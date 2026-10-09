// 5wan.yaru.ai (moving to start.yaru.ai) — Thai 1-day course landing page with Beam checkout.
// Serves the static landing page from public/, turns a form submission into a Beam
// payment link, records the order, and marks it paid when Beam confirms.
//
// Env (Replit Secrets):
//   DATABASE_URL            Postgres connection string (Replit "Database" tool sets this)
//   ADMIN_PASSWORD          password for /admin (the orders list) and /admin/orders.csv
//   BEAM_MERCHANT_ID        Beam Lighthouse → Developers
//   BEAM_API_KEY            Beam Lighthouse → Developers → API Key (secret, server only)
//   BEAM_WEBHOOK_HMAC_KEY   Beam Lighthouse → Developers → Webhooks → your webhook's HMAC key
//   BEAM_ENV                "playground" (test money, default) or "production" (real money)
//   PUBLIC_BASE_URL         optional, e.g. https://start.yaru.ai — where Beam sends buyers back
//                           (an old https://5wan.yaru.ai value is treated as https://start.yaru.ai)
//   TIKTOK_ACCESS_TOKEN     optional: TikTok Events API token (Events Manager → pixel → Generate access token);
//                           when set, each paid order is reported to TikTok as a Purchase from the server
//   TIKTOK_TEST_EVENT_CODE  optional: send Events API calls to TikTok's "Test events" instead of live data
//   TEST_CHECKOUT_CODE      optional: visiting /?test=<code> makes any tier a real ฿20 charge,
//                           for end-to-end testing; such orders are marked TEST in /admin
//   PORT                    optional, defaults to 3000
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const IS_DEPLOYED = process.env.REPLIT_DEPLOYMENT === "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const LOCAL_FILE = path.join(__dirname, "data", "orders.local.json");

// Prices live here, never in the browser: the form only says which package.
// Amounts are in satang (Beam uses the smallest currency unit): 399000 = ฿3,990.
// storeLink: the reusable Beam link made in Lighthouse for that tier. It is used when
// the Beam API keys aren't set; with keys, a one-off payment link is created per order
// instead (tracks each payment automatically and sends the buyer to /thank-you).
const PACKAGES = {
  essential: { label: "Essential", item: "คอร์ส 1 วัน: แพ็กเกจพื้นฐาน", amount: 399000,
           storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/EssentialT1" },
  vip: { label: "VIP", item: "คอร์ส 1 วัน: แพ็กเกจ VIP", amount: 999000,
         storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/VIPT1" },
  coaching: { label: "1:1 Coaching", item: "โค้ชชิ่งแบบตัวต่อตัว (1 เดือน)", amount: 25000000,
              storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/1on1Coach" },
};
// Test checkouts: real Beam payment for ฿20 (2000 satang) instead of the tier price.
const TEST_AMOUNT = 2000;
const TEST_CODE = process.env.TEST_CHECKOUT_CODE || "";
// Purchase destinations (TikTok, Google, the thank-you page's tags) only ever get real-money
// orders on the production Beam account. ฿20 test orders ("production-test"), playground
// orders and store-link orders (amount not verified per order) never count as purchases.
const isProductionOrder = (r) => r.beam_env === "production";
// For reports: real money received (production API orders + matched store-link orders).
const isRealOrder = (r) => r.beam_env === "production" || r.beam_env === "store_link";

// Ad-click attribution kept with each order. The landing page saves the first and the latest
// ad visit (allowlisted URL parameters + timestamp) and sends both with the checkout.
// Policy: order columns (utm_source, …, ttclid) = LAST ad touch before checkout; the first
// touch is kept alongside in params._attr.first. Identifiers are stored exactly as received.
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
  "gclid", "gbraid", "wbraid", "ttclid", "ldtag_cl"];
const SAFE_VALUE = /^[^\u0000-\u001f<>"'`\\]{1,300}$/;
function cleanTouch(t) {
  if (!t || typeof t !== "object") return null;
  const out = {};
  for (const k of ATTR_KEYS) if (typeof t[k] === "string" && SAFE_VALUE.test(t[k])) out[k] = t[k];
  if (!Object.keys(out).length) return null;
  if (typeof t.ts === "string" && !isNaN(Date.parse(t.ts))) out.ts = new Date(t.ts).toISOString();
  if (typeof t.landing === "string") out.landing = t.landing.slice(0, 200);
  return out;
}

const AD_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid"];

const BEAM = {
  env: process.env.BEAM_ENV === "production" ? "production" : "playground",
  merchantId: process.env.BEAM_MERCHANT_ID || "",
  apiKey: process.env.BEAM_API_KEY || "",
  hmacKey: process.env.BEAM_WEBHOOK_HMAC_KEY || "",
};
BEAM.api =
  process.env.BEAM_API_BASE || // local testing against a mock only
  (BEAM.env === "production" ? "https://api.beamcheckout.com" : "https://playground.api.beamcheckout.com");
BEAM.ready = Boolean(BEAM.merchantId && BEAM.apiKey);

// TikTok Events API: the server reports each paid order as CompletePayment ("Purchase") with
// SHA-256-hashed email and phone. event_id = order number, the same as the browser event on
// /thank-you, so TikTok counts the purchase once.
const TIKTOK = {
  token: process.env.TIKTOK_ACCESS_TOKEN || "",
  pixel: "DB3I03JC77U04C8M6HN0",
  testCode: process.env.TIKTOK_TEST_EVENT_CODE || "",
  api: process.env.TIKTOK_API_BASE || "https://business-api.tiktok.com", // override for local testing only
};
// The site moved from 5wan.yaru.ai to start.yaru.ai. Links we generate (Beam's return
// address, TikTok's page URL) always use the current domain, even if PUBLIC_BASE_URL
// still holds the old one.
const SITE_URL = "https://start.yaru.ai";
const OLD_HOSTS = ["5wan.yaru.ai"];
function siteBase(fallback) {
  const base = (process.env.PUBLIC_BASE_URL || fallback || SITE_URL).replace(/\/+$/, "");
  try {
    if (OLD_HOSTS.includes(new URL(base).hostname)) return SITE_URL;
  } catch {}
  return base;
}
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const toE164 = (p) => {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d;
  if (d.startsWith("66")) return "+" + d;
  return d.startsWith("0") ? "+66" + d.slice(1) : "+66" + d;
};
// Sends one paid order to the TikTok Events API as CompletePayment (same event name and
// event_id = order number as the browser event on /thank-you, so TikTok keeps one).
// Returns { ok, ack } or { ok: false, error }. Called only by the delivery queue below.
async function sendTikTokPurchase(order) {
  const email = String(order.email || "").trim().toLowerCase();
  const tel = toE164(order.phone);
  const attr = order.params?._attr || {};
  const ttclid = attr.last?.ttclid || attr.first?.ttclid || order.ttclid || "";
  const user = {};
  if (email) user.email = sha256(email);
  if (tel) user.phone = sha256(tel);
  if (ttclid) user.ttclid = ttclid; // Events API 2.0: data[].user.ttclid, sent as received
  const body = {
    event_source: "web",
    event_source_id: TIKTOK.pixel,
    ...(TIKTOK.testCode ? { test_event_code: TIKTOK.testCode } : {}),
    data: [{
      event: "CompletePayment",
      event_time: Math.floor(new Date(order.paid_at || Date.now()).getTime() / 1000),
      event_id: order.ref,
      user,
      properties: {
        currency: "THB",
        value: Number(order.amount) / 100, // satang -> baht, once
        contents: [{ content_id: order.package, content_type: "product", quantity: 1 }],
      },
      page: { url: `${siteBase()}/thank-you` },
    }],
  };
  try {
    const res = await fetch(`${TIKTOK.api}/open_api/v1.3/event/track/`, {
      method: "POST",
      headers: { "Access-Token": TIKTOK.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.code === 0) return { ok: true, ack: data.request_id || "code 0" };
    return { ok: false, error: `${res.status} ${data.code ?? ""} ${String(data.message || "").slice(0, 200)}`.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Beam payment-link statuses -> our order status.
const LINK_STATUS = { ACTIVE: "pending", PAID: "paid", EXPIRED: "expired", DISABLED: "cancelled", VOIDED: "refunded", REFUNDED: "refunded" };

// ---------------------------------------------------------------------------
// Storage: Postgres when DATABASE_URL is set; a local JSON file otherwise
// (local testing only — deployed instances refuse to run without Postgres,
// because Replit deployments don't keep files written at runtime).
// The old `waitlist` table, if present, is left untouched.
// ---------------------------------------------------------------------------
function createStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return {
      kind: "postgres",
      async init() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS orders (
            id              SERIAL PRIMARY KEY,
            ref             TEXT NOT NULL UNIQUE,
            name            TEXT NOT NULL,
            email           TEXT NOT NULL,
            package         TEXT NOT NULL,
            amount          INTEGER NOT NULL,
            currency        TEXT NOT NULL DEFAULT 'THB',
            status          TEXT NOT NULL DEFAULT 'pending',
            beam_env        TEXT,
            payment_link_id TEXT,
            phone           TEXT,
            payment_method  TEXT,
            utm_source      TEXT, utm_medium TEXT, utm_campaign TEXT,
            utm_content     TEXT, utm_term   TEXT, ttclid       TEXT,
            params          JSONB,
            referrer        TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            paid_at         TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS orders_payment_link_id ON orders (payment_link_id);
        `);
      },
      async create(o) {
        await pool.query(
          `INSERT INTO orders (ref, name, email, package, amount, beam_env, utm_source, utm_medium,
                               utm_campaign, utm_content, utm_term, ttclid, params, referrer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [o.ref, o.name, o.email, o.package, o.amount, o.beam_env, ...AD_FIELDS.map((f) => o[f]), o.params, o.referrer]
        );
      },
      async update(ref, fields) {
        const keys = Object.keys(fields);
        await pool.query(
          `UPDATE orders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE ref = $1`,
          [ref, ...keys.map((k) => fields[k])]
        );
      },
      async byLink(linkId) {
        const r = await pool.query("SELECT * FROM orders WHERE payment_link_id = $1", [linkId]);
        return r.rows[0] || null;
      },
      async byRef(ref) {
        const r = await pool.query("SELECT * FROM orders WHERE ref = $1", [ref]);
        return r.rows[0] || null;
      },
      // Idempotent paid transition: only one caller (webhook, retry, refresh) gets the row back.
      async markPaid(ref, fields, paidAt) {
        const keys = Object.keys(fields);
        const r = await pool.query(
          `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, $2)${keys.map((k, i) => `, ${k} = $${i + 3}`).join("")}
           WHERE ref = $1 AND status NOT IN ('paid', 'refunded', 'partially_refunded') RETURNING *`,
          [ref, paidAt, ...keys.map((k) => fields[k])]
        );
        return r.rows[0] || null;
      },
      async mergeParams(ref, obj) {
        await pool.query("UPDATE orders SET params = COALESCE(params, '{}'::jsonb) || $2::jsonb WHERE ref = $1", [ref, JSON.stringify(obj)]);
      },
      async setDelivery(ref, platform, state) {
        await pool.query(
          `UPDATE orders SET params = jsonb_set(COALESCE(params, '{}'::jsonb) || jsonb_build_object('_delivery', COALESCE(params->'_delivery', '{}'::jsonb)),
             ARRAY['_delivery', $2::text], $3::jsonb) WHERE ref = $1`,
          [ref, platform, JSON.stringify(state)]
        );
      },
      // Claim a due delivery for this instance (lease), so two instances don't send at once.
      async claimDelivery(ref, platform, leaseUntil, now) {
        const r = await pool.query(
          `UPDATE orders SET params = jsonb_set(params, ARRAY['_delivery', $2::text, 'lease_until'], to_jsonb($3::text))
           WHERE ref = $1 AND params->'_delivery'->$2->>'status' = 'pending'
             AND COALESCE(params->'_delivery'->$2->>'lease_until', '') < $4 RETURNING ref`,
          [ref, platform, leaseUntil, now]
        );
        return r.rowCount === 1;
      },
      async list() {
        const r = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
        return r.rows;
      },
    };
  }

  if (IS_DEPLOYED) {
    throw new Error("DATABASE_URL is not set. Create a PostgreSQL database in Replit before deploying.");
  }
  console.warn("[orders] DATABASE_URL not set — saving to", LOCAL_FILE, "(local testing only)");
  const read = () => (fs.existsSync(LOCAL_FILE) ? JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")) : []);
  const write = (rows) => fs.writeFileSync(LOCAL_FILE, JSON.stringify(rows, null, 2));
  return {
    kind: "local-file",
    async init() {
      fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    },
    async create(o) {
      const rows = read();
      rows.push({ id: rows.length + 1, ...o, currency: "THB", status: "pending", created_at: new Date().toISOString(), paid_at: null });
      write(rows);
    },
    async update(ref, fields) {
      write(read().map((r) => (r.ref === ref ? { ...r, ...fields } : r)));
    },
    async byLink(linkId) {
      return read().find((r) => r.payment_link_id === linkId) || null;
    },
    async byRef(ref) {
      return read().find((r) => r.ref === ref) || null;
    },
    async markPaid(ref, fields, paidAt) {
      const rows = read();
      const row = rows.find((r) => r.ref === ref && !["paid", "refunded", "partially_refunded"].includes(r.status));
      if (!row) return null;
      Object.assign(row, fields, { status: "paid", paid_at: row.paid_at || paidAt });
      write(rows);
      return { ...row };
    },
    async mergeParams(ref, obj) {
      write(read().map((r) => (r.ref === ref ? { ...r, params: { ...(r.params || {}), ...obj } } : r)));
    },
    async setDelivery(ref, platform, state) {
      write(read().map((r) => (r.ref === ref
        ? { ...r, params: { ...(r.params || {}), _delivery: { ...(r.params?._delivery || {}), [platform]: state } } } : r)));
    },
    async claimDelivery(ref, platform, leaseUntil, now) {
      const rows = read();
      const d = rows.find((r) => r.ref === ref)?.params?._delivery?.[platform];
      if (!d || d.status !== "pending" || (d.lease_until || "") >= now) return false;
      d.lease_until = leaseUntil;
      write(rows);
      return true;
    },
    async list() {
      return read().reverse();
    },
  };
}

// ---------------------------------------------------------------------------
// Beam API
// ---------------------------------------------------------------------------
async function beamRequest(method, urlPath, body, idempotencyKey) {
  const headers = {
    Authorization: "Basic " + Buffer.from(`${BEAM.merchantId}:${BEAM.apiKey}`).toString("base64"),
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["x-beam-idempotency-key"] = idempotencyKey;
  const res = await fetch(BEAM.api + urlPath, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Beam ${method} ${urlPath} -> ${res.status} ${data?.error?.errorCode || ""} ${data?.error?.errorMessage || ""}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

// Beam signs the raw request body with HMAC-SHA256 (base64 key, base64 signature).
function validBeamSignature(rawBody, signature) {
  if (!BEAM.hmacKey || !signature) return false;
  const expected = crypto.createHmac("sha256", Buffer.from(BEAM.hmacKey, "base64")).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// A provider "paid" message only counts if it is for this exact order: same reference,
// same amount in satang (the unit we sent Beam), THB.
function matchesOrder(order, { amount, currency, referenceId }) {
  const problems = [];
  if (Number(amount) !== Number(order.amount)) problems.push(`amount ${amount} != ${order.amount}`);
  if (currency !== "THB") problems.push(`currency ${currency}`);
  if (referenceId !== undefined && referenceId !== order.ref) problems.push(`reference ${referenceId}`);
  return problems;
}

// Mark an order paid once (idempotent), record the provider IDs, reload the saved record and
// queue purchase delivery from it. Returns the saved order.
async function confirmPaid(store, order, source, extra = {}, fields = {}) {
  const prevBeam = order.params?._beam || {};
  const updated = await store.markPaid(order.ref, fields, extra.paidAt || new Date().toISOString());
  await store.mergeParams(order.ref, { _beam: { ...prevBeam, ...extra.beam, ...(updated ? { confirmed_by: source, confirmed_at: new Date().toISOString() } : {}) } });
  const saved = await store.byRef(order.ref);
  if (updated) {
    console.log(`[beam] order ${order.ref} paid (${order.package}) via ${source}`);
    await enqueuePurchaseDelivery(store, saved);
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Purchase delivery queue (server -> TikTok Events API). State lives on the order
// (params._delivery.tiktok): pending -> sent (TikTok answered code 0) | failed (gave up) |
// skipped (no token / consent denied) | cancelled (order no longer paid before sending).
// Retries with backoff; a lease stops two instances sending the same order at once.
// "sent" means TikTok accepted the request, not that the sale was attributed to an ad.
// ---------------------------------------------------------------------------
const DELIVERY_MAX_ATTEMPTS = 10;
async function enqueuePurchaseDelivery(store, order) {
  if (!order || order.status !== "paid" || !isProductionOrder(order)) return;
  if (order.params?._delivery?.tiktok) return; // already queued or done
  const now = new Date();
  const state = !TIKTOK.token
    ? { status: "skipped", reason: "TIKTOK_ACCESS_TOKEN not set" }
    : order.params?._attr?.consent === "denied"
      ? { status: "skipped", reason: "ad consent denied" }
      : { status: "pending", event: "CompletePayment", event_id: order.ref, attempts: 0, queued_at: now.toISOString(),
          // short delay so Beam's charge webhook (buyer's phone) can land first
          next_at: new Date(now.getTime() + 15000).toISOString() };
  await store.setDelivery(order.ref, "tiktok", state);
  if (state.status === "pending") setTimeout(() => processDeliveries(store).catch((e) => console.warn("[delivery]", e.message)), 16000);
}

let deliveryRunning = false;
async function processDeliveries(store) {
  if (deliveryRunning) return;
  deliveryRunning = true;
  try {
    const now = Date.now();
    const due = (await store.list()).filter((r) => {
      const d = r.params?._delivery?.tiktok;
      return d && d.status === "pending" && Date.parse(d.next_at || 0) <= now;
    });
    for (const r of due) {
      const nowIso = new Date().toISOString();
      if (!(await store.claimDelivery(r.ref, "tiktok", new Date(Date.now() + 5 * 60000).toISOString(), nowIso))) continue;
      const order = await store.byRef(r.ref); // reload the saved record before sending
      const st = { ...order.params._delivery.tiktok, lease_until: null };
      if (order.status !== "paid" || !isProductionOrder(order)) {
        await store.setDelivery(order.ref, "tiktok", { ...st, status: "cancelled", reason: `order is ${order.status}` });
        continue;
      }
      const result = await sendTikTokPurchase(order);
      st.attempts = (st.attempts || 0) + 1;
      st.last_attempt_at = new Date().toISOString();
      if (result.ok) {
        Object.assign(st, { status: "sent", ack: result.ack, sent_at: st.last_attempt_at, last_error: null });
        console.log(`[tiktok] purchase ${order.ref} accepted${TIKTOK.testCode ? " (test events)" : ""}`);
      } else {
        st.last_error = result.error;
        if (st.attempts >= DELIVERY_MAX_ATTEMPTS) st.status = "failed";
        else st.next_at = new Date(Date.now() + Math.min(2 ** st.attempts * 60000, 6 * 3600000)).toISOString();
        console.warn(`[tiktok] purchase ${order.ref} attempt ${st.attempts} failed: ${result.error}`);
      }
      await store.setDelivery(order.ref, "tiktok", st);
    }
  } finally {
    deliveryRunning = false;
  }
}

// Ask Beam for a pending order's link status (backup for missed webhooks).
async function refreshFromBeam(store, order) {
  if (!BEAM.ready || order.status !== "pending" || !order.payment_link_id || String(order.beam_env).replace(/-test$/, "") !== BEAM.env) return;
  const link = await beamRequest("GET", `/api/v1/payment-links/${encodeURIComponent(order.payment_link_id)}`);
  const status = LINK_STATUS[link.status];
  if (!status || status === order.status) return;
  if (status === "paid") {
    const problems = matchesOrder(order, { amount: link.order?.netAmount, currency: link.order?.currency, referenceId: link.order?.referenceId });
    if (problems.length) {
      console.warn(`[beam] order ${order.ref}: paid link does not match the order (${problems.join(", ")}); not marked paid`);
      return;
    }
    Object.assign(order, await confirmPaid(store, order, "beam_api_refresh", { beam: { paid_amount_satang: Number(link.order.netAmount) } }));
  } else {
    await store.update(order.ref, { status });
    order.status = status;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Channel of an order = its last ad touch: click IDs first, then utm_source.
function channelOf(r) {
  const a = r.params?._attr || {};
  const t = a.last || a.first || r;
  if (t.gclid || t.gbraid || t.wbraid) return "google";
  if (t.ttclid) return "tiktok";
  if (t.ldtag_cl) return "line";
  const src = String(t.utm_source || r.utm_source || "").toLowerCase();
  return src || "direct/unknown";
}
// Beam's refund amount unit isn't documented; treat a value equal to the order in satang as satang.
const refundAmountBaht = (r, f) => (Number(f.amount) === Number(r.amount) || Number(f.amount) > Number(r.amount) / 100 ? Number(f.amount) / 100 : Number(f.amount));
const refundedBaht = (r) => (r.params?._refunds || []).reduce((s, f) => s + refundAmountBaht(r, f), 0);
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const baht = (satang) => "฿" + (Number(satang || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Naive per-IP limit so a bot can't flood checkouts: 10 per 10 min.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10000) hits.clear();
  return recent.length > 10;
}

function checkAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).send("Admin is disabled: set ADMIN_PASSWORD in Replit Secrets.");
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  const given = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Yaru 1-day course admin", charset="UTF-8"').status(401).send("Login required");
}

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Prefix cells that Excel would treat as formulas.
const csvCell = (v) => {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) : "";

const STATUS_COLOR = { partially_refunded: "#7a6f63", paid: "#1f7a3a", pending: "#9a6b00", expired: "#7a6f63", cancelled: "#7a6f63", refunded: "#7a6f63", error: "#c62a35" };

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
async function main() {
  const store = createStore();
  await store.init();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  // Beam webhook: needs the raw body for the signature, so it's registered before express.json().
  app.post("/api/beam/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    if (!BEAM.hmacKey) return res.status(503).send("Webhook key not configured");
    if (!validBeamSignature(req.body, req.get("x-beam-signature"))) return res.status(401).send("Bad signature");
    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).send("Bad JSON");
    }
    const type = req.get("x-beam-event") || "";
    const phoneOf = (c, fallback) => {
      const p = c?.primaryPhone; // Thai numbers arrive as 0XXXXXXXXX: keep that local format
      return p?.number ? (p.number.startsWith("0") ? p.number : `${p.countryCode || ""}${p.number}`) : fallback || null;
    };
    try {
      if (type === "payment_link.paid" && event.paymentLinkId) {
        // The authoritative "paid": amount (satang), currency and reference must match the order.
        const order = await store.byLink(event.paymentLinkId);
        if (!order) console.warn(`[beam] payment_link.paid for unknown link ${event.paymentLinkId}`);
        else if (order.status === "paid") console.log(`[beam] duplicate payment_link.paid for ${order.ref} ignored`);
        else {
          const problems = matchesOrder(order, { amount: event.order?.netAmount, currency: event.order?.currency, referenceId: event.order?.referenceId });
          if (problems.length) {
            console.warn(`[beam] payment_link.paid for ${order.ref} does not match the order (${problems.join(", ")}); not marked paid`);
            await store.mergeParams(order.ref, { _beam: { ...(order.params?._beam || {}), mismatch: problems.join(", "), mismatch_at: new Date().toISOString() } });
          } else {
            await confirmPaid(store, order, "payment_link.paid", { beam: { paid_amount_satang: Number(event.order.netAmount), payment_link_id: event.paymentLinkId } });
          }
        }
      } else if (type === "charge.succeeded" && event.source !== "PAYMENT_LINK") {
        // Store-link payment: no order ref, so match the newest unpaid store-link order
        // with the same email and amount from the last 3 days. Unmatched ones are logged.
        // (Store-link orders are counted in reports but never sent to ad platforms.)
        const email = String(event.customer?.email || "").trim().toLowerCase();
        const order = (await store.list()).find(
          (r) => r.beam_env === "store_link" && r.status === "pending" && email && r.email === email &&
            Number(r.amount) === Number(event.amount) && Date.now() - new Date(r.created_at) < 3 * 864e5
        );
        if (order) {
          await confirmPaid(store, order, "charge.succeeded (store link)", { paidAt: event.transactionTime, beam: { charge_id: event.chargeId } },
            { phone: phoneOf(event.customer, order.phone), payment_method: event.paymentMethod?.paymentMethodType || null });
          console.log(`[beam] store-link order ${order.ref} matched to charge ${event.chargeId}`);
        } else {
          console.log(`[beam] store-link charge ${event.chargeId} (${event.amount}) not matched to an order`);
        }
      } else if (type === "charge.succeeded" && event.source === "PAYMENT_LINK" && event.sourceId) {
        // Carries the buyer's phone, payment method and charge ID. It also confirms payment,
        // but only when its amount matches the order exactly; otherwise payment_link.paid does.
        const order = await store.byLink(event.sourceId);
        if (order) {
          const fields = {
            phone: phoneOf(event.customer, order.phone),
            payment_method: event.paymentMethod?.paymentMethodType || order.payment_method || null,
          };
          await store.update(order.ref, fields);
          const beam = { ...(order.params?._beam || {}), charge_id: event.chargeId || null };
          if (order.status !== "paid" && event.status === "SUCCEEDED" &&
              !matchesOrder(order, { amount: event.amount, currency: event.currency, referenceId: event.referenceId || undefined }).length) {
            await confirmPaid(store, { ...order, params: { ...order.params, _beam: beam } }, "charge.succeeded", { paidAt: event.transactionTime, beam });
          } else {
            await store.mergeParams(order.ref, { _beam: beam });
          }
        }
      } else if (type === "refund.succeeded" && /^5W-[0-9A-F]{10}$/.test(String(event.referenceId || ""))) {
        // Refunds are recorded on the order and shown in reports. Purchase events already sent
        // to ad platforms are not reversed from here.
        const order = await store.byRef(event.referenceId);
        if (order) {
          const refunds = (order.params?._refunds || []).filter((r) => r.refund_id !== event.refundId);
          refunds.push({ refund_id: event.refundId, charge_id: event.chargeId, amount: event.amount, currency: event.currency, at: event.transactionTime || new Date().toISOString() });
          await store.mergeParams(order.ref, { _refunds: refunds });
          // Beam's refund amount unit isn't documented: a full refund matches the order in satang or baht.
          const full = refunds.some((r) => Number(r.amount) === Number(order.amount) || Number(r.amount) * 100 === Number(order.amount));
          await store.update(order.ref, { status: full ? "refunded" : "partially_refunded" });
          console.log(`[beam] order ${order.ref} ${full ? "refunded" : "partially refunded"} (${event.refundId})`);
        }
      }
      res.status(200).send("ok");
      processDeliveries(store).catch((e) => console.warn("[delivery]", e.message)); // retries due now
    } catch (err) {
      console.error(`[beam] webhook ${type} failed:`, err.message);
      res.status(500).send("error"); // Beam retries
    }
  });

  app.use(express.json({ limit: "10kb" }));

  app.post("/api/checkout", async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ message: "Too many requests" });
    const name = clip(req.body?.name, 100);
    const email = clip(req.body?.email, 254).toLowerCase();
    const pkgKey = clip(req.body?.package, 20);
    const pkg = PACKAGES[pkgKey];
    if (!name || !EMAIL_RE.test(email) || !pkg) return res.status(400).json({ message: "Invalid name, email or package" });

    const params = {};
    for (const [k, v] of Object.entries(req.body?.params || {}).slice(0, 30)) {
      const key = clip(k, 50);
      if (key && !key.startsWith("_")) params[key] = clip(v, 300); // "_" keys are reserved for our own data
    }
    const first = cleanTouch(req.body?.attribution?.first), last = cleanTouch(req.body?.attribution?.last);
    const consent = ["granted", "denied"].includes(req.body?.attribution?.consent) ? req.body.attribution.consent : "not_collected";
    const isTest = Boolean(TEST_CODE) && BEAM.ready && params.test === TEST_CODE;
    delete params.test; // never store the code
    const ref = "5W-" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const amount = isTest ? TEST_AMOUNT : pkg.amount;
    const order = { ref, name, email, package: pkgKey, amount, beam_env: BEAM.env + (isTest ? "-test" : ""), params, referrer: clip(req.body?.referrer, 500) };
    // Columns = last ad touch (from the saved visit, or the current URL); first touch kept in params._attr.
    const touch = last || first || cleanTouch(params) || {};
    for (const f of AD_FIELDS) order[f] = touch[f] || null;
    params._attr = { policy: "columns=last_touch", first, last, consent };

    if (!BEAM.ready) {
      // No API keys: save the buyer, then send them to the tier's reusable Beam link.
      order.beam_env = "store_link";
      try {
        await store.create(order);
        console.log(`[checkout] order ${ref} -> store link (${pkgKey}, source: ${order.utm_source || "direct"})`);
        return res.json({ url: pkg.storeLink, value: amount / 100, currency: "THB" });
      } catch (err) {
        console.error(`[checkout] order ${ref} failed:`, err.message);
        return res.status(500).json({ message: "Could not start payment" });
      }
    }

    const base = siteBase(`${req.protocol}://${req.get("host")}`);
    try {
      await store.create(order);
      const link = await beamRequest(
        "POST",
        "/api/v1/payment-links",
        {
          order: {
            currency: "THB",
            netAmount: amount,
            description: `Yaru 1-Day Course – ${pkg.label}${isTest ? " (TEST ฿20)" : ""}`,
            referenceId: ref,
            orderItems: [{ itemName: pkg.item + (isTest ? " (ทดสอบ)" : ""), price: amount, quantity: 1, productId: pkgKey }],
          },
          // The account has no default methods for API links, so list them (Beam rejects a link with none).
          linkSettings: {
            card: { isEnabled: true },
            qrPromptPay: { isEnabled: true },
            eWallets: { isEnabled: true },
            mobileBanking: { isEnabled: true },
            cardInstallments: { isEnabled: false },
            buyNowPayLater: { isEnabled: false },
          },
          collectPhoneNumber: true,
          redirectUrl: `${base}/thank-you?tier=${pkgKey}&order=${ref}${isTest ? "&test=1" : ""}`, // separate confirmation page; tier lets ad tags report the value
          cancelUrl: `${base}/?payment=cancelled#signup`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        ref
      );
      await store.update(ref, { payment_link_id: link.id });
      console.log(`[checkout] order ${ref} created (${pkgKey}, ${order.beam_env}, source: ${order.utm_source || "direct"})`);
      res.json({ url: link.url, value: amount / 100, currency: "THB" }); // value in baht, for Begin checkout
    } catch (err) {
      console.error(`[checkout] order ${ref} failed:`, err.message);
      await store.update(ref, { status: "error" }).catch(() => {});
      res.status(502).json({ message: "Could not start payment" });
    }
  });

  // Payment status for the confirmation page, so ad purchase tags fire only for orders the
  // server has confirmed paid (webhook, or a direct check with Beam here). Returns no buyer
  // details: just status, package and the amount actually charged.
  const statusChecks = new Map();
  app.get("/api/order-status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const ref = clip(req.query.order, 20);
    if (!/^5W-[0-9A-F]{10}$/.test(ref)) return res.status(400).json({ message: "Invalid order" });
    try {
      const order = await store.byRef(ref);
      if (!order) return res.status(404).json({ message: "Not found" });
      // The redirect can beat the webhook: ask Beam directly, at most every 5 s per order.
      if (order.status === "pending" && Date.now() - (statusChecks.get(ref) || 0) > 5000) {
        statusChecks.set(ref, Date.now());
        if (statusChecks.size > 5000) statusChecks.clear();
        await refreshFromBeam(store, order).catch((e) => console.warn("[status] refresh", ref, e.message));
      }
      // value is in baht (amounts are stored in satang).
      res.json({ order: order.ref, status: order.status, package: order.package, value: Number(order.amount) / 100, currency: order.currency || "THB", test: !isProductionOrder(order) });
    } catch (err) {
      console.error("[status]", ref, err.message);
      res.status(500).json({ message: "error" });
    }
  });

  app.get("/admin", checkAdmin, async (_req, res) => {
    const rows = await store.list();
    // Catch up on payments whose webhook hasn't arrived (recent pending orders only).
    const recentPending = rows.filter((r) => r.status === "pending" && Date.now() - new Date(r.created_at) < 3 * 864e5).slice(0, 25);
    for (const r of recentPending) await refreshFromBeam(store, r).catch((e) => console.warn("[admin] refresh", r.ref, e.message));

    const paid = rows.filter((r) => r.status === "paid" && isRealOrder(r));
    const testCount = rows.filter((r) => !isRealOrder(r)).length;
    const byPackage = {};
    for (const r of paid) {
      const k = PACKAGES[r.package]?.label || r.package;
      byPackage[k] = byPackage[k] || { n: 0, sum: 0 };
      byPackage[k].n += 1;
      byPackage[k].sum += Number(r.amount);
    }
    const revenue = paid.reduce((s, r) => s + Number(r.amount), 0);
    const mode = BEAM.ready
      ? BEAM.env === "production" ? "LIVE payments (Beam API)" : "TEST payments (Beam playground)"
      : "Beam store links: confirm payments in Beam Lighthouse";
    res.set("Cache-Control", "no-store").send(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>1-day course orders (${paid.length} paid)</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f1a14;background:#f7f3ee}
h1{margin:0 0 4px}.muted{color:#7a6f63}table{border-collapse:collapse;width:100%;background:#fff;margin-top:16px}
th,td{padding:8px 10px;border-bottom:1px solid #e6dfd6;text-align:left;font-size:14px;vertical-align:top;white-space:nowrap}
th{background:#c62a35;color:#fff;position:sticky;top:0}a.btn{display:inline-block;margin-top:12px;padding:8px 14px;
background:#c62a35;color:#fff;border-radius:8px;text-decoration:none}.wrap{overflow-x:auto}
.mode{display:inline-block;padding:2px 10px;border-radius:999px;background:${BEAM.env === "production" && BEAM.ready ? "#1f7a3a" : "#9a6b00"};color:#fff;font-size:12px}</style></head><body>
<h1>Orders: ${paid.length} paid · ${esc(baht(revenue))}</h1>
<div class="muted"><span class="mode">${esc(mode)}</span> · storage: ${store.kind}</div>
<div class="muted">Paid by package: ${Object.entries(byPackage).map(([k, v]) => `${esc(k)} ${v.n} (${esc(baht(v.sum))})`).join(" · ") || "none yet"}</div>
${testCount ? `<div class="muted">Test / playground orders (not counted above): ${testCount}</div>` : ""}
<div class="muted"><a href="/admin/report">Daily report (read-only)</a></div>
<div class="muted">Not marked paid: ${rows.filter((r) => r.status !== "paid" && isRealOrder(r)).length}${BEAM.ready ? " (pending, expired, cancelled or failed)" : " (sent to Beam; with store links, check Beam Lighthouse for who actually paid)"}</div>
<a class="btn" href="/admin/orders.csv">Download CSV</a>
<div class="wrap"><table><thead><tr><th>Created (Bangkok)</th><th>Status</th><th>Order</th><th>Name</th><th>Email</th><th>Phone</th><th>Package</th><th>Amount</th><th>Paid (Bangkok)</th><th>Method</th><th>utm_source</th><th>utm_campaign</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(fmtDate(r.created_at))}</td><td style="color:${STATUS_COLOR[r.status] || "#1f1a14"};font-weight:600">${esc(r.status)}${!isRealOrder(r) ? ' <span style="background:#1f1a14;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">TEST</span>' : ""}</td><td>${esc(r.ref)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(PACKAGES[r.package]?.label || r.package)}</td><td>${esc(baht(r.amount))}</td><td>${esc(fmtDate(r.paid_at))}</td><td>${esc(r.payment_method)}</td><td>${esc(r.utm_source)}</td><td>${esc(r.utm_campaign)}</td></tr>`).join("\n")}
</tbody></table></div></body></html>`);
  });

  app.get("/admin/orders.csv", checkAdmin, async (_req, res) => {
    const rows = await store.list();
    const cols = ["created_at", "status", "ref", "name", "email", "phone", "package", "amount_thb", "paid_at", "payment_method", "beam_env", "payment_link_id",
      ...AD_FIELDS, "channel", ...ATTR_KEYS.map((k) => "first_" + k), "first_touch_at", ...ATTR_KEYS.map((k) => "last_" + k), "last_touch_at",
      "consent", "beam_charge_id", "refunded_thb", "tiktok_server_delivery", "referrer"];
    const value = (r, c) => {
      const a = r.params?._attr || {};
      if (c === "amount_thb") return Number(r.amount) / 100;
      if (c === "created_at" || c === "paid_at") return r[c] ? new Date(r[c]).toISOString() : "";
      if (c === "channel") return channelOf(r);
      if (c.startsWith("first_") || c.startsWith("last_")) {
        const [which, ...rest] = c.split("_"); const k = rest.join("_");
        return k === "touch_at" ? a[which]?.ts || "" : a[which]?.[k] || "";
      }
      if (c === "consent") return a.consent || "";
      if (c === "beam_charge_id") return r.params?._beam?.charge_id || "";
      if (c === "refunded_thb") return refundedBaht(r) || "";
      if (c === "tiktok_server_delivery") return r.params?._delivery?.tiktok?.status || "";
      return r[c];
    };
    const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(value(r, c))).join(","))];
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="yaru-1day-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    res.send("﻿" + lines.join("\r\n")); // BOM so Excel shows Thai names correctly
  });

  // Daily value-for-money report. Read-only: it never asks Beam for updates and never sends
  // events (unlike /admin, which refreshes pending orders). Counts unique real-money orders
  // by Bangkok day and channel (last ad touch). Ad spend and each platform's own attributed
  // purchases come from the ad platforms, not from here; don't add those to these counts.
  app.get(["/admin/report", "/admin/report.csv"], checkAdmin, async (req, res) => {
    const rows = (await store.list()).filter(isRealOrder);
    const day = (d) => new Date(new Date(d).getTime() + 7 * 3600000).toISOString().slice(0, 10);
    const buckets = new Map();
    const get = (d, ch) => {
      const k = d + "|" + ch;
      if (!buckets.has(k)) buckets.set(k, { date: d, channel: ch, paid_orders: 0, revenue_thb: 0, refunds: 0, refunded_thb: 0, with_click_id: 0, with_any_source: 0 });
      return buckets.get(k);
    };
    for (const r of rows) {
      const ch = channelOf(r);
      if (["paid", "refunded", "partially_refunded"].includes(r.status) && r.paid_at) {
        const b = get(day(r.paid_at), ch);
        b.paid_orders += 1;
        b.revenue_thb += Number(r.amount) / 100;
        const a = r.params?._attr || {};
        const t = { ...(a.first || {}), ...(a.last || {}), ...r };
        if (t.gclid || t.gbraid || t.wbraid || t.ttclid || t.ldtag_cl) b.with_click_id += 1;
        if (ch !== "direct/unknown") b.with_any_source += 1;
      }
      for (const f of r.params?._refunds || []) {
        const b = get(day(f.at), ch);
        b.refunds += 1;
        b.refunded_thb += refundAmountBaht(r, f);
      }
    }
    const out = [...buckets.values()].sort((x, y) => (x.date + x.channel).localeCompare(y.date + y.channel));
    const cols = ["date", "channel", "paid_orders", "revenue_thb", "refunds", "refunded_thb", "with_any_source", "with_click_id", "spend_thb"];
    res.set("Cache-Control", "no-store");
    if (req.path.endsWith(".csv")) {
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="yaru-daily-report-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.send("\ufeff" + [cols.join(","), ...out.map((b) => cols.map((c) => csvCell(c === "spend_thb" ? "" : b[c])).join(","))].join("\r\n"));
    }
    res.send(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Daily report</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f1a14;background:#f7f3ee}table{border-collapse:collapse;background:#fff;margin-top:12px}
th,td{padding:6px 10px;border-bottom:1px solid #e6dfd6;text-align:left;font-size:14px}th{background:#c62a35;color:#fff}.muted{color:#7a6f63}</style></head><body>
<h1>Daily report (read-only)</h1><p class="muted">Unique real-money orders by Bangkok day (paid date) and channel (last ad touch). Test, playground and failed orders are excluded.
Spend is not known to the website: fill it in from each ad platform. Platform-attributed purchases (TikTok/Google/LINE dashboards) are separate numbers; don't add them to these.</p>
<p><a href="/admin/report.csv">Download CSV</a></p>
<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
${out.map((b) => `<tr>${cols.map((c) => `<td>${esc(c === "spend_thb" ? "" : b[c])}</td>`).join("")}</tr>`).join("\n") || '<tr><td colspan="9">No paid orders yet</td></tr>'}
</tbody></table></body></html>`);
  });

  app.get("/healthz", (_req, res) =>
    res.json({ ok: true, storage: store.kind, beam: BEAM.ready ? BEAM.env : "store-links", webhook: Boolean(BEAM.hmacKey), tiktokEventsApi: Boolean(TIKTOK.token) })
  );

  // The confirmation page is its own standalone file (public/thank-you.html), not part of
  // the landing page. Ad platforms' purchase tags go there. Old return links that pointed
  // at the landing page (/?payment=success&…) are forwarded to it with their query.
  app.get("/thank-you", (_req, res) => {
    res.set("Cache-Control", "no-cache").sendFile(path.join(PUBLIC_DIR, "thank-you.html"));
  });
  app.get("/", (req, res, next) => {
    if (req.query.payment !== "success") return next();
    const { payment, ...rest } = req.query;
    const qs = new URLSearchParams(rest).toString();
    res.redirect(302, "/thank-you" + (qs ? "?" + qs : ""));
  });

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (file.endsWith(".html")) res.set("Cache-Control", "no-cache");
    },
  }));
  // Single-page app: unknown paths get the landing page.
  app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  // Purchase delivery queue: on start (catches up after a restart) and every minute.
  processDeliveries(store).catch((e) => console.warn("[delivery]", e.message));
  setInterval(() => processDeliveries(store).catch((e) => console.warn("[delivery]", e.message)), 60000);

  app.listen(PORT, "0.0.0.0", () =>
    console.log(`[5wan] listening on :${PORT} (storage: ${store.kind}, beam: ${BEAM.ready ? BEAM.env : "not configured"})`)
  );
}

main().catch((err) => {
  console.error("[5wan] failed to start:", err);
  process.exit(1);
});

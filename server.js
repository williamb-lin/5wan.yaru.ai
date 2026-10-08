// 5wan.yaru.ai — Thai 5-Day Challenge landing page with Beam checkout.
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
//   PUBLIC_BASE_URL         optional, e.g. https://5wan.yaru.ai — where Beam sends buyers back
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
  essential: { label: "Essential", item: "ชาเลนจ์ 5 วัน: แพ็กเกจพื้นฐาน", amount: 399000,
           storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/EssentialT1" },
  vip: { label: "VIP", item: "ชาเลนจ์ 5 วัน: แพ็กเกจ VIP", amount: 999000,
         storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/VIPT1" },
  coaching: { label: "1:1 Coaching", item: "โค้ชชิ่งแบบตัวต่อตัว (1 เดือน)", amount: 25000000,
              storeLink: "https://pay.beamcheckout.com/yaru-aqbm4q/1on1Coach" },
};
// Test checkouts: real Beam payment for ฿20 (2000 satang) instead of the tier price.
const TEST_AMOUNT = 2000;
const TEST_CODE = process.env.TEST_CHECKOUT_CODE || "";
const isTestOrder = (r) => String(r.beam_env || "").endsWith("-test");

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
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const toE164 = (p) => {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d;
  if (d.startsWith("66")) return "+" + d;
  return d.startsWith("0") ? "+66" + d.slice(1) : "+66" + d;
};
async function reportPurchaseToTikTok(order, phone) {
  if (!TIKTOK.token) return;
  const email = String(order.email || "").trim().toLowerCase();
  const tel = toE164(phone || order.phone);
  const user = {};
  if (email) user.email = sha256(email);
  if (tel) user.phone = sha256(tel);
  const body = {
    event_source: "web",
    event_source_id: TIKTOK.pixel,
    ...(TIKTOK.testCode ? { test_event_code: TIKTOK.testCode } : {}),
    data: [{
      event: "CompletePayment",
      event_time: Math.floor(Date.now() / 1000),
      event_id: order.ref,
      user,
      properties: {
        currency: "THB",
        value: Number(order.amount) / 100,
        contents: [{ content_id: order.package, content_type: "product", quantity: 1 }],
      },
      page: { url: `${(process.env.PUBLIC_BASE_URL || "https://5wan.yaru.ai").replace(/\/+$/, "")}/thank-you` },
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
    if (data.code === 0) console.log(`[tiktok] purchase ${order.ref} reported${TIKTOK.testCode ? " (test events)" : ""}`);
    else console.warn(`[tiktok] purchase ${order.ref} not accepted: ${res.status} ${data.code} ${data.message || ""}`);
  } catch (err) {
    console.warn(`[tiktok] purchase ${order.ref} failed: ${err.message}`);
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

// Ask Beam for a pending order's link status (backup for missed webhooks).
async function refreshFromBeam(store, order) {
  if (!BEAM.ready || order.status !== "pending" || !order.payment_link_id || String(order.beam_env).replace(/-test$/, "") !== BEAM.env) return;
  const link = await beamRequest("GET", `/api/v1/payment-links/${encodeURIComponent(order.payment_link_id)}`);
  const status = LINK_STATUS[link.status];
  if (status && status !== order.status) {
    const fields = { status, ...(status === "paid" && !order.paid_at ? { paid_at: new Date().toISOString() } : {}) };
    await store.update(order.ref, fields);
    Object.assign(order, fields);
    if (status === "paid") reportPurchaseToTikTok(order);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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
  res.set("WWW-Authenticate", 'Basic realm="5wan admin", charset="UTF-8"').status(401).send("Login required");
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

const STATUS_COLOR = { paid: "#1f7a3a", pending: "#9a6b00", expired: "#7a6f63", cancelled: "#7a6f63", refunded: "#7a6f63", error: "#c62a35" };

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
    try {
      if (type === "payment_link.paid" && event.paymentLinkId) {
        const order = await store.byLink(event.paymentLinkId);
        if (order && order.status !== "paid") {
          await store.update(order.ref, { status: "paid", paid_at: new Date().toISOString() });
          console.log(`[beam] order ${order.ref} paid (${order.package})`);
          reportPurchaseToTikTok(order);
        }
      } else if (type === "charge.succeeded" && event.source !== "PAYMENT_LINK") {
        // Store-link payment: no order ref, so match the newest unpaid store-link order
        // with the same email and amount from the last 3 days. Unmatched ones are logged.
        const email = String(event.customer?.email || "").trim().toLowerCase();
        const order = (await store.list()).find(
          (r) => r.beam_env === "store_link" && r.status === "pending" && email && r.email === email &&
            Number(r.amount) === Number(event.amount) && Date.now() - new Date(r.created_at) < 3 * 864e5
        );
        if (order) {
          const p = event.customer?.primaryPhone;
          await store.update(order.ref, {
            status: "paid",
            paid_at: event.transactionTime || new Date().toISOString(),
            phone: p?.number ? (p.number.startsWith("0") ? p.number : `${p.countryCode || ""}${p.number}`) : order.phone || null,
            payment_method: event.paymentMethod?.paymentMethodType || null,
          });
          console.log(`[beam] store-link order ${order.ref} matched to charge ${event.chargeId}`);
        } else {
          console.log(`[beam] store-link charge ${event.chargeId} (${event.amount}) not matched to an order`);
        }
      } else if (type === "charge.succeeded" && event.source === "PAYMENT_LINK" && event.sourceId) {
        // Carries the buyer's phone and payment method; also marks paid if it arrives first.
        const order = await store.byLink(event.sourceId);
        if (order) {
          const p = event.customer?.primaryPhone;
          const fields = {
            // Thai numbers arrive as 0XXXXXXXXX: keep that familiar local format.
            phone: p?.number ? (p.number.startsWith("0") ? p.number : `${p.countryCode || ""}${p.number}`) : order.phone || null,
            payment_method: event.paymentMethod?.paymentMethodType || order.payment_method || null,
          };
          if (order.status !== "paid") Object.assign(fields, { status: "paid", paid_at: event.transactionTime || new Date().toISOString() });
          await store.update(order.ref, fields);
          reportPurchaseToTikTok(order, fields.phone); // same event_id as above: TikTok keeps one
        }
      }
      res.status(200).send("ok");
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
    for (const [k, v] of Object.entries(req.body?.params || {}).slice(0, 30)) params[clip(k, 50)] = clip(v, 300);
    const isTest = Boolean(TEST_CODE) && BEAM.ready && params.test === TEST_CODE;
    delete params.test; // never store the code
    const ref = "5W-" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const amount = isTest ? TEST_AMOUNT : pkg.amount;
    const order = { ref, name, email, package: pkgKey, amount, beam_env: BEAM.env + (isTest ? "-test" : ""), params, referrer: clip(req.body?.referrer, 500) };
    for (const f of AD_FIELDS) order[f] = params[f] || null;

    if (!BEAM.ready) {
      // No API keys: save the buyer, then send them to the tier's reusable Beam link.
      order.beam_env = "store_link";
      try {
        await store.create(order);
        console.log(`[checkout] order ${ref} -> store link (${pkgKey}, source: ${order.utm_source || "direct"})`);
        return res.json({ url: pkg.storeLink });
      } catch (err) {
        console.error(`[checkout] order ${ref} failed:`, err.message);
        return res.status(500).json({ message: "Could not start payment" });
      }
    }

    const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    try {
      await store.create(order);
      const link = await beamRequest(
        "POST",
        "/api/v1/payment-links",
        {
          order: {
            currency: "THB",
            netAmount: amount,
            description: `Yaru 5-Day Challenge – ${pkg.label}${isTest ? " (TEST ฿20)" : ""}`,
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
      res.json({ url: link.url });
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
      res.json({ status: order.status, package: order.package, value: Number(order.amount) / 100, currency: order.currency || "THB", test: isTestOrder(order) });
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

    const paid = rows.filter((r) => r.status === "paid" && !isTestOrder(r));
    const testCount = rows.filter(isTestOrder).length;
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
<title>5wan orders (${paid.length} paid)</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f1a14;background:#f7f3ee}
h1{margin:0 0 4px}.muted{color:#7a6f63}table{border-collapse:collapse;width:100%;background:#fff;margin-top:16px}
th,td{padding:8px 10px;border-bottom:1px solid #e6dfd6;text-align:left;font-size:14px;vertical-align:top;white-space:nowrap}
th{background:#c62a35;color:#fff;position:sticky;top:0}a.btn{display:inline-block;margin-top:12px;padding:8px 14px;
background:#c62a35;color:#fff;border-radius:8px;text-decoration:none}.wrap{overflow-x:auto}
.mode{display:inline-block;padding:2px 10px;border-radius:999px;background:${BEAM.env === "production" && BEAM.ready ? "#1f7a3a" : "#9a6b00"};color:#fff;font-size:12px}</style></head><body>
<h1>Orders: ${paid.length} paid · ${esc(baht(revenue))}</h1>
<div class="muted"><span class="mode">${esc(mode)}</span> · storage: ${store.kind}</div>
<div class="muted">Paid by package: ${Object.entries(byPackage).map(([k, v]) => `${esc(k)} ${v.n} (${esc(baht(v.sum))})`).join(" · ") || "none yet"}</div>
${testCount ? `<div class="muted">Test orders (฿20, not counted above): ${testCount}</div>` : ""}
<div class="muted">Not marked paid: ${rows.filter((r) => r.status !== "paid" && !isTestOrder(r)).length}${BEAM.ready ? " (pending, expired, cancelled or failed)" : " (sent to Beam; with store links, check Beam Lighthouse for who actually paid)"}</div>
<a class="btn" href="/admin/orders.csv">Download CSV</a>
<div class="wrap"><table><thead><tr><th>Created (Bangkok)</th><th>Status</th><th>Order</th><th>Name</th><th>Email</th><th>Phone</th><th>Package</th><th>Amount</th><th>Paid (Bangkok)</th><th>Method</th><th>utm_source</th><th>utm_campaign</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(fmtDate(r.created_at))}</td><td style="color:${STATUS_COLOR[r.status] || "#1f1a14"};font-weight:600">${esc(r.status)}${isTestOrder(r) ? ' <span style="background:#1f1a14;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">TEST</span>' : ""}</td><td>${esc(r.ref)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(PACKAGES[r.package]?.label || r.package)}</td><td>${esc(baht(r.amount))}</td><td>${esc(fmtDate(r.paid_at))}</td><td>${esc(r.payment_method)}</td><td>${esc(r.utm_source)}</td><td>${esc(r.utm_campaign)}</td></tr>`).join("\n")}
</tbody></table></div></body></html>`);
  });

  app.get("/admin/orders.csv", checkAdmin, async (_req, res) => {
    const rows = await store.list();
    const cols = ["created_at", "status", "ref", "name", "email", "phone", "package", "amount_thb", "paid_at", "payment_method", "beam_env", "payment_link_id", ...AD_FIELDS, "referrer"];
    const value = (r, c) =>
      c === "amount_thb" ? Number(r.amount) / 100 : c === "created_at" || c === "paid_at" ? (r[c] ? new Date(r[c]).toISOString() : "") : r[c];
    const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(value(r, c))).join(","))];
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="5wan-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    res.send("﻿" + lines.join("\r\n")); // BOM so Excel shows Thai names correctly
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

  app.listen(PORT, "0.0.0.0", () =>
    console.log(`[5wan] listening on :${PORT} (storage: ${store.kind}, beam: ${BEAM.ready ? BEAM.env : "not configured"})`)
  );
}

main().catch((err) => {
  console.error("[5wan] failed to start:", err);
  process.exit(1);
});

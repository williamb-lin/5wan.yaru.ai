// 5wan.yaru.ai — Thai 5-Day Challenge waitlist.
// Serves the static landing page from public/ and stores waitlist sign-ups.
//
// Env (Replit Secrets):
//   DATABASE_URL    Postgres connection string (Replit "Database" tool sets this)
//   ADMIN_PASSWORD  password for /admin (the sign-up list) and /admin/waitlist.csv
//   PORT            optional, defaults to 3000
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const IS_DEPLOYED = process.env.REPLIT_DEPLOYMENT === "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const LOCAL_FILE = path.join(__dirname, "data", "waitlist.local.json");

// ---------------------------------------------------------------------------
// Storage: Postgres when DATABASE_URL is set; a local JSON file otherwise
// (local testing only — deployed instances refuse to run without Postgres,
// because Replit deployments don't keep files written at runtime).
// ---------------------------------------------------------------------------
// Course packages offered on the page (value sent by the form -> label).
const PACKAGES = { basic: "Basic", vip: "VIP", coaching: "1:1 Coaching", online: "Online (old pricing)" };
const AD_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid"];

function createStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return {
      kind: "postgres",
      async init() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS waitlist (
            id           SERIAL PRIMARY KEY,
            name         TEXT NOT NULL,
            email        TEXT NOT NULL,
            utm_source   TEXT, utm_medium TEXT, utm_campaign TEXT,
            utm_content  TEXT, utm_term   TEXT, ttclid       TEXT,
            params       JSONB,
            referrer     TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key ON waitlist (lower(email));
          ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS package TEXT;
        `);
      },
      // Returns true when the email was new, false when already on the list.
      async add(row) {
        const r = await pool.query(
          `INSERT INTO waitlist (name, email, package, utm_source, utm_medium, utm_campaign,
                                 utm_content, utm_term, ttclid, params, referrer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (lower(email)) DO NOTHING`,
          [row.name, row.email, row.package, ...AD_FIELDS.map((f) => row[f]), row.params, row.referrer]
        );
        return r.rowCount === 1;
      },
      async list() {
        const r = await pool.query("SELECT * FROM waitlist ORDER BY created_at DESC");
        return r.rows;
      },
    };
  }

  if (IS_DEPLOYED) {
    throw new Error("DATABASE_URL is not set. Create a PostgreSQL database in Replit before deploying.");
  }
  console.warn("[waitlist] DATABASE_URL not set — saving to", LOCAL_FILE, "(local testing only)");
  const read = () => (fs.existsSync(LOCAL_FILE) ? JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")) : []);
  return {
    kind: "local-file",
    async init() {
      fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    },
    async add(row) {
      const rows = read();
      if (rows.some((r) => r.email.toLowerCase() === row.email.toLowerCase())) return false;
      rows.push({ id: rows.length + 1, ...row, created_at: new Date().toISOString() });
      fs.writeFileSync(LOCAL_FILE, JSON.stringify(rows, null, 2));
      return true;
    },
    async list() {
      return read().reverse();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// Naive per-IP limit so a bot can't flood the list: 10 sign-ups / 10 min.
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
  res.set("WWW-Authenticate", 'Basic realm="5wan waitlist", charset="UTF-8"').status(401).send("Login required");
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
  new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
async function main() {
  const store = createStore();
  await store.init();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "10kb" }));

  app.post("/api/waitlist", async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ message: "Too many requests" });
    const name = clip(req.body?.name, 100);
    const email = clip(req.body?.email, 254).toLowerCase();
    if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ message: "Invalid name or email" });

    const params = {};
    for (const [k, v] of Object.entries(req.body?.params || {}).slice(0, 30)) params[clip(k, 50)] = clip(v, 300);
    const pkg = clip(req.body?.package, 20);
    const row = { name, email, package: PACKAGES[pkg] ? pkg : null, params, referrer: clip(req.body?.referrer, 500) };
    for (const f of AD_FIELDS) row[f] = params[f] || null;

    try {
      const isNew = await store.add(row);
      console.log(`[waitlist] ${isNew ? "new" : "duplicate"} sign-up (package: ${row.package || "none"}, source: ${row.utm_source || "direct"})`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[waitlist] save failed:", err);
      res.status(500).json({ message: "Could not save sign-up" });
    }
  });

  app.get("/admin", checkAdmin, async (_req, res) => {
    const rows = await store.list();
    const bySource = {};
    const byPackage = {};
    for (const r of rows) {
      bySource[r.utm_source || "direct"] = (bySource[r.utm_source || "direct"] || 0) + 1;
      const label = PACKAGES[r.package] || "not chosen";
      byPackage[label] = (byPackage[label] || 0) + 1;
    }
    res.set("Cache-Control", "no-store").send(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>5wan waitlist (${rows.length})</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f1a14;background:#f7f3ee}
h1{margin:0 0 4px}.muted{color:#7a6f63}table{border-collapse:collapse;width:100%;background:#fff;margin-top:16px}
th,td{padding:8px 10px;border-bottom:1px solid #e6dfd6;text-align:left;font-size:14px;vertical-align:top}
th{background:#c62a35;color:#fff;position:sticky;top:0}a.btn{display:inline-block;margin-top:12px;padding:8px 14px;
background:#c62a35;color:#fff;border-radius:8px;text-decoration:none}.wrap{overflow-x:auto}</style></head><body>
<h1>Waitlist: ${rows.length} sign-up${rows.length === 1 ? "" : "s"}</h1>
<div class="muted">By package: ${Object.entries(byPackage).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "none yet"}</div>
<div class="muted">By source: ${Object.entries(bySource).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "none yet"} · storage: ${store.kind}</div>
<a class="btn" href="/admin/waitlist.csv">Download CSV</a>
<div class="wrap"><table><thead><tr><th>#</th><th>Signed up (Bangkok)</th><th>Name</th><th>Email</th><th>Package</th><th>utm_source</th><th>utm_campaign</th><th>utm_content</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td>${rows.length - i}</td><td>${esc(fmtDate(r.created_at))}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(PACKAGES[r.package] || "")}</td><td>${esc(r.utm_source)}</td><td>${esc(r.utm_campaign)}</td><td>${esc(r.utm_content)}</td></tr>`).join("\n")}
</tbody></table></div></body></html>`);
  });

  app.get("/admin/waitlist.csv", checkAdmin, async (_req, res) => {
    const rows = await store.list();
    const cols = ["created_at", "name", "email", "package", ...AD_FIELDS, "referrer", "params"];
    const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(c === "created_at" ? new Date(r[c]).toISOString() : r[c])).join(","))];
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="5wan-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    res.send("﻿" + lines.join("\r\n")); // BOM so Excel shows Thai names correctly
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true, storage: store.kind }));

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (file.endsWith(".html")) res.set("Cache-Control", "no-cache");
    },
  }));
  // Single-page app: unknown paths get the landing page.
  app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  app.listen(PORT, "0.0.0.0", () => console.log(`[5wan] listening on :${PORT} (storage: ${store.kind})`));
}

main().catch((err) => {
  console.error("[5wan] failed to start:", err);
  process.exit(1);
});

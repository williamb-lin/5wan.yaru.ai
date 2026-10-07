# 5wan.yaru.ai — Yaru 5-Day Challenge (Thai)

Thai version of [challenge.yaru.ai](https://challenge.yaru.ai), translated to Thai and set in Sukhumvit Set. Buyers pick a package (พื้นฐาน ฿3,990 · VIP ฿9,990 · 1:1 coaching ฿250,000/month), enter name and email, and pay on **Beam**'s hosted checkout. Orders are stored in Postgres and shown on `/admin`.

## What's in here

| Path | What it is |
|---|---|
| `public/` | The live site: `index.html`, built JS/CSS, images, video, fonts |
| `server.js` | Express server: serves `public/`, creates Beam payment links, receives Beam webhooks, admin page |
| `source/` | Original English page + bundle from challenge.yaru.ai (never edited) |
| `build_th.py` | Turns `source/` into `public/`: all Thai copy, fonts, pricing, checkout form |

## Run on Replit

1. **Database:** *Database* tool → PostgreSQL (sets `DATABASE_URL`). The `orders` table is created on first start.
2. **App Secrets** (Tools → Secrets → App Secrets):

   | Key | Where it comes from |
   |---|---|
   | `ADMIN_PASSWORD` | any strong password, for `/admin` |
   | `BEAM_MERCHANT_ID` | Beam Lighthouse → Developers |
   | `BEAM_API_KEY` | Beam Lighthouse → Developers → API Key |
   | `BEAM_WEBHOOK_HMAC_KEY` | Beam Lighthouse → Developers → Webhooks → the webhook's HMAC key |
   | `BEAM_ENV` | `playground` for test payments, `production` for real money |
   | `PUBLIC_BASE_URL` | `https://5wan.yaru.ai` (where Beam sends buyers back) |

   Playground and production keys are different; use the pair that matches `BEAM_ENV`.
3. **Beam webhook:** in Lighthouse → Developers → Webhooks, create one pointing to `https://5wan.yaru.ai/api/beam/webhook` with events `payment_link.paid` and `charge.succeeded`.
4. **Restart** the app after changing secrets, then **Deploy → Autoscale** and link `5wan.yaru.ai`.

Check: `/healthz` returns `{"ok":true,"storage":"postgres","beam":"production","webhook":true}`.

## Orders

- **`/admin`**: every order with status (paid / pending / expired / cancelled / error), buyer, phone, package, amount, payment method and ad source; paid totals per package. Opening it also re-checks recent pending orders with Beam, in case a webhook was missed.
- **`/admin/orders.csv`**: everything as a spreadsheet.
- **Two payment modes.** Without Beam API keys, each tier sends the buyer to its reusable Beam **store link** (set in `server.js` → `PACKAGES[...].storeLink`); the order is saved as *pending* and payment is confirmed in Beam Lighthouse. With API keys, a one-off payment link is created per order and payment is tracked automatically.
- Prices are set in `server.js` (`PACKAGES`, in satang); the page only sends which package. Change prices in both `server.js` and the cards in `build_th.py`.
- The old `waitlist` table, if present, is left untouched.

## Tagging ad links

Put UTM tags on the landing-page ad URL so `/admin` can tell sources apart, e.g.

```
https://5wan.yaru.ai/?utm_source=tiktok&utm_medium=paid&utm_campaign=5wan_ab_web&utm_content=video1
```

## Editing the copy

All Thai text lives in `build_th.py` (the `T` dictionary, English → Thai). Edit, then:

```
python3 build_th.py
```

and commit the updated `public/` files.

## Tracking scripts on the page

- **LINE Tag** (`34e8f29d-a401-4dcc-b551-e49132bbd5d4`): base code in `<head>` sends a page view on every visit; a **Conversion** (`_lt('send','cv',{type:'Conversion'})`) fires when someone clicks the pay button. Both are added in `build_th.py`.
- No Google, Meta, TikTok or ActiveCampaign tracking (the English site's were removed so the Thai test doesn't mix with English data).

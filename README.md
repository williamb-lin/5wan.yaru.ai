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

## Confirmation page

`public/thank-you.html`, served at **`/thank-you`**: a standalone page, separate from the landing page (it loads none of the landing page's code). Every tier lands here after paying: Beam payment links are created with `redirectUrl` = `/thank-you?tier=essential|vip|coaching&order=…`. **Ad platforms' purchase tags go in this file only.** The landing page contains no confirmation content; old `/?payment=success…` links are forwarded here.

## Testing with real ฿20 payments

Set `TEST_CHECKOUT_CODE` in Replit Secrets, then open `https://5wan.yaru.ai/?test=<code>`: any tier is charged ฿20 through live Beam (real payment), returns to `/thank-you`, and is marked **TEST** in `/admin` (excluded from totals). Refund test payments in Beam Lighthouse. Without the code, normal prices apply.

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
- **TikTok Pixel** (`DB3I03JC77U04C8M6HN0`): base code in `<head>` of both pages (PageView); **InitiateCheckout** (tier + price, THB) on the pay button; **CompletePayment** (value per tier, `event_id` = order number) on `/thank-you`. ฿20 test orders return with `&test=1` and are reported with their real value of ฿20.
- TikTok funnel also includes **ViewContent** (page load) and **AddToCart** (package picked, or on buy if none picked); on the buy click the email is SHA-256-hashed in the browser and passed via `ttq.identify`.
- **TikTok Events API** (server): with `TIKTOK_ACCESS_TOKEN` set, every paid order is reported as CompletePayment with hashed email + phone, `event_id` = order number (deduplicated with the browser event). Optional `TIKTOK_TEST_EVENT_CODE` routes these to TikTok's Test events.
- Consent line under the pay button links https://yaru.ai/privacy (PDPA).
- The LINE Tag base code is on `/thank-you` too.
- **Google Ads** (`AW-18496929738`): Google tag on both pages (the landing page stores the ad click). **Purchase** (label `GqwmCIbK4pIdEMr_gvRE`) fires on `/thank-you` only after the server confirms the order is paid: the page polls `/api/order-status?order=…` (which checks Beam directly if the webhook hasn't arrived yet), then sends the amount actually charged in THB with `transaction_id` = order number. ฿20 test orders are not sent to Google. **Begin checkout** (Secondary) is wired in `build_th.py` → `GOOGLE_BEGIN_CHECKOUT_LABEL`; empty = not sent. Set the label and rebuild to turn it on.
- No Meta or ActiveCampaign tracking (the English site's were removed so the Thai test doesn't mix with English data).

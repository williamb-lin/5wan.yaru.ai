# 5wan.yaru.ai — Yaru 5-Day Challenge (Thai waitlist)

Thai version of [challenge.yaru.ai](https://challenge.yaru.ai). Same page, same design, translated to Thai and set in Sukhumvit Set. The sign-up form adds people to a **waitlist** (nothing is sent to Circle or any email tool); invite them later from the exported list.

## What's in here

| Path | What it is |
|---|---|
| `public/` | The live site: `index.html`, built JS/CSS, images, video, fonts |
| `server.js` | Small Express server: serves `public/`, saves sign-ups, admin page |
| `source/` | Original English page + bundle from challenge.yaru.ai (never edited) |
| `build_th.py` | Turns `source/` into `public/`: all Thai copy, fonts, waitlist form |

## Run on Replit

1. **Import** this repo into the Repl (Git pane → connect `williamb-lin/5wan.yaru.ai`).
2. **Database:** open the *Database* tool → create a PostgreSQL database. This sets `DATABASE_URL`. The `waitlist` table is created on first start.
3. **Secrets:** add `ADMIN_PASSWORD` (any strong password, used to view the list).
4. **Run** to test, then **Deploy → Autoscale**. Make sure the deployment has the database and `ADMIN_PASSWORD` too.
5. **Custom domain:** in the deployment settings, add `5wan.yaru.ai` and create the DNS record Replit shows.

Check it's live: `https://<your-domain>/healthz` should return `{"ok":true,"storage":"postgres"}`.

## Seeing who signed up

- **`/admin`** — the list, newest first, with a count per ad source (log in with any username + `ADMIN_PASSWORD`).
- **`/admin/waitlist.csv`** — download everything (opens in Excel/Sheets with Thai names intact).

Each row stores: name, email, sign-up time, `utm_source / utm_medium / utm_campaign / utm_content / utm_term`, TikTok's `ttclid`, and the referrer. The same email is only stored once.

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

None for now. The English site's Google Tag Manager container (which fires the English TikTok pixel), Meta Pixel and ActiveCampaign tracking were removed so the Thai A/B test doesn't mix with English data. The Thai TikTok pixel will be added in `build_th.py` once it's created.

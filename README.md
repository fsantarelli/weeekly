# Weeekly

Reads a dedicated school-emails mailbox, has Claude extract the week's activities and
action items, and sends a Telegram digest every Sunday at 5PM (Europe/London) — plus an
on-demand summary and the occasional mid-week alert if something urgent comes up.

v1 covers a single year group (Y3) and a single subscriber, but the data model and
subscriber list are built to extend to more year groups/parents later without a schema
change.

## How it works

- `api/cron/fetch_emails.py` — runs daily (~16:00 UTC via Vercel Cron), IMAP-fetches new
  emails from `SCHOOL_SENDER`, asks Claude to extract structured activities, stores them
  in Upstash Redis, and fires an immediate Telegram alert for anything action-required
  due within 2 days.
- `api/cron/send_summary.py` — runs on Sundays (checked at both 16:00 and 17:00 UTC to
  stay correct across the BST/GMT clock change), sends the full week digest once the
  Europe/London time hits 17:00, guarded so it only sends once per week.
- `api/telegram_webhook.py` — handles incoming Telegram messages: `/start` subscribes
  the chat, `/summary` replies with the latest stored digest.

Both cron endpoints are also directly callable over HTTP to bypass the schedule (see
"Manual triggers" below) — useful since Vercel's free tier only allows each cron job to
run once a day.

## Setup

1. **Zoho mailbox**: create (or reuse) a mailbox dedicated to school emails. In Zoho Mail
   settings, generate an **app-specific password** (Zoho Account → Security → App
   Passwords) — don't use your normal account password.
2. **Telegram bot**: message [@BotFather](https://t.me/BotFather), run `/newbot`, and
   copy the token it gives you.
3. **Anthropic API key**: from the Anthropic Console.
4. **Upstash Redis**: add the Upstash integration from the Vercel Marketplace (free
   tier), which will populate `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` for
   you, or create a database directly at upstash.com.
5. Copy `.env.example` to `.env` and fill in all values, including a random
   `CRON_SECRET` (any long random string).
6. Deploy to Vercel (`vercel deploy` or connect the GitHub repo), setting the same env
   vars in the Vercel project settings.
7. **Register the Telegram webhook** once deployed:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-deployment>.vercel.app/api/telegram_webhook"
   ```
8. Message your bot with `/start` to subscribe.

## Manual triggers

Both cron endpoints check for the shared `CRON_SECRET` — either as the
`Authorization: Bearer <CRON_SECRET>` header Vercel sends automatically on real cron
invocations, or as a `?secret=<CRON_SECRET>` query param for manual calls:

```bash
# Trigger an email fetch/check right now
curl "https://<your-deployment>.vercel.app/api/cron/fetch_emails?secret=<CRON_SECRET>"

# Force-send the weekly summary right now (bypasses the day/time and once-per-week guard)
curl "https://<your-deployment>.vercel.app/api/cron/send_summary?secret=<CRON_SECRET>"
```

## Notes / open questions

- Daily fetch time (16:00 UTC) and the "alert if due within N days" threshold (2 days)
  are easy to tune in `api/cron/fetch_emails.py`.
- Telegram formatting uses legacy Markdown; revisit once you've seen a real digest.

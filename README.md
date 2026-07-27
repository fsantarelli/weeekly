# Weeekly

Reads a dedicated school-emails mailbox, has Claude extract the week's activities and
action items, and sends a Telegram digest every Sunday at 5PM (Europe/London) — plus an
on-demand summary and the occasional mid-week alert if something urgent comes up.

v1 covers a single year group (Y3) and a single subscriber, but the data model and
subscriber list are built to extend to more year groups/parents later without a schema
change.

## Architecture: local processing + hosted delivery

Email extraction runs **locally**, via `scripts/process_emails.py`, using the local
`claude` CLI (your Claude Code subscription) instead of the metered Anthropic API. That
script isn't deployed — Vercel serverless functions can't invoke your local CLI. Run it
yourself whenever you want to check for new school emails:

```bash
python scripts/process_emails.py
```

It fetches new emails from `SCHOOL_SENDER`, asks local Claude to extract structured
activities, and writes them straight to Upstash Redis.

Everything that talks to Telegram stays on **Vercel**, reading from that same Redis
database:

- `api/cron/check_alerts.py` — runs daily (~16:00 UTC via Vercel Cron), scans stored
  activities for anything action-required due within 2 days that hasn't been alerted
  yet, and sends a Telegram alert. Doesn't touch email or Claude at all.
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
3. **Claude Code CLI**: make sure `claude` is installed and you're logged in on the
   machine you'll run `scripts/process_emails.py` from (`claude --version` to check).
4. **Upstash Redis**: add the Upstash integration from the Vercel Marketplace (free
   tier), which will populate `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` for
   you, or create a database directly at upstash.com.
5. Copy `.env.example` to `.env` and fill in all values, including a random
   `CRON_SECRET` (any long random string). This `.env` is only read locally.
6. Install local dependencies: `pip install -r requirements-local.txt`.
7. Deploy to Vercel (`vercel deploy` or connect the GitHub repo). It only needs
   `requirements.txt` (no IMAP/Claude deps). Set `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, and `YEAR_GROUP` in
   the Vercel project settings — it doesn't need the Zoho or Claude-related vars.
8. **Register the Telegram webhook** once deployed:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-deployment>.vercel.app/api/telegram_webhook"
   ```
9. Message your bot with `/start` to subscribe.
10. Run `python scripts/process_emails.py` to do your first import.

## Manual triggers

Both cron endpoints check for the shared `CRON_SECRET` — either as the
`Authorization: Bearer <CRON_SECRET>` header Vercel sends automatically on real cron
invocations, or as a `?secret=<CRON_SECRET>` query param for manual calls:

```bash
# Re-scan stored activities for due-soon action items and alert now
curl "https://<your-deployment>.vercel.app/api/cron/check_alerts?secret=<CRON_SECRET>"

# Force-send the weekly summary right now (bypasses the day/time and once-per-week guard)
curl "https://<your-deployment>.vercel.app/api/cron/send_summary?secret=<CRON_SECRET>"
```

## Notes / open questions

- `scripts/process_emails.py` is manual — run it as often as you like. There's no
  automated schedule for it since Vercel can't reach your machine to trigger it.
- The "alert if due within N days" threshold (2 days) is easy to tune in
  `api/cron/check_alerts.py`.
- Telegram formatting uses legacy Markdown; revisit once you've seen a real digest.

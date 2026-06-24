# Weeekly

Weekly school reminders from Zoho Mail to Telegram.

This project is designed for Vercel serverless functions and Vercel Cron. It reads recent school emails over IMAP, extracts Year 2 activities for the next school week, and sends a Sunday Telegram reminder.

## Endpoints

- `GET /api/weekly-reminder`
  - Runs the reminder job.
  - Triggered by Vercel Cron every Sunday.
  - Add `?preview=1` to return the generated message without sending it.

- `GET /api/telegram-chat-id`
  - Helper endpoint for setup.
  - After you message your bot once in Telegram, this endpoint returns recent chat IDs from Telegram `getUpdates`.

## Vercel Environment Variables

Set these in the Vercel project settings. Do not commit real values.

```text
ZOHO_EMAIL=
ZOHO_APP_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
CRON_SECRET=
```

Optional:

```text
IMAP_HOST=imap.zoho.eu
IMAP_FOLDERS=INBOX,Newsletter,Archive
```

## Telegram Setup

1. Create a bot with `@BotFather`.
2. Set `TELEGRAM_BOT_TOKEN` in Vercel.
3. Send any message to the bot from the Telegram account that should receive reminders.
4. Deploy the project.
5. Open `/api/telegram-chat-id` with the `Authorization: Bearer <CRON_SECRET>` header.
6. Copy the chat `id` into `TELEGRAM_CHAT_ID`.

## Schedule

The cron schedule is configured in `vercel.json`:

```json
{
  "path": "/api/weekly-reminder",
  "schedule": "0 17 * * 0"
}
```

Vercel cron runs in UTC. `17:00 UTC` is `18:00` in London during British Summer Time.

## Local Checks

```bash
npm install
npm test
```

For local execution, create a `.env` file if needed. `.env` files are ignored by git.

## Preview

Inspect the generated summary without sending a Telegram message:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://<your-vercel-domain>/api/weekly-reminder?preview=1"
```

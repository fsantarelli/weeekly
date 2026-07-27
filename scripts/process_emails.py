#!/usr/bin/env python3
"""Run this locally (not deployed to Vercel) to fetch new school emails and
extract activities from them.

Extraction uses the local `claude` CLI (your Claude Code subscription) rather
than the metered Anthropic API, so this has to run on a machine where you're
logged into Claude Code — it can't run as a Vercel serverless function.

Results are written straight to Upstash Redis, the same database the
deployed Vercel app (api/cron/check_alerts.py, api/cron/send_summary.py,
api/telegram_webhook.py) reads from to send Telegram messages. This script
does not talk to Telegram itself.

Usage:
    python scripts/process_emails.py
"""
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from lib import storage, util  # noqa: E402
from lib.claude_extract import extract_activities  # noqa: E402
from lib.email_client import fetch_new_emails  # noqa: E402

YEAR_GROUP = os.environ.get("YEAR_GROUP", "Y3")


def main() -> None:
    last_uid = storage.get_last_processed_uid(YEAR_GROUP)
    emails = fetch_new_emails(since_uid=last_uid)

    if not emails:
        print("No new school emails.")
        return

    today = util.london_now().date()
    activities_added = 0

    for email in emails:
        print(f"Processing: {email.subject!r} (uid {email.uid})")
        activities = extract_activities(email.subject, email.body, email.received_at)

        for activity in activities:
            week_start = util.week_start_for(today)
            if activity.get("date"):
                try:
                    activity_date = datetime.fromisoformat(activity["date"]).date()
                    week_start = util.week_start_for(activity_date)
                except ValueError:
                    pass

            week_key = week_start.isoformat()
            week = storage.get_week(YEAR_GROUP, week_key) or {
                "year_group": YEAR_GROUP,
                "week_start": week_key,
                "days": {},
            }
            week["days"].setdefault(activity["day_of_week"], []).append(activity)
            storage.save_week(YEAR_GROUP, week_key, week)
            activities_added += 1
            print(f"  + {activity['day_of_week']}: {activity['title']}")

        storage.set_last_processed_uid(YEAR_GROUP, email.uid)

    print(f"\nDone: {len(emails)} email(s) processed, {activities_added} activity(ies) added.")
    print(
        "Telegram alerts/summaries are sent by the deployed Vercel app on its "
        "own schedule, or trigger it manually — see README.md."
    )


if __name__ == "__main__":
    main()

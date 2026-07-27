import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from lib import claude_extract, email_client, formatting, storage, telegram_client, util  # noqa: E402

YEAR_GROUP = os.environ.get("YEAR_GROUP", "Y3")
ALERT_WITHIN_DAYS = 2


def run() -> dict:
    last_uid = storage.get_last_processed_uid(YEAR_GROUP)
    emails = email_client.fetch_new_emails(since_uid=last_uid)

    if not emails:
        return {"processed": 0, "activities_added": 0, "alerts_sent": 0}

    today = util.london_now().date()
    alerts_sent = 0
    activities_added = 0

    for email in emails:
        activities = claude_extract.extract_activities(email.subject, email.body, email.received_at)
        for activity in activities:
            week_start = util.week_start_for(today)
            # If the activity's date falls in next week's window, file it there instead.
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
            day = activity["day_of_week"]
            week["days"].setdefault(day, []).append(activity)
            storage.save_week(YEAR_GROUP, week_key, week)
            activities_added += 1

            if activity.get("action_required") and activity.get("date"):
                try:
                    activity_date = datetime.fromisoformat(activity["date"]).date()
                    if 0 <= (activity_date - today).days <= ALERT_WITHIN_DAYS:
                        text = formatting.format_alert(activity, day)
                        for chat_id in storage.get_subscribers(YEAR_GROUP):
                            telegram_client.send_message(chat_id, text)
                        alerts_sent += 1
                except ValueError:
                    pass

        storage.set_last_processed_uid(YEAR_GROUP, email.uid)

    return {"processed": len(emails), "activities_added": activities_added, "alerts_sent": alerts_sent}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        if not util.is_authorized(dict(self.headers), query):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"Unauthorized")
            return

        try:
            result = run()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as exc:  # surfaced to caller for manual-trigger debugging
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

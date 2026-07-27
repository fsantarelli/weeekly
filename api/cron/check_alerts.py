import hashlib
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from lib import formatting, storage, telegram_client, util  # noqa: E402

YEAR_GROUP = os.environ.get("YEAR_GROUP", "Y3")
ALERT_WITHIN_DAYS = 2


def _activity_key(day: str, activity: dict) -> str:
    raw = f"{day}|{activity.get('date', '')}|{activity.get('title', '')}".lower()
    return hashlib.sha1(raw.encode()).hexdigest()


def run() -> dict:
    """Scan this week's and next week's stored activities (written by the local
    processing script) for due-soon action items that haven't been alerted yet."""
    today = util.london_now().date()
    week_starts = {util.week_start_for(today).isoformat(), util.next_week_start()}

    alerts_sent = 0
    for week_key in week_starts:
        week = storage.get_week(YEAR_GROUP, week_key)
        if not week:
            continue
        for day, activities in week.get("days", {}).items():
            for activity in activities:
                if not activity.get("action_required") or not activity.get("date"):
                    continue
                try:
                    activity_date = datetime.fromisoformat(activity["date"]).date()
                except ValueError:
                    continue
                if not (0 <= (activity_date - today).days <= ALERT_WITHIN_DAYS):
                    continue

                key = _activity_key(day, activity)
                if storage.was_alerted(YEAR_GROUP, key):
                    continue

                text = formatting.format_alert(activity, day)
                for chat_id in storage.get_subscribers(YEAR_GROUP):
                    telegram_client.send_message(chat_id, text)
                storage.mark_alerted(YEAR_GROUP, key)
                alerts_sent += 1

    return {"alerts_sent": alerts_sent}


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
        except Exception as exc:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

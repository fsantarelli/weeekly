import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from lib import formatting, storage, telegram_client, util  # noqa: E402

YEAR_GROUP = os.environ.get("YEAR_GROUP", "Y3")
SEND_HOUR_LONDON = 17


def run(force: bool = False) -> dict:
    now = util.london_now()
    if not force and now.hour != SEND_HOUR_LONDON:
        return {"sent": False, "reason": f"not {SEND_HOUR_LONDON}:00 Europe/London yet"}

    week_key = util.next_week_start()
    if not force and storage.was_sunday_summary_sent(YEAR_GROUP, week_key):
        return {"sent": False, "reason": "already sent for this week"}

    week = storage.get_week(YEAR_GROUP, week_key) or {
        "year_group": YEAR_GROUP,
        "week_start": week_key,
        "days": {},
    }
    text = formatting.format_week_summary(week)

    subscribers = storage.get_subscribers(YEAR_GROUP)
    for chat_id in subscribers:
        telegram_client.send_message(chat_id, text)

    storage.mark_sunday_summary_sent(YEAR_GROUP, week_key)
    return {"sent": True, "recipients": len(subscribers), "week_start": week_key}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        if not util.is_authorized(dict(self.headers), query):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"Unauthorized")
            return

        # Manual triggers (identified by ?secret=... rather than Vercel's own
        # Authorization header) bypass the day/time and once-per-week guards.
        force = "secret" in query
        try:
            result = run(force=force)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as exc:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

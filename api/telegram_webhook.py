import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib import formatting, storage, telegram_client, util  # noqa: E402

YEAR_GROUP = os.environ.get("YEAR_GROUP", "Y3")


def handle_update(update: dict) -> None:
    message = update.get("message") or update.get("edited_message")
    if not message:
        return

    chat_id = str(message["chat"]["id"])
    text = (message.get("text") or "").strip().lower()

    if text.startswith("/start"):
        storage.add_subscriber(YEAR_GROUP, chat_id)
        telegram_client.send_message(
            chat_id,
            "You're subscribed to Weeekly. You'll get a summary every Sunday at "
            "5PM, plus the odd alert if something urgent comes up. Send /summary "
            "any time for the latest update.",
        )
        return

    if text.startswith("/summary"):
        week_key = util.next_week_start()
        week = storage.get_week(YEAR_GROUP, week_key)
        if week is None:
            telegram_client.send_message(chat_id, "No activities recorded for next week yet.")
            return
        telegram_client.send_message(chat_id, formatting.format_week_summary(week))
        return

    telegram_client.send_message(chat_id, "Commands: /start to subscribe, /summary for the latest update.")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"

        try:
            update = json.loads(raw or b"{}")
            handle_update(update)
            self.send_response(200)
            self.end_headers()
        except Exception as exc:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

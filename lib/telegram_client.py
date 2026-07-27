import os

import requests

_API_BASE = "https://api.telegram.org/bot{token}"


def _base_url() -> str:
    return _API_BASE.format(token=os.environ["TELEGRAM_BOT_TOKEN"])


def send_message(chat_id: str, text: str) -> None:
    resp = requests.post(
        f"{_base_url()}/sendMessage",
        json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
        timeout=10,
    )
    resp.raise_for_status()

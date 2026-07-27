import os
from dataclasses import dataclass
from email import message_from_bytes
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from typing import List

from imapclient import IMAPClient


@dataclass
class FetchedEmail:
    uid: int
    subject: str
    body: str
    received_at: str  # ISO 8601


def _decode(value) -> str:
    if not value:
        return ""
    return str(make_header(decode_header(value)))


def _extract_body(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        return ""
    payload = msg.get_payload(decode=True)
    if not payload:
        return ""
    charset = msg.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")


def fetch_new_emails(since_uid: int) -> List[FetchedEmail]:
    """Fetch emails from SCHOOL_SENDER with UID > since_uid, oldest first."""
    host = os.environ.get("ZOHO_IMAP_HOST", "imap.zoho.com")
    email_addr = os.environ["ZOHO_EMAIL"]
    password = os.environ["ZOHO_APP_PASSWORD"]
    school_sender = os.environ["SCHOOL_SENDER"]

    results: List[FetchedEmail] = []

    with IMAPClient(host, use_uid=True, ssl=True) as client:
        client.login(email_addr, password)
        client.select_folder("INBOX", readonly=True)

        uids = client.search(["FROM", school_sender, "UID", f"{since_uid + 1}:*"])
        # Some servers include the boundary UID even when nothing new exists.
        uids = sorted(u for u in uids if u > since_uid)
        if not uids:
            return results

        response = client.fetch(uids, ["RFC822"])
        for uid in uids:
            raw = response[uid][b"RFC822"]
            msg = message_from_bytes(raw)
            subject = _decode(msg.get("Subject"))
            body = _extract_body(msg)
            date_header = msg.get("Date")
            try:
                received_at = parsedate_to_datetime(date_header).isoformat()
            except (TypeError, ValueError):
                received_at = ""
            results.append(FetchedEmail(uid=uid, subject=subject, body=body, received_at=received_at))

    return results

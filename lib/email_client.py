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


def _parse_school_senders(raw: str) -> List[str]:
    """SCHOOL_SENDER is a comma-separated list of domains ("@kingsely.org" or
    "kingsely.org") and/or full addresses ("test@school.org")."""
    return [entry.strip().lower() for entry in raw.split(",") if entry.strip()]


def _sender_matches(address: str, patterns: List[str]) -> bool:
    address = address.lower()
    for pattern in patterns:
        if pattern.startswith("@"):
            if address.endswith(pattern):
                return True
        elif "@" in pattern:
            if address == pattern:
                return True
        else:
            if address.endswith("@" + pattern):
                return True
    return False


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
    """Fetch emails matching SCHOOL_SENDER with UID > since_uid, oldest first."""
    host = os.environ.get("ZOHO_IMAP_HOST", "imap.zoho.com")
    email_addr = os.environ["ZOHO_EMAIL"]
    password = os.environ["ZOHO_APP_PASSWORD"]
    patterns = _parse_school_senders(os.environ["SCHOOL_SENDER"])

    results: List[FetchedEmail] = []

    with IMAPClient(host, use_uid=True, ssl=True) as client:
        client.login(email_addr, password)
        client.select_folder("INBOX", readonly=True)

        uids = client.search(["UID", f"{since_uid + 1}:*"])
        # Some servers include the boundary UID even when nothing new exists.
        uids = sorted(u for u in uids if u > since_uid)
        if not uids:
            return results

        # Fetch envelopes first (cheap) to filter by sender before pulling full bodies.
        envelopes = client.fetch(uids, ["ENVELOPE"])
        matching_uids = []
        for uid in uids:
            envelope = envelopes[uid][b"ENVELOPE"]
            from_addr = envelope.from_[0] if envelope.from_ else None
            if not from_addr or not from_addr.mailbox or not from_addr.host:
                continue
            address = f"{from_addr.mailbox.decode()}@{from_addr.host.decode()}"
            if _sender_matches(address, patterns):
                matching_uids.append(uid)

        if not matching_uids:
            return results

        response = client.fetch(matching_uids, ["RFC822"])
        for uid in matching_uids:
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

import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")


def london_now() -> datetime:
    return datetime.now(LONDON)


def week_start_for(d: date) -> date:
    """Monday of the ISO week containing d."""
    return d - timedelta(days=d.weekday())


def current_week_start() -> str:
    return week_start_for(london_now().date()).isoformat()


def next_week_start() -> str:
    return (week_start_for(london_now().date()) + timedelta(days=7)).isoformat()


def is_authorized(request_headers: dict, query_params: dict) -> bool:
    """Auth check shared by both real Vercel Cron invocations and manual triggers.

    Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when it invokes
    a cron path, if a CRON_SECRET env var is set on the project. We reuse that same
    secret for manual invocations (curl with the same header, or ?secret=... query
    param) so there's a single value to configure.
    """
    expected = os.environ.get("CRON_SECRET")
    if not expected:
        return False
    auth_header = request_headers.get("Authorization", "")
    if auth_header == f"Bearer {expected}":
        return True
    return query_params.get("secret") == expected

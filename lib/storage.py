import json
import os
from typing import List, Optional

from upstash_redis import Redis

_redis = None


def _client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis(
            url=os.environ["UPSTASH_REDIS_REST_URL"],
            token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
        )
    return _redis


def _week_key(year_group: str, week_start: str) -> str:
    return f"week:{year_group}:{week_start}"


def get_week(year_group: str, week_start: str) -> Optional[dict]:
    raw = _client().get(_week_key(year_group, week_start))
    return json.loads(raw) if raw else None


def save_week(year_group: str, week_start: str, data: dict) -> None:
    _client().set(_week_key(year_group, week_start), json.dumps(data))


def get_last_processed_uid(year_group: str) -> int:
    raw = _client().get(f"last_processed_uid:{year_group}")
    return int(raw) if raw else 0


def set_last_processed_uid(year_group: str, uid: int) -> None:
    _client().set(f"last_processed_uid:{year_group}", str(uid))


def get_subscribers(year_group: str) -> List[str]:
    raw = _client().get(f"subscribers:{year_group}")
    return json.loads(raw) if raw else []


def add_subscriber(year_group: str, chat_id: str) -> None:
    subs = get_subscribers(year_group)
    if chat_id not in subs:
        subs.append(chat_id)
        _client().set(f"subscribers:{year_group}", json.dumps(subs))


def was_sunday_summary_sent(year_group: str, week_start: str) -> bool:
    return _client().get(f"sunday_sent:{year_group}:{week_start}") is not None


def mark_sunday_summary_sent(year_group: str, week_start: str) -> None:
    # Expire after 8 days so the guard key doesn't linger forever.
    _client().set(f"sunday_sent:{year_group}:{week_start}", "1", ex=8 * 24 * 3600)


def was_alerted(year_group: str, activity_key: str) -> bool:
    return _client().get(f"alerted:{year_group}:{activity_key}") is not None


def mark_alerted(year_group: str, activity_key: str) -> None:
    # Expire after 14 days — well past any "due within N days" alert window.
    _client().set(f"alerted:{year_group}:{activity_key}", "1", ex=14 * 24 * 3600)

from typing import Optional

_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _escape(text: str) -> str:
    # Minimal escaping for Telegram legacy Markdown parse mode.
    return text.replace("*", "").replace("_", "").replace("[", "(").replace("]", ")")


def format_week_summary(week: dict, heading: Optional[str] = None) -> str:
    """Render a week's activities as a Telegram message, one line per day."""
    lines = []
    if heading:
        lines.append(f"*{_escape(heading)}*")
    else:
        lines.append(f"*Weeekly — week of {week.get('week_start', '?')}*")
    lines.append("")

    any_activity = False
    for day in _DAYS:
        activities = week.get("days", {}).get(day, [])
        if not activities:
            continue
        any_activity = True
        parts = []
        for activity in activities:
            title = _escape(activity.get("title", ""))
            desc = _escape(activity.get("description", ""))
            entry = f"{title}"
            if desc:
                entry += f" — {desc}"
            if activity.get("action_required"):
                action = _escape(activity.get("action_text", ""))
                entry += f" *[ACTION: {action}]*"
            parts.append(entry)
        lines.append(f"*{day}*: " + "; ".join(parts))

    if not any_activity:
        lines.append("No activities recorded for this week yet.")

    return "\n".join(lines)


def format_alert(activity: dict, day: str) -> str:
    title = _escape(activity.get("title", ""))
    desc = _escape(activity.get("description", ""))
    action = _escape(activity.get("action_text", ""))
    text = f"*Heads up — {day}*\n{title}"
    if desc:
        text += f"\n{desc}"
    if action:
        text += f"\n*ACTION: {action}*"
    return text

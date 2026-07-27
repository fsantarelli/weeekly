import json
import subprocess
from typing import List, TypedDict

_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

_INSTRUCTIONS = (
    "You extract school activities from parent emails. Given an email's subject and "
    "body, identify every distinct activity, event, or action-item relevant to the "
    "school week (e.g. dress-up days, trips, payments due, items to bring, forms to "
    "sign). Ignore signatures, disclaimers, and unrelated newsletter content.\n\n"
    "Respond with ONLY a JSON array (no prose, no markdown code fences) of objects "
    "with exactly these keys:\n"
    f'  "day_of_week": one of {_DAYS}\n'
    '  "date": ISO date "YYYY-MM-DD" if determinable, else ""\n'
    '  "title": short title, e.g. "Tuck shop"\n'
    '  "description": 1-2 sentence summary\n'
    '  "action_required": true/false — true if a parent needs to do something\n'
    '  "action_text": what the parent needs to do if action_required is true, else ""\n\n'
    "If the email contains no concrete activity, respond with an empty array: []"
)


class Activity(TypedDict):
    day_of_week: str
    date: str
    title: str
    description: str
    action_required: bool
    action_text: str


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.endswith("```"):
            text = text[: -len("```")]
    return text.strip()


def extract_activities(subject: str, body: str, received_at: str) -> List[Activity]:
    """Ask the local Claude Code CLI to pull structured activities out of one email.

    Runs `claude` headlessly (uses the logged-in Claude subscription on this
    machine, not the metered Anthropic API) so it must be run locally, not from
    a Vercel serverless function.
    """
    prompt = (
        f"{_INSTRUCTIONS}\n\n"
        f"This email was received at {received_at or 'an unknown time'}.\n\n"
        f"Subject: {subject}\n\n"
        f"Body:\n{body[:12000]}"
    )

    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed (exit {result.returncode}): {result.stderr.strip()}")

    raw = _strip_code_fence(result.stdout)
    try:
        activities = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"claude CLI returned non-JSON output: {raw[:500]!r}") from exc

    for activity in activities:
        activity.setdefault("date", "")
        activity.setdefault("action_text", "")
    return activities

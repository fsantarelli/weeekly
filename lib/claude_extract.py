import os
from typing import List, TypedDict

from anthropic import Anthropic

_client = None

_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

_TOOL = {
    "name": "record_activities",
    "description": "Record the school activities/events/action-items found in this email.",
    "input_schema": {
        "type": "object",
        "properties": {
            "activities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "day_of_week": {
                            "type": "string",
                            "enum": _DAYS,
                            "description": "The day this activity happens on.",
                        },
                        "date": {
                            "type": "string",
                            "description": "ISO date (YYYY-MM-DD) for the activity if determinable from the email, else omit.",
                        },
                        "title": {"type": "string", "description": "Short title, e.g. 'Tuck shop'."},
                        "description": {"type": "string", "description": "1-2 sentence summary."},
                        "action_required": {
                            "type": "boolean",
                            "description": "True if a parent needs to do something (bring an item, sign a form, pay, etc.).",
                        },
                        "action_text": {
                            "type": "string",
                            "description": "What the parent needs to do, if action_required is true. Empty string otherwise.",
                        },
                    },
                    "required": ["day_of_week", "title", "description", "action_required", "action_text"],
                },
            }
        },
        "required": ["activities"],
    },
}


class Activity(TypedDict):
    day_of_week: str
    date: str
    title: str
    description: str
    action_required: bool
    action_text: str


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def extract_activities(subject: str, body: str, received_at: str) -> List[Activity]:
    """Ask Claude to pull structured day/activity data out of one school email."""
    prompt = (
        f"This email was received at {received_at or 'an unknown time'}.\n\n"
        f"Subject: {subject}\n\n"
        f"Body:\n{body[:12000]}\n\n"
        "Extract every distinct activity, event, or action-item relevant to the "
        "school week (e.g. dress-up days, trips, payments due, items to bring, "
        "forms to sign). Ignore signatures, disclaimers, and unrelated newsletter "
        "content. If the email mentions no concrete activity, call the tool with "
        "an empty activities list."
    )

    response = _get_client().messages.create(
        model="claude-sonnet-5",
        max_tokens=2048,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "record_activities"},
        messages=[{"role": "user", "content": prompt}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "record_activities":
            activities = block.input.get("activities", [])
            for activity in activities:
                activity.setdefault("date", "")
                activity.setdefault("action_text", "")
            return activities

    return []

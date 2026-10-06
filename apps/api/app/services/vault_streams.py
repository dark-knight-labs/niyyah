"""Streams: the goals the planner pages organise work by.

A stream owns one quarter goal, one pipeline and one week objective. Streams are not time blocks:
the OT block serves Kahf on Sun-Thu and Alisha on Fri-Sat. Finance is passive (no slot, no weekly
objective); sleep only has a weekly objective.
"""
import re

PIPELINE_STREAMS = ("soul", "body", "kahf", "alisha", "distribution", "fnf", "finance")
OBJECTIVE_STREAMS = ("soul", "body", "kahf", "alisha", "distribution", "fnf", "sleep")
LABELS = {
    "soul": "Soul", "body": "Body", "kahf": "Kahf", "alisha": "Alisha", "distribution": "Distribution",
    "fnf": "FnF", "finance": "Finance", "sleep": "Sleep",
}
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
MONTH_TAG = re.compile(r"(?:^|\s)#(" + "|".join(MONTHS) + r")\b", re.IGNORECASE)


def split_month_tag(text: str) -> tuple[str, str | None]:
    """('Ship it #nov') -> ('Ship it', 'nov'); the last month tag wins, text is whitespace-normalised."""
    found = MONTH_TAG.findall(text)
    month = found[-1].lower() if found else None
    return " ".join(MONTH_TAG.sub("", text).split()), month

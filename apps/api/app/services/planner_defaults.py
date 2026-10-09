"""The starter template a new account begins with: blocks, location settings and a prayer-anchored weekly schedule."""
from app.services.rules import COLORS

COLOR_KEYS = list(COLORS)


def _b(key, label, ring, color, stars=True, archived=False):
    return {"key": key, "label": label, "ring_name": ring, "color": color, "counts_for_stars": stars, "archived": archived}


STARTER_BLOCKS = [
    _b("soul", "Soul", "SOUL", "emerald"),
    _b("body", "Body", "BODY", "amber"),
    _b("work", "Deep work", "WORK", "violet"),
    _b("planning", "Planning", "PLAN", "sky", stars=False),
    _b("fnf", "Family and friends", "FAM", "rose"),
    _b("sleep", "Sleep", "SLEEP", "slate"),
]

STARTER_META = {"city": None, "lat": None, "lon": None, "tz": "UTC", "method": "mwl", "madhab": "shafi", "weekend_days": ["sat", "sun"]}


def _r(block, start, end, what, stream=None):
    return {"block": block, "start": start, "end": end, "what": what, "stream": stream}


STARTER_WEEKDAY = [
    _r("soul", "fajr", "sunrise", "Quran and adhkar"),
    _r("body", "sunrise+10", "07:45", "Walk or train"),
    _r("work", "08:30", "dhuhr-10", "Deep work"),
    _r("soul", "dhuhr", "dhuhr+25", "Dhuhr and lunch"),
    _r("work", "13:30", "asr-15", "Deep work"),
    _r("fnf", "maghrib", "isha+40", "Family dinner"),
    _r("sleep", "isha+90", "fajr-20", "Sleep"),
]
STARTER_WEEKEND = [
    _r("soul", "fajr", "sunrise", "Quran and adhkar"),
    _r("planning", "09:00", "10:30", "Weekly planning"),
    _r("work", "11:00", "asr-15", "Side project"),
    _r("fnf", "maghrib", "isha+60", "Family and friends"),
    _r("sleep", "isha+100", "fajr-20", "Sleep"),
]

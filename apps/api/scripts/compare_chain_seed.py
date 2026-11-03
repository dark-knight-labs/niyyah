#!/usr/bin/env python3
"""Seed one running Niyyah API with the data compare_chain.py is rehearsed on: the sample account plus the awkward cases
the planning-rows migration has to keep (past-week objectives, an objective whose text and tick differ from its item, an
empty-text ticked objective, an objective with no item, tasks in the 8 weeks before this one). Writes through POST /import,
so run it against the OLD code's server on a throwaway database, then copy that database for the NEW code.

    python scripts/compare_chain_seed.py http://127.0.0.1:8100 --email chain@example.com --password chainpass123

Needs httpx and, on sys.path, the API's own `app` package (rules.py) and `tests.sample_snapshot` (run it from apps/api).
"""
import argparse
import sys
from datetime import date, timedelta

import httpx

from app.services.rules import week_for
from tests.sample_snapshot import sample_snapshot


def snapshot(today: date) -> dict:
    snap = sample_snapshot(today)
    iso = lambda d: d.isoformat()  # noqa: E731
    last, before = week_for(today - timedelta(days=7))[2], week_for(today - timedelta(days=14))[2]
    studio = snap["pipeline_items"]
    studio[0]["description"] = "Check the SFP module first.\nThen the VLANs."
    snap["week_objectives"][0].update(text="Wire the router, then test it #oct", done=True)  # differs from its item in text, tick and month
    studio.append({"stream": "studio", "lane": "done", "text": "Last week's domino", "description": "", "products": ["Router"], "checkpoint": None,
                   "added_on": iso(today - timedelta(days=20)), "done_on": iso(today - timedelta(days=6)), "focus_week": last, "done": True, "blocked_by": []})
    snap["week_objectives"] += [
        {"week": last, "stream": "studio", "text": "Last week's domino, as typed", "done": True, "checkpoint": None},  # linked to the item above
        {"week": last, "stream": "shop", "text": "Draft the page", "done": False, "checkpoint": None},  # no item carries it
        {"week": before, "stream": "shop", "text": "", "done": True, "checkpoint": None},  # empty text, ticked
    ]
    snap["tasks"] += [
        {"text": f"Week {n} task #ops", "done": n % 2 == 0, "due_on": None, "scheduled_on": iso(today - timedelta(days=7 * n)), "start_on": None,
         "done_on": iso(today - timedelta(days=7 * n)) if n % 2 == 0 else None, "source_path": f"Calendar/Daily/{iso(today - timedelta(days=7 * n))}.md",
         "stream": "studio" if n % 3 == 0 else None, "products": ["ops"], "start_min": 540 if n % 2 else None, "end_min": 600 if n % 2 else None}
        for n in range(0, 9)]
    return snap


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--today", help="YYYY-MM-DD (default: today on this machine)")
    args = ap.parse_args()
    today = date.fromisoformat(args.today) if args.today else date.today()
    http = httpx.Client(base_url=args.base.rstrip("/") + "/api/v1", timeout=60)
    http.post("/auth/register", json={"email": args.email, "password": args.password})
    token = http.post("/auth/login", json={"email": args.email, "password": args.password}).json()["access_token"]
    res = http.post("/import", params={"replace": "true"}, json=snapshot(today), headers={"Authorization": f"Bearer {token}"})
    print(res.status_code, res.text[:300])
    return 0 if res.status_code == 200 else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Compare two Niyyah API servers that hold the same data: the code before the planning-rows migration (OLD) and after it (NEW).

Criterion 2 (reads): GET /vault/pipelines, /vault/objectives, /vault/items for this week and the 8 weeks before it (in 14-day
windows) and /vault/day/<d>/tasks for each of those days must answer the same on both servers.
Criterion 3 (writes): one scripted write sequence is replayed against both, and the same reads are compared after every step.
The sequence only touches items it makes itself (text "zzchain ..."), plus the stream's focus and objective for this week.
RUN IT ONLY AGAINST COPIES OF THE DATA: it writes.

Allowed differences, and nothing else:
  (a) pipeline `line` and plain-item `id` values: pipeline rows get new ids at the migration, and rows made during the replay
      get ids from each server's own sequence. Ids are compared through labels (old `line` via `origin` on the new server).
  (b) the item fields lane, focus_week, checkpoint, parent_id on /vault/items, which only the new server sends.
Any other difference prints and the exit status is 1.

    python scripts/compare_chain.py --old http://127.0.0.1:8101 --old-token T1 --new http://127.0.0.1:8102 --new-token T2 [--stream studio]

Needs only httpx (a dependency of the API).
"""
import argparse
import json
import re
import sys
from datetime import date, timedelta

import httpx

V = "/api/v1/vault"
NEW_ITEM_FIELDS = ("lane", "focus_week", "checkpoint", "parent_id")  # allowed difference (b)
MARK = "zzchain"


class Side:
    def __init__(self, name: str, base: str, token: str):
        self.name = name
        self.http = httpx.Client(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=60)
        self.labels: dict[int, str] = {}  # pipeline line / task id -> label shared by both sides

    def get(self, path: str, **params):
        res = self.http.get(path, params=params)
        res.raise_for_status()
        return res.json()

    def send(self, method: str, path: str, body: dict | None = None) -> httpx.Response:
        return self.http.request(method, path, json=body)


# --- Reading ----------------------------------------------------------------------------------------------------

def week_start(day: date) -> date:
    return day - timedelta(days=(day.weekday() + 1) % 7)  # Sunday


def windows(today: date) -> list[tuple[date, date]]:
    """14-day windows covering the week of `today` and the 8 weeks before it."""
    first, last = week_start(today) - timedelta(weeks=8), week_start(today) + timedelta(days=6)
    out, cursor = [], first
    while cursor <= last:
        out.append((cursor, min(cursor + timedelta(days=13), last)))
        cursor += timedelta(days=14)
    return out


def read_all(side: Side, today: date, days: bool = True) -> dict:
    snap = {"pipelines": side.get(f"{V}/pipelines"), "objectives": side.get(f"{V}/objectives"), "items": [], "orphans": [], "day_tasks": {}}
    for first, last in windows(today):
        body = side.get(f"{V}/items", **{"from": first.isoformat(), "to": last.isoformat()})
        snap["items"] += body["items"]
        snap["orphans"] += body["orphans"]
    if days:
        first, last = windows(today)[0][0], windows(today)[-1][1]
        day = first
        while day <= last:
            snap["day_tasks"][day.isoformat()] = side.get(f"{V}/day/{day.isoformat()}/tasks")
            day += timedelta(days=1)
    return snap


def learn_labels(side: Side, snap: dict, new_side: bool) -> None:
    """Label every pipeline line. Old side: p<line>. New side: p<old line> through `origin`, c<text> for rows made by the replay."""
    side.labels = {}
    origins = {}
    if new_side:
        for item in side.get(f"{V}/items/undated")["items"]:
            origins[item["id"]] = item.get("origin")
    for stream in snap["pipelines"]["streams"]:
        for row in stream["items"]:
            text = row["text"]
            if text.startswith(MARK):
                side.labels[row["line"]] = f"c:{stream['stream']}:{text}"
            elif new_side:
                origin = origins.get(row["line"]) or ""
                match = re.match(r"pipeline:(\d+)", origin)
                side.labels[row["line"]] = f"p{match.group(1)}" if match else f"?new:{row['line']}"
            else:
                side.labels[row["line"]] = f"p{row['line']}"


def normalise(side: Side, snap: dict) -> dict:
    """Replace ids by labels and drop the allowed-different fields, so two snapshots can be compared as plain JSON."""
    out = json.loads(json.dumps(snap))
    for stream in out["pipelines"]["streams"]:
        for row in stream["items"]:
            row["line"] = side.labels.get(row["line"], f"?{row['line']}")
    for item in out["items"]:
        for field in NEW_ITEM_FIELDS:
            item.pop(field, None)
        if item.get("id") is not None and item["title"].startswith(MARK):
            item["id"] = f"c:{item['title']}"
    for tasks in out["day_tasks"].values():
        for task in tasks:
            if task["text"].startswith(MARK):
                task["line"] = f"c:{task['text']}"
    return out


def diff(a, b, path="") -> list[str]:
    if type(a) is not type(b):
        return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict):
        out = []
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                out.append(f"{path}/{key}: only on {'old' if key in a else 'new'}")
            else:
                out += diff(a[key], b[key], f"{path}/{key}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: {len(a)} entries on old, {len(b)} on new"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in diff(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: old {a!r} != new {b!r}"]


def compare(old: Side, new: Side, today: date, where: str, days: bool) -> list[str]:
    old_snap, new_snap = read_all(old, today, days), read_all(new, today, days)
    learn_labels(old, old_snap, False)
    learn_labels(new, new_snap, True)
    return [f"[{where}] {d}" for d in diff(normalise(old, old_snap), normalise(new, new_snap))]


# --- Writing ----------------------------------------------------------------------------------------------------

def find(side: Side, stream: str, text: str) -> dict:
    for s in side.get(f"{V}/pipelines")["streams"]:
        if s["stream"] == stream:
            for row in s["items"]:
                if row["text"] == text:
                    return row
    raise LookupError(f"{side.name}: no pipeline item {text!r} in {stream}")


def day_task(side: Side, day: date, text: str) -> dict:
    for task in side.get(f"{V}/day/{day.isoformat()}/tasks"):
        if task["text"] == text:
            return task
    raise LookupError(f"{side.name}: no task {text!r} on {day}")


def steps(stream: str, today: date):
    """The write sequence: (name, function(side) -> list of (method, path, body)). Item references are text lookups per side."""
    s, p = stream, f"{V}/pipeline"
    a, b, c, d, e = (f"{MARK} {x}" for x in "ABCDE")
    ref = lambda side, text: {"stream": s, "line": find(side, s, text)["line"], "hash": ""}  # noqa: E731
    week_text = f"{MARK} week goal"

    def one(method, path, body=None):
        return lambda side: [(method, path, body(side) if callable(body) else body)]

    yield "add items to now, next, backlog", lambda side: [
        ("POST", f"{p}/{s}/items", {"texts": [a], "lane": "now"}), ("POST", f"{p}/{s}/items", {"texts": [b], "lane": "next", "descriptions": ["two\nlines"]}),
        ("POST", f"{p}/{s}/items", {"texts": [c], "lane": "backlog"}), ("POST", f"{p}/{s}/items", {"texts": [f"{d} #router [product:: Edge] #nov"], "lane": "next"}),
        ("POST", f"{p}/{s}/items", {"texts": [e], "lane": "next"})]
    yield "focus A", one("PUT", f"{p}/focus", lambda side: ref(side, a))
    yield "objective text with a tag renames the domino", one("PUT", f"{V}/objectives", {"stream": s, "text": f"{a} #oct", "checkpoint": "oct"})
    yield "tick the objective", one("PUT", f"{V}/objectives", {"stream": s, "done": True})
    yield "untick the objective", one("PUT", f"{V}/objectives", {"stream": s, "done": False})
    yield "finish the domino in the pipeline", one("PUT", f"{p}/move", lambda side: {**ref(side, a), "lane": "done"})
    yield "reopen the domino", one("PUT", f"{p}/move", lambda side: {**ref(side, a), "lane": "now"})
    yield "move next -> done -> backlog -> now", lambda side: [
        ("PUT", f"{p}/move", {**ref(side, b), "lane": "done"}), ("PUT", f"{p}/move", {**ref(side, b), "lane": "backlog"}),
        ("PUT", f"{p}/move", {**ref(side, b), "lane": "now"})]
    yield "checkpoint, description, blocked-by, rename", lambda side: [
        ("PUT", f"{p}/checkpoint", {**ref(side, c), "checkpoint": "dec"}), ("PUT", f"{p}/description", {**ref(side, c), "description": "line one\n\nline three"}),
        ("PUT", f"{p}/blocked-by", {**ref(side, c), "ids": ["abcd1234", "abcd1234"]}), ("PUT", f"{p}/text", {**ref(side, c), "text": f"{c} renamed #infra"})]
    c = f"{c} renamed"
    # v3 item 3: clearing the objective of a domino whose objective is ticked keeps the tick
    yield "tick, then clear the objective text of a domino", lambda side: [
        ("PUT", f"{p}/focus", ref(side, d)), ("PUT", f"{V}/objectives", {"stream": s, "done": True}), ("PUT", f"{V}/objectives", {"stream": s, "text": ""})]
    # v3 item 2 (i): an objective with no item exists, then a pipeline item is focused
    yield "objective without an item, then focus an item", lambda side: [
        ("PUT", f"{p}/focus", ref(side, e)), ("PUT", f"{V}/objectives", {"stream": s, "done": True}), ("POST", f"{p}/remove", ref(side, e)),
        ("PUT", f"{p}/focus", ref(side, b))]
    # v3 item 2 (ii): the same, then the objective text names an open item
    yield "objective without an item, then objective text names an open item", lambda side: [
        ("PUT", f"{V}/objectives", {"stream": s, "done": True}), ("POST", f"{p}/remove", ref(side, b)),
        ("PUT", f"{V}/objectives", {"stream": s, "text": c})]
    yield "objective text names nothing: a new domino", one("PUT", f"{V}/objectives", {"stream": s, "text": week_text})
    yield "rename the domino through the objective", one("PUT", f"{V}/objectives", {"stream": s, "text": f"{week_text} v2 #nov"})
    yield "remove a focused domino", one("POST", f"{p}/remove", lambda side: ref(side, f"{week_text} v2"))
    yield "plain tasks: add, rename, tick, move, remove", lambda side: [
        ("POST", f"{V}/day/{today.isoformat()}/tasks", {"text": f"{MARK} task #tag"}), ("POST", f"{V}/day/{today.isoformat()}/tasks", {"text": f"{MARK} task two"})]
    line = lambda side, text: (lambda: {"line": day_task(side, today, text)["line"]})  # noqa: E731  (looked up when the request is sent)
    yield "plain task writes by id", lambda side: [
        ("PUT", f"{V}/tasks/text", lambda: {**line(side, f"{MARK} task")(), "text": f"{MARK} task renamed"}),
        ("PUT", f"{V}/tasks", lambda: {**line(side, f"{MARK} task renamed")(), "done": True}),
        ("PUT", f"{V}/tasks/move", lambda: {**line(side, f"{MARK} task two")(), "from_day": today.isoformat(), "to_day": (today + timedelta(days=1)).isoformat()}),
        ("POST", f"{V}/tasks/remove", line(side, f"{MARK} task renamed"))]
    yield "items API: add, patch, delete a plain item", lambda side: [
        ("POST", f"{V}/items", {"day": today.isoformat(), "text": f"{MARK} item #x", "weight": 2, "start_min": 540, "end_min": 600})]
    yield "items API patch and delete", lambda side: _item_patch(side, today)


def _item_patch(side: Side, today: date):
    item_id = lambda: next(i["id"] for i in side.get(f"{V}/items", **{"from": today.isoformat(), "to": today.isoformat()})["items"]  # noqa: E731
                           if i["title"].startswith(f"{MARK} item"))
    path = lambda: f"{V}/items/{item_id()}"  # noqa: E731
    return [("PATCH", path, {"status": "done", "description": "d"}), ("PATCH", path, {"text": f"{MARK} item renamed"}), ("DELETE", path, None)]


def pick_stream(side: Side, wanted: str | None) -> str:
    for s in side.get(f"{V}/pipelines")["streams"]:
        if (wanted and s["stream"] == wanted) or (not wanted and s["weekly"]):
            return s["stream"]
    sys.exit(f"{side.name}: no weekly stream with a pipeline{' named ' + wanted if wanted else ''}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True)
    ap.add_argument("--old-token", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--new-token", required=True)
    ap.add_argument("--stream", help="the weekly stream with a pipeline the replay writes to (default: the first)")
    ap.add_argument("--today", help="the day both servers think it is (YYYY-MM-DD; default: the OLD server's /vault/objectives week start + today)")
    ap.add_argument("--reads-only", action="store_true", help="skip the write replay")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    old, new = Side("old", args.old, args.old_token), Side("new", args.new, args.new_token)
    today = date.fromisoformat(args.today) if args.today else date.today()
    failures: list[str] = []

    def report(found: list[str]) -> None:
        failures.extend(found)
        for line in found[:40]:
            print("DIFF", line)
        if len(found) > 40:
            print(f"DIFF ... and {len(found) - 40} more")

    stream = pick_stream(new, args.stream)
    for side in (old, new):
        if pick_stream(side, stream) != stream:
            sys.exit("the two servers do not agree on the stream")
    n_old = sum(len(s["items"]) for s in old.get(f"{V}/pipelines")["streams"])
    n_new = sum(len(s["items"]) for s in new.get(f"{V}/pipelines")["streams"])
    print(f"before: {n_old} pipeline items on old, {n_new} on new; replay stream '{stream}'")
    report(compare(old, new, today, "reads before the writes", days=True))

    if not args.reads_only:
        for name, make in steps(stream, today):
            statuses = {}
            for side in (old, new):
                results = []
                for method, path, body in make(side):
                    path, body = path() if callable(path) else path, body() if callable(body) else body
                    res = side.send(method, path, body)
                    results.append(res.status_code)
                    if res.status_code >= 500:
                        failures.append(f"[{name}] {side.name} answered {res.status_code} to {method} {path}: {res.text[:200]}")
                statuses[side.name] = results
            if statuses["old"] != statuses["new"]:
                failures.append(f"[{name}] status codes differ: old {statuses['old']} new {statuses['new']}")
            found = compare(old, new, today, name, days=False)
            report(found)
            if not args.quiet:
                print(("FAIL" if found or statuses["old"] != statuses["new"] else "ok  "), name, statuses["old"])
        report(compare(old, new, today, "reads after the writes", days=True))

    allowed = "allowed differences: ids/lines (compared through labels), items fields " + ", ".join(NEW_ITEM_FIELDS)
    print(allowed)
    for failure in failures:
        if not failure.startswith("["):
            print("FAILURE", failure)
    print(f"{'PASS' if not failures else 'FAIL'}: {len(failures)} difference(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

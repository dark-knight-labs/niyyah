"""Deterministic perf boards for fps.mjs (planner v2 B3). Talks to a running API over HTTP (httpx, from the API venv).

  P: 500 mind nodes in ONE tree (depth <= 5) + 500 stickies.
  S: 300 mind (one tree) + 200 stickies + 12 shape types x 10 + 100 connectors with mixed styles (+ 20 image nodes with --images, release R2 only).

Usage: python seed-board.py <api-url> <email> <password> [--images]
Prints one JSON line: {"P": "<board id>", "S": "<board id>", "tokens": {...}}. Ids are uuid5 of fixed names, so reruns on a fresh DB give identical rows.
"""
import json
import sys
import uuid

import httpx

NS = uuid.UUID("6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f")
SHAPES = ["rect", "rounded", "ellipse", "diamond", "triangle", "hexagon", "parallelogram", "star", "arrow", "cylinder", "cloud", "speech"]
COLORS = ["violet", "cyan", "orange", "indigo", "lime", "fuchsia", "rose", "sky", "emerald", "amber"]
STICKY = ["yellow", "green", "blue", "pink"]
# a valid 16x16 PNG (solid grey), built once
import struct, zlib


def _png(w: int = 16, h: int = 16) -> bytes:
    raw = b"".join(b"\x00" + b"\x88" * w for _ in range(h))
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PNG = _png()


def nid(board: str, name: str) -> str:
    return str(uuid.uuid5(NS, f"{board}/{name}"))


def node(board: str, name: str, kind: str, **kw) -> dict:
    base = dict(id=nid(board, name), kind=kind, parent_id=None, parent_key=None, position=0, x=0, y=0, w=0, h=0, text="", notes="",
                style={}, collapsed=False, hidden=False, ref_key=None, frame_id=None)
    base.update(kw)
    return {"op": "upsert_node", "node": base, "base_updated_at": None}


def mind_tree(board: str, count: int) -> list[dict]:
    """4-ary heap: index i has parent (i-1)//4 -> depths 0..5 for up to 1,365 nodes. Root centred at (0,0)."""
    ops = []
    for i in range(count):
        if i == 0:
            ops.append(node(board, "m0", "mind", x=0, y=0, text="Root"))
            continue
        parent = (i - 1) // 4
        style = {}
        if parent == 0:
            style = {"side": "R" if i % 2 else "L", "color": COLORS[i % len(COLORS)]}
        ops.append(node(board, f"m{i}", "mind", parent_id=nid(board, f"m{parent}"), position=(i - 1) % 4 if parent else i, style=style, text=f"Thought {i}"))
    return ops


def stickies(board: str, count: int, x0: int, y0: int, cols: int = 25) -> list[dict]:
    return [node(board, f"s{i}", "sticky", x=x0 + (i % cols) * 190, y=y0 + (i // cols) * 150, w=170, h=130, text=f"Note {i}", style={"color": STICKY[i % 4]}) for i in range(count)]


def push(client: httpx.Client, headers: dict, board_id: int, ops: list[dict]) -> None:
    for i in range(0, len(ops), 400):
        r = client.post(f"/api/v1/boards/{board_id}/ops", json={"ops": ops[i:i + 400]}, headers=headers)
        r.raise_for_status()


def main() -> None:
    url, email, password = sys.argv[1:4]
    images = "--images" in sys.argv
    with httpx.Client(base_url=url, timeout=60) as c:
        tokens = c.post("/api/v1/auth/login", json={"email": email, "password": password}).json()
        h = {"Authorization": f"Bearer {tokens['access_token']}"}
        out: dict = {}
        # Board P
        p = c.post("/api/v1/boards", json={"title": "Perf P"}, headers=h).json()
        push(c, h, p["id"], mind_tree("P", 500) + stickies("P", 500, 2600, -1500))
        out["P"] = str(p["id"])
        # Board S
        s = c.post("/api/v1/boards", json={"title": "Perf S"}, headers=h).json()
        ops = mind_tree("S", 300) + stickies("S", 200, 2200, -1100, cols=20)
        for k, shape in enumerate(SHAPES):
            for j in range(10):
                ops.append(node("S", f"sh{k}_{j}", "shape", x=-2600 + j * 200, y=1400 + k * 140, w=170, h=100, text=shape, style={"shape": shape}))
        if images:
            # one small real PNG (uploaded raw), referenced by 20 image nodes: the browser fetches it once and shows it 20 times
            up = c.post("/api/v1/boards/files", params={"name": "seed.png"}, content=PNG, headers={**h, "content-type": "image/png"})
            up.raise_for_status()
            fid = up.json()["id"]
            for i in range(20):
                ops.append(node("S", f"img{i}", "image", x=-2600 + (i % 10) * 200, y=3200 + (i // 10) * 160, w=170, h=120, style={"file_id": fid, "mime": "image/png", "bytes": len(PNG), "nw": 16, "nh": 16}))
        for i in range(100):
            ops.append({"op": "upsert_edge", "base_updated_at": None, "edge": {
                "id": nid("S", f"e{i}"), "from_id": nid("S", f"s{i}"), "to_id": nid("S", f"s{(i * 7 + 3) % 200}"), "label": f"link {i}" if i % 10 == 0 else "",
                "style": {"path": ["straight", "curved", "elbow"][i % 3], "width": [1, 2, 3, 5][i % 4], "dash": ["solid", "dashed", "dotted"][i % 3],
                          "start": ["none", "dot"][i % 2], "end": ["arrow", "open", "diamond", "bar"][i % 4], "color": COLORS[i % len(COLORS)]}}})
        push(c, h, s["id"], ops)
        out["S"] = str(s["id"])
        out["tokens"] = tokens
    print(json.dumps(out))


if __name__ == "__main__":
    main()

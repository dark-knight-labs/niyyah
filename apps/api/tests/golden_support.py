"""Golden files: the exact JSON an endpoint returned before the item tree existed. Regenerate only on purpose: UPDATE_GOLDEN=1."""
import json
import os
from pathlib import Path

GOLDEN = Path(__file__).parent / "golden"


def canonical(data) -> str:
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def assert_golden(name: str, data) -> None:
    path = GOLDEN / f"{name}.json"
    text = canonical(data)
    if os.environ.get("UPDATE_GOLDEN") == "1":
        path.write_text(text, encoding="utf-8")
        return
    assert path.exists(), f"missing golden file {path.name}; run with UPDATE_GOLDEN=1 once, on the code that defines the behavior"
    assert text == path.read_text(encoding="utf-8"), f"{name} changed"

"""Shape of core's public API as plugins and clients see it, and the rule for what counts as a breaking change.

Regenerate the snapshot deliberately, in the PR that makes the change:
    python -m tests.contract > tests/openapi_contract.json
"""
import json
import os
import sys

os.environ.setdefault("APP_ENV", "development")


def _shape(schema: dict, spec: dict, depth: int = 0) -> dict:
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        if depth > 6:
            return {"ref": name}
        return _shape(spec["components"]["schemas"][name], spec, depth + 1)
    for key in ("anyOf", "oneOf"):
        if key in schema:  # Optional[X] is anyOf [X, null]: keep the non-null branches, sorted for a stable snapshot
            parts = [_shape(s, spec, depth + 1) for s in schema[key] if s.get("type") != "null"]
            return parts[0] if len(parts) == 1 else {"any": sorted(parts, key=json.dumps)}
    out: dict = {"type": schema.get("type", "any")}
    if "properties" in schema:
        out["properties"] = {k: _shape(v, spec, depth + 1) for k, v in sorted(schema["properties"].items())}
        out["required"] = sorted(schema.get("required", []))
    if "items" in schema:
        out["items"] = _shape(schema["items"], spec, depth + 1)
    return out


def build_contract(openapi: dict) -> dict:
    contract = {}
    for path, methods in sorted(openapi["paths"].items()):
        for method, op in sorted(methods.items()):
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            ok = next((r for code, r in sorted(op.get("responses", {}).items()) if code.startswith("2")), {})
            reply = ok.get("content", {}).get("application/json", {}).get("schema")
            contract[f"{method.upper()} {path}"] = {
                "params": sorted(f"{p['in']}:{p['name']}{'*' if p.get('required') else ''}" for p in op.get("parameters", [])),
                "request": _shape(body, openapi) if body else None,
                "response": _shape(reply, openapi) if reply else None,
            }
    return contract


def breaks(old: dict, new: dict, where: str, side: str) -> list[str]:
    """Why `new` is not a drop-in for `old`. Responses may gain fields; requests may gain optional ones."""
    if old is None or new is None:
        return [] if old is None and side == "response" or old == new else [f"{where}: body appeared or vanished"]
    if "any" in old or "any" in new:
        return [] if old == new else [f"{where}: union changed"]
    if old.get("type") != new.get("type"):
        return [f"{where}: type {old.get('type')} -> {new.get('type')}"]
    found = []
    old_props, new_props = old.get("properties", {}), new.get("properties", {})
    for name, shape in old_props.items():
        if name not in new_props:
            if side == "response":
                found.append(f"{where}.{name}: removed")
            continue
        found += breaks(shape, new_props[name], f"{where}.{name}", side)
    if side == "request":
        for name in set(new.get("required", [])) - set(old.get("required", [])):
            found.append(f"{where}.{name}: newly required")
    if "items" in old and "items" in new:
        found += breaks(old["items"], new["items"], f"{where}[]", side)
    return found


if __name__ == "__main__":
    from app.main import create_app

    json.dump(build_contract(create_app(plugin_specs=[], entry_points=lambda: []).openapi()), sys.stdout, indent=1, sort_keys=True)
    print()

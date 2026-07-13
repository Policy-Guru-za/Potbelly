#!/usr/bin/env python3
"""Migrate legacy slug-keyed rewrite caches to stable source identities."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from potbelly.model import normalize_recipe, source_id  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=str(Path(__file__).parent / "out" / "rewritten"))
    parser.add_argument("--apply", action="store_true", help="write migrated identity-keyed files")
    args = parser.parse_args()
    cache_dir = Path(args.cache_dir)
    planned = []
    failures = []
    for path in sorted(cache_dir.glob("*.json")):
        try:
            record = normalize_recipe(json.loads(path.read_text(encoding="utf-8")))
            target = cache_dir / f"{source_id(record['source_url'])}.json"
            if target == path:
                continue
            if target.exists() and target.read_bytes() != path.read_bytes():
                failures.append(f"conflicting target: {target.name}")
                continue
            planned.append((path, target, record))
        except Exception as exc:
            failures.append(f"{path.name}: {type(exc).__name__}: {exc}")
    print(json.dumps({"planned": len(planned), "failures": failures}, indent=2))
    if failures:
        raise SystemExit(1)
    if args.apply:
        for _, target, record in planned:
            target.write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n",
                              encoding="utf-8")


if __name__ == "__main__":
    main()

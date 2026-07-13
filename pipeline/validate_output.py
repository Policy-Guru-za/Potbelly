#!/usr/bin/env python3
"""Create a deduplicated candidate corpus without promoting it to production."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from potbelly.model import (  # noqa: E402
    assign_unique_slugs,
    dump_corpus,
    load_corpus,
    normalize_recipe,
    source_id,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(Path(__file__).parent / "out" / "data.json"))
    parser.add_argument("--output", default=str(Path(__file__).parent / "out" / "data.validated.json"))
    parser.add_argument("--target", type=int, default=150)
    args = parser.parse_args()

    production = load_corpus(ROOT / "data.json", legacy=True)
    production_sources = {item["source_id"] for item in production}
    raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    unique = {item["source_id"]: item for item in production}
    rejected = []
    candidates = []
    for item in raw:
        try:
            normalized = normalize_recipe(item, legacy=True)
        except Exception as exc:
            rejected.append({"slug": item.get("slug"), "error": str(exc)})
            continue
        if normalized["source_id"] in production_sources:
            continue
        unique.setdefault(normalized["source_id"], normalized)
        candidates.append(normalized)
    assigned = assign_unique_slugs(
        [item for sid, item in unique.items() if sid not in production_sources], production
    )
    result = production + [normalize_recipe(item) for item in assigned]
    dump_corpus(result, args.output)
    report = {
        "target": args.target,
        "validated_unique": len(result),
        "missing": max(0, args.target - len(result)),
        "rejected": rejected,
        "output": args.output,
    }
    print(json.dumps(report, indent=2))
    if len(result) != args.target:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

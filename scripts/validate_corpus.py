#!/usr/bin/env python3
"""Validate the production corpus and print a CI-friendly summary."""

import json
from pathlib import Path

from potbelly.model import load_corpus


def main() -> None:
    recipes = load_corpus(Path("data.json"), legacy=True)
    summary = {
        "recipes": len(recipes),
        "unique_sources": len({recipe["source_id"] for recipe in recipes}),
        "unique_routes": len({recipe["slug"] for recipe in recipes}),
        "legacy": sum(recipe["quality_tier"] == "legacy" for recipe in recipes),
    }
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()

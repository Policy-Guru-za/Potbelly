#!/usr/bin/env python3
"""Audit source attribution links without failing on transient publisher blocks."""

from __future__ import annotations

import concurrent.futures
import json
import urllib.error
import urllib.request

from potbelly.model import load_corpus

TERMINAL = {404, 410}


def check(url: str) -> tuple[str, int | str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Potbelly link audit (+https://potbelly.example)"},
        method="HEAD",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return url, response.status
    except urllib.error.HTTPError as exc:
        if exc.code in {403, 405, 429}:
            return url, f"publisher-blocked:{exc.code}"
        return url, exc.code
    except Exception as exc:
        return url, f"transient:{type(exc).__name__}"


def main() -> None:
    recipes = load_corpus("data.json", legacy=True)
    urls = sorted({recipe["source_url"] for recipe in recipes})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(check, urls))
    terminal = [(url, status) for url, status in results if status in TERMINAL]
    summary = {
        "checked": len(results),
        "healthy": sum(isinstance(status, int) and status < 400 for _, status in results),
        "publisher_blocked_or_transient": sum(not isinstance(status, int) for _, status in results),
        "terminal": terminal,
    }
    print(json.dumps(summary, indent=2))
    if terminal:
        raise SystemExit("terminal source links require editorial review")


if __name__ == "__main__":
    main()

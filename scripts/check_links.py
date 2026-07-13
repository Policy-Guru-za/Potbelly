#!/usr/bin/env python3
"""Fail when generated HTML references a missing same-origin artifact."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: list[str] = []

    def handle_starttag(self, tag, attrs):
        key = "href" if tag in {"a", "link"} else "src" if tag == "script" else None
        if not key:
            return
        value = dict(attrs).get(key)
        if value:
            self.values.append(value)


def target_for(root: Path, value: str) -> Path | None:
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return None
    path = parsed.path
    if path == "/":
        return root / "index.html"
    candidate = root / path.lstrip("/")
    if candidate.suffix:
        return candidate
    return candidate.with_suffix(".html")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    failures = []
    checked = 0
    for page in sorted(args.root.rglob("*.html")):
        links = Links()
        links.feed(page.read_text(encoding="utf-8"))
        for value in links.values:
            target = target_for(args.root, value)
            if target is None:
                continue
            checked += 1
            if not target.is_file():
                failures.append(f"{page}: {value} -> {target}")
    if failures:
        raise SystemExit("broken internal links:\n" + "\n".join(failures))
    print(f"checked {checked} internal asset and route links")


if __name__ == "__main__":
    main()

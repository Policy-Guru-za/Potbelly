#!/usr/bin/env python3
"""Fail when generated HTML references a missing same-origin artifact."""

from __future__ import annotations

import argparse
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)")


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: list[str] = []
        self.canonicals: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        key = "href" if tag in {"a", "link"} else "src" if tag == "script" else None
        if not key:
            return
        value = attributes.get(key)
        if value:
            self.values.append(value)
        if tag == "link" and "canonical" in attributes.get("rel", "").split() and value:
            self.canonicals.append(value)


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


def validate(root: Path, site_url: str | None = None) -> tuple[int, list[str]]:
    failures = []
    checked = 0
    for page in sorted(root.rglob("*.html")):
        links = Links()
        links.feed(page.read_text(encoding="utf-8"))
        if site_url and page == root / "index.html":
            expected = site_url.rstrip("/") + "/"
            if links.canonicals != [expected]:
                failures.append(
                    f"{page}: canonical {links.canonicals!r} does not equal {expected!r}"
                )
        for value in links.values:
            target = target_for(root, value)
            if target is None:
                continue
            checked += 1
            if not target.is_file():
                failures.append(f"{page}: {value} -> {target}")
    for stylesheet in sorted(root.rglob("*.css")):
        for _quote, value in CSS_URL.findall(stylesheet.read_text(encoding="utf-8")):
            target = target_for(root, value)
            if target is None:
                continue
            checked += 1
            if not target.is_file():
                failures.append(f"{stylesheet}: {value} -> {target}")
    return checked, failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--site-url")
    args = parser.parse_args()
    checked, failures = validate(args.root, args.site_url)
    if failures:
        raise SystemExit("release artifact validation failed:\n" + "\n".join(failures))
    print(f"checked {checked} internal asset and route links")


if __name__ == "__main__":
    main()

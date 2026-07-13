#!/usr/bin/env python3
"""Build a complete Potbelly static release from a validated recipe corpus."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

from potbelly.model import RecipeValidationError, load_corpus
from potbelly.pdf import render_pdfs
from potbelly.site import (
    index_page,
    information_page,
    not_found_page,
    recipe_page,
    search_record,
    site_url,
    sitemap,
)

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONTS = ROOT / "fonts"
WEB_ASSETS = ROOT / ".web-assets" / "assets"
STATIC = ROOT / "static"


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def validate_inputs() -> None:
    required_fonts = (
        "Lora-400.ttf", "Lora-500.ttf", "Lora-600.ttf", "Lora-Italic.ttf",
        "Poppins-400.ttf", "Poppins-500.ttf", "Poppins-600.ttf",
    )
    missing = [str(FONTS / name) for name in required_fonts if not (FONTS / name).is_file()]
    if missing:
        raise FileNotFoundError("missing build assets: " + ", ".join(missing))


def generate(recipes: list[dict], destination: Path, canonical_site: str) -> dict:
    validate_inputs()
    (destination / "recipe").mkdir(parents=True)
    (destination / "pdfs").mkdir()
    shutil.copytree(FONTS, destination / "fonts")
    runtime_assets = WEB_ASSETS if WEB_ASSETS.is_dir() else ASSETS
    (destination / "assets").mkdir()
    for source in runtime_assets.iterdir():
        if source.is_file():
            shutil.copy2(source, destination / "assets" / source.name)
    if not (destination / "assets" / "info.js").is_file():
        shutil.copy2(ASSETS / "recipe.js", destination / "assets" / "info.js")
    chunks = runtime_assets / "chunks"
    if chunks.is_dir():
        shutil.copytree(chunks, destination / "assets" / "chunks")
    if STATIC.is_dir():
        shutil.copytree(STATIC, destination, dirs_exist_ok=True)

    write_text(destination / "index.html", index_page(recipes, canonical_site))
    write_text(destination / "404.html", not_found_page(canonical_site))
    for page in ("install", "privacy", "support"):
        write_text(destination / f"{page}.html", information_page(page, canonical_site))
    write_text(destination / "offline.html", not_found_page(canonical_site).replace(
        "Recipe not found", "Potbelly is offline"
    ).replace(
        "That one isn't in the pot.", "The cookbook is ready offline."
    ).replace(
        "The recipe may have moved, or the address may be incomplete.",
        "Return to the cookbook to open any saved recipe. The AI assistant needs an internet connection.",
    ))
    write_text(
        destination / "search-index.json",
        json.dumps([search_record(recipe) for recipe in sorted(
            recipes, key=lambda item: item["slug"]
        )], ensure_ascii=False, separators=(",", ":")) + "\n",
    )
    write_text(destination / "sitemap.xml", sitemap(recipes, canonical_site))
    write_text(
        destination / "robots.txt",
        f"User-agent: *\nAllow: /\nSitemap: {canonical_site}/sitemap.xml\n",
    )
    for recipe in recipes:
        write_text(
            destination / "recipe" / f'{recipe["slug"]}.html',
            recipe_page(recipe, canonical_site),
        )
    render_pdfs(recipes, destination / "pdfs", FONTS)

    report = {
        "schema_version": 1,
        "recipes": len(recipes),
        "recipe_pages": len(list((destination / "recipe").glob("*.html"))),
        "pdfs": len(list((destination / "pdfs").glob("*.pdf"))),
        "legacy_recipes": sum(recipe["quality_tier"] == "legacy" for recipe in recipes),
        "site_url": canonical_site,
    }
    if len({report["recipes"], report["recipe_pages"], report["pdfs"]}) != 1:
        raise RuntimeError(f"generated output count mismatch: {report}")
    write_text(destination / "build-report.json", json.dumps(report, indent=2) + "\n")
    return report


def atomic_build(input_path: Path, output_path: Path, canonical_site: str) -> dict:
    recipes = load_corpus(input_path, legacy=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output_path.name}-", dir=output_path.parent))
    backup = output_path.with_name(f".{output_path.name}.previous")
    try:
        report = generate(recipes, temporary, canonical_site)
        if backup.exists():
            shutil.rmtree(backup)
        if output_path.exists():
            output_path.replace(backup)
        temporary.replace(output_path)
        if backup.exists():
            shutil.rmtree(backup)
        return report
    except Exception:
        if not output_path.exists() and backup.exists():
            backup.replace(output_path)
        raise
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data.json")
    parser.add_argument("--output", default="public")
    parser.add_argument("--site-url", default=os.environ.get("SITE_URL"))
    args = parser.parse_args()
    if not args.site_url:
        parser.error("--site-url or SITE_URL is required")
    try:
        report = atomic_build(
            (ROOT / args.input).resolve(),
            (ROOT / args.output).resolve(),
            site_url(args.site_url),
        )
    except (RecipeValidationError, OSError, RuntimeError, ValueError) as exc:
        raise SystemExit(f"BUILD_FAILED: {exc}") from exc
    print(json.dumps({"event": "build_complete", **report}, sort_keys=True))


if __name__ == "__main__":
    main()

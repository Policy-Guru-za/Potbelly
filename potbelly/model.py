"""Recipe normalization, identity, and fail-closed validation."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, unquote, urlsplit, urlunsplit

SCHEMA_VERSION = 1
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
HOST_RE = re.compile(r"[^a-z0-9]+")

LEGACY_KEYWORDS = {
    "instant-pot-pulled-pork": "bbq barbecue shoulder butt sandwich shredded smoky",
    "instant-pot-boneless-pork-chops": "quick weeknight fast juicy",
    "instant-pot-ribs": "bbq barbecue baby back spare sticky",
    "instant-pot-mac-and-cheese": "pasta cheddar creamy comfort kids quick weeknight",
    "instant-pot-pot-roast": "sunday chuck gravy comfort family dinner",
    "instant-pot-beef-stew": "comfort winter gravy hearty stew",
    "instant-pot-butter-chicken": "indian curry murgh makhani creamy weeknight quick",
    "instant-pot-chicken-biryani": "indian rice spiced saffron dinner",
    "instant-pot-chicken-breast": "quick weeknight healthy juicy meal prep",
    "instant-pot-whole-chicken": "roast rotisserie sunday family dinner",
    "instant-pot-chili": "beef beans comfort game day hearty dinner",
    "instant-pot-rice": "white basmati jasmine side fluffy easy",
    "instant-pot-mashed-potatoes": "side creamy buttery thanksgiving comfort",
    "instant-pot-steel-cut-oats": "oatmeal porridge breakfast morning healthy",
    "instant-pot-cheesecake": "sweet dessert vanilla baking cake",
    "instant-pot-new-york-cheesecake": "sweet dessert baking cake new york",
    "instant-pot-vegetable-soup": "vegetarian healthy vegetable light quick soup",
    "instant-pot-lamb-shanks": "braised red wine gravy dinner party special",
}


class RecipeValidationError(ValueError):
    """Raised when a corpus record violates the public recipe contract."""


def canonical_source_url(value: str) -> str:
    """Return a stable HTTPS URL suitable for identity and attribution."""
    if not isinstance(value, str) or not value.strip():
        raise RecipeValidationError("source_url must be a non-empty string")
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise RecipeValidationError("source_url must be an absolute HTTPS URL")
    if parsed.username or parsed.password:
        raise RecipeValidationError("source_url must not contain credentials")
    host = parsed.hostname.lower()
    if parsed.port and parsed.port != 443:
        host = f"{host}:{parsed.port}"
    path = quote(unquote(parsed.path or "/"), safe="/%:@-._~!$&'()*+,;=")
    if path != "/":
        path = path.rstrip("/") + "/"
    return urlunsplit(("https", host, path, parsed.query, ""))


def source_id(source_url: str) -> str:
    canonical = canonical_source_url(source_url)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def host_label(source_url: str) -> str:
    host = urlsplit(canonical_source_url(source_url)).hostname or "source"
    labels = host.removeprefix("www.").split(".")
    label = labels[-2] if len(labels) > 1 else labels[0]
    return HOST_RE.sub("-", label.lower()).strip("-") or "source"


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    if not value or not SLUG_RE.fullmatch(value):
        raise RecipeValidationError(f"cannot create a valid slug from {value!r}")
    return value


def _keywords(value: Any, slug: str) -> list[str]:
    if isinstance(value, str):
        parts = re.split(r"[,\s]+", value)
    elif isinstance(value, list) and all(isinstance(item, str) for item in value):
        parts = value
    elif value in (None, ""):
        parts = LEGACY_KEYWORDS.get(slug, "").split()
    else:
        raise RecipeValidationError("keywords must be a string or list of strings")
    cleaned = []
    for item in parts:
        word = re.sub(r"\s+", " ", item.strip().lower())
        if word and word not in cleaned:
            cleaned.append(word)
    return cleaned


def normalize_recipe(raw: dict[str, Any], *, legacy: bool = False) -> dict[str, Any]:
    """Normalize a record without silently repairing unsafe structural data."""
    if not isinstance(raw, dict):
        raise RecipeValidationError("recipe must be an object")
    record = dict(raw)
    url = canonical_source_url(record.get("source_url", ""))
    record["source_url"] = url
    record["source_id"] = source_id(url)
    record["schema_version"] = SCHEMA_VERSION
    supplied_slug = record.get("slug")
    if not isinstance(supplied_slug, str) or not SLUG_RE.fullmatch(supplied_slug):
        raise RecipeValidationError(f"invalid slug: {supplied_slug!r}")
    record["slug"] = supplied_slug
    record["keywords"] = _keywords(record.get("keywords"), record["slug"])
    record["quality_tier"] = record.get("quality_tier") or (
        "legacy" if legacy and (
            float(record.get("rating", 0)) < 4.6
            or int(record.get("rating_count", 0)) < 30
        ) else "standard"
    )
    validate_recipe(record)
    return record


def _require_text(record: dict[str, Any], key: str, *, allow_empty: bool = False) -> None:
    value = record.get(key)
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        qualifier = "a string" if allow_empty else "a non-empty string"
        raise RecipeValidationError(f"{key} must be {qualifier}")


def _validate_groups(record: dict[str, Any], key: str, item_key: str) -> None:
    groups = record.get(key)
    if not isinstance(groups, list) or not groups:
        raise RecipeValidationError(f"{key} must be a non-empty list")
    total = 0
    for index, group in enumerate(groups):
        if not isinstance(group, dict):
            raise RecipeValidationError(f"{key}[{index}] must be an object")
        if not isinstance(group.get("name", ""), str):
            raise RecipeValidationError(f"{key}[{index}].name must be a string")
        items = group.get(item_key)
        if not isinstance(items, list) or not all(
            isinstance(item, str) and item.strip() for item in items
        ):
            raise RecipeValidationError(
                f"{key}[{index}].{item_key} must contain non-empty strings"
            )
        total += len(items)
    if not total:
        raise RecipeValidationError(f"{key} must contain at least one {item_key[:-1]}")


def validate_recipe(record: dict[str, Any]) -> None:
    required_text = (
        "title", "description", "category", "source_name", "source_url", "slug"
    )
    for key in required_text:
        _require_text(record, key)
    for key in ("course", "cuisine", "servings", "prep_time", "cook_time",
                "total_time", "nutrition"):
        _require_text(record, key, allow_empty=True)
    if record.get("schema_version") != SCHEMA_VERSION:
        raise RecipeValidationError(f"unsupported schema_version: {record.get('schema_version')}")
    if record.get("source_id") != source_id(record["source_url"]):
        raise RecipeValidationError("source_id does not match source_url")
    if not SLUG_RE.fullmatch(record["slug"]):
        raise RecipeValidationError(f"invalid slug: {record['slug']}")
    if not isinstance(record.get("rating"), (int, float)) or not 0 <= record["rating"] <= 5:
        raise RecipeValidationError("rating must be a number from 0 to 5")
    if not isinstance(record.get("rating_count"), int) or record["rating_count"] < 0:
        raise RecipeValidationError("rating_count must be a non-negative integer")
    if record.get("quality_tier") not in {"standard", "legacy"}:
        raise RecipeValidationError("quality_tier must be standard or legacy")
    if not isinstance(record.get("keywords"), list) or not all(
        isinstance(word, str) and word.strip() for word in record["keywords"]
    ):
        raise RecipeValidationError("keywords must contain non-empty strings")
    if not isinstance(record.get("notes"), list) or not all(
        isinstance(note, str) and note.strip() for note in record["notes"]
    ):
        raise RecipeValidationError("notes must contain non-empty strings")
    _validate_groups(record, "ingredient_groups", "items")
    _validate_groups(record, "step_groups", "steps")


def assert_unique(recipes: Iterable[dict[str, Any]]) -> None:
    recipes = list(recipes)
    for key in ("source_id", "source_url", "slug"):
        counts = Counter(recipe[key] for recipe in recipes)
        duplicates = sorted(value for value, count in counts.items() if count > 1)
        if duplicates:
            raise RecipeValidationError(f"duplicate {key}: {', '.join(duplicates)}")


def assign_unique_slugs(
    records: list[dict[str, Any]], existing: Iterable[dict[str, Any]] = ()
) -> list[dict[str, Any]]:
    """Assign deterministic routes while preserving existing public slugs."""
    existing = list(existing)
    used = {record["slug"] for record in existing}
    owned = {source_id(record["source_url"]): record["slug"] for record in existing}
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        base = slugify(str(record.get("slug") or record.get("title", "recipe")))
        groups[base].append(record)

    output = []
    for base in sorted(groups):
        group = sorted(groups[base], key=lambda item: canonical_source_url(item["source_url"]))
        collision = len(group) > 1 or base in used
        for raw in group:
            item = dict(raw)
            sid = source_id(item["source_url"])
            if sid in owned:
                candidate = owned[sid]
                item["slug"] = candidate
                output.append(item)
                continue
            elif collision:
                candidate = slugify(f"{base}-{host_label(item['source_url'])}")
            else:
                candidate = base
            suffix = 2
            original = candidate
            while candidate in used:
                candidate = f"{original}-{suffix}"
                suffix += 1
            item["slug"] = candidate
            used.add(candidate)
            output.append(item)
    return output


def load_corpus(path: str | Path, *, legacy: bool = False) -> list[dict[str, Any]]:
    source = Path(path)
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RecipeValidationError(f"cannot load corpus {source}: {exc}") from exc
    if not isinstance(raw, list):
        raise RecipeValidationError("corpus root must be a JSON list")
    recipes = [normalize_recipe(item, legacy=legacy) for item in raw]
    assert_unique(recipes)
    return recipes


def dump_corpus(recipes: Iterable[dict[str, Any]], path: str | Path) -> None:
    normalized = [normalize_recipe(record) for record in recipes]
    assert_unique(normalized)
    target = Path(path)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(normalized, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(target)

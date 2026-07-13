#!/usr/bin/env python3
"""
extract_recipe.py — pull schema.org Recipe structured data from a recipe URL.

Usage:
    python3 extract_recipe.py <url> <output.json>

Outputs a normalized recipe.json skeleton. The instructions in the output are
RAW SCRAPED TEXT: Claude must rewrite them concisely in its own words before
building the PDF. Ingredient lines are factual data and can be kept as-is
(lightly tidied).
"""
import json
import re
import sys
import ssl
import urllib.request
import certifi

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.load_verify_locations(cafile=certifi.where())


UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
        return r.read().decode("utf-8", errors="replace")


def find_recipe_jsonld(html: str):
    """Return the first schema.org Recipe object found in JSON-LD blocks."""
    blocks = re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE)
    candidates = []
    for raw in blocks:
        raw = raw.strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Some sites embed invalid control chars
            try:
                data = json.loads(re.sub(r"[\x00-\x1f]", " ", raw))
            except json.JSONDecodeError:
                continue
        candidates.extend(walk(data))
    for obj in candidates:
        t = obj.get("@type", "")
        types = t if isinstance(t, list) else [t]
        if any(str(x).lower() == "recipe" for x in types):
            return obj
    return None


def walk(node):
    """Yield every dict inside a JSON-LD structure (handles @graph, lists)."""
    out = []
    if isinstance(node, dict):
        out.append(node)
        for v in node.values():
            out.extend(walk(v))
    elif isinstance(node, list):
        for item in node:
            out.extend(walk(item))
    return out


def iso_duration(v) -> str:
    """PT1H30M -> '1 hr 30 min'. Pass through anything non-ISO."""
    if not v or not isinstance(v, str):
        return ""
    m = re.match(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", v)
    if not m:
        return v
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    mi += s // 60
    parts = []
    if d:
        parts.append(f"{d} day" + ("s" if d > 1 else ""))
    if h:
        parts.append(f"{h} hr")
    if mi:
        parts.append(f"{mi} min")
    return " ".join(parts) or v


def strip_html(text: str) -> str:
    import html as _html
    text = _html.unescape(_html.unescape(str(text)))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_instructions(node, steps=None, groups=None, current=None):
    """Flatten recipeInstructions (strings, HowToStep, HowToSection)."""
    if groups is None:
        groups = []
        current = {"name": "", "steps": []}
        groups.append(current)
    if isinstance(node, list):
        for item in node:
            current = extract_instructions(item, None, groups, current)
        return groups
    if isinstance(node, str):
        current["steps"].append(strip_html(node))
        return current
    if isinstance(node, dict):
        t = str(node.get("@type", "")).lower()
        if t == "howtosection":
            current = {"name": strip_html(node.get("name", "")), "steps": []}
            groups.append(current)
            extract_instructions(node.get("itemListElement", []), None,
                                 groups, current)
            return current
        text = node.get("text") or node.get("name") or ""
        if text:
            current["steps"].append(strip_html(text))
        return current
    return current


def normalize(recipe: dict, url: str) -> dict:
    def first(v):
        return v[0] if isinstance(v, list) and v else v

    author = recipe.get("author", "")
    if isinstance(author, list):
        author = author[0] if author else ""
    if isinstance(author, dict):
        author = author.get("name", "")

    servings = first(recipe.get("recipeYield", "")) or ""

    ingredients = [strip_html(i) for i in recipe.get("recipeIngredient", [])]

    groups = extract_instructions(recipe.get("recipeInstructions", []))
    step_groups = [g for g in (groups or []) if g["steps"]]

    kw = recipe.get("keywords", "")
    if isinstance(kw, list):
        kw = ", ".join(kw)

    nutrition = recipe.get("nutrition") or {}
    nut_line = ""
    if isinstance(nutrition, dict):
        pairs = [("calories", "Calories"), ("carbohydrateContent", "Carbs"),
                 ("proteinContent", "Protein"), ("fatContent", "Fat"),
                 ("sodiumContent", "Sodium"), ("fiberContent", "Fiber"),
                 ("sugarContent", "Sugar")]
        bits = [f"{label}: {nutrition[k]}" for k, label in pairs
                if nutrition.get(k)]
        nut_line = " · ".join(bits)

    return {
        "title": strip_html(recipe.get("name", "Recipe")),
        "description_RAW": strip_html(recipe.get("description", "")),
        "source_name": strip_html(author) if author else "",
        "source_url": url,
        "course": strip_html(first(recipe.get("recipeCategory", "")) or ""),
        "cuisine": strip_html(first(recipe.get("recipeCuisine", "")) or ""),
        "servings": str(servings),
        "prep_time": iso_duration(recipe.get("prepTime", "")),
        "cook_time": iso_duration(recipe.get("cookTime", "")),
        "total_time": iso_duration(recipe.get("totalTime", "")),
        "ingredient_groups": [{"name": "", "items": ingredients}],
        "step_groups_RAW": step_groups,
        "notes_RAW": [],
        "nutrition": nut_line,
        "keywords": strip_html(kw),
    }


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: extract_recipe.py <url> <output.json>")
    url, out_path = sys.argv[1], sys.argv[2]
    html = fetch(url)
    recipe = find_recipe_jsonld(html)
    if not recipe:
        sys.exit("NO_STRUCTURED_DATA: no schema.org Recipe JSON-LD found. "
                 "Fall back to reading the page content directly.")
    data = normalize(recipe, url)
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out_path}")
    print(f"Title: {data['title']}")
    print(f"Ingredients: {len(data['ingredient_groups'][0]['items'])}, "
          f"step groups: {len(data['step_groups_RAW'])}")
    print("REMINDER: fields ending in _RAW are scraped text. Rewrite "
          "descriptions/steps/notes concisely in your own words, rename the "
          "keys (drop _RAW), then run build_pdf.py.")


if __name__ == "__main__":
    main()

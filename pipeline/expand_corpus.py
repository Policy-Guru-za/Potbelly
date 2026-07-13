#!/usr/bin/env python3
"""
Potbelly corpus expander: crawl -> extract -> select -> rewrite -> validate.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...        # never hardcode the key
    pip install anthropic
    python3 expand_corpus.py --target 150      # full run
    python3 expand_corpus.py --dry-run         # everything except API calls
    python3 expand_corpus.py --limit 5         # small test run

Outputs (in ./out):
    candidates.json   all extracted raw recipes with ratings
    selected.json     the quality-gated shortlist
    rewritten/        one cleaned JSON per recipe (resumable cache)
    data.json         merged, ready to drop into the deploy folder
    report.txt        what passed, failed, and why
"""
import argparse
import concurrent.futures as cf
from collections import Counter
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_recipe import fetch, find_recipe_jsonld, normalize, _SSL_CTX, UA  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from potbelly.model import (  # noqa: E402
    RecipeValidationError,
    assign_unique_slugs,
    canonical_source_url,
    dump_corpus,
    load_corpus,
    normalize_recipe,
    source_id,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

SITES = [
    "https://www.pressurecookrecipes.com",
    "https://www.thereciperebel.com",
    "https://littlesunnykitchen.com",
    "https://pipingpotcurry.com",
    "https://recipeteacher.com",
    "https://tastesbetterfromscratch.com",
    "https://www.wellplated.com",
    "https://www.lecremedelacrumb.com",
    "https://kristineskitchenblog.com",
    "https://amindfullmom.com",
    "https://twosleevers.com",
    "https://damndelicious.net",
    "https://www.skinnytaste.com",
    "https://www.cookingclassy.com",
    "https://thesaltymarshmallow.com",
]
URL_FILTER = re.compile(r"instant-pot|pressure-cooker", re.I)
PER_SITE_CAP = 20
CATEGORY_CAP = 24
MIN_RATING, MIN_COUNT = 4.6, 30

CATEGORY_RULES = [
    ("Dessert", r"cheesecake|cake|brownie|pudding|dessert|dulce|custard|cobbler"),
    ("Breakfast", r"oat|egg bites|yogurt|breakfast|frittata"),
    ("Soups & Stews", r"soup|stew|chili|chowder|broth"),
    ("Pasta & Grains", r"pasta|mac and cheese|spaghetti|risotto|noodle|quinoa|lasagna"),
    ("Seafood", r"shrimp|salmon|fish|seafood|mussels"),
    ("Chicken", r"chicken|turkey"),
    ("Beef", r"beef|pot roast|brisket|short rib|stroganoff|barbacoa"),
    ("Pork", r"pork|ribs|carnitas|ham|sausage"),
    ("Lamb", r"lamb"),
    ("Sides", r"potato|rice|corn|beans|carrot|vegetable|beet|squash|applesauce"),
]

STOPWORDS = {"instant", "pot", "easy", "best", "damn", "the", "perfect",
             "simple", "quick", "recipe", "homemade", "creamy"}

REWRITE_SYSTEM = """You are the editor for Potbelly, a typeset Instant Pot \
cookbook. You receive one recipe as JSON scraped from a food blog. Produce a \
cleaned version following these non-negotiable rules:

1. Rewrite every instruction step concisely IN YOUR OWN WORDS. Never copy the \
source phrasing. Keep every functional detail: quantities, temperatures, \
times, pressure settings, release method, pan sizes, visual doneness cues, \
safety notes. Drop marketing, brand plugs, cross-links, and chattiness. \
Merge trivially small steps; split overloaded ones.
2. Never alter a quantity, temperature, or time. They are sacred.
3. description: one or two plain sentences saying what the dish is. No hype.
4. notes: 0-3 genuinely useful notes (storage, substitutions, technique), \
one short sentence each, your own words.
5. Tidy ingredient lines (unicode fractions like ½, "tsp"/"tbsp" style, fix \
encoding artifacts) but never change amounts. Split into named \
ingredient_groups only if the source clearly groups them.
6. keywords: 5-8 lowercase search words a home cook might type (dish type, \
cuisine, occasion, main ingredients). No "instant pot".

Return ONLY a JSON object, no markdown fences, with exactly these keys:
title, description, course, cuisine, servings, prep_time, cook_time, \
total_time, ingredient_groups (list of {name, items}), step_groups (list of \
{name, steps}), notes (list), nutrition (string, keep as given), keywords \
(list)."""

FRAC = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3",
        "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅙": "1/6"}


# ------------------------------------------------------------------ crawl
def with_retry(operation, url, attempts=4):
    """Retry transient network failures with bounded exponential backoff."""
    for attempt in range(attempts):
        try:
            return operation()
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            status = getattr(exc, "code", None)
            if status and status not in {408, 429, 500, 502, 503, 504}:
                raise
            if attempt == attempts - 1:
                raise
            delay = min(8, 2 ** attempt)
            print(json.dumps({"level": "warning", "event": "network_retry",
                              "url": url, "attempt": attempt + 1,
                              "delay_seconds": delay,
                              "error": f"{type(exc).__name__}: {exc}"}))
            time.sleep(delay)


def fetch_text(url):
    def operation():
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as response:
            return response.read().decode("utf-8", errors="replace")
    return with_retry(operation, url)


def site_urls(site):
    """Pull candidate recipe URLs from a site's sitemap(s)."""
    urls = set()
    try:
        xml = fetch_text(f"{site}/sitemap.xml")
    except Exception as e1:
        try:
            xml = fetch_text(f"{site}/sitemap_index.xml")
        except Exception as e2:
            print(f"  !! {site}: {type(e1).__name__}: {e1}")
            return urls
    locs = re.findall(r"<loc>(.*?)</loc>", xml)
    children = [u for u in locs if u.endswith(".xml")]
    pages = [u for u in locs if not u.endswith(".xml")]
    for child in children:
        if not re.search(r"post|sitemap-\d|pt-post", child, re.I):
            continue
        try:
            cxml = fetch_text(child)
            pages += re.findall(r"<loc>(.*?)</loc>", cxml)
        except Exception as exc:
            print(json.dumps({"level": "warning", "event": "sitemap_child_failed",
                              "url": child,
                              "error": f"{type(exc).__name__}: {exc}"}))
            continue
    for u in pages:
        if URL_FILTER.search(u):
            urls.add(u.strip())
    return urls


def crawl(limit_per_site=None):
    all_urls = {}
    for site in SITES:
        found = sorted(site_urls(site))
        if limit_per_site:
            found = found[:limit_per_site]
        all_urls[site] = found
        print(f"  {site}: {len(found)} candidate URLs")
    return all_urls


# ------------------------------------------------------------------ extract
def extract_one(url):
    try:
        html = with_retry(lambda: fetch(url), url)
        recipe = find_recipe_jsonld(html)
        if not recipe:
            return None
        data = normalize(recipe, url)
        agg = recipe.get("aggregateRating") or {}
        try:
            data["rating"] = round(float(agg.get("ratingValue", 0)), 2)
            data["rating_count"] = int(float(agg.get("ratingCount")
                                        or agg.get("reviewCount") or 0))
        except (TypeError, ValueError):
            data["rating"], data["rating_count"] = 0, 0
        data["source_url"] = canonical_source_url(url)
        data["source_id"] = source_id(url)
        data["slug"] = url.rstrip("/").split("/")[-1]
        return data
    except Exception as exc:
        print(json.dumps({"level": "warning", "event": "extract_failed",
                          "url": url, "error": f"{type(exc).__name__}: {exc}"}))
        return None


def extract_all(url_map):
    urls = [u for lst in url_map.values() for u in lst]
    results = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for i, r in enumerate(ex.map(extract_one, urls)):
            if r:
                results.append(r)
            if (i + 1) % 50 == 0:
                print(f"  extracted {i+1}/{len(urls)} ({len(results)} recipes)")
    return results


# ------------------------------------------------------------------ select
def dish_key(title):
    toks = [t for t in re.findall(r"[a-z]+", title.lower()) if t not in STOPWORDS]
    return " ".join(sorted(set(toks)))


def categorize(title):
    for cat, pat in CATEGORY_RULES:
        if re.search(pat, title, re.I):
            return cat
    return "Mains"


def select(candidates, existing, target):
    import math
    existing_sources = {source_id(r["source_url"]) for r in existing}
    pool = [c for c in candidates
            if c["rating"] >= MIN_RATING and c["rating_count"] >= MIN_COUNT
            if source_id(c["source_url"]) not in existing_sources
            and c["step_groups_RAW"] and c["ingredient_groups"][0]["items"]]
    for c in pool:
        c["pop"] = c["rating"] * math.log10(c["rating_count"] + 1)
        c["category"] = categorize(c["title"])
        c["_site"] = c["source_url"].split("/")[2]
        c["_dish"] = dish_key(c["title"])
    pool.sort(key=lambda c: -c["pop"])
    picked = []
    seen_dish = {dish_key(r["title"]) for r in existing}
    site_n, cat_n = {}, {}
    seen_source = set(existing_sources)
    for c in pool:
        sid = source_id(c["source_url"])
        if c["_dish"] in seen_dish or sid in seen_source:
            continue
        if site_n.get(c["_site"], 0) >= PER_SITE_CAP:
            continue
        if cat_n.get(c["category"], 0) >= CATEGORY_CAP:
            continue
        picked.append(c)
        seen_dish.add(c["_dish"])
        seen_source.add(sid)
        site_n[c["_site"]] = site_n.get(c["_site"], 0) + 1
        cat_n[c["category"]] = cat_n.get(c["category"], 0) + 1
        if len(picked) >= target:
            break
    # Backfill thin categories (e.g. Dessert) with a relaxed count floor
    thin = {cat for cat, _ in CATEGORY_RULES
            if sum(1 for p in picked if p["category"] == cat) < 5}
    if thin and len(picked) < target:
        pool2 = [c for c in candidates
                 if c["rating"] >= MIN_RATING and 10 <= c["rating_count"] < MIN_COUNT
                 and source_id(c["source_url"]) not in existing_sources
                 and c["step_groups_RAW"] and c["ingredient_groups"][0]["items"]]
        for c in pool2:
            c["pop"] = math.log10(c["rating_count"] + 1) * c["rating"]
            c["category"] = categorize(c["title"])
            c["_site"] = c["source_url"].split("/")[2]
            c["_dish"] = dish_key(c["title"])
        pool2.sort(key=lambda c: -c["pop"])
        for c in pool2:
            sid = source_id(c["source_url"])
            if (c["category"] not in thin or c["_dish"] in seen_dish
                    or sid in seen_source):
                continue
            if sum(1 for p in picked if p["category"] == c["category"]) >= 8:
                continue
            picked.append(c)
            seen_dish.add(c["_dish"])
            seen_source.add(sid)
            if len(picked) >= target:
                break
    return picked


# ------------------------------------------------------------------ rewrite
def numbers_in(text):
    t = text
    for u, a in FRAC.items():
        t = t.replace(u, f" {a} ")
    return Counter(re.findall(r"\d+(?:\.\d+)?(?:/\d+)?", t))


def shingles(text, n=8):
    words = re.findall(r"[a-z']+", text.lower())
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


CONNECTIVES = {"and", "or", "the", "a", "an", "then", "add", "stir", "in",
               "to", "of", "with", "pour", "mix", "salt", "pepper", "taste",
               "combine", "until", "into", "remaining", "if", "using", "cup",
               "cups", "tsp", "tbsp", "teaspoon", "tablespoon", "oz", "lb"}


def factual_tokens(raw):
    toks = set(CONNECTIVES)
    for g in raw.get("ingredient_groups", []):
        for line in g.get("items", []):
            toks.update(re.findall(r"[a-z']+", line.lower()))
    return toks


def validate(raw, clean):
    problems = []
    expected = {
        "title", "description", "course", "cuisine", "servings",
        "prep_time", "cook_time", "total_time", "ingredient_groups",
        "step_groups", "notes", "nutrition", "keywords",
    }
    missing_keys = sorted(expected - set(clean))
    extra_keys = sorted(set(clean) - expected)
    if missing_keys:
        problems.append(f"missing keys: {missing_keys}")
    if extra_keys:
        problems.append(f"unexpected keys: {extra_keys}")
    for key in ("title", "description", "ingredient_groups", "step_groups"):
        if not clean.get(key):
            problems.append(f"missing {key}")
    if not isinstance(clean.get("notes"), list):
        problems.append("notes must be a list")
    if not isinstance(clean.get("keywords"), list):
        problems.append("keywords must be a list")
    src_steps = " ".join(s for g in raw["step_groups_RAW"] for s in g["steps"])
    new_steps = " ".join(s for g in clean.get("step_groups", [])
                         for s in g.get("steps", []))
    new_all = new_steps + " " + " ".join(clean.get("notes", []))
    missing = numbers_in(src_steps) - numbers_in(new_all)
    if missing:
        problems.append(f"lost numbers: {sorted(missing.elements())[:12]}")
    facts = factual_tokens(raw)
    overlap = {s for s in (shingles(src_steps) & shingles(new_steps))
               if not all(w in facts for w in s.split())}
    if overlap:
        problems.append(f"verbatim overlap: '{sorted(overlap)[0]}'")
    return problems


def rewrite_one(client, model, raw):
    payload = {k: raw[k] for k in
               ("title", "description_RAW", "course", "cuisine", "servings",
                "prep_time", "cook_time", "total_time", "ingredient_groups",
                "step_groups_RAW", "nutrition")}
    feedback = ""
    for attempt in range(4):
        msg = client.messages.create(
            model=model, max_tokens=3000,
            system=REWRITE_SYSTEM,
            messages=[{"role": "user",
                       "content": json.dumps(payload, ensure_ascii=False)
                       + feedback}])
        text = msg.content[0].text.strip()
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
        try:
            clean = json.loads(text)
        except json.JSONDecodeError:
            feedback = "\n\nYour last reply was not valid JSON. Return only JSON."
            continue
        problems = validate(raw, clean)
        if not problems:
            clean.update({"slug": raw["slug"], "category": raw["category"],
                          "rating": raw["rating"],
                          "rating_count": raw["rating_count"],
                          "source_name": raw["source_name"] or
                          raw["source_url"].split("/")[2],
                          "source_url": raw["source_url"]})
            try:
                return normalize_recipe(clean), None
            except RecipeValidationError as exc:
                problems = [f"schema validation: {exc}"]
        feedback = ("\n\nYour previous attempt failed validation: "
                    + "; ".join(problems)
                    + ". For any flagged overlap, rewrite that step with "
                    "completely different sentence structure and verbs. "
                    "For lost numbers, ensure every quantity, time and "
                    "temperature from the source appears in your steps or "
                    "notes. Return the full corrected JSON.")
        time.sleep(1)
    return None, problems


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=150)
    ap.add_argument("--limit", type=int, help="cap selected recipes (testing)")
    ap.add_argument("--dry-run", action="store_true",
                    help="crawl/extract/select only, no API calls")
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--existing", default="../data.json",
                    help="current data.json to extend")
    ap.add_argument("--reserve", type=int, default=50,
                    help="extra candidates available to backfill rewrite failures")
    args = ap.parse_args()

    os.makedirs(f"{OUT}/rewritten", exist_ok=True)

    # Stage 1+2: crawl and extract (cached)
    cand_path = f"{OUT}/candidates.json"
    if os.path.exists(cand_path):
        candidates = json.load(open(cand_path))
        print(f"Loaded {len(candidates)} cached candidates")
    else:
        print("Crawling sitemaps…")
        url_map = crawl()
        print("Extracting structured data…")
        candidates = extract_all(url_map)
        json.dump(candidates, open(cand_path, "w"), ensure_ascii=False)
        print(f"Extracted {len(candidates)} recipes with structured data")

    # Stage 3: select
    existing_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 args.existing)
    existing = load_corpus(existing_path, legacy=True) if os.path.exists(existing_path) else []
    need = args.target - len(existing)
    shortlist_size = max(need, 0) + (args.reserve if need > 0 else 0)
    selected = select(candidates, existing, shortlist_size)
    selected = assign_unique_slugs(selected, existing)
    if args.limit:
        selected = selected[:args.limit]
    json.dump(selected, open(f"{OUT}/selected.json", "w"), ensure_ascii=False)
    cats = {}
    for c in selected:
        cats[c["category"]] = cats.get(c["category"], 0) + 1
    print(f"Selected {len(selected)} new recipes "
          f"(have {len(existing)}, target {args.target}): {cats}")

    if args.dry_run:
        print("Dry run: stopping before rewrites. Review out/selected.json.")
        return

    # Stage 4: rewrite with validation (resumable)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is not set. Export it and re-run.")
    from anthropic import Anthropic
    client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment

    done, failed, attempted = [], [], []
    for i, raw in enumerate(selected):
        if len(done) >= max(need, 0):
            break
        sid = source_id(raw["source_url"])
        cache = f"{OUT}/rewritten/{sid}.json"
        attempted.append(raw)
        if os.path.exists(cache):
            cached = normalize_recipe(json.load(open(cache)))
            if cached["source_id"] != sid:
                raise RecipeValidationError(f"cache identity mismatch: {cache}")
            done.append(cached)
            continue
        clean, problems = rewrite_one(client, args.model, raw)
        if clean:
            json.dump(clean, open(cache, "w"), ensure_ascii=False, indent=1)
            done.append(clean)
            print(f"  [{i+1}/{len(selected)}] ok  {raw['slug']}")
        else:
            failed.append((raw["slug"], problems))
            print(f"  [{i+1}/{len(selected)}] FAIL {raw['slug']}: {problems}")

    # Stage 5: merge
    merged = existing + done
    dump_corpus(merged, f"{OUT}/data.json")
    json.dump(attempted, open(f"{OUT}/attempted.json", "w"), ensure_ascii=False)
    with open(f"{OUT}/report.txt", "w") as f:
        f.write(f"existing {len(existing)}  new {len(done)}  "
                f"failed {len(failed)}  unique {len(merged)}  target {args.target}\n")
        for slug, why in failed:
            f.write(f"FAIL {slug}: {why}\n")
    if len(merged) != args.target:
        print(f"\nTARGET NOT MET: produced {len(merged)} of {args.target}")
    print(f"Done: {len(merged)} total recipes -> out/data.json")
    print(f"Failed: {len(failed)} (see out/report.txt). "
          "Validate and review the candidate corpus before promotion.")


if __name__ == "__main__":
    main()

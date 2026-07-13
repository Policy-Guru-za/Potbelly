#!/usr/bin/env python3
"""Harvest schema.org Recipe data + ratings from candidate URLs."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from extract_recipe import fetch, find_recipe_jsonld, normalize, strip_html

CANDIDATES = [
    "https://www.thereciperebel.com/instant-pot-vegetable-soup/",
    "https://littlesunnykitchen.com/instant-pot-lamb-shanks/",
    "https://damndelicious.net/2019/01/02/instant-pot-chicken-noodle-soup/",
    "https://damndelicious.net/2018/04/14/instant-pot-korean-beef/",
    "https://damndelicious.net/2019/03/01/instant-pot-pot-roast/",
    "https://recipeteacher.com/best-damn-instant-pot-pulled-pork/",
    "https://recipeteacher.com/best-damn-instant-pot-boneless-pork-chops/",
    "https://tastesbetterfromscratch.com/instant-pot-ribs/",
    "https://www.wellplated.com/instant-pot-mac-and-cheese/",
    "https://www.wellplated.com/instant-pot-chicken-breast/",
    "https://www.lecremedelacrumb.com/instant-pot-pot-roast-potatoes/",
    "https://twosleevers.com/instant-pot-butter-chicken/",
    "https://pipingpotcurry.com/chicken-biryani-instant-pot/",
    "https://ministryofcurry.com/instant-pot-chicken-tikka-masala/",
    "https://www.thereciperebel.com/instant-pot-chicken-breast/",
    "https://littlesunnykitchen.com/instant-pot-whole-chicken/",
    "https://amindfullmom.com/instant-pot-white-rice/",
    "https://amindfullmom.com/instant-pot-steel-cut-oats/",
    "https://www.thereciperebel.com/instant-pot-chili/",
    "https://www.cookingclassy.com/instant-pot-chicken-tortilla-soup/",
    "https://www.skinnytaste.com/instant-pot-chicken-taco-soup/",
    "https://thesaltymarshmallow.com/best-instant-pot-chicken-breast/",
    "https://www.number-2-pencil.com/instant-pot-white-chicken-chili/",
    "https://www.gimmesomeoven.com/instant-pot-baked-potatoes/",
    "https://sweetandsavorymeals.com/instant-pot-cheesecake-recipe/",
    "https://www.berlyskitchen.com/instant-pot-new-york-cheesecake/",
    "https://kristineskitchenblog.com/instant-pot-rice/",
    "https://kristineskitchenblog.com/instant-pot-chili/",
    "https://www.platedcravings.com/instant-pot-risotto/",
    "https://www.lemonblossoms.com/blog/instant-pot-pork-carnitas/",
    "https://cafedelites.com/instant-pot-beef-stroganoff/",
    "https://www.pressurecookrecipes.com/instant-pot-beef-stew/",
    "https://www.pressurecookrecipes.com/instant-pot-mashed-potatoes/",
    "https://www.simplyhappyfoodie.com/instant-pot-chicken-wild-rice-soup/",
    "https://lifemadesweeter.com/instant-pot-chocolate-lava-cake/",
    "https://www.eatingonadime.com/instant-pot-spaghetti-recipe/",
]

RAW = os.path.join(HERE, "out", "raw")
os.makedirs(RAW, exist_ok=True)
ok, fail = [], []
for url in CANDIDATES:
    try:
        html = fetch(url)
        recipe = find_recipe_jsonld(html)
        if not recipe:
            fail.append((url, "no JSON-LD"))
            continue
        data = normalize(recipe, url)
        agg = recipe.get("aggregateRating") or {}
        if isinstance(agg, dict):
            try:
                data["rating"] = round(float(agg.get("ratingValue", 0)), 2)
                data["rating_count"] = int(float(agg.get("ratingCount")
                                          or agg.get("reviewCount") or 0))
            except (TypeError, ValueError):
                data["rating"], data["rating_count"] = 0, 0
        slug = url.rstrip("/").split("/")[-1].replace("_", "-")
        data["slug"] = slug
        with open(os.path.join(RAW, f"{slug}.json"), "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        ok.append((slug, data.get("rating"), data.get("rating_count"),
                   len(data["ingredient_groups"][0]["items"]),
                   sum(len(g["steps"]) for g in data["step_groups_RAW"])))
    except Exception as e:
        fail.append((url, f"{type(e).__name__}: {e}"))

print(f"=== OK: {len(ok)} ===")
for s in ok:
    print(f"{s[0]}  rating={s[1]} ({s[2]})  ing={s[3]} steps={s[4]}")
print(f"=== FAIL: {len(fail)} ===")
for u, why in fail:
    print(f"{u}  ->  {why}")

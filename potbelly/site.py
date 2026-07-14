"""Secure static HTML, search index, and discovery metadata generation."""

from __future__ import annotations

import html
import json
import math
import re
from typing import Any
from urllib.parse import urlsplit


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def safe_json(value: Any) -> str:
    """Serialize JSON safely inside a non-executable HTML script element."""
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def site_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("SITE_URL must be an absolute HTTP(S) URL")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("SITE_URL must use HTTPS outside local development")
    return value.rstrip("/")


def human_duration_to_iso(value: str) -> str | None:
    """Convert unambiguous display durations; omit ambiguous active/chilling values."""
    value = value.strip().lower()
    match = re.fullmatch(
        r"(?:(\d+)\s*days?\s*)?(?:(\d+)\s*(?:hr|hrs|hours?)\s*)?"
        r"(?:(\d+)\s*(?:min|mins|minutes?)\s*)?",
        value,
    )
    if not match or not any(match.groups()):
        return None
    days, hours, minutes = (int(part or 0) for part in match.groups())
    result = "P"
    if days:
        result += f"{days}D"
    if hours or minutes:
        result += "T"
        if hours:
            result += f"{hours}H"
        if minutes:
            result += f"{minutes}M"
    return result


def popularity(recipe: dict[str, Any]) -> float:
    return float(recipe["rating"]) * math.log10(int(recipe["rating_count"]) + 1)


def duration_minutes(value: str) -> int | None:
    match = re.fullmatch(r"\s*(?:(\d+)\s*(?:hr|hrs|hours?)\s*)?(?:(\d+)\s*(?:min|mins|minutes?)\s*)?", value.lower())
    if not match or not any(match.groups()):
        return None
    hours, minutes = (int(part or 0) for part in match.groups())
    return hours * 60 + minutes


def normalized_course(value: str) -> str:
    text = value.lower()
    for result, terms in {
        "breakfast": ("breakfast", "brunch"), "main": ("main", "dinner", "rice"),
        "side": ("side",), "soup": ("soup",), "dessert": ("dessert",),
        "snack": ("snack", "appetizer"), "drink": ("drink",),
    }.items():
        if any(term in text for term in terms):
            return result
    return "other"


def head(*, title: str, description: str, canonical: str, site: str,
         structured_data: dict[str, Any] | None = None) -> str:
    social_image = f"{site}/social/potbelly-share.jpg"
    json_ld = ""
    if structured_data:
        json_ld = (
            '<script type="application/ld+json">'
            f"{safe_json(structured_data)}</script>"
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f6f0e4">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Potbelly">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:site_name" content="Potbelly">
<meta property="og:image" content="{esc(social_image)}">
<meta property="og:image:secure_url" content="{esc(social_image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Potbelly — Pot Luck with Laupie">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(social_image)}">
<meta name="twitter:image:alt" content="Potbelly — Pot Luck with Laupie">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
{json_ld}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-header"><div class="wrap">
  <a class="brand" href="/" aria-label="Potbelly home">
    <span class="brand-mark" aria-hidden="true"><img src="/icons/chef-mark.png" alt="" width="192" height="192"></span>
    <span><span class="brand-name">Potbelly</span><span class="brand-tagline">Pot Luck with Laupie</span></span>
  </a>
  <div class="header-actions">
    <span class="status-pill" id="networkStatus" data-state="online">Online</span>
    <button class="about-button" type="button" data-open-dialog="#aboutDialog" aria-label="About, installation and local data">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10.7v6M12 7.2h.01"></path></svg>
      <span>About</span>
    </button>
  </div>
</div></header>
<p class="visually-hidden" id="appStatus" aria-live="polite"></p>
"""


FOOTER = """<footer><div class="wrap"><p>Potbelly is a small, curated Instant Pot
cookbook. Every recipe is credited and linked to its original author — methods
are summarised in our own words.</p><p><a href="/install">Install</a> · <a href="/privacy">Privacy</a> · <a href="/support">Support</a></p><button class="btn-quiet" type="button"
data-open-dialog="#aboutDialog">Install &amp; data</button></div></footer>
<dialog class="dialog" id="aboutDialog">
  <div class="dialog-head"><h2>Potbelly on iPad</h2><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
  <div class="dialog-body">
    <h3>Your cookbook, even offline.</h3>
    <p>Install Potbelly from Safari for a standalone app window. Recipes, search and cooking progress remain on this iPad.</p>
    <ol class="install-steps"><li>Open this site in Safari.</li><li>Tap Share, then Add to Home Screen.</li><li>Turn on Open as Web App and tap Add.</li></ol>
    <div class="data-note"><p><strong>Local data.</strong> iPadOS may remove website storage under severe pressure. Export a backup after meaningful changes.</p></div>
    <div class="dialog-actions"><button class="btn-secondary" id="protectStorage" type="button">Protect local storage</button><button class="btn-quiet" id="exportBackup" type="button">Export Backup</button><label class="btn-quiet import-label">Import Backup<input id="importBackup" type="file" accept="application/json,.json"></label></div>
    <p id="storageResult" aria-live="polite"></p>
    <div class="import-confirm" id="importConfirm" hidden><p id="importSummary"></p><div class="dialog-actions"><button class="btn-secondary" id="replaceLocalData" type="button" disabled>Replace local data</button><button class="btn-quiet" id="cancelImport" type="button">Cancel</button></div></div>
  </div>
</dialog>
<div class="update-bar" id="updateBar" hidden><p><strong>Update available.</strong> Reload when you are ready.</p><button id="applyUpdate" type="button">Update now</button></div>
</body></html>"""


def search_record(recipe: dict[str, Any]) -> dict[str, Any]:
    ingredients = " ".join(
        item for group in recipe["ingredient_groups"] for item in group["items"]
    )
    primary_items = [group["items"][0] for group in recipe["ingredient_groups"] if group["items"]]
    searchable = " ".join([recipe["title"], recipe["category"], *recipe["keywords"], ingredients]).lower()
    vegetarian = not any(re.search(rf"\b{term}\b", searchable) for term in (
        "beef", "chicken", "pork", "lamb", "turkey", "bacon", "sausage", "fish", "shrimp", "prawn", "ham", "meat",
    ))
    return {
        "slug": recipe["slug"],
        "title": recipe["title"],
        "category": recipe["category"],
        "course": recipe["course"],
        "cuisine": recipe["cuisine"],
        "servings": recipe["servings"],
        "time": recipe["total_time"],
        "durationMinutes": duration_minutes(recipe["total_time"]),
        "description": recipe["description"],
        "sourceName": recipe["source_name"],
        "primaryIngredients": " ".join(primary_items),
        "normalizedCourse": normalized_course(" ".join((recipe["course"], recipe["category"]))),
        "normalizedCuisine": recipe["cuisine"].strip().lower() or "other",
        "vegetarian": vegetarian,
        "ingredients": ingredients,
        "keywords": " ".join(recipe["keywords"]),
        "popularity": round(popularity(recipe), 3),
    }


def index_page(recipes: list[dict[str, Any]], site: str) -> str:
    ordered = sorted(recipes, key=popularity, reverse=True)
    rows = []
    for index, recipe in enumerate(ordered, 1):
        meta = (
            f'<b>{esc(recipe["rating"])} &#9733;</b> '
            f'{int(recipe["rating_count"]):,} ratings &middot; '
            f'{esc(recipe["total_time"])} &middot; {esc(recipe["source_name"])}'
        )
        rows.append(
            f'<li data-slug="{esc(recipe["slug"])}" tabindex="-1">'
            f'<a href="/recipe/{esc(recipe["slug"])}">'
            f'<span class="rank">{index:02d}</span>'
            f'<span class="rtitle">{esc(recipe["title"])}</span>'
            f'<span class="rmeta">{meta}</span></a></li>'
        )
    description = (
        "150 curated Instant Pot recipes with guided Cooking Mode and a "
        "voice-powered AI cooking assistant."
    )
    return head(
        title="Potbelly — Pot Luck with Laupie",
        description=description,
        canonical=site + "/",
        site=site,
    ) + f"""
<main id="main">
  <section class="dashboard" id="dashboard" aria-labelledby="dashboardTitle"><div class="wrap">
    <div class="dashboard-head"><div><div class="label dashboard-kicker">A Curation of Instant Pot Recipes</div><h1 id="dashboardTitle">What are we making?</h1></div><button class="btn-quiet" id="openShopping" type="button">Shopping list <span id="shoppingCount">0</span></button></div>
    <div class="dashboard-grid">
      <section class="dashboard-card dashboard-continue" id="continueCard" hidden><span class="label">Continue cooking</span><a id="continueLink" href="/"><strong id="continueTitle">Recipe</strong><span id="continueMeta">Resume where you left off →</span></a></section>
      <section class="dashboard-card"><span class="label">Favourites</span><div class="dashboard-links" id="favouriteItems"><p>Save recipes you want close at hand.</p></div></section>
      <section class="dashboard-card"><span class="label">Recently viewed</span><div class="dashboard-links" id="recentDashboard"><p>Your latest recipes will appear here.</p></div></section>
    </div>
  </div></section>
  <section class="hero" aria-label="Find a recipe"><div class="wrap">
    <div class="search-panel">
      <label class="label" for="q">What do you want to cook?</label>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Chicken, dessert, or dinner for six" disabled>
      <div class="discovery-controls"><div class="filter-scroll" id="filters" aria-label="Recipe filters">
        <button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="under-30" aria-pressed="false">Under 30 min</button><button type="button" data-filter="chicken" aria-pressed="false">Chicken</button><button type="button" data-filter="beef" aria-pressed="false">Beef</button><button type="button" data-filter="vegetarian" aria-pressed="false">Vegetarian</button><button type="button" data-filter="soup" aria-pressed="false">Soups</button><button type="button" data-filter="dessert" aria-pressed="false">Desserts</button><button type="button" data-filter="indian" aria-pressed="false">Indian</button>
      </div></div>
    </div>
  </div></section>
  <section class="cookbook" aria-labelledby="listLabel"><div class="wrap cookbook-master"><div class="catalogue-pane">
    <div class="cookbook-head">
      <h2 class="label" id="listLabel">The cookbook · ranked by popularity</h2>
      <span class="label" id="listCount">{len(ordered)} recipes</span>
    </div>
    <ol class="results" id="results">{''.join(rows)}</ol>
    <p class="empty" id="empty">Nothing matches that yet. Try fewer words or a different ingredient.</p>
    <button class="btn-quiet show-more" id="showMore" type="button">Show more recipes</button>
    </div><aside class="recipe-preview" id="recipePreview" aria-label="Selected recipe preview"><div class="preview-inner"><span class="label" id="previewEyebrow">Recipe preview</span><h2 id="previewTitle">Choose a recipe</h2><p id="previewDescription">Move through the cookbook to see useful details here.</p><dl class="preview-meta"><div><dt>Time</dt><dd id="previewTime">—</dd></div><div><dt>Serves</dt><dd id="previewServes">—</dd></div></dl><p class="preview-source" id="previewSource"></p><a class="btn" id="previewLink" href="/">Open recipe</a><button class="btn-quiet" id="previewFavourite" type="button">♡ Save favourite</button></div></aside>
  </div></section>
</main>
<dialog class="dialog shopping-dialog" id="shoppingDialog"><div class="dialog-head"><h2>Shopping list</h2><button class="icon-button" type="button" data-close-dialog aria-label="Close shopping list">×</button></div><div class="dialog-body"><div id="shoppingItems" class="shopping-items"></div><p id="shoppingEmpty">Add ingredients from any recipe.</p><div class="dialog-actions"><button class="btn-quiet btn-danger" id="clearShopping" type="button">Clear list</button></div></div></dialog>
<script src="/assets/app.js" type="module"></script>
""" + FOOTER


def recipe_structured_data(recipe: dict[str, Any], canonical: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "@id": canonical + "#recipe",
        "mainEntityOfPage": canonical,
        "name": recipe["title"],
        "description": recipe["description"],
        "author": {"@type": "Organization", "name": recipe["source_name"],
                   "url": recipe["source_url"]},
        "publisher": {"@type": "Organization", "name": "Potbelly"},
        "recipeYield": recipe["servings"],
        "recipeCategory": recipe["course"] or recipe["category"],
        "recipeCuisine": recipe["cuisine"],
        "keywords": ", ".join(recipe["keywords"]),
        "recipeIngredient": [
            item for group in recipe["ingredient_groups"] for item in group["items"]
        ],
        "recipeInstructions": [
            {"@type": "HowToStep", "text": step}
            for group in recipe["step_groups"] for step in group["steps"]
        ],
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": recipe["rating"],
            "ratingCount": recipe["rating_count"],
            "bestRating": 5,
        },
        "isBasedOn": recipe["source_url"],
    }
    for source, target in (("prep_time", "prepTime"), ("cook_time", "cookTime"),
                           ("total_time", "totalTime")):
        duration = human_duration_to_iso(recipe[source])
        if duration:
            data[target] = duration
    if recipe["nutrition"]:
        data["nutrition"] = {"@type": "NutritionInformation",
                             "description": recipe["nutrition"]}
    return data


def recipe_page(recipe: dict[str, Any], site: str) -> str:
    canonical = f'{site}/recipe/{recipe["slug"]}'
    eyebrow = " · ".join(esc(value) for value in (recipe["course"], recipe["cuisine"]) if value)
    meta = "".join(
        f'<div><span class="label">{label}</span><div class="v">{esc(recipe[key])}</div></div>'
        for key, label in (("prep_time", "Prep"), ("cook_time", "Cook"),
                           ("total_time", "Total"), ("servings", "Serves"))
        if recipe[key]
    )
    ingredients = "".join(
        (f'<div class="gname">{esc(group["name"])}</div>' if group["name"] else "")
        + "<ul>" + "".join(
            f'<li><label class="ingredient-check"><input type="checkbox" data-ingredient-id="ingredient-{group_index + 1}-{item_index + 1}"><span>{esc(item)}</span></label></li>'
            for item_index, item in enumerate(group["items"])
        ) + "</ul>"
        for group_index, group in enumerate(recipe["ingredient_groups"])
    )
    step_items = []
    total_steps = sum(len(group["steps"]) for group in recipe["step_groups"])
    global_step_index = 0
    for group_index, group in enumerate(recipe["step_groups"]):
        if group["name"]:
            step_items.append(f'<div class="gsteps">{esc(group["name"])}</div>')
        step_items.append('<ol class="steps">')
        for step_index, step in enumerate(group["steps"]):
            global_step_index += 1
            step_id = f"step-{group_index + 1}-{step_index + 1}"
            action_label = "Finish cooking" if global_step_index == total_steps else "Done — next step"
            step_items.append(
                f'<li class="step-card" data-step-id="{step_id}" data-step-number="{global_step_index}"><p>{esc(step)}</p>'
                '<div class="step-actions">'
                f'<button class="step-done" type="button" data-complete-step aria-pressed="false">{action_label}</button>'
                '</div></li>'
            )
        step_items.append('</ol>')
    steps = "".join(step_items)
    notes = ""
    if recipe["notes"]:
        notes = '<h2 class="sec">Notes</h2><div class="notes">' + "".join(
            f"<p>{esc(note)}</p>" for note in recipe["notes"]
        ) + "</div>"
    nutrition = (
        f'<p class="nutrition">{esc(recipe["nutrition"])}</p>'
        if recipe["nutrition"] else ""
    )
    return head(
        title=f'{recipe["title"]} — Potbelly',
        description=recipe["description"],
        canonical=canonical,
        site=site,
        structured_data=recipe_structured_data(recipe, canonical),
    ) + f"""
<main id="main" class="recipe-shell">
  <div class="reading-wrap topbar">
    <a class="back" href="/">← Potbelly</a>
    <span class="label"><b>{esc(recipe["rating"])} &#9733;</b>
      &nbsp;{int(recipe["rating_count"]):,} ratings</span>
  </div>
  <article class="reading-wrap" data-recipe-slug="{esc(recipe["slug"])}">
    <div class="recipe-hero"><div>
      <div class="eyebrow">{eyebrow or 'Recipe'}</div>
      <h1 class="rname" id="recipeTitle">{esc(recipe["title"])}</h1>
      <p class="desc">{esc(recipe["description"])}</p>
      <div class="actions">
        <button class="btn" id="startCooking" type="button" disabled>Start cooking</button>
        <button class="btn-secondary" id="askPotbelly" type="button" disabled>Ask Potbelly</button>
        <button class="btn-quiet" id="favouriteRecipe" type="button" aria-pressed="false">♡ Favourite</button>
        <button class="btn-quiet" id="addToShopping" type="button">Add to shopping</button>
        <button class="btn-quiet" id="shareRecipe" type="button">Share</button>
        <button class="btn-quiet" id="savePdf" type="button" data-pdf-url="/pdfs/{esc(recipe["slug"])}.pdf" data-pdf-filename="potbelly-{esc(recipe["slug"])}.pdf">Save PDF</button>
        <a class="textlink" href="{esc(recipe["source_url"])}" rel="noopener noreferrer">Original recipe</a>
      </div>
    </div><div class="meta">{meta}</div></div>
    <div class="recipe-layout">
      <section class="ingredients-column" id="ingredientsPanel"><div class="section-head"><h2 class="sec">Ingredients</h2><button class="icon-button ingredients-close" id="closeIngredients" type="button" aria-label="Close ingredients">×</button></div><div class="ingredients">{ingredients}</div></section>
      <section class="method-column"><h2 class="sec">Method</h2><details class="completed-history" id="completedHistory" hidden><summary>Completed steps <span id="completedCount">0</span></summary><div id="completedStepLinks"></div></details>{steps}</section>
    </div>
    <div class="personal-notes"><label class="sec" for="personalNote">My notes</label><textarea id="personalNote" maxlength="20000" placeholder="Add your own substitutions, timings, or reminders…"></textarea><p id="noteStatus" aria-live="polite"></p></div>
    <div class="notes-area">{notes}{nutrition}
    <p class="credit">Adapted from <a href="{esc(recipe["source_url"])}"
      rel="noopener noreferrer">{esc(recipe["source_name"])}</a>. Method summarised in
      Potbelly's own words; quantities and timings as published. All credit to the original author.</p></div>
  </article>
</main>
<nav class="cooking-dock" id="cookingDock" aria-label="Cooking controls" hidden>
  <div class="dock-navigation">
    <button class="dock-nav" id="previousStep" type="button" aria-label="Previous step"><span aria-hidden="true">←</span></button>
    <span class="dock-progress" id="cookingProgress">Cooking</span>
    <button class="dock-next" id="nextStep" type="button" aria-label="Next step"><span id="nextStepLabel">Next</span><span aria-hidden="true">→</span></button>
  </div>
  <div class="dock-tools">
    <button class="dock-tool" id="showIngredients" type="button"><span class="dock-tool-icon" aria-hidden="true">≡</span><span>Ingredients</span></button>
    <button class="dock-tool" id="openVoiceAssistant" type="button"><span class="dock-tool-icon dock-mic" aria-hidden="true"></span><span>Assistant</span></button>
    <button class="dock-tool" id="textSize" type="button"><span class="dock-tool-icon dock-text" aria-hidden="true">Aa</span><span>Text size</span></button>
    <details class="dock-overflow"><summary><span class="dock-tool-icon" aria-hidden="true">•••</span><span>More</span></summary><div class="dock-more"><button id="undoCooking" type="button">Undo last change</button><button id="resetCooking" type="button">Reset cooking</button><button id="exitCooking" type="button">Exit Cooking Mode</button></div></details>
  </div>
</nav>
<button class="ingredients-backdrop" id="ingredientsBackdrop" type="button" aria-label="Dismiss ingredients panel"></button>
<div class="timer-rail" id="timerRail" hidden aria-live="polite"></div>
<dialog class="dialog confirm-dialog" id="resetDialog"><div class="dialog-head"><h2>Reset this cook?</h2><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div><div class="dialog-body"><p>Ingredient checks, completed steps, and timers for this recipe will be cleared.</p><div class="dialog-actions"><button class="btn btn-danger-solid" id="confirmReset" type="button">Reset everything</button><button class="btn-quiet" id="cancelReset" type="button">Keep cooking</button></div></div></dialog>
{ai_dialog()}
<script src="/assets/recipe.js" type="module"></script>
""" + FOOTER


def ai_dialog() -> str:
    return """<aside class="ai-panel" id="aiDialog" role="dialog" aria-modal="false" aria-labelledby="aiPanelTitle" hidden>
  <div class="dialog-head"><h2 id="aiPanelTitle">Ask Potbelly</h2><button class="icon-button" id="aiClose" type="button" aria-label="Close cooking assistant">×</button></div>
  <div class="dialog-body">
    <section data-ai-stage="loading"><h3>Warming up…</h3><p>Checking assistant availability.</p></section>
    <section data-ai-stage="offline" hidden><h3>Assistant unavailable</h3><p>The assistant needs internet. The complete recipe remains available.</p></section>
    <section data-ai-stage="consent" hidden><h3>Before you start</h3><p>Your microphone audio and this recipe's context will be sent to OpenAI only after you press Start listening.</p><p>Audio and answers are not saved by Potbelly. AI can make mistakes; follow appliance safety instructions and use a food thermometer.</p><div class="dialog-actions"><button class="btn" id="acceptVoiceConsent" type="button">Accept and continue</button></div></section>
    <section class="voice-ready" data-ai-stage="ready" hidden><div class="voice-ready-mark" aria-hidden="true"><span class="dock-mic"></span></div><h3>Your recipe-aware sous-chef.</h3><p class="ai-step-context" id="aiStepContext">Ask about the current step, heat, texture, timing, or substitutions.</p><div class="voice-examples" aria-label="Example questions"><span>Try asking</span><ul><li>“What should I check?”</li><li>“How hot should this be?”</li><li>“Is it cooked safely?”</li></ul></div><p class="voice-ready-status" id="voiceReadyStatus" aria-live="polite"></p><button class="btn-secondary voice-start" id="startVoiceSession" type="button">Start listening</button><p class="voice-privacy">Your microphone remains off until you press this button.</p></section>
    <section class="voice-shell" data-ai-stage="session" hidden>
      <div class="voice-orb" id="voiceOrb" data-state="ready" aria-hidden="true"></div><h3 class="voice-state" id="aiStateLabel">Ready</h3><p class="voice-detail" id="aiStateDetail">Ask a question about this recipe.</p>
      <div class="voice-controls"><button class="btn-quiet" id="muteVoice" type="button">Mute</button><button class="btn-quiet" id="interruptVoice" type="button">Stop answer</button><button class="btn-quiet btn-danger" id="endVoiceSession" type="button">End session</button></div>
      <div class="approval" id="aiApproval" hidden><p id="aiApprovalText">Allow this change?</p><div class="dialog-actions"><button class="btn-secondary" id="approveAiTool" type="button">Allow change</button><button class="btn-quiet" id="rejectAiTool" type="button">Keep current state</button></div></div>
    </section>
  </div>
</aside>"""


def not_found_page(site: str) -> str:
    return head(title="Recipe not found — Potbelly", description="That recipe is not in the cookbook.",
                canonical=site + "/404", site=site) + """
<main id="main" class="reading-wrap not-found">
  <div class="eyebrow">404 · misplaced recipe</div>
  <h1 class="rname">That one isn't in the pot.</h1>
  <p>The recipe may have moved, or the address may be incomplete.</p>
  <a class="btn" href="/">Return to the cookbook</a>
</main>""" + FOOTER


def information_page(kind: str, site: str) -> str:
    pages = {
        "install": (
            "Install Potbelly",
            "A proper iPad app window, without the App Store.",
            """<ol class="install-steps"><li>Open potbelly.redcliffebay.com in Safari.</li><li>Tap the Share button.</li><li>Choose Add to Home Screen.</li><li>Turn on Open as Web App, then tap Add.</li></ol><div class="data-note"><p>Open Potbelly online once after installation so Safari can cache the cookbook. Then test it in airplane mode.</p></div>""",
        ),
        "privacy": (
            "Privacy",
            "The cookbook stays on your iPad.",
            """<p>Potbelly has no accounts, advertising, behavioural analytics or server-side recipe storage. Cooking progress and preferences remain in IndexedDB on this device.</p><p>The optional AI Cooking Assistant sends microphone audio together with the selected recipe context to OpenAI only after you explicitly start listening. Potbelly does not display, log or deliberately retain a transcript. The permanent OpenAI credential remains on Cloudflare.</p><p>You can use every recipe, search and Cooking Mode without enabling the AI feature.</p>""",
        ),
        "support": (
            "Support",
            "Quick fixes in the kitchen.",
            """<p>If the app looks out of date, close and reopen it, then accept the update prompt. If offline recipes are unavailable, reconnect once and leave the cookbook open until it has loaded.</p><p>Microphone problems: open iPad Settings, find Safari or Potbelly, and allow microphone access. The AI assistant also requires an internet connection and available daily quota.</p><p>For recipe attribution or technical support, contact <a class="textlink" href="mailto:Ryan@redcliffebay.com">Ryan@redcliffebay.com</a>.</p>""",
        ),
    }
    title, lead, content = pages[kind]
    return head(
        title=f"{title} — Potbelly",
        description=lead,
        canonical=f"{site}/{kind}",
        site=site,
    ) + f"""<main id="main" class="reading-wrap not-found"><div class="eyebrow">Potbelly</div><h1 class="rname">{title}</h1><p class="desc">{lead}</p><div class="dialog-body">{content}</div><a class="btn" href="/">Return to the cookbook</a></main><script src="/assets/info.js" type="module"></script>""" + FOOTER


def sitemap(recipes: list[dict[str, Any]], site: str) -> str:
    urls = [site + "/"] + [f"{site}/{page}" for page in ("install", "privacy", "support")]
    urls += [f'{site}/recipe/{recipe["slug"]}' for recipe in recipes]
    entries = "".join(f"<url><loc>{esc(url)}</loc></url>" for url in urls)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + (
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{entries}</urlset>\n"
    )

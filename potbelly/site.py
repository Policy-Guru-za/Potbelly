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


def head(*, title: str, description: str, canonical: str, site: str,
         structured_data: dict[str, Any] | None = None) -> str:
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
<meta name="twitter:card" content="summary">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
{json_ld}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-header"><div class="wrap">
  <a class="brand" href="/" aria-label="Potbelly home">
    <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path fill="currentColor" d="M8 12h16l-1 12H9L8 12Zm2-5h12v3H10V7Zm4-4h4v3h-4V3ZM6 13H3v5h3v-2H5v-1h1v-2Zm20 0h3v5h-3v-2h1v-1h-1v-2Z"/></svg></span>
    <span><span class="brand-name">Potbelly</span><span class="brand-tagline">Pressure cooking, beautifully clear.</span></span>
  </a>
  <div class="header-actions">
    <span class="status-pill" id="networkStatus" data-state="online">Online</span>
    <button class="icon-button" type="button" data-open-dialog="#aboutDialog" aria-label="About and install Potbelly">i</button>
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
    <div class="data-note"><p><strong>Local data.</strong> iPadOS may remove website storage under severe pressure. Cooking progress is helpful state, not a permanent record.</p></div>
    <div class="dialog-actions"><button class="btn-secondary" id="protectStorage" type="button">Protect local storage</button></div>
    <p id="storageResult" aria-live="polite"></p>
  </div>
</dialog>
<div class="update-bar" id="updateBar" hidden><p><strong>Update available.</strong> Reload when you are ready.</p><button id="applyUpdate" type="button">Update now</button></div>
</body></html>"""


def search_record(recipe: dict[str, Any]) -> dict[str, Any]:
    ingredients = " ".join(
        item for group in recipe["ingredient_groups"] for item in group["items"]
    )
    return {
        "slug": recipe["slug"],
        "title": recipe["title"],
        "category": recipe["category"],
        "course": recipe["course"],
        "cuisine": recipe["cuisine"],
        "servings": recipe["servings"],
        "time": recipe["total_time"],
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
            f'<li data-slug="{esc(recipe["slug"])}">'
            f'<a href="/recipe/{esc(recipe["slug"])}">'
            f'<span class="rank">{index:02d}</span>'
            f'<span class="rtitle">{esc(recipe["title"])}</span>'
            f'<span class="rmeta">{meta}</span></a></li>'
        )
    description = (
        "Ask what you want to cook. Potbelly finds loved Instant Pot recipes, "
        "stripped of the fluff and typeset for screen and PDF."
    )
    return head(
        title="Potbelly — the Instant Pot cookbook, typeset",
        description=description,
        canonical=site + "/",
        site=site,
    ) + f"""
<main id="main">
  <section class="hero" aria-labelledby="search-heading"><div class="wrap">
    <div class="hero-grid"><div>
      <div class="hero-kicker label">Curated for the Instant Pot</div>
      <h1 id="search-heading">Good food. No life story.</h1>
      <p class="hero-copy">Loved recipes, carefully distilled into calm, practical instructions for the kitchen.</p>
    </div>
    <svg class="pot-illustration" viewBox="0 0 360 300" role="img" aria-label="Illustration of a warm pressure cooker">
      <path class="steam" d="M132 62c-20-24 17-31 0-53" fill="none" stroke="#b54b32" stroke-width="7" stroke-linecap="round"/>
      <path class="steam" d="M180 52c-18-22 19-30 1-48" fill="none" stroke="#b54b32" stroke-width="7" stroke-linecap="round"/>
      <path class="steam" d="M228 62c-20-24 17-31 0-53" fill="none" stroke="#b54b32" stroke-width="7" stroke-linecap="round"/>
      <path d="M82 103h196l-15 145c-3 25-21 39-45 39h-76c-24 0-42-14-45-39L82 103Z" fill="#53664d"/>
      <path d="M67 94c0-13 10-23 23-23h180c13 0 23 10 23 23v19H67V94Z" fill="#2b241d"/>
      <path d="M139 57h82v20h-82z" fill="#d5a53d"/><circle cx="180" cy="177" r="51" fill="#f6f0e4"/><path d="M152 177h56M180 149v56" stroke="#b54b32" stroke-width="8" stroke-linecap="round"/>
    </svg></div>
    <div class="search-panel">
      <label class="label" for="q">What do you want to cook?</label>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Chicken, something sweet, dinner for six…" disabled>
      <div class="chips" aria-label="Recipe suggestions">
        <button type="button" data-query="weeknight chicken" disabled>Weeknight chicken</button>
        <button type="button" data-query="soup" disabled>Soup season</button>
        <button type="button" data-query="dessert" disabled>Something sweet</button>
        <button type="button" data-query="side" disabled>On the side</button>
        <button type="button" id="surprise" disabled>Surprise me</button>
      </div>
    </div>
    <div class="recents" id="recents">
      <div class="label">Recently viewed</div>
      <div class="items" id="recentItems"></div>
    </div>
  </div></section>
  <section class="cookbook" aria-labelledby="listLabel"><div class="wrap">
    <div class="cookbook-head">
      <h2 class="label" id="listLabel">The cookbook · ranked by popularity</h2>
      <span class="label" id="listCount">{len(ordered)} recipes</span>
    </div>
    <ol class="results" id="results">{''.join(rows)}</ol>
    <p class="empty" id="empty">Nothing matches that yet. Try fewer words or one of the suggestions above.</p>
  </div></section>
</main>
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
    for group_index, group in enumerate(recipe["step_groups"]):
        if group["name"]:
            step_items.append(f'<div class="gsteps">{esc(group["name"])}</div>')
        step_items.append('<ol class="steps">')
        for step_index, step in enumerate(group["steps"]):
            step_id = f"step-{group_index + 1}-{step_index + 1}"
            step_items.append(
                f'<li class="step-card" data-step-id="{step_id}"><p>{esc(step)}</p>'
                '<div class="step-actions">'
                '<button type="button" data-activate-step>Make current step</button>'
                '<button type="button" data-complete-step aria-pressed="false">Mark complete</button>'
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
        <a class="btn-quiet" href="/pdfs/{esc(recipe["slug"])}.pdf" download>Save PDF</a>
        <a class="textlink" href="{esc(recipe["source_url"])}" rel="noopener noreferrer">Original recipe</a>
      </div>
    </div><div class="meta">{meta}</div></div>
    <div class="recipe-layout">
      <section class="ingredients-column"><h2 class="sec">Ingredients</h2><div class="ingredients">{ingredients}</div></section>
      <section class="method-column"><h2 class="sec">Method</h2>{steps}</section>
    </div>
    <div class="notes-area">{notes}{nutrition}
    <p class="credit">Adapted from <a href="{esc(recipe["source_url"])}"
      rel="noopener noreferrer">{esc(recipe["source_name"])}</a>. Method summarised in
      Potbelly's own words; quantities and timings as published. All credit to the original author.</p></div>
  </article>
</main>
<nav class="cooking-dock" id="cookingDock" aria-label="Cooking controls" hidden>
  <button class="dock-icon" id="previousStep" type="button" aria-label="Previous step">←</button>
  <div class="dock-center"><span class="dock-progress" id="cookingProgress">Cooking</span><button id="undoCooking" type="button">Undo</button><button id="resetCooking" type="button">Reset</button><button id="exitCooking" type="button">Exit</button></div>
  <button class="dock-icon" id="nextStep" type="button" aria-label="Next step">→</button>
</nav>
{ai_dialog()}
<script src="/assets/recipe.js" type="module"></script>
""" + FOOTER


def ai_dialog() -> str:
    return """<dialog class="dialog" id="aiDialog">
  <div class="dialog-head"><h2>Ask Potbelly</h2><button class="icon-button" id="aiClose" type="button" aria-label="Close cooking assistant">×</button></div>
  <div class="dialog-body">
    <section data-ai-stage="loading"><h3>Warming up…</h3><p>Checking AI access.</p></section>
    <section data-ai-stage="offline" hidden><h3>Assistant unavailable</h3><p>The assistant needs internet. The complete recipe remains available.</p></section>
    <section data-ai-stage="unlock" hidden><h3>AI access</h3><p>The cookbook is public. This shared code protects only the realtime AI service.</p>
      <form id="aiUnlockForm"><label class="field-label label" for="aiAccessCode">Access code</label><input class="field" id="aiAccessCode" type="password" inputmode="numeric" autocomplete="one-time-code" required maxlength="32"><p class="field-error" id="aiUnlockError" aria-live="polite"></p><button class="btn" id="unlockAi" type="submit">Unlock assistant</button></form>
    </section>
    <section data-ai-stage="consent" hidden><h3>Before you start</h3><p>Your microphone audio and this recipe's context will be sent to OpenAI for a live response. Potbelly does not display or save a transcript.</p><p>AI can make mistakes. Follow appliance safety instructions and use a food thermometer where appropriate.</p><div class="dialog-actions"><button class="btn" id="acceptVoiceConsent" type="button">Accept and continue</button></div></section>
    <section data-ai-stage="ready" hidden><h3>Ready when you are.</h3><p>Ask about heat, texture, substitutions, timing, pressure release, or the next step. Potbelly answers aloud.</p><div class="dialog-actions"><button class="btn-secondary" id="startVoiceSession" type="button">Start voice assistant</button></div></section>
    <section class="voice-shell" data-ai-stage="session" hidden>
      <div class="voice-orb" id="voiceOrb" data-state="ready" aria-hidden="true"></div><h3 class="voice-state" id="aiStateLabel">Ready</h3><p class="voice-detail" id="aiStateDetail">Ask a question about this recipe.</p>
      <div class="voice-controls"><button class="btn-quiet" id="muteVoice" type="button">Mute</button><button class="btn-quiet" id="interruptVoice" type="button">Stop answer</button><button class="btn-quiet btn-danger" id="endVoiceSession" type="button">End session</button></div>
      <form class="typed-question" id="typedQuestionForm"><label class="visually-hidden" for="typedQuestion">Type a cooking question</label><input class="field" id="typedQuestion" placeholder="Or type one question…" autocomplete="off"><button class="btn-secondary" type="submit">Ask</button></form>
      <div class="approval" id="aiApproval" hidden><p id="aiApprovalText">Allow this change?</p><div class="dialog-actions"><button class="btn-secondary" id="approveAiTool" type="button">Allow change</button><button class="btn-quiet" id="rejectAiTool" type="button">Keep current state</button></div></div>
    </section>
  </div>
</dialog>"""


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
            """<p>Potbelly has no accounts, advertising, behavioural analytics or server-side recipe storage. Cooking progress and preferences remain in IndexedDB on this device.</p><p>The optional AI Cooking Assistant sends microphone audio and the selected recipe context to OpenAI for a live response. Potbelly does not display, log or deliberately retain a transcript. The permanent OpenAI credential remains on Cloudflare.</p><p>You can use every recipe, search and Cooking Mode without enabling the AI feature.</p>""",
        ),
        "support": (
            "Support",
            "Quick fixes in the kitchen.",
            """<p>If the app looks out of date, close and reopen it, then accept the update prompt. If offline recipes are unavailable, reconnect once and leave the cookbook open until it has loaded.</p><p>Microphone problems: open iPad Settings, find Safari or Potbelly, and allow microphone access. The AI assistant also requires internet access and a valid AI access code.</p><p>For recipe attribution or technical support, contact <a class="textlink" href="mailto:Ryan@redcliffebay.com">Ryan@redcliffebay.com</a>.</p>""",
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

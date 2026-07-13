"""Typeset A4 PDF rendering for validated recipes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from potbelly.site import esc

PDF_CSS = """
@page{size:A4;margin:22mm 20mm 24mm;
 @bottom-left{content:string(doc-title);font-family:PBSans,sans-serif;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:#6E6A5D}
 @bottom-right{content:counter(page) " / " counter(pages);font-family:PBSans,sans-serif;font-size:7.5pt;color:#6E6A5D}}
*{box-sizing:border-box;margin:0;padding:0}
body{color:#23221D;font-family:PBSerif,serif;font-size:10.5pt;line-height:1.55}
.eyebrow{color:#46603C;font-family:PBSans,sans-serif;font-size:8pt;font-weight:500;letter-spacing:.18em;margin-bottom:6pt;text-transform:uppercase}
h1{font-size:27pt;font-weight:600;line-height:1.12;margin-bottom:7pt;string-set:doc-title content()}
.description{max-width:88%;color:#6E6A5D;font-size:11pt;font-style:italic;margin-bottom:14pt}
.meta{display:flex;border-block:1.4pt solid #23221D;border-bottom-width:.6pt;margin-bottom:18pt;padding:8pt 0}
.meta div{flex:1}.meta .label{display:block;color:#6E6A5D;font-family:PBSans,sans-serif;font-size:6.8pt;font-weight:500;letter-spacing:.14em;text-transform:uppercase}.meta .value{font-size:10.5pt}
h2{color:#46603C;font-family:PBSans,sans-serif;font-size:9.5pt;font-weight:600;letter-spacing:.16em;margin:16pt 0 8pt;text-transform:uppercase}
h2::after{content:"";display:block;border-bottom:.6pt solid #DDD9CC;margin-top:4pt}
.ingredients{background:#F4F3EC;border-radius:4pt;column-count:2;column-gap:22pt;padding:11pt 13pt}
.group-name{column-span:all;color:#46603C;font-family:PBSans,sans-serif;font-size:8pt;font-weight:600;letter-spacing:.1em;margin:6pt 0 3pt;text-transform:uppercase}
.ingredients ul{list-style:none}.ingredients li{border-bottom:.5pt solid #DDD8C6;break-inside:avoid;font-size:9.8pt;padding:2.6pt 0}
.steps{list-style:none;counter-reset:step}.steps li{counter-increment:step;position:relative;break-inside:avoid;padding:0 0 9pt 26pt}
.steps li::before{content:counter(step);position:absolute;left:0;top:1pt;display:flex;width:15pt;height:15pt;align-items:center;justify-content:center;border:.9pt solid #46603C;border-radius:50%;color:#46603C;font-family:PBSans,sans-serif;font-size:8pt;font-weight:600}
.step-group-name{color:#6E6A5D;font-family:PBSans,sans-serif;font-size:8.5pt;font-weight:600;letter-spacing:.1em;margin:6pt 0;text-transform:uppercase}
.notes{border-left:2pt solid #46603C;padding:2pt 0 2pt 10pt}.notes p{color:#4A4739;font-size:9.6pt;margin-bottom:5pt}
.nutrition{color:#6E6A5D;font-family:PBSans,sans-serif;font-size:8pt;line-height:1.7;margin-top:10pt}
.source{border-top:.6pt solid #DDD9CC;color:#6E6A5D;font-family:PBSans,sans-serif;font-size:8pt;margin-top:14pt;padding-top:8pt}.source a{color:#46603C;text-decoration:none}
"""


def pdf_html(recipe: dict[str, Any]) -> str:
    eyebrow = " · ".join(
        esc(value) for value in (recipe["course"], recipe["cuisine"]) if value
    ) or "Recipe"
    meta = "".join(
        f'<div><span class="label">{label}</span><span class="value">{esc(recipe[key])}</span></div>'
        for key, label in (("prep_time", "Prep"), ("cook_time", "Cook"),
                           ("total_time", "Total"), ("servings", "Serves"))
        if recipe[key]
    )
    ingredients = "".join(
        (f'<div class="group-name">{esc(group["name"])}</div>' if group["name"] else "")
        + "<ul>" + "".join(f"<li>{esc(item)}</li>" for item in group["items"]) + "</ul>"
        for group in recipe["ingredient_groups"]
    )
    steps = "".join(
        (f'<div class="step-group-name">{esc(group["name"])}</div>' if group["name"] else "")
        + '<ol class="steps">'
        + "".join(f"<li>{esc(step)}</li>" for step in group["steps"])
        + "</ol>"
        for group in recipe["step_groups"]
    )
    notes = ""
    if recipe["notes"]:
        notes = "<h2>Notes</h2><div class='notes'>" + "".join(
            f"<p>{esc(note)}</p>" for note in recipe["notes"]
        ) + "</div>"
    nutrition = (
        f'<div class="nutrition">{esc(recipe["nutrition"])}</div>'
        if recipe["nutrition"] else ""
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{PDF_CSS}</style></head>
<body><div class="eyebrow">{eyebrow}</div><h1>{esc(recipe["title"])}</h1>
<p class="description">{esc(recipe["description"])}</p><div class="meta">{meta}</div>
<h2>Ingredients</h2><div class="ingredients">{ingredients}</div>
<h2>Method</h2>{steps}{notes}{nutrition}
<div class="source">Adapted from {esc(recipe["source_name"])} ·
<a href="{esc(recipe["source_url"])}">{esc(recipe["source_url"])}</a> · Potbelly, typeset</div>
</body></html>"""


def render_pdfs(recipes: list[dict[str, Any]], output: Path, fonts: Path) -> None:
    try:
        from weasyprint import CSS, HTML
        from weasyprint.text.fonts import FontConfiguration
    except ImportError as exc:
        raise RuntimeError(
            "WeasyPrint is required for PDF output; install pinned Python dependencies"
        ) from exc

    output.mkdir(parents=True, exist_ok=True)
    config = FontConfiguration()
    faces = "".join(
        f"@font-face{{font-family:{family};font-weight:{weight};font-style:{style};"
        f"src:url('{(fonts / filename).as_uri()}');}}"
        for family, weight, style, filename in (
            ("PBSerif", 400, "normal", "Lora-400.ttf"),
            ("PBSerif", 500, "normal", "Lora-500.ttf"),
            ("PBSerif", 600, "normal", "Lora-600.ttf"),
            ("PBSerif", 400, "italic", "Lora-Italic.ttf"),
            ("PBSans", 400, "normal", "Poppins-400.ttf"),
            ("PBSans", 500, "normal", "Poppins-500.ttf"),
            ("PBSans", 600, "normal", "Poppins-600.ttf"),
        )
    )
    font_css = CSS(string=faces, font_config=config)
    for recipe in recipes:
        HTML(string=pdf_html(recipe), base_url=str(output)).write_pdf(
            output / f'{recipe["slug"]}.pdf',
            stylesheets=[font_css],
            font_config=config,
        )

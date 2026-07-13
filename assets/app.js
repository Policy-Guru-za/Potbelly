"use strict";

const queryInput = document.querySelector("#q");
const list = document.querySelector("#results");
const empty = document.querySelector("#empty");
const label = document.querySelector("#listLabel");
const count = document.querySelector("#listCount");
const status = document.querySelector("#resultStatus");
const rows = new Map(
  [...document.querySelectorAll("#results li[data-slug]")].map((row) => [row.dataset.slug, row]),
);

const STOP_WORDS = new Set(["a", "an", "and", "for", "of", "please", "the", "to", "with"]);
const NUMBER_WORDS = new Map([
  ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"],
  ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"], ["ten", "10"],
]);
const ALIASES = new Map([
  ["dinner", ["main", "mains", "supper"]],
  ["sweet", ["dessert", "cake"]],
  ["veggie", ["vegetable", "vegetarian"]],
  ["minute", ["min"]],
  ["minutes", ["min"]],
]);

let data = [];

function tokens(value) {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .map((token) => NUMBER_WORDS.get(token) || token);
}

function fieldScore(recipe, token) {
  const candidates = [token, ...(ALIASES.get(token) || [])];
  const fields = [
    [recipe.title, 5], [recipe.category, 4], [recipe.course, 3.5], [recipe.cuisine, 3],
    [recipe.keywords, 3], [recipe.ingredients, 2], [recipe.servings, 2], [recipe.time, 1.5],
  ];
  let best = 0;
  for (const candidate of candidates) {
    for (const [value, weight] of fields) {
      if (String(value || "").toLocaleLowerCase("en").includes(candidate)) {
        best = Math.max(best, weight);
      }
    }
  }
  return best;
}

function score(recipe, queryTokens) {
  const scores = queryTokens.map((token) => fieldScore(recipe, token));
  const matched = scores.filter(Boolean).length;
  const coverage = queryTokens.length ? matched / queryTokens.length : 1;
  if (coverage < 0.6) return 0;
  return scores.reduce((sum, value) => sum + value, 0) + coverage * 2;
}

function announce(value) {
  status.textContent = value;
}

function render() {
  const queryTokens = tokens(queryInput.value);
  let visible;
  if (!queryTokens.length) {
    visible = data.map((recipe) => recipe.slug);
    label.textContent = "The cookbook · ranked by popularity";
  } else {
    visible = data
      .map((recipe) => [recipe, score(recipe, queryTokens)])
      .filter(([, value]) => value > 0)
      .sort((a, b) => (b[1] - a[1]) || (b[0].popularity - a[0].popularity))
      .map(([recipe]) => recipe.slug);
    label.textContent = "Results · best match first";
  }

  for (const row of rows.values()) row.hidden = true;
  visible.forEach((slug, index) => {
    const row = rows.get(slug);
    if (!row) return;
    row.hidden = false;
    row.querySelector(".rank").textContent = String(index + 1).padStart(2, "0");
    list.appendChild(row);
  });
  const message = `${visible.length} ${visible.length === 1 ? "recipe" : "recipes"}`;
  count.textContent = message;
  empty.classList.toggle("is-visible", visible.length === 0);
  announce(queryTokens.length ? `${message} found` : `${message} in the cookbook`);
}

function showRecents() {
  try {
    const seen = JSON.parse(localStorage.getItem("potbelly-recents") || "[]");
    if (!Array.isArray(seen)) return;
    const box = document.querySelector("#recentItems");
    for (const slug of seen.slice(0, 5)) {
      const recipe = data.find((item) => item.slug === slug);
      if (!recipe) continue;
      const anchor = document.createElement("a");
      anchor.href = `/recipe/${encodeURIComponent(recipe.slug)}`;
      anchor.textContent = recipe.title;
      box.appendChild(anchor);
    }
    if (box.children.length) document.querySelector("#recents").classList.add("is-visible");
  } catch {
    localStorage.removeItem("potbelly-recents");
  }
}

async function start() {
  try {
    const response = await fetch("/search-index.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Search index returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Search index is invalid");
    data = payload.filter((item) => typeof item.slug === "string" && rows.has(item.slug));
    queryInput.disabled = false;
    document.querySelectorAll(".chips button").forEach((button) => { button.disabled = false; });
    showRecents();
    render();
  } catch (error) {
    queryInput.disabled = true;
    announce("Search is temporarily unavailable. The full cookbook remains below.");
    console.error("Potbelly search failed", error);
  }
}

queryInput.addEventListener("input", render);
document.querySelectorAll(".chips button[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query;
    render();
    queryInput.focus();
  });
});
document.querySelector("#surprise").addEventListener("click", () => {
  if (!data.length) return;
  const recipe = data[Math.floor(Math.random() * data.length)];
  location.assign(`/recipe/${encodeURIComponent(recipe.slug)}`);
});

start();

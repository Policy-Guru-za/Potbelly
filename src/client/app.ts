import "../styles/site.css";
import type { SearchRecipe } from "../domain/types";
import { getRecents } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import { searchRecipes, tokenize } from "./search";
import { initialiseShell } from "./shell";

const queryInput = requiredElement<HTMLInputElement>("#q");
const list = requiredElement<HTMLOListElement>("#results");
const empty = requiredElement<HTMLElement>("#empty");
const label = requiredElement<HTMLElement>("#listLabel");
const count = requiredElement<HTMLElement>("#listCount");
const rows = new Map([...document.querySelectorAll<HTMLElement>("#results li[data-slug]")]
  .map((row) => [row.dataset.slug ?? "", row]));
let recipes: SearchRecipe[] = [];

function render(): void {
  const visible = searchRecipes(recipes, queryInput.value);
  const queryActive = tokenize(queryInput.value).length > 0;
  label.textContent = queryActive ? "Results · best match first" : "The cookbook · ranked by popularity";
  for (const row of rows.values()) row.hidden = true;
  visible.forEach((recipe, index) => {
    const row = rows.get(recipe.slug);
    if (!row) return;
    row.hidden = false;
    const rank = row.querySelector<HTMLElement>(".rank");
    if (rank) rank.textContent = String(index + 1).padStart(2, "0");
    list.append(row);
  });
  const message = `${visible.length} ${visible.length === 1 ? "recipe" : "recipes"}`;
  count.textContent = message;
  empty.classList.toggle("is-visible", visible.length === 0);
  setLiveMessage(queryActive ? `${message} found.` : `${message} in the cookbook.`);
}

async function showRecents(): Promise<void> {
  const recents = await getRecents();
  const box = requiredElement<HTMLElement>("#recentItems");
  for (const recipe of recents) {
    const anchor = document.createElement("a");
    anchor.href = `/recipe/${encodeURIComponent(recipe.slug)}`;
    anchor.textContent = recipe.title;
    box.append(anchor);
  }
  if (recents.length) requiredElement<HTMLElement>("#recents").classList.add("is-visible");
}

async function start(): Promise<void> {
  await initialiseShell();
  try {
    const response = await fetch("/search-index.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Search index returned ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Search index is invalid");
    recipes = (payload as SearchRecipe[]).filter((recipe) => typeof recipe.slug === "string" && rows.has(recipe.slug));
    queryInput.disabled = false;
    document.querySelectorAll<HTMLButtonElement>(".chips button").forEach((button) => { button.disabled = false; });
    await showRecents();
    render();
  } catch {
    setLiveMessage("Search is temporarily unavailable. The full cookbook remains below.");
  }
}

queryInput.addEventListener("input", render);
document.querySelectorAll<HTMLButtonElement>(".chips button[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query ?? "";
    render();
    queryInput.focus();
  });
});
requiredElement<HTMLButtonElement>("#surprise").addEventListener("click", () => {
  const recipe = recipes[Math.floor(Math.random() * recipes.length)];
  if (recipe) location.assign(`/recipe/${encodeURIComponent(recipe.slug)}`);
});

void start();

import "../styles/site.css";
import type { DiscoveryFilter, SearchRecipe, ShoppingItem } from "../domain/types";
import {
  clearShoppingItems, getActiveProgress, getFavourites, getRecents, getShoppingItems,
  toggleFavourite, updateShoppingItem,
} from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import { discoverRecipes, tokenize } from "./search";
import { initialiseShell } from "./shell";

const queryInput = requiredElement<HTMLInputElement>("#q");
const list = requiredElement<HTMLOListElement>("#results");
const empty = requiredElement<HTMLElement>("#empty");
const label = requiredElement<HTMLElement>("#listLabel");
const count = requiredElement<HTMLElement>("#listCount");
const showMore = requiredElement<HTMLButtonElement>("#showMore");
const rows = new Map([...document.querySelectorAll<HTMLElement>("#results li[data-slug]")]
  .map((row) => [row.dataset.slug ?? "", row]));
let recipes: SearchRecipe[] = [];
let favourites = new Set<string>();
let filter: DiscoveryFilter = "all";
let selected: SearchRecipe | null = null;
let visibleLimit = 24;

function setPreview(recipe: SearchRecipe | null): void {
  const link = requiredElement<HTMLAnchorElement>("#previewLink");
  const button = requiredElement<HTMLButtonElement>("#previewFavourite");
  if (!recipe) {
    selected = null;
    requiredElement<HTMLElement>("#previewEyebrow").textContent = "Recipe preview";
    requiredElement<HTMLElement>("#previewTitle").textContent = "No recipe selected";
    requiredElement<HTMLElement>("#previewDescription").textContent = "Adjust the search or filters to see matching recipes.";
    requiredElement<HTMLElement>("#previewTime").textContent = "—";
    requiredElement<HTMLElement>("#previewServes").textContent = "—";
    requiredElement<HTMLElement>("#previewSource").textContent = "";
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    button.disabled = true;
    button.textContent = "♡ Save favourite";
    return;
  }
  selected = recipe;
  requiredElement<HTMLElement>("#previewEyebrow").textContent = `${recipe.normalizedCourse} · ${recipe.cuisine}`;
  requiredElement<HTMLElement>("#previewTitle").textContent = recipe.title;
  requiredElement<HTMLElement>("#previewDescription").textContent = recipe.description;
  requiredElement<HTMLElement>("#previewTime").textContent = recipe.time || "Not stated";
  requiredElement<HTMLElement>("#previewServes").textContent = recipe.servings || "Not stated";
  requiredElement<HTMLElement>("#previewSource").textContent = `Adapted from ${recipe.sourceName}`;
  link.href = `/recipe/${encodeURIComponent(recipe.slug)}`;
  link.removeAttribute("aria-disabled");
  button.disabled = false;
  const saved = favourites.has(recipe.slug);
  button.textContent = saved ? "♥ Saved favourite" : "♡ Save favourite";
  button.setAttribute("aria-pressed", String(saved));
}

function render(): void {
  const matches = discoverRecipes(recipes, queryInput.value, filter);
  const visible = matches.slice(0, visibleLimit);
  const queryActive = tokenize(queryInput.value).length > 0;
  label.textContent = queryActive ? "Results · best match first" : "The cookbook · most loved";
  for (const row of rows.values()) row.hidden = true;
  visible.forEach((recipe, index) => {
    const row = rows.get(recipe.slug);
    if (!row) return;
    row.hidden = false;
    row.dataset.resultIndex = String(index);
    const rank = row.querySelector<HTMLElement>(".rank");
    if (rank) rank.textContent = String(index + 1).padStart(2, "0");
    list.append(row);
  });
  const message = `${matches.length} ${matches.length === 1 ? "recipe" : "recipes"}`;
  count.textContent = message;
  empty.classList.toggle("is-visible", matches.length === 0);
  showMore.hidden = visible.length >= matches.length;
  showMore.textContent = `Show ${Math.min(24, matches.length - visible.length)} more recipes`;
  if (!selected || !visible.some(({ slug }) => slug === selected?.slug)) setPreview(visible[0] ?? null);
  const shown = visible.length < matches.length ? ` Showing ${visible.length}.` : "";
  setLiveMessage(queryActive ? `${message} found.${shown}` : `${message} in the cookbook.${shown}`);
}

function renderLinks(container: HTMLElement, items: { slug: string; title: string }[], emptyCopy: string): void {
  container.replaceChildren();
  if (!items.length) {
    const paragraph = document.createElement("p");
    paragraph.textContent = emptyCopy;
    container.append(paragraph);
    return;
  }
  for (const item of items.slice(0, 4)) {
    const anchor = document.createElement("a");
    anchor.href = `/recipe/${encodeURIComponent(item.slug)}`;
    anchor.textContent = item.title;
    container.append(anchor);
  }
}

async function renderDashboard(): Promise<void> {
  const [saved, recents, progress] = await Promise.all([getFavourites(), getRecents(4), getActiveProgress()]);
  favourites = new Set(saved.map(({ slug }) => slug));
  renderLinks(requiredElement("#favouriteItems"), saved, "Save recipes you want close at hand.");
  renderLinks(requiredElement("#recentDashboard"), recents, "Your latest recipes will appear here.");
  const latest = progress[0];
  const recipe = latest ? recipes.find(({ slug }) => slug === latest.recipeSlug) : null;
  if (latest && recipe) {
    const card = requiredElement<HTMLElement>("#continueCard");
    card.hidden = false;
    requiredElement<HTMLElement>("#continueTitle").textContent = recipe.title;
    requiredElement<HTMLElement>("#continueMeta").textContent = `${latest.completedStepIds.length} steps complete · Resume →`;
    requiredElement<HTMLAnchorElement>("#continueLink").href = `/recipe/${encodeURIComponent(recipe.slug)}?cook=1`;
  }
}

async function renderShopping(): Promise<void> {
  const items = await getShoppingItems();
  requiredElement<HTMLElement>("#shoppingCount").textContent = String(items.filter(({ checked }) => !checked).length);
  const container = requiredElement<HTMLElement>("#shoppingItems");
  container.replaceChildren();
  requiredElement<HTMLElement>("#shoppingEmpty").hidden = items.length > 0;
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) groups.set(item.recipeTitle, [...(groups.get(item.recipeTitle) ?? []), item]);
  for (const [title, group] of groups) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.append(heading);
    for (const item of group) section.append(shoppingRow(item));
    container.append(section);
  }
}

function shoppingRow(item: ShoppingItem): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "shopping-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.checked;
  input.addEventListener("change", () => void updateShoppingItem(item.id, input.checked).then(renderShopping));
  const text = document.createElement("span");
  text.textContent = item.text;
  label.append(input, text);
  return label;
}

function bind(): void {
  queryInput.addEventListener("input", () => { visibleLimit = 24; render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    filter = button.dataset.filter as DiscoveryFilter;
    visibleLimit = 24;
    document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    render();
  }));
  showMore.addEventListener("click", () => { visibleLimit += 24; render(); });
  rows.forEach((row, slug) => {
    const select = (): void => setPreview(recipes.find((recipe) => recipe.slug === slug) ?? null);
    row.addEventListener("mouseenter", select);
    row.addEventListener("focusin", select);
  });
  requiredElement<HTMLButtonElement>("#previewFavourite").addEventListener("click", async () => {
    if (!selected) return;
    const saved = await toggleFavourite(selected);
    if (saved) favourites.add(selected.slug); else favourites.delete(selected.slug);
    setPreview(selected);
    await renderDashboard();
    render();
    setLiveMessage(saved ? `${selected.title} saved to favourites.` : `${selected.title} removed from favourites.`);
  });
  requiredElement<HTMLButtonElement>("#openShopping").addEventListener("click", () => requiredElement<HTMLDialogElement>("#shoppingDialog").showModal());
  requiredElement<HTMLButtonElement>("#clearShopping").addEventListener("click", () => void clearShoppingItems().then(renderShopping));
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
    bind();
    await renderDashboard();
    await renderShopping();
    render();
  } catch { setLiveMessage("Search is temporarily unavailable. The full cookbook remains below."); }
}

void start();

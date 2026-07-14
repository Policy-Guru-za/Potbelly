import {
  getRecipeNote, isFavourite, putShoppingItems, saveRecipeNote, toggleFavourite,
} from "../services/db";
import { debounce, requiredElement, setLiveMessage } from "../services/dom";

export async function initialiseRecipeData(slug: string, title: string): Promise<void> {
  const favourite = requiredElement<HTMLButtonElement>("#favouriteRecipe");
  const renderFavourite = (saved: boolean): void => {
    favourite.textContent = saved ? "♥ Favourited" : "♡ Favourite";
    favourite.setAttribute("aria-pressed", String(saved));
  };
  renderFavourite(await isFavourite(slug));
  favourite.addEventListener("click", async () => {
    const saved = await toggleFavourite({ slug, title });
    renderFavourite(saved);
    setLiveMessage(saved ? `${title} saved to favourites.` : `${title} removed from favourites.`);
  });

  requiredElement<HTMLButtonElement>("#addToShopping").addEventListener("click", async () => {
    const now = new Date().toISOString();
    const items = [...document.querySelectorAll<HTMLInputElement>("[data-ingredient-id]")].map((input) => ({
      id: `${slug}:${input.dataset.ingredientId ?? crypto.randomUUID()}`, recipeSlug: slug, recipeTitle: title,
      text: input.parentElement?.querySelector("span")?.textContent?.trim() ?? "Ingredient",
      checked: false, addedAt: now,
    }));
    await putShoppingItems(items);
    setLiveMessage(`${items.length} ingredients added to your shopping list.`);
  });

  requiredElement<HTMLButtonElement>("#shareRecipe").addEventListener("click", async () => {
    const data = { title, text: `Try ${title} in Potbelly`, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        setLiveMessage("Recipe link copied.");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setLiveMessage("Recipe could not be shared.");
    }
  });

  const note = requiredElement<HTMLTextAreaElement>("#personalNote");
  note.value = (await getRecipeNote(slug))?.text ?? "";
  const save = debounce(() => {
    void saveRecipeNote(slug, note.value).then(() => {
      requiredElement<HTMLElement>("#noteStatus").textContent = note.value.trim() ? "Saved on this iPad" : "";
    });
  }, 300);
  note.addEventListener("input", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saveRecipeNote(slug, note.value);
  });
}

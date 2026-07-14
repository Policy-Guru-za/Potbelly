import { describe, expect, it } from "vitest";
import type { SearchRecipe } from "../../src/domain/types";
import { discoverRecipes, normalizeSearchText, searchRecipes, tokenize } from "../../src/client/search";

function recipe(overrides: Partial<SearchRecipe>): SearchRecipe {
  return {
    slug: "recipe", title: "Recipe", category: "Mains", course: "Main Course",
    cuisine: "American", servings: "4", time: "30 min", ingredients: "stock",
    durationMinutes: 30, description: "A useful recipe.", sourceName: "Test Kitchen",
    primaryIngredients: "stock", normalizedCourse: "main", normalizedCuisine: "american",
    vegetarian: false, keywords: "weeknight", popularity: 1, ...overrides,
  };
}

const chicken = recipe({
  slug: "chicken", title: "Instant Pot Chicken", category: "Chicken", course: "Dinner",
  servings: "6", ingredients: "chicken stock", keywords: "weeknight main", popularity: 10,
});
const cake = recipe({
  slug: "cake", title: "Cheesecake", category: "Dessert", course: "Dessert",
  servings: "8", time: "1 hr", ingredients: "cream cheese", keywords: "sweet cake", popularity: 20,
});
const marsala = recipe({
  slug: "instant-pot-chicken-marsala", title: "Instant Pot Chicken Marsala",
  category: "Chicken", cuisine: "Italian", ingredients: "chicken mushrooms marsala wine",
  keywords: "marsala mushroom dinner", popularity: 8,
});
const ingredientOnly = recipe({
  slug: "beef-stew", title: "Hearty Beef Stew", category: "Beef",
  ingredients: "beef chicken stock carrots", popularity: 100,
});

describe("offline recipe search", () => {
  it("normalises capitalization, accents, punctuation, spacing, number words, and stop words", () => {
    expect(normalizeSearchText("  CRÈME—brûlée!!!  ")).toBe("creme brulee");
    expect(tokenize(" Dinner—FOR   SIX, please! ")).toEqual(["dinner", "6"]);
  });

  it("ranks exact and strong title matches above weaker metadata and ingredient matches", () => {
    expect(searchRecipes([ingredientOnly, chicken], "instant-pot chicken")[0]?.slug).toBe("chicken");
    expect(searchRecipes([ingredientOnly, chicken], "chicken")[0]?.slug).toBe("chicken");
  });

  it("supports useful title prefixes without broad arbitrary substrings", () => {
    expect(searchRecipes([chicken, cake], "cheesec").map(({ slug }) => slug)).toEqual(["cake"]);
    expect(searchRecipes([chicken, cake], "ake")).toEqual([]);
  });

  it("requires every meaningful term in a multi-word query", () => {
    expect(searchRecipes([cake, chicken], "weeknight chicken")[0]?.slug).toBe("chicken");
    expect(searchRecipes([cake, chicken], "dinner for six")[0]?.slug).toBe("chicken");
    expect(searchRecipes([cake, chicken], "unknown chicken impossible")).toEqual([]);
  });

  it("finds a representative recipe from the supplied expansion collection", () => {
    expect(searchRecipes([cake, marsala], "chicken marsala")[0]?.slug)
      .toBe("instant-pot-chicken-marsala");
    expect(searchRecipes([cake, marsala], "ITALIAN, mushrooms")[0]?.slug)
      .toBe("instant-pot-chicken-marsala");
  });

  it("combines quick filters, sorting, and favourites without changing routes", () => {
    const vegetarian = recipe({ slug: "dal", title: "Dal", normalizedCourse: "main", normalizedCuisine: "indian", vegetarian: true, durationMinutes: 20 });
    expect(discoverRecipes([cake, chicken, vegetarian], "", "vegetarian", "fastest").map(({ slug }) => slug)).toEqual(["dal"]);
    expect(discoverRecipes([cake, chicken], "", "all", "favourites", new Set(["chicken"])).map(({ slug }) => slug)).toEqual(["chicken"]);
  });

  it("keeps quick chicken intent focused on chicken rather than a supporting stock ingredient", () => {
    expect(discoverRecipes([ingredientOnly, chicken], "quick chicken dinner")[0]?.slug).toBe("chicken");
  });
});

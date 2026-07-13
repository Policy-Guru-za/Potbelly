import { describe, expect, it } from "vitest";
import type { SearchRecipe } from "../../src/domain/types";
import { normalizeSearchText, searchRecipes, tokenize } from "../../src/client/search";

function recipe(overrides: Partial<SearchRecipe>): SearchRecipe {
  return {
    slug: "recipe", title: "Recipe", category: "Mains", course: "Main Course",
    cuisine: "American", servings: "4", time: "30 min", ingredients: "stock",
    keywords: "weeknight", popularity: 1, ...overrides,
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
});

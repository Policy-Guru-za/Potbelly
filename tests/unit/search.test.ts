import { describe, expect, it } from "vitest";
import type { SearchRecipe } from "../../src/domain/types";
import { searchRecipes, tokenize } from "../../src/client/search";

const chicken: SearchRecipe = {
  slug: "chicken", title: "Instant Pot Chicken", category: "Chicken", course: "Dinner",
  cuisine: "American", servings: "6", time: "30 min", ingredients: "chicken stock",
  keywords: "weeknight main", popularity: 10,
};
const cake: SearchRecipe = {
  slug: "cake", title: "Cheesecake", category: "Dessert", course: "Dessert",
  cuisine: "American", servings: "8", time: "1 hr", ingredients: "cream cheese",
  keywords: "sweet cake", popularity: 20,
};

describe("offline recipe search", () => {
  it("normalises natural number words and stop words", () => {
    expect(tokenize("Dinner for six please")).toEqual(["dinner", "6"]);
  });

  it("ranks intent matches and rejects poor coverage", () => {
    expect(searchRecipes([cake, chicken], "weeknight chicken")[0]?.slug).toBe("chicken");
    expect(searchRecipes([cake, chicken], "unknown chicken impossible")).toEqual([]);
  });
});

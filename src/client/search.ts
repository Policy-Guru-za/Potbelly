import type { SearchRecipe } from "../domain/types";

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

export function tokenize(value: string): string[] {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean).filter((token) => !STOP_WORDS.has(token))
    .map((token) => NUMBER_WORDS.get(token) ?? token);
}

function fieldScore(recipe: SearchRecipe, token: string): number {
  const candidates = [token, ...(ALIASES.get(token) ?? [])];
  const fields: Array<[string, number]> = [
    [recipe.title, 5], [recipe.category, 4], [recipe.course, 3.5], [recipe.cuisine, 3],
    [recipe.keywords, 3], [recipe.ingredients, 2], [recipe.servings, 2], [recipe.time, 1.5],
  ];
  return candidates.reduce((best, candidate) => fields.reduce((score, [value, weight]) =>
    value.toLocaleLowerCase("en").includes(candidate) ? Math.max(score, weight) : score, best), 0);
}

export function searchRecipes(recipes: SearchRecipe[], query: string): SearchRecipe[] {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [...recipes].sort((a, b) => b.popularity - a.popularity);
  return recipes.map((recipe) => {
    const scores = queryTokens.map((token) => fieldScore(recipe, token));
    const coverage = scores.filter(Boolean).length / queryTokens.length;
    return { recipe, score: coverage < 0.6 ? 0 : scores.reduce((sum, value) => sum + value, 0) + coverage * 2 };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.recipe.popularity - a.recipe.popularity)
    .map(({ recipe }) => recipe);
}

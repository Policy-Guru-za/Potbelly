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

interface SearchField {
  value: string;
  exactWeight: number;
}

interface RankedRecipe {
  recipe: SearchRecipe;
  score: number;
}

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(value: string): string[] {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean).filter((token) => !STOP_WORDS.has(token))
    .map((token) => NUMBER_WORDS.get(token) ?? token);
}

function tokenMatchScore(fieldValue: string, queryToken: string, exactWeight: number): number {
  const fieldTokens = tokenize(fieldValue);
  if (fieldTokens.includes(queryToken)) return exactWeight;
  if (queryToken.length < 3) return 0;
  if (fieldTokens.some((fieldToken) => fieldToken.startsWith(queryToken))) {
    return exactWeight * 0.72;
  }
  return 0;
}

function fieldScore(recipe: SearchRecipe, token: string): number {
  const candidates = [token, ...(ALIASES.get(token) ?? [])];
  const fields: SearchField[] = [
    { value: recipe.title, exactWeight: 90 },
    { value: recipe.category, exactWeight: 48 },
    { value: recipe.course, exactWeight: 42 },
    { value: recipe.cuisine, exactWeight: 36 },
    { value: recipe.keywords, exactWeight: 34 },
    { value: recipe.ingredients, exactWeight: 18 },
    { value: recipe.servings, exactWeight: 14 },
    { value: recipe.time, exactWeight: 8 },
  ];
  return candidates.reduce((best, candidate) => fields.reduce((score, field) =>
    Math.max(score, tokenMatchScore(field.value, candidate, field.exactWeight)), best), 0);
}

function titleBonus(recipe: SearchRecipe, queryTokens: string[]): number {
  const titleTokens = tokenize(recipe.title);
  const queryPhrase = queryTokens.join(" ");
  const titlePhrase = titleTokens.join(" ");
  if (titlePhrase === queryPhrase) return 1_200;
  if (titlePhrase.startsWith(queryPhrase)) return 900;
  if (` ${titlePhrase} `.includes(` ${queryPhrase} `)) return 760;
  if (queryTokens.every((token) => titleTokens.includes(token))) return 560;
  return 0;
}

function rankRecipe(recipe: SearchRecipe, queryTokens: string[]): RankedRecipe | null {
  const tokenScores = queryTokens.map((token) => fieldScore(recipe, token));
  if (tokenScores.some((score) => score === 0)) return null;
  return {
    recipe,
    score: titleBonus(recipe, queryTokens) + tokenScores.reduce((sum, score) => sum + score, 0),
  };
}

export function searchRecipes(recipes: SearchRecipe[], query: string): SearchRecipe[] {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return [...recipes].sort((a, b) => b.popularity - a.popularity
      || a.title.localeCompare(b.title, "en") || a.slug.localeCompare(b.slug, "en"));
  }
  return recipes.map((recipe) => rankRecipe(recipe, queryTokens))
    .filter((result): result is RankedRecipe => result !== null)
    .sort((a, b) => b.score - a.score || b.recipe.popularity - a.recipe.popularity
      || a.recipe.title.localeCompare(b.recipe.title, "en")
      || a.recipe.slug.localeCompare(b.recipe.slug, "en"))
    .map(({ recipe }) => recipe);
}

export interface CookingProgress {
  recipeSlug: string;
  checkedIngredientIds: string[];
  completedStepIds: string[];
  activeStepId: string | null;
  timers: CookingTimer[];
  updatedAt: string;
}

export interface CookingTimer {
  id: string;
  recipeSlug: string;
  stepId: string;
  label: string;
  durationSeconds: number;
  endsAt: string;
  createdAt: string;
}

export interface LocalPreferences {
  textScale: "standard" | "large" | "extra-large";
  cloudVoiceConsentVersion: string | null;
  installationHelpDismissed: boolean;
  storagePersistenceResult: "granted" | "declined" | "unsupported" | null;
}

export interface RecentRecipe {
  slug: string;
  title: string;
  viewedAt: string;
}

export interface FavouriteRecipe {
  slug: string;
  title: string;
  savedAt: string;
}

export interface ShoppingItem {
  id: string;
  recipeSlug: string;
  recipeTitle: string;
  text: string;
  checked: boolean;
  addedAt: string;
}

export interface RecipeNote {
  recipeSlug: string;
  text: string;
  updatedAt: string;
}

export interface SearchRecipe {
  slug: string;
  title: string;
  category: string;
  course: string;
  cuisine: string;
  servings: string;
  time: string;
  durationMinutes: number | null;
  description: string;
  sourceName: string;
  primaryIngredients: string;
  normalizedCourse: "breakfast" | "main" | "side" | "soup" | "dessert" | "snack" | "drink" | "other";
  normalizedCuisine: string;
  vegetarian: boolean;
  ingredients: string;
  keywords: string;
  popularity: number;
}

export type DiscoveryFilter = "all" | "under-30" | "chicken" | "beef" | "vegetarian" | "soup" | "dessert" | "indian";
export type DiscoverySort = "popular" | "fastest" | "alphabetical" | "favourites";

export interface PotbellyBackupV1 {
  format: "potbelly-backup";
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  progress: CookingProgress[];
  favourites: FavouriteRecipe[];
  shopping: ShoppingItem[];
  notes: RecipeNote[];
  recents: RecentRecipe[];
  preferences: Pick<LocalPreferences, "textScale" | "installationHelpDismissed">;
}

export interface RealtimeSessionRequest {
  mode: "typed" | "voice";
  recipeSlug: string;
  anonymousDeviceId: string;
  activeStepId: string | null;
  checkedIngredientIds: string[];
  completedStepIds: string[];
}

export interface RealtimeSessionResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  promptVersion: string;
  instructions: string;
}

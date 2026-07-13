export interface CookingProgress {
  recipeSlug: string;
  checkedIngredientIds: string[];
  completedStepIds: string[];
  activeStepId: string | null;
  updatedAt: string;
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

export interface SearchRecipe {
  slug: string;
  title: string;
  category: string;
  course: string;
  cuisine: string;
  servings: string;
  time: string;
  ingredients: string;
  keywords: string;
  popularity: number;
}

export interface RealtimeSessionRequest {
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

import { type DBSchema, openDB } from "idb";
import type {
  CookingProgress, FavouriteRecipe, LocalPreferences, RecentRecipe, RecipeNote, ShoppingItem,
} from "../domain/types";

interface PotbellyDatabase extends DBSchema {
  progress: { key: string; value: CookingProgress };
  settings: { key: string; value: LocalPreferences };
  recents: { key: string; value: RecentRecipe };
  favourites: { key: string; value: FavouriteRecipe };
  shopping: { key: string; value: ShoppingItem };
  notes: { key: string; value: RecipeNote };
  meta: { key: string; value: { key: string; value: string } };
}

const DEFAULT_PREFERENCES: LocalPreferences = {
  textScale: "standard",
  cloudVoiceConsentVersion: null,
  installationHelpDismissed: false,
  storagePersistenceResult: null,
};

const database = openDB<PotbellyDatabase>("potbelly", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("progress");
      db.createObjectStore("settings");
      db.createObjectStore("recents");
      db.createObjectStore("meta");
    }
    if (oldVersion < 2) {
      db.createObjectStore("favourites");
      db.createObjectStore("shopping");
      db.createObjectStore("notes");
    }
  },
});

function progressRecoveryKey(recipeSlug: string): string {
  return `potbelly-progress-recovery:${recipeSlug}`;
}

function serializedProgress(progress: CookingProgress): string {
  return JSON.stringify(progress);
}

function recoveryProgress(recipeSlug: string): CookingProgress | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(progressRecoveryKey(recipeSlug)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<CookingProgress>;
    if (candidate.recipeSlug !== recipeSlug || typeof candidate.updatedAt !== "string" ||
        !Array.isArray(candidate.checkedIngredientIds) || !Array.isArray(candidate.completedStepIds)) return null;
    return candidate as CookingProgress;
  } catch {
    return null;
  }
}

export async function loadProgress(recipeSlug: string): Promise<CookingProgress | null> {
  const recovery = recoveryProgress(recipeSlug);
  const saved = await (await database).get("progress", recipeSlug) ?? null;
  if (!recovery) return saved ? { ...saved, timers: saved.timers ?? [] } : null;
  if (saved && saved.updatedAt > recovery.updatedAt) return { ...saved, timers: saved.timers ?? [] };
  if (saved && serializedProgress(saved) === serializedProgress(recovery)) return { ...saved, timers: saved.timers ?? [] };
  void saveProgress(recovery);
  return { ...recovery, timers: recovery.timers ?? [] };
}

export async function getActiveProgress(): Promise<CookingProgress[]> {
  return (await (await database).getAll("progress"))
    .map((progress) => ({ ...progress, timers: progress.timers ?? [] }))
    .filter((progress) => progress.activeStepId !== null || progress.checkedIngredientIds.length > 0 || progress.completedStepIds.length > 0)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function stageProgressRecovery(progress: CookingProgress): CookingProgress {
  const snapshot = structuredClone(progress);
  localStorage.setItem(progressRecoveryKey(snapshot.recipeSlug), serializedProgress(snapshot));
  return snapshot;
}

export async function commitProgress(snapshot: CookingProgress): Promise<void> {
  const key = progressRecoveryKey(snapshot.recipeSlug);
  await (await database).put("progress", snapshot, snapshot.recipeSlug);
  if (localStorage.getItem(key) === serializedProgress(snapshot)) localStorage.removeItem(key);
}

export async function saveProgress(progress: CookingProgress): Promise<void> {
  await commitProgress(stageProgressRecovery(progress));
}

export async function resetProgress(recipeSlug: string): Promise<void> {
  localStorage.removeItem(progressRecoveryKey(recipeSlug));
  await (await database).delete("progress", recipeSlug);
}

export async function getPreferences(): Promise<LocalPreferences> {
  const value = await (await database).get("settings", "current");
  return value ?? DEFAULT_PREFERENCES;
}

export async function updatePreferences(change: Partial<LocalPreferences>): Promise<LocalPreferences> {
  const db = await database;
  const next = { ...(await db.get("settings", "current") ?? DEFAULT_PREFERENCES), ...change };
  await db.put("settings", next, "current");
  return next;
}

export async function addRecent(recipe: RecentRecipe): Promise<void> {
  await (await database).put("recents", recipe, recipe.slug);
}

export async function getRecents(limit = 5): Promise<RecentRecipe[]> {
  const values = await (await database).getAll("recents");
  return values.sort((left, right) => right.viewedAt.localeCompare(left.viewedAt)).slice(0, limit);
}

export async function getAllRecents(): Promise<RecentRecipe[]> {
  return (await (await database).getAll("recents"))
    .sort((left, right) => right.viewedAt.localeCompare(left.viewedAt));
}

export async function getFavourites(): Promise<FavouriteRecipe[]> {
  return (await (await database).getAll("favourites"))
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function isFavourite(slug: string): Promise<boolean> {
  return Boolean(await (await database).get("favourites", slug));
}

export async function toggleFavourite(recipe: Pick<FavouriteRecipe, "slug" | "title">): Promise<boolean> {
  const db = await database;
  if (await db.get("favourites", recipe.slug)) {
    await db.delete("favourites", recipe.slug);
    return false;
  }
  await db.put("favourites", { ...recipe, savedAt: new Date().toISOString() }, recipe.slug);
  return true;
}

export async function getShoppingItems(): Promise<ShoppingItem[]> {
  return (await (await database).getAll("shopping"))
    .sort((left, right) => left.addedAt.localeCompare(right.addedAt));
}

export async function putShoppingItems(items: ShoppingItem[]): Promise<void> {
  const db = await database;
  const transaction = db.transaction("shopping", "readwrite");
  for (const item of items) await transaction.store.put(item, item.id);
  await transaction.done;
}

export async function updateShoppingItem(id: string, checked: boolean): Promise<void> {
  const db = await database;
  const item = await db.get("shopping", id);
  if (item) await db.put("shopping", { ...item, checked }, id);
}

export async function clearShoppingItems(): Promise<void> {
  await (await database).clear("shopping");
}

export async function getRecipeNote(recipeSlug: string): Promise<RecipeNote | null> {
  return await (await database).get("notes", recipeSlug) ?? null;
}

export async function saveRecipeNote(recipeSlug: string, text: string): Promise<void> {
  const db = await database;
  if (!text.trim()) await db.delete("notes", recipeSlug);
  else await db.put("notes", { recipeSlug, text, updatedAt: new Date().toISOString() }, recipeSlug);
}

export async function exportLocalData(): Promise<{
  progress: CookingProgress[]; favourites: FavouriteRecipe[]; shopping: ShoppingItem[];
  notes: RecipeNote[]; recents: RecentRecipe[]; preferences: LocalPreferences;
}> {
  const db = await database;
  const [progress, favourites, shopping, notes, recents, preferences] = await Promise.all([
    db.getAll("progress"), db.getAll("favourites"), db.getAll("shopping"), db.getAll("notes"),
    db.getAll("recents"), getPreferences(),
  ]);
  return { progress, favourites, shopping, notes, recents, preferences };
}

export async function replaceLocalData(data: {
  progress: CookingProgress[]; favourites: FavouriteRecipe[]; shopping: ShoppingItem[];
  notes: RecipeNote[]; recents: RecentRecipe[]; preferences: LocalPreferences;
}): Promise<void> {
  const db = await database;
  const transaction = db.transaction(
    ["progress", "favourites", "shopping", "notes", "recents", "settings"], "readwrite",
  );
  await Promise.all([
    transaction.objectStore("progress").clear(), transaction.objectStore("favourites").clear(),
    transaction.objectStore("shopping").clear(), transaction.objectStore("notes").clear(),
    transaction.objectStore("recents").clear(), transaction.objectStore("settings").clear(),
  ]);
  for (const item of data.progress) await transaction.objectStore("progress").put(item, item.recipeSlug);
  for (const item of data.favourites) await transaction.objectStore("favourites").put(item, item.slug);
  for (const item of data.shopping) await transaction.objectStore("shopping").put(item, item.id);
  for (const item of data.notes) await transaction.objectStore("notes").put(item, item.recipeSlug);
  for (const item of data.recents) await transaction.objectStore("recents").put(item, item.slug);
  await transaction.objectStore("settings").put(data.preferences, "current");
  await transaction.done;
}

export async function getDeviceId(): Promise<string> {
  const db = await database;
  const existing = await db.get("meta", "device-id");
  if (existing) return existing.value;
  const value = crypto.randomUUID();
  await db.put("meta", { key: "device-id", value }, "device-id");
  return value;
}

export async function requestPersistentStorage(): Promise<LocalPreferences["storagePersistenceResult"]> {
  if (!navigator.storage?.persist) return "unsupported";
  const result = await navigator.storage.persist();
  const value = result ? "granted" : "declined";
  await updatePreferences({ storagePersistenceResult: value });
  return value;
}

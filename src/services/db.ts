import { type DBSchema, openDB } from "idb";
import type { CookingProgress, LocalPreferences, RecentRecipe } from "../domain/types";

interface PotbellyDatabase extends DBSchema {
  progress: { key: string; value: CookingProgress };
  settings: { key: string; value: LocalPreferences };
  recents: { key: string; value: RecentRecipe };
  meta: { key: string; value: { key: string; value: string } };
}

const DEFAULT_PREFERENCES: LocalPreferences = {
  textScale: "standard",
  cloudVoiceConsentVersion: null,
  installationHelpDismissed: false,
  storagePersistenceResult: null,
};

const database = openDB<PotbellyDatabase>("potbelly", 1, {
  upgrade(db) {
    db.createObjectStore("progress");
    db.createObjectStore("settings");
    db.createObjectStore("recents");
    db.createObjectStore("meta");
  },
});

function progressRecoveryKey(recipeSlug: string): string {
  return `potbelly-progress-recovery:${recipeSlug}`;
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
  const saved = await (await database).get("progress", recipeSlug) ?? null;
  const recovery = recoveryProgress(recipeSlug);
  if (!recovery || (saved && saved.updatedAt >= recovery.updatedAt)) return saved;
  void saveProgress(recovery);
  return recovery;
}

export async function saveProgress(progress: CookingProgress): Promise<void> {
  const snapshot = structuredClone(progress);
  const key = progressRecoveryKey(snapshot.recipeSlug);
  localStorage.setItem(key, JSON.stringify(snapshot));
  await (await database).put("progress", snapshot, snapshot.recipeSlug);
  if (recoveryProgress(snapshot.recipeSlug)?.updatedAt === snapshot.updatedAt) localStorage.removeItem(key);
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

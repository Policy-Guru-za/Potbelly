import { z } from "zod";
import type { LocalPreferences, PotbellyBackupV1 } from "../domain/types";
import { exportLocalData, replaceLocalData } from "./db";

const isoDate = z.iso.datetime({ offset: true });
const shortText = z.string().max(20_000);
const timerSchema = z.object({
  id: z.string().min(1).max(100), recipeSlug: z.string().min(1).max(160), stepId: z.string().min(1).max(100),
  label: z.string().min(1).max(180), durationSeconds: z.number().int().positive().max(172_800),
  endsAt: isoDate, createdAt: isoDate,
});
const progressSchema = z.object({
  recipeSlug: z.string().min(1).max(160), checkedIngredientIds: z.array(z.string().max(100)).max(300),
  completedStepIds: z.array(z.string().max(100)).max(100), activeStepId: z.string().max(100).nullable(),
  timers: z.array(timerSchema).max(20).default([]), updatedAt: isoDate,
});
const backupSchema = z.object({
  format: z.literal("potbelly-backup"), schemaVersion: z.literal(1), exportedAt: isoDate,
  appVersion: z.string().min(1).max(40), progress: z.array(progressSchema).max(200),
  favourites: z.array(z.object({ slug: z.string().min(1).max(160), title: z.string().min(1).max(300), savedAt: isoDate })).max(200),
  shopping: z.array(z.object({
    id: z.string().min(1).max(200), recipeSlug: z.string().min(1).max(160), recipeTitle: z.string().min(1).max(300),
    text: z.string().min(1).max(2_000), checked: z.boolean(), addedAt: isoDate,
  })).max(2_000),
  notes: z.array(z.object({ recipeSlug: z.string().min(1).max(160), text: shortText, updatedAt: isoDate })).max(200),
  recents: z.array(z.object({ slug: z.string().min(1).max(160), title: z.string().min(1).max(300), viewedAt: isoDate })).max(200),
  preferences: z.object({ textScale: z.enum(["standard", "large", "extra-large"]), installationHelpDismissed: z.boolean() }),
});

const currentPreferences = (preferences: PotbellyBackupV1["preferences"]): LocalPreferences => ({
  ...preferences, cloudVoiceConsentVersion: null, storagePersistenceResult: null,
});

export async function createBackup(appVersion = "2.0.0"): Promise<PotbellyBackupV1> {
  const data = await exportLocalData();
  return {
    format: "potbelly-backup", schemaVersion: 1, exportedAt: new Date().toISOString(), appVersion,
    progress: data.progress.map((progress) => ({ ...progress, timers: progress.timers ?? [] })),
    favourites: data.favourites, shopping: data.shopping, notes: data.notes, recents: data.recents,
    preferences: {
      textScale: data.preferences.textScale,
      installationHelpDismissed: data.preferences.installationHelpDismissed,
    },
  };
}

export async function downloadBackup(): Promise<void> {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const stamp = backup.exportedAt.slice(0, 16).replace("T", "-").replace(":", "");
  const file = new File([blob], `potbelly-backup-${stamp}.json`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Potbelly backup" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function readBackup(file: File): Promise<PotbellyBackupV1> {
  if (!file.name.toLocaleLowerCase("en").endsWith(".json")) throw new Error("Choose a Potbelly JSON backup.");
  if (file.size > 5 * 1024 * 1024) throw new Error("That backup is larger than 5 MiB.");
  let source: unknown;
  try { source = JSON.parse(await file.text()); } catch { throw new Error("That file is not valid JSON."); }
  const parsed = backupSchema.safeParse(source);
  if (!parsed.success) throw new Error("That backup is damaged or uses an unsupported format.");
  return parsed.data;
}

export async function restoreBackup(backup: PotbellyBackupV1): Promise<void> {
  await replaceLocalData({
    progress: backup.progress, favourites: backup.favourites, shopping: backup.shopping,
    notes: backup.notes, recents: backup.recents, preferences: currentPreferences(backup.preferences),
  });
}

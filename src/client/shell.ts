import { requestPersistentStorage } from "../services/db";
import type { PotbellyBackupV1 } from "../domain/types";
import { downloadBackup, readBackup, restoreBackup } from "../services/backup";
import { requiredElement, setLiveMessage } from "../services/dom";
import { registerPwa, watchConnectivity, type UpdateController } from "../services/pwa";

function openDialog(id: string): void {
  requiredElement<HTMLDialogElement>(id).showModal();
}

export async function initialiseShell(): Promise<void> {
  document.documentElement.classList.toggle("is-standalone", matchMedia("(display-mode: standalone)").matches);
  const network = requiredElement<HTMLElement>("#networkStatus");
  watchConnectivity((online) => {
    document.documentElement.classList.toggle("is-offline", !online);
    network.textContent = online ? "Online" : "Offline — cookbook ready";
    network.dataset.state = online ? "online" : "offline";
    setLiveMessage(online ? "You are back online." : "You are offline. Saved recipes remain available.");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => openDialog(button.dataset.openDialog ?? ""));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  const storageButton = document.querySelector<HTMLButtonElement>("#protectStorage");
  storageButton?.addEventListener("click", async () => {
    storageButton.disabled = true;
    const result = await requestPersistentStorage();
    const message = result === "granted"
      ? "This iPad accepted the storage protection request. Backups are still sensible."
      : "iPadOS did not guarantee storage protection. Your cooking progress still saves locally.";
    requiredElement<HTMLElement>("#storageResult").textContent = message;
    storageButton.disabled = false;
  });

  document.querySelector<HTMLButtonElement>("#exportBackup")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await downloadBackup();
      setLiveMessage("Potbelly backup ready.");
    } catch { setLiveMessage("Backup export was cancelled or could not be completed."); }
    button.disabled = false;
  });
  const importInput = document.querySelector<HTMLInputElement>("#importBackup");
  const confirm = document.querySelector<HTMLElement>("#importConfirm");
  const replaceButton = document.querySelector<HTMLButtonElement>("#replaceLocalData");
  let selectedBackup: PotbellyBackupV1 | null = null;
  importInput?.addEventListener("change", async () => {
    selectedBackup = null;
    const selectedFile = importInput.files?.[0] ?? null;
    if (!selectedFile || !confirm) return;
    confirm.hidden = false;
    if (replaceButton) replaceButton.disabled = true;
    const summary = requiredElement<HTMLElement>("#importSummary");
    summary.textContent = "Checking backup…";
    try {
      selectedBackup = await readBackup(selectedFile);
      const itemCount = selectedBackup.favourites.length + selectedBackup.shopping.length + selectedBackup.notes.length;
      summary.textContent = `${selectedFile.name} contains ${selectedBackup.progress.length} cooking ${selectedBackup.progress.length === 1 ? "session" : "sessions"} and ${itemCount} saved ${itemCount === 1 ? "item" : "items"}. Replace this iPad's local Potbelly data?`;
      if (replaceButton) replaceButton.disabled = false;
    } catch (error) {
      summary.textContent = error instanceof Error ? error.message : "That backup could not be checked.";
    }
  });
  document.querySelector<HTMLButtonElement>("#cancelImport")?.addEventListener("click", () => {
    selectedBackup = null;
    if (importInput) importInput.value = "";
    if (confirm) confirm.hidden = true;
    if (replaceButton) replaceButton.disabled = true;
  });
  document.querySelector<HTMLButtonElement>("#replaceLocalData")?.addEventListener("click", async (event) => {
    if (!selectedBackup) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await restoreBackup(selectedBackup);
      setLiveMessage("Backup restored. Reloading Potbelly.");
      location.reload();
    } catch (error) {
      requiredElement<HTMLElement>("#importSummary").textContent = error instanceof Error ? error.message : "That backup could not be imported.";
      button.disabled = false;
    }
  });

  const updateBar = requiredElement<HTMLElement>("#updateBar");
  let update: UpdateController | null = null;
  void registerPwa((controller) => {
    update = controller;
    updateBar.hidden = false;
    setLiveMessage("An update is available.");
  });
  requiredElement<HTMLButtonElement>("#applyUpdate").addEventListener("click", async () => {
    const button = requiredElement<HTMLButtonElement>("#applyUpdate");
    button.disabled = true;
    button.textContent = "Updating…";
    await update?.apply();
  });
}

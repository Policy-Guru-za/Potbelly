import { requestPersistentStorage } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import { registerPwa, watchConnectivity, type UpdateController } from "../services/pwa";

function openDialog(id: string): void {
  requiredElement<HTMLDialogElement>(id).showModal();
}

export async function initialiseShell(): Promise<void> {
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

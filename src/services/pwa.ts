export interface UpdateController {
  apply(): Promise<void>;
}

export async function registerPwa(onUpdate: (controller: UpdateController) => void): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // The app remains fully usable online if an update artifact is temporarily invalid.
    return;
  }
  let updateAccepted = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateAccepted) return;
    updateAccepted = false;
    location.reload();
  });

  const announce = (worker: ServiceWorker | null): void => {
    if (!worker) return;
    onUpdate({
      apply() {
        updateAccepted = true;
        worker.postMessage({ type: "SKIP_WAITING" });
        return Promise.resolve();
      },
    });
  };

  if (registration.waiting) announce(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) announce(worker);
    });
  });
}

export function watchConnectivity(onChange: (online: boolean) => void): () => void {
  const update = (): void => onChange(navigator.onLine);
  addEventListener("online", update);
  addEventListener("offline", update);
  update();
  return () => {
    removeEventListener("online", update);
    removeEventListener("offline", update);
  };
}

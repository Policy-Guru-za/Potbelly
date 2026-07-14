import type { CookingProgress, CookingTimer, LocalPreferences } from "../domain/types";
import {
  commitProgress, getPreferences, loadProgress, resetProgress, stageProgressRecovery, updatePreferences,
} from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";

interface Snapshot {
  checkedIngredientIds: string[];
  completedStepIds: string[];
  activeStepId: string | null;
  timers: CookingTimer[];
}

export class CookingController extends EventTarget {
  readonly recipeSlug: string;
  private readonly ingredientInputs = [...document.querySelectorAll<HTMLInputElement>("[data-ingredient-id]")];
  private readonly steps = [...document.querySelectorAll<HTMLElement>("[data-step-id]")];
  private progress: CookingProgress;
  private history: Snapshot[] = [];
  private persistQueue: Promise<void> = Promise.resolve();
  private timerInterval = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private preferences: LocalPreferences | null = null;
  private readonly notifiedTimers = new Set<string>();
  private audioContext: AudioContext | null = null;

  constructor(recipeSlug: string) {
    super();
    this.recipeSlug = recipeSlug;
    this.progress = this.emptyProgress();
  }

  async initialise(): Promise<void> {
    [this.progress, this.preferences] = [
      await loadProgress(this.recipeSlug) ?? this.emptyProgress(), await getPreferences(),
    ];
    this.progress.timers ??= [];
    this.bind();
    this.addTimerActions();
    this.applyTextScale();
    this.render();
    this.timerInterval = window.setInterval(() => this.renderTimers(), 1_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.persist();
      else if (document.body.classList.contains("cooking-mode")) void this.requestWakeLock();
    });
    if (new URLSearchParams(location.search).get("cook") === "1") this.enterCookingMode();
  }

  getState(): CookingProgress { return structuredClone(this.progress); }

  setActiveStep(stepId: string): string {
    if (!this.steps.some((step) => step.dataset.stepId === stepId)) return "Unknown step.";
    this.snapshot();
    this.progress.activeStepId = stepId;
    this.changed(`Step ${this.stepNumber(stepId)} is now active.`);
    return "Active step updated.";
  }

  markStepComplete(stepId: string): string {
    const index = this.steps.findIndex((step) => step.dataset.stepId === stepId);
    if (index < 0) return "Unknown step.";
    this.snapshot();
    this.progress.completedStepIds = [...new Set([...this.progress.completedStepIds, stepId])];
    this.progress.activeStepId = this.steps[index + 1]?.dataset.stepId ?? stepId;
    this.changed(index === this.steps.length - 1 ? "Every step is complete. Dinner is ready." : `Step ${index + 1} complete. Moving on.`);
    this.scrollToActive();
    return "Step marked complete.";
  }

  markIngredientReady(ingredientId: string): string {
    if (!this.ingredientInputs.some((input) => input.dataset.ingredientId === ingredientId)) return "Unknown ingredient.";
    this.snapshot();
    this.progress.checkedIngredientIds = [...new Set([...this.progress.checkedIngredientIds, ingredientId])];
    this.changed("Ingredient marked ready.");
    return "Ingredient marked ready.";
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    Object.assign(this.progress, previous);
    this.changed("Last cooking change undone.");
  }

  private emptyProgress(): CookingProgress {
    return {
      recipeSlug: this.recipeSlug, checkedIngredientIds: [], completedStepIds: [], activeStepId: null,
      timers: [], updatedAt: new Date().toISOString(),
    };
  }

  private bind(): void {
    this.ingredientInputs.forEach((input) => input.addEventListener("change", () => {
      this.snapshot();
      const id = input.dataset.ingredientId ?? "";
      this.progress.checkedIngredientIds = input.checked
        ? [...new Set([...this.progress.checkedIngredientIds, id])]
        : this.progress.checkedIngredientIds.filter((value) => value !== id);
      this.changed(input.checked ? "Ingredient marked ready." : "Ingredient returned to the list.");
    }));
    this.steps.forEach((step) => step.querySelector<HTMLButtonElement>("[data-complete-step]")?.addEventListener("click", () => {
      const id = step.dataset.stepId ?? "";
      if (this.progress.completedStepIds.includes(id)) {
        this.snapshot();
        this.progress.completedStepIds = this.progress.completedStepIds.filter((value) => value !== id);
        this.progress.activeStepId = id;
        this.changed(`Step ${this.stepNumber(id)} reopened.`);
      } else this.markStepComplete(id);
    }));
    requiredElement<HTMLButtonElement>("#startCooking").addEventListener("click", () => this.enterCookingMode());
    requiredElement<HTMLButtonElement>("#exitCooking").addEventListener("click", () => void this.exitCookingMode());
    requiredElement<HTMLButtonElement>("#previousStep").addEventListener("click", () => this.move(-1));
    requiredElement<HTMLButtonElement>("#nextStep").addEventListener("click", () => this.move(1));
    requiredElement<HTMLButtonElement>("#undoCooking").addEventListener("click", () => this.undo());
    requiredElement<HTMLButtonElement>("#showIngredients").addEventListener("click", () => document.body.classList.add("ingredients-open"));
    requiredElement<HTMLButtonElement>("#closeIngredients").addEventListener("click", () => document.body.classList.remove("ingredients-open"));
    requiredElement<HTMLButtonElement>("#textSize").addEventListener("click", () => void this.cycleTextSize());
    const dialog = requiredElement<HTMLDialogElement>("#resetDialog");
    requiredElement<HTMLButtonElement>("#resetCooking").addEventListener("click", () => dialog.showModal());
    requiredElement<HTMLButtonElement>("#cancelReset").addEventListener("click", () => dialog.close());
    requiredElement<HTMLButtonElement>("#confirmReset").addEventListener("click", async () => {
      this.history = [];
      this.progress = this.emptyProgress();
      await resetProgress(this.recipeSlug);
      dialog.close();
      this.render();
      setLiveMessage("Cooking progress reset.");
    });
  }

  private enterCookingMode(): void {
    document.body.classList.add("cooking-mode");
    if (!this.progress.activeStepId && this.steps[0]?.dataset.stepId) this.setActiveStep(this.steps[0].dataset.stepId);
    requiredElement<HTMLElement>("#cookingDock").hidden = false;
    void this.requestWakeLock();
    this.scrollToActive();
  }

  private async exitCookingMode(): Promise<void> {
    document.body.classList.remove("cooking-mode", "ingredients-open");
    requiredElement<HTMLElement>("#cookingDock").hidden = true;
    await this.wakeLock?.release();
    this.wakeLock = null;
  }

  private async requestWakeLock(): Promise<void> {
    try { this.wakeLock = await navigator.wakeLock?.request("screen") ?? null; } catch { this.wakeLock = null; }
  }

  private move(offset: number): void {
    const current = this.steps.findIndex((step) => step.dataset.stepId === this.progress.activeStepId);
    const next = Math.min(this.steps.length - 1, Math.max(0, current + offset));
    const id = this.steps[next]?.dataset.stepId;
    if (id) this.setActiveStep(id);
    this.scrollToActive();
  }

  private addTimerActions(): void {
    const pattern = /\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i;
    this.steps.forEach((step) => {
      const match = step.querySelector("p")?.textContent?.match(pattern);
      if (!match) return;
      const quantity = Number(match[1]);
      const seconds = /hour|hr/i.test(match[2] ?? "") ? quantity * 3_600 : quantity * 60;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-timer";
      button.textContent = `Start ${quantity} ${seconds >= 3_600 ? "hr" : "min"} timer`;
      button.addEventListener("click", () => this.startTimer(step.dataset.stepId ?? "", button.textContent ?? "Timer", seconds));
      step.querySelector(".step-actions")?.prepend(button);
    });
  }

  private startTimer(stepId: string, label: string, durationSeconds: number): void {
    this.snapshot();
    const now = Date.now();
    this.progress.timers = [...this.progress.timers, {
      id: crypto.randomUUID(), recipeSlug: this.recipeSlug, stepId, label, durationSeconds,
      createdAt: new Date(now).toISOString(), endsAt: new Date(now + durationSeconds * 1_000).toISOString(),
    }].slice(-20);
    if (!this.audioContext && "AudioContext" in window) {
      try { this.audioContext = new AudioContext(); } catch { this.audioContext = null; }
    }
    this.changed(`${label} started.`);
  }

  private renderTimers(): void {
    const rail = requiredElement<HTMLElement>("#timerRail");
    rail.replaceChildren();
    const now = Date.now();
    for (const timer of this.progress.timers) {
      const remaining = Math.max(0, Math.ceil((Date.parse(timer.endsAt) - now) / 1_000));
      if (remaining === 0 && !this.notifiedTimers.has(timer.id)) this.notifyTimer(timer);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = remaining ? "timer-chip" : "timer-chip is-done";
      chip.textContent = remaining ? `${timer.label.replace("Start ", "")} · ${this.formatTime(remaining)}` : `${timer.label.replace("Start ", "")} · Done`;
      chip.addEventListener("click", () => {
        this.snapshot();
        this.progress.timers = this.progress.timers.filter(({ id }) => id !== timer.id);
        this.changed("Timer dismissed.");
      });
      rail.append(chip);
    }
    rail.hidden = this.progress.timers.length === 0;
  }

  private notifyTimer(timer: CookingTimer): void {
    this.notifiedTimers.add(timer.id);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Potbelly timer", { body: `${timer.label.replace("Start ", "")} is done.` });
    }
    try {
      const context = this.audioContext;
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .7);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + .72);
    } catch { /* The visible timer remains the reliable alert. */ }
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  private async cycleTextSize(): Promise<void> {
    const order: LocalPreferences["textScale"][] = ["standard", "large", "extra-large"];
    const current = this.preferences?.textScale ?? "standard";
    const textScale = order[(order.indexOf(current) + 1) % order.length] ?? "standard";
    this.preferences = await updatePreferences({ textScale });
    this.applyTextScale();
    setLiveMessage(`Cooking text size: ${textScale.replace("-", " ")}.`);
  }

  private applyTextScale(): void {
    document.documentElement.dataset.textScale = this.preferences?.textScale ?? "standard";
  }

  private snapshot(): void {
    this.history.push({
      checkedIngredientIds: [...this.progress.checkedIngredientIds],
      completedStepIds: [...this.progress.completedStepIds], activeStepId: this.progress.activeStepId,
      timers: structuredClone(this.progress.timers),
    });
    this.history = this.history.slice(-20);
  }

  private changed(message: string): void {
    this.progress.updatedAt = new Date().toISOString();
    this.render();
    void this.persist();
    setLiveMessage(message);
    this.dispatchEvent(new CustomEvent("progresschange", { detail: this.getState() }));
  }

  private async persist(): Promise<void> {
    const snapshot = stageProgressRecovery(this.progress);
    this.persistQueue = this.persistQueue.catch(() => undefined).then(() => commitProgress(snapshot));
    await this.persistQueue;
  }

  private render(): void {
    this.ingredientInputs.forEach((input) => { input.checked = this.progress.checkedIngredientIds.includes(input.dataset.ingredientId ?? ""); });
    this.steps.forEach((step) => {
      const id = step.dataset.stepId ?? "";
      const active = id === this.progress.activeStepId;
      const complete = this.progress.completedStepIds.includes(id);
      step.classList.toggle("is-active", active);
      step.classList.toggle("is-complete", complete);
      const button = step.querySelector<HTMLButtonElement>("[data-complete-step]");
      button?.setAttribute("aria-pressed", String(complete));
      if (button) button.textContent = complete ? "Reopen step" : "Done — next step";
    });
    const activeIndex = this.steps.findIndex((step) => step.dataset.stepId === this.progress.activeStepId);
    requiredElement<HTMLElement>("#cookingProgress").textContent = activeIndex >= 0 ? `Step ${activeIndex + 1} of ${this.steps.length}` : `${this.steps.length} steps`;
    requiredElement<HTMLButtonElement>("#previousStep").disabled = activeIndex <= 0;
    requiredElement<HTMLButtonElement>("#nextStep").disabled = activeIndex === this.steps.length - 1;
    requiredElement<HTMLButtonElement>("#undoCooking").disabled = this.history.length === 0;
    this.renderCompletedHistory();
    this.renderTimers();
  }

  private renderCompletedHistory(): void {
    const details = requiredElement<HTMLDetailsElement>("#completedHistory");
    const container = requiredElement<HTMLElement>("#completedStepLinks");
    container.replaceChildren();
    for (const id of this.progress.completedStepIds) {
      const index = this.steps.findIndex((step) => step.dataset.stepId === id);
      if (index < 0) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Review step ${index + 1}`;
      button.addEventListener("click", () => { this.setActiveStep(id); details.open = false; this.scrollToActive(); });
      container.append(button);
    }
    requiredElement<HTMLElement>("#completedCount").textContent = String(this.progress.completedStepIds.length);
    details.hidden = this.progress.completedStepIds.length === 0;
  }

  private scrollToActive(): void {
    document.querySelector("[data-step-id].is-active")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private stepNumber(stepId: string): number { return this.steps.findIndex((step) => step.dataset.stepId === stepId) + 1; }
}

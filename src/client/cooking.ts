import type { CookingProgress } from "../domain/types";
import { loadProgress, resetProgress, saveProgress } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";

interface Snapshot {
  checkedIngredientIds: string[];
  completedStepIds: string[];
  activeStepId: string | null;
}

export class CookingController extends EventTarget {
  readonly recipeSlug: string;
  private readonly ingredientInputs: HTMLInputElement[];
  private readonly steps: HTMLElement[];
  private progress: CookingProgress;
  private history: Snapshot[] = [];

  constructor(recipeSlug: string) {
    super();
    this.recipeSlug = recipeSlug;
    this.ingredientInputs = [...document.querySelectorAll<HTMLInputElement>("[data-ingredient-id]")];
    this.steps = [...document.querySelectorAll<HTMLElement>("[data-step-id]")];
    this.progress = this.emptyProgress();
  }

  async initialise(): Promise<void> {
    this.progress = await loadProgress(this.recipeSlug) ?? this.emptyProgress();
    this.bind();
    this.render();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.persist();
    });
  }

  getState(): CookingProgress {
    return structuredClone(this.progress);
  }

  setActiveStep(stepId: string): string {
    if (!this.steps.some((step) => step.dataset.stepId === stepId)) return "Unknown step.";
    this.snapshot();
    this.progress.activeStepId = stepId;
    this.changed(`Step ${this.stepNumber(stepId)} is now active.`);
    return "Active step updated.";
  }

  markStepComplete(stepId: string): string {
    if (!this.steps.some((step) => step.dataset.stepId === stepId)) return "Unknown step.";
    this.snapshot();
    this.progress.completedStepIds = [...new Set([...this.progress.completedStepIds, stepId])];
    this.changed(`Step ${this.stepNumber(stepId)} marked complete.`);
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
    return { recipeSlug: this.recipeSlug, checkedIngredientIds: [], completedStepIds: [], activeStepId: null, updatedAt: new Date().toISOString() };
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
    this.steps.forEach((step) => {
      step.querySelector<HTMLButtonElement>("[data-activate-step]")?.addEventListener("click", () => this.setActiveStep(step.dataset.stepId ?? ""));
      step.querySelector<HTMLButtonElement>("[data-complete-step]")?.addEventListener("click", () => {
        const id = step.dataset.stepId ?? "";
        if (this.progress.completedStepIds.includes(id)) {
          this.snapshot();
          this.progress.completedStepIds = this.progress.completedStepIds.filter((value) => value !== id);
          this.changed(`Step ${this.stepNumber(id)} reopened.`);
        } else this.markStepComplete(id);
      });
    });
    requiredElement<HTMLButtonElement>("#startCooking").addEventListener("click", () => {
      document.body.classList.add("cooking-mode");
      if (!this.progress.activeStepId && this.steps[0]?.dataset.stepId) this.setActiveStep(this.steps[0].dataset.stepId);
      requiredElement<HTMLElement>("#cookingDock").hidden = false;
      this.scrollToActive();
    });
    requiredElement<HTMLButtonElement>("#exitCooking").addEventListener("click", () => {
      document.body.classList.remove("cooking-mode");
      requiredElement<HTMLElement>("#cookingDock").hidden = true;
    });
    requiredElement<HTMLButtonElement>("#previousStep").addEventListener("click", () => this.move(-1));
    requiredElement<HTMLButtonElement>("#nextStep").addEventListener("click", () => this.move(1));
    requiredElement<HTMLButtonElement>("#undoCooking").addEventListener("click", () => this.undo());
    requiredElement<HTMLButtonElement>("#resetCooking").addEventListener("click", async () => {
      if (!window.confirm("Reset every ingredient and cooking step for this recipe?")) return;
      this.history = [];
      this.progress = this.emptyProgress();
      await resetProgress(this.recipeSlug);
      this.render();
      setLiveMessage("Cooking progress reset.");
    });
  }

  private move(offset: number): void {
    const current = this.steps.findIndex((step) => step.dataset.stepId === this.progress.activeStepId);
    const next = Math.min(this.steps.length - 1, Math.max(0, current + offset));
    const id = this.steps[next]?.dataset.stepId;
    if (id) this.setActiveStep(id);
    this.scrollToActive();
  }

  private snapshot(): void {
    this.history.push({
      checkedIngredientIds: [...this.progress.checkedIngredientIds],
      completedStepIds: [...this.progress.completedStepIds],
      activeStepId: this.progress.activeStepId,
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
    await saveProgress(this.progress);
  }

  private render(): void {
    this.ingredientInputs.forEach((input) => { input.checked = this.progress.checkedIngredientIds.includes(input.dataset.ingredientId ?? ""); });
    this.steps.forEach((step) => {
      const id = step.dataset.stepId ?? "";
      const active = id === this.progress.activeStepId;
      const complete = this.progress.completedStepIds.includes(id);
      step.classList.toggle("is-active", active);
      step.classList.toggle("is-complete", complete);
      step.querySelector<HTMLButtonElement>("[data-complete-step]")?.setAttribute("aria-pressed", String(complete));
    });
    const activeIndex = this.steps.findIndex((step) => step.dataset.stepId === this.progress.activeStepId);
    requiredElement<HTMLElement>("#cookingProgress").textContent = activeIndex >= 0 ? `Step ${activeIndex + 1} of ${this.steps.length}` : `${this.steps.length} steps`;
    requiredElement<HTMLButtonElement>("#previousStep").disabled = activeIndex <= 0;
    requiredElement<HTMLButtonElement>("#nextStep").disabled = activeIndex === this.steps.length - 1;
    requiredElement<HTMLButtonElement>("#undoCooking").disabled = this.history.length === 0;
  }

  private scrollToActive(): void {
    document.querySelector("[data-step-id].is-active")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private stepNumber(stepId: string): number {
    return this.steps.findIndex((step) => step.dataset.stepId === stepId) + 1;
  }
}

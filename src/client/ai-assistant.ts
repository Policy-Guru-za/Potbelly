import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import type { RunToolApprovalItem } from "@openai/agents";
import { z } from "zod";
import { getDeviceId, getPreferences, updatePreferences } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import type { RealtimeSessionResponse } from "../domain/types";
import type { CookingController } from "./cooking";

const CONSENT_VERSION = "1";
const SESSION_LIMIT_MS = 20 * 60 * 1000;

const sessionResponseSchema = z.object({
  clientSecret: z.string().min(10),
  expiresAt: z.number().int().positive(),
  model: z.string().min(1),
  voice: z.string().min(1),
  promptVersion: z.string().min(1),
  instructions: z.string().min(20),
});

interface AiStatus {
  unlocked: boolean;
  aiEnabled: boolean;
}

interface ToolApprovalRequest {
  tool: { name: string };
  approvalItem: RunToolApprovalItem;
}

export class AiAssistant {
  private readonly cooking: CookingController;
  private session: RealtimeSession | null = null;
  private sessionTimer = 0;
  private backgroundTimer = 0;

  constructor(cooking: CookingController) {
    this.cooking = cooking;
  }

  initialise(): void {
    requiredElement<HTMLButtonElement>("#aiClose").addEventListener("click", () => this.close());
    requiredElement<HTMLFormElement>("#aiUnlockForm").addEventListener("submit", (event) => void this.unlock(event));
    requiredElement<HTMLButtonElement>("#acceptVoiceConsent").addEventListener("click", () => void this.acceptConsent());
    requiredElement<HTMLButtonElement>("#startVoiceSession").addEventListener("click", () => void this.start());
    requiredElement<HTMLButtonElement>("#muteVoice").addEventListener("click", () => this.toggleMute());
    requiredElement<HTMLButtonElement>("#interruptVoice").addEventListener("click", () => this.session?.interrupt());
    requiredElement<HTMLButtonElement>("#endVoiceSession").addEventListener("click", () => this.end("Session ended."));
    requiredElement<HTMLFormElement>("#typedQuestionForm").addEventListener("submit", (event) => this.sendTyped(event));
    document.addEventListener("visibilitychange", () => this.handleVisibility());
  }

  async open(): Promise<void> {
    const dialog = requiredElement<HTMLDialogElement>("#aiDialog");
    dialog.showModal();
    this.showStage("loading");
    if (!navigator.onLine) {
      this.setState("Offline", "The assistant needs internet. The complete recipe remains available.");
      this.showStage("offline");
      return;
    }
    try {
      const response = await fetch("/api/ai/status", { credentials: "same-origin" });
      const status = await response.json() as AiStatus;
      if (!status.aiEnabled) {
        this.setState("Unavailable", "The assistant is currently switched off. Try again later.");
        this.showStage("offline");
      } else if (!status.unlocked) this.showStage("unlock");
      else await this.showConsentOrReady();
    } catch {
      this.setState("Connection lost", "We could not reach the cooking assistant. Check your connection.");
      this.showStage("offline");
    }
  }

  private async unlock(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const code = requiredElement<HTMLInputElement>("#aiAccessCode");
    const error = requiredElement<HTMLElement>("#aiUnlockError");
    error.textContent = "";
    const button = requiredElement<HTMLButtonElement>("#unlockAi");
    button.disabled = true;
    try {
      const response = await fetch("/api/ai/unlock", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.value }),
      });
      code.value = "";
      if (!response.ok) {
        error.textContent = response.status === 429
          ? "Too many attempts. Wait before trying again."
          : "That access code was not accepted.";
        return;
      }
      await this.showConsentOrReady();
    } catch {
      error.textContent = "The assistant could not be reached. Check your connection.";
    } finally {
      button.disabled = false;
    }
  }

  private async showConsentOrReady(): Promise<void> {
    const preferences = await getPreferences();
    this.showStage(preferences.cloudVoiceConsentVersion === CONSENT_VERSION ? "ready" : "consent");
  }

  private async acceptConsent(): Promise<void> {
    await updatePreferences({ cloudVoiceConsentVersion: CONSENT_VERSION });
    this.showStage("ready");
  }

  private async start(): Promise<void> {
    const button = requiredElement<HTMLButtonElement>("#startVoiceSession");
    button.disabled = true;
    this.setState("Connecting", "Preparing your recipe-aware cooking assistant…");
    try {
      const state = this.cooking.getState();
      const response = await fetch("/api/ai/realtime-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipeSlug: state.recipeSlug,
          anonymousDeviceId: await getDeviceId(),
          activeStepId: state.activeStepId,
          checkedIngredientIds: state.checkedIngredientIds,
          completedStepIds: state.completedStepIds,
        }),
      });
      if (response.status === 401) {
        this.showStage("unlock");
        return;
      }
      if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
      const config: RealtimeSessionResponse = sessionResponseSchema.parse(await response.json());
      this.session = this.createSession(config);
      await this.session.connect({ apiKey: config.clientSecret, model: config.model });
      this.showStage("session");
      this.setState("Listening", "Ask a question about this recipe.");
      this.sessionTimer = window.setTimeout(() => this.end("Twenty-minute session complete. Start another whenever you need it."), SESSION_LIMIT_MS);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was not allowed. Enable it in Safari settings and try again."
        : "The voice session could not start. Check your connection and try again.";
      this.setState("Connection lost", message);
      this.showStage("ready");
    } finally {
      button.disabled = false;
    }
  }

  private createSession(config: RealtimeSessionResponse): RealtimeSession {
    const idSchema = z.object({ id: z.string().min(1).max(80) });
    const agent = new RealtimeAgent({
      name: "Potbelly Cooking Assistant",
      instructions: config.instructions,
      tools: [
        tool({
          name: "get_current_recipe_state",
          description: "Read the current local recipe step and checklist state.",
          parameters: z.object({}),
          execute: () => JSON.stringify(this.cooking.getState()),
        }),
        tool({
          name: "set_active_step",
          description: "Change the active recipe step only after the user explicitly asks.",
          parameters: idSchema,
          needsApproval: true,
          execute: ({ id }) => this.cooking.setActiveStep(id),
        }),
        tool({
          name: "mark_step_complete",
          description: "Mark a recipe step complete only after the user explicitly asks.",
          parameters: idSchema,
          needsApproval: true,
          execute: ({ id }) => this.cooking.markStepComplete(id),
        }),
        tool({
          name: "mark_ingredient_ready",
          description: "Mark an ingredient ready only after the user explicitly asks.",
          parameters: idSchema,
          needsApproval: true,
          execute: ({ id }) => this.cooking.markIngredientReady(id),
        }),
      ],
    });
    const session = new RealtimeSession(agent, {
      model: config.model,
      transport: "webrtc",
      tracingDisabled: true,
      historyStoreAudio: false,
      config: {
        outputModalities: ["audio"],
        audio: {
          input: { transcription: null, noiseReduction: { type: "near_field" }, turnDetection: { type: "semantic_vad", interruptResponse: true, eagerness: "auto" } },
          output: { voice: config.voice },
        },
      },
    });
    session.on("agent_start", () => this.setState("Thinking", "Considering your question…"));
    session.on("audio_start", () => this.setState("Speaking", "Potbelly is answering."));
    session.on("audio_stopped", () => this.setState("Listening", "Ask another question."));
    session.on("audio_interrupted", () => this.setState("Listening", "Answer stopped. Go ahead."));
    session.on("error", () => this.setState("Connection lost", "The voice connection was interrupted."));
    session.on("tool_approval_requested", (_context, _agent, request) => {
      if (request.type === "function_approval") this.requestApproval(request);
    });
    return session;
  }

  private requestApproval(request: ToolApprovalRequest): void {
    const panel = requiredElement<HTMLElement>("#aiApproval");
    panel.hidden = false;
    requiredElement<HTMLElement>("#aiApprovalText").textContent = `Allow Potbelly to ${request.tool.name.replaceAll("_", " ")}?`;
    const allow = requiredElement<HTMLButtonElement>("#approveAiTool");
    const reject = requiredElement<HTMLButtonElement>("#rejectAiTool");
    allow.onclick = () => { panel.hidden = true; void this.session?.approve(request.approvalItem); };
    reject.onclick = () => { panel.hidden = true; void this.session?.reject(request.approvalItem); };
  }

  private sendTyped(event: SubmitEvent): void {
    event.preventDefault();
    const input = requiredElement<HTMLInputElement>("#typedQuestion");
    const question = input.value.trim();
    if (!question || !this.session) return;
    input.value = "";
    this.session.sendMessage(question);
    this.setState("Thinking", "Considering your question…");
  }

  private toggleMute(): void {
    if (!this.session) return;
    const muted = !(this.session.muted ?? false);
    this.session.mute(muted);
    requiredElement<HTMLButtonElement>("#muteVoice").textContent = muted ? "Unmute" : "Mute";
    this.setState(muted ? "Muted" : "Listening", muted ? "Your microphone is off." : "Ask a question.");
  }

  private handleVisibility(): void {
    clearTimeout(this.backgroundTimer);
    if (document.visibilityState === "hidden" && this.session) {
      this.session.mute(true);
      this.backgroundTimer = window.setTimeout(() => this.end("Session ended while Potbelly was in the background."), 60_000);
    }
  }

  private end(message: string): void {
    clearTimeout(this.sessionTimer);
    clearTimeout(this.backgroundTimer);
    this.session?.close();
    this.session = null;
    this.setState("Ready", message);
    this.showStage("ready");
  }

  private close(): void {
    this.end("Session ended.");
    requiredElement<HTMLDialogElement>("#aiDialog").close();
  }

  private showStage(stage: string): void {
    document.querySelectorAll<HTMLElement>("[data-ai-stage]").forEach((element) => {
      element.hidden = element.dataset.aiStage !== stage;
    });
  }

  private setState(label: string, detail: string): void {
    requiredElement<HTMLElement>("#aiStateLabel").textContent = label;
    requiredElement<HTMLElement>("#aiStateDetail").textContent = detail;
    requiredElement<HTMLElement>("#voiceOrb").dataset.state = label.toLocaleLowerCase("en").replaceAll(" ", "-");
    setLiveMessage(`${label}. ${detail}`);
  }
}

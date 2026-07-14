import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import type { RunToolApprovalItem } from "@openai/agents";
import { z } from "zod";
import { getDeviceId, getPreferences, updatePreferences } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import type { RealtimeSessionResponse } from "../domain/types";
import type { CookingController } from "./cooking";

const CONSENT_VERSION = "2";
const SESSION_LIMIT_MS = 20 * 60 * 1000;
const sessionResponseSchema = z.object({
  clientSecret: z.string().min(10), expiresAt: z.number().int().positive(), model: z.string().min(1),
  voice: z.string().min(1), promptVersion: z.string().min(1), instructions: z.string().min(20),
});

interface AiStatus { aiEnabled: boolean; }
interface ToolApprovalRequest { tool: { name: string }; approvalItem: RunToolApprovalItem; }
export class AiAssistant {
  private session: RealtimeSession | null = null;
  private sessionTimer = 0;
  private backgroundTimer = 0;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly cooking: CookingController) {}

  initialise(): void {
    requiredElement<HTMLButtonElement>("#aiClose").addEventListener("click", () => this.close());
    requiredElement<HTMLButtonElement>("#acceptVoiceConsent").addEventListener("click", () => void this.acceptConsent());
    requiredElement<HTMLButtonElement>("#startVoiceSession").addEventListener("click", () => void this.startVoice());
    requiredElement<HTMLButtonElement>("#muteVoice").addEventListener("click", () => this.toggleMute());
    requiredElement<HTMLButtonElement>("#interruptVoice").addEventListener("click", () => this.session?.interrupt());
    requiredElement<HTMLButtonElement>("#endVoiceSession").addEventListener("click", () => this.end("Voice mode ended."));
    document.addEventListener("visibilitychange", () => this.handleVisibility());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !requiredElement<HTMLElement>("#aiDialog").hidden) this.close();
    });
    this.cooking.addEventListener("progresschange", () => this.renderStepContext());
  }

  async open(returnFocus?: HTMLElement): Promise<void> {
    this.returnFocus = returnFocus ?? null;
    const panel = requiredElement<HTMLElement>("#aiDialog");
    panel.hidden = false;
    document.body.classList.add("ai-open");
    requiredElement<HTMLButtonElement>("#aiClose").focus();
    this.renderStepContext();
    this.showStage("loading");
    if (!navigator.onLine) {
      this.setState("Offline", "The assistant needs internet. The complete recipe remains available.");
      this.showStage("offline");
      return;
    }
    try {
      const response = await fetch("/api/ai/status", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Assistant status unavailable");
      const status = await response.json() as AiStatus;
      if (!status.aiEnabled) {
        this.setState("Unavailable", "The assistant is currently switched off. Try again later.");
        this.showStage("offline");
      } else await this.showConsentOrReady();
    } catch {
      this.setState("Connection lost", "We could not reach the cooking assistant. Check your connection.");
      this.showStage("offline");
    }
  }

  private async showConsentOrReady(): Promise<void> {
    const consented = (await getPreferences()).cloudVoiceConsentVersion === CONSENT_VERSION;
    if (consented) {
      requiredElement<HTMLElement>("#voiceReadyStatus").textContent = "";
      requiredElement<HTMLButtonElement>("#startVoiceSession").textContent = "Start listening";
    }
    this.showStage(consented ? "ready" : "consent");
    if (consented) requiredElement<HTMLButtonElement>("#startVoiceSession").focus();
  }

  private async acceptConsent(): Promise<void> {
    await updatePreferences({ cloudVoiceConsentVersion: CONSENT_VERSION });
    this.showStage("ready");
    requiredElement<HTMLElement>("#voiceReadyStatus").textContent = "";
    requiredElement<HTMLButtonElement>("#startVoiceSession").focus();
  }

  private async requestConfig(): Promise<RealtimeSessionResponse> {
    const state = this.cooking.getState();
    const response = await fetch("/api/ai/realtime-session", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "voice",
        recipeSlug: state.recipeSlug, anonymousDeviceId: await getDeviceId(), activeStepId: state.activeStepId,
        checkedIngredientIds: state.checkedIngredientIds, completedStepIds: state.completedStepIds,
      }),
    });
    if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
    return sessionResponseSchema.parse(await response.json());
  }

  private async startVoice(): Promise<void> {
    const button = requiredElement<HTMLButtonElement>("#startVoiceSession");
    button.disabled = true;
    button.textContent = "Connecting…";
    requiredElement<HTMLElement>("#voiceReadyStatus").textContent = "";
    this.setState("Connecting", "Preparing hands-free voice mode…");
    this.endSessionOnly();
    try {
      const config = await this.requestConfig();
      this.session = this.createSession(config);
      await this.session.connect({ apiKey: config.clientSecret, model: config.model });
      this.showStage("session");
      this.setState("Listening", "Ask a question about this recipe.");
      this.armSessionLimit();
    } catch (error) {
      this.endSessionOnly();
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was not allowed. Enable it in iPad Settings for Safari or Potbelly, then try again."
        : "Voice mode could not start. Check your connection and try again.";
      this.setState("Voice unavailable", message);
      this.showStage("ready");
      requiredElement<HTMLElement>("#voiceReadyStatus").textContent = message;
      requiredElement<HTMLButtonElement>("#startVoiceSession").textContent = "Try again";
    } finally { button.disabled = false; }
  }

  private createSession(config: RealtimeSessionResponse): RealtimeSession {
    const idSchema = z.object({ id: z.string().min(1).max(80) });
    const agent = new RealtimeAgent({
      name: "Potbelly Cooking Assistant", instructions: config.instructions,
      tools: [
        tool({ name: "get_current_recipe_state", description: "Read the current local recipe step and checklist state.", parameters: z.object({}), execute: () => JSON.stringify(this.cooking.getState()) }),
        tool({ name: "set_active_step", description: "Change the active step only after the user explicitly asks.", parameters: idSchema, needsApproval: true, execute: ({ id }) => this.cooking.setActiveStep(id) }),
        tool({ name: "mark_step_complete", description: "Mark a step complete only after the user explicitly asks.", parameters: idSchema, needsApproval: true, execute: ({ id }) => this.cooking.markStepComplete(id) }),
        tool({ name: "mark_ingredient_ready", description: "Mark an ingredient ready only after the user explicitly asks.", parameters: idSchema, needsApproval: true, execute: ({ id }) => this.cooking.markIngredientReady(id) }),
      ],
    });
    const session = new RealtimeSession(agent, {
      model: config.model, transport: "webrtc", tracingDisabled: true, historyStoreAudio: false,
      config: {
        outputModalities: ["audio"],
        audio: { input: { transcription: null, noiseReduction: { type: "near_field" }, turnDetection: { type: "semantic_vad", interruptResponse: true, eagerness: "auto" } }, output: { voice: config.voice } },
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
    requiredElement<HTMLButtonElement>("#approveAiTool").onclick = () => { panel.hidden = true; void this.session?.approve(request.approvalItem); };
    requiredElement<HTMLButtonElement>("#rejectAiTool").onclick = () => { panel.hidden = true; void this.session?.reject(request.approvalItem); };
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
      requiredElement<HTMLButtonElement>("#muteVoice").textContent = "Unmute";
      this.backgroundTimer = window.setTimeout(() => this.end("Session ended while Potbelly was in the background."), 60_000);
    }
  }

  private renderStepContext(): void {
    const state = this.cooking.getState();
    const step = state.activeStepId ? document.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(state.activeStepId)}"] p`) : null;
    const context = document.querySelector<HTMLElement>("#aiStepContext");
    if (context) context.textContent = step?.textContent ? `Current step: ${step.textContent}` : "Ask about heat, texture, timing, pressure release, or substitutions.";
  }

  private armSessionLimit(): void {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => this.end("Twenty-minute session complete. Start another whenever you need it."), SESSION_LIMIT_MS);
  }

  private endSessionOnly(): void {
    clearTimeout(this.sessionTimer);
    clearTimeout(this.backgroundTimer);
    this.session?.close();
    this.session = null;
    requiredElement<HTMLElement>("#aiApproval").hidden = true;
  }

  private end(message: string): void {
    this.endSessionOnly();
    this.setState("Ready", message);
    this.showStage("ready");
    requiredElement<HTMLButtonElement>("#startVoiceSession").textContent = "Start listening";
    requiredElement<HTMLElement>("#voiceReadyStatus").textContent = message;
  }

  private close(): void {
    this.endSessionOnly();
    requiredElement<HTMLButtonElement>("#startVoiceSession").textContent = "Start listening";
    requiredElement<HTMLElement>("#voiceReadyStatus").textContent = "";
    requiredElement<HTMLElement>("#aiDialog").hidden = true;
    document.body.classList.remove("ai-open");
    (this.returnFocus ?? requiredElement<HTMLButtonElement>("#askPotbelly")).focus();
    this.returnFocus = null;
  }

  private showStage(stage: string): void {
    document.querySelectorAll<HTMLElement>("[data-ai-stage]").forEach((element) => { element.hidden = element.dataset.aiStage !== stage; });
  }

  private setState(label: string, detail: string): void {
    requiredElement<HTMLElement>("#aiStateLabel").textContent = label;
    requiredElement<HTMLElement>("#aiStateDetail").textContent = detail;
    requiredElement<HTMLElement>("#voiceOrb").dataset.state = label.toLocaleLowerCase("en").replaceAll(" ", "-");
    setLiveMessage(`${label}. ${detail}`);
  }
}

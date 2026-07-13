import "../styles/site.css";
import { addRecent } from "../services/db";
import { requiredElement } from "../services/dom";
import { CookingController } from "./cooking";
import { initialiseShell } from "./shell";

async function start(): Promise<void> {
  await initialiseShell();
  const article = requiredElement<HTMLElement>("article[data-recipe-slug]");
  const slug = article.dataset.recipeSlug ?? "";
  const title = requiredElement<HTMLElement>("#recipeTitle").textContent.trim() || slug;
  await addRecent({ slug, title, viewedAt: new Date().toISOString() });
  const cooking = new CookingController(slug);
  await cooking.initialise();
  let assistant: import("./ai-assistant").AiAssistant | null = null;
  const showOfflineAssistant = (): void => {
    const dialog = requiredElement<HTMLDialogElement>("#aiDialog");
    document.querySelectorAll<HTMLElement>("[data-ai-stage]").forEach((element) => {
      element.hidden = element.dataset.aiStage !== "offline";
    });
    dialog.showModal();
  };
  requiredElement<HTMLButtonElement>("#askPotbelly").addEventListener("click", async () => {
    if (!navigator.onLine) {
      showOfflineAssistant();
      return;
    }
    try {
      if (!assistant) {
        const { AiAssistant } = await import("./ai-assistant");
        assistant = new AiAssistant(cooking);
        assistant.initialise();
      }
      await assistant.open();
    } catch {
      showOfflineAssistant();
    }
  });
}

void start();

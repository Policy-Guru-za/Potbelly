import "../styles/site.css";
import { addRecent } from "../services/db";
import { requiredElement, setLiveMessage } from "../services/dom";
import { loadPdfFile, sharePdfFile } from "../services/pdf";
import { CookingController } from "./cooking";
import { initialiseRecipeData } from "./recipe-data";
import { initialiseShell } from "./shell";

async function start(): Promise<void> {
  await initialiseShell();
  const article = requiredElement<HTMLElement>("article[data-recipe-slug]");
  const slug = article.dataset.recipeSlug ?? "";
  const title = requiredElement<HTMLElement>("#recipeTitle").textContent.trim() || slug;
  void addRecent({ slug, title, viewedAt: new Date().toISOString() });
  await initialiseRecipeData(slug, title);
  const cooking = new CookingController(slug);
  await cooking.initialise();
  requiredElement<HTMLButtonElement>("#startCooking").disabled = false;
  requiredElement<HTMLButtonElement>("#askPotbelly").disabled = false;
  let assistant: import("./ai-assistant").AiAssistant | null = null;
  const showOfflineAssistant = (): void => {
    const dialog = requiredElement<HTMLElement>("#aiDialog");
    document.querySelectorAll<HTMLElement>("[data-ai-stage]").forEach((element) => {
      element.hidden = element.dataset.aiStage !== "offline";
    });
    dialog.hidden = false;
  };
  let assistantTrigger: HTMLButtonElement | null = null;
  requiredElement<HTMLButtonElement>("#aiClose").addEventListener("click", () => {
    if (assistant) return;
    requiredElement<HTMLElement>("#aiDialog").hidden = true;
    document.body.classList.remove("ai-open");
    assistantTrigger?.focus();
  });
  const openAssistant = async (trigger: HTMLButtonElement): Promise<void> => {
    assistantTrigger = trigger;
    try {
      if (!assistant) {
        const { AiAssistant } = await import("./ai-assistant");
        assistant = new AiAssistant(cooking);
        assistant.initialise();
      }
      await assistant.open(trigger);
    } catch {
      showOfflineAssistant();
    }
  };
  const recipeAssistantButton = requiredElement<HTMLButtonElement>("#askPotbelly");
  const cookingAssistantButton = requiredElement<HTMLButtonElement>("#openVoiceAssistant");
  recipeAssistantButton.addEventListener("click", () => void openAssistant(recipeAssistantButton));
  cookingAssistantButton.addEventListener("click", () => void openAssistant(cookingAssistantButton));

  const pdfButton = requiredElement<HTMLButtonElement>("#savePdf");
  const pdfLabel = pdfButton.textContent;
  let pdfFile: File | null = null;
  pdfButton.disabled = true;
  pdfButton.textContent = "Preparing PDF…";
  void loadPdfFile(
    pdfButton.dataset.pdfUrl ?? "",
    pdfButton.dataset.pdfFilename ?? "potbelly-recipe.pdf",
  ).then((file) => {
    pdfFile = file;
    pdfButton.textContent = pdfLabel;
    pdfButton.disabled = false;
  }).catch(() => {
    pdfButton.textContent = "PDF unavailable";
    setLiveMessage("This PDF is not available offline yet. Reconnect and reopen the recipe.");
  });
  pdfButton.addEventListener("click", async () => {
    if (!pdfFile) return;
    pdfButton.disabled = true;
    pdfButton.textContent = "Opening Share Sheet…";
    try {
      const result = await sharePdfFile(pdfFile, title);
      setLiveMessage(result === "cancelled" ? "PDF sharing closed. The recipe is still here." : "PDF ready to save or share.");
    } catch {
      setLiveMessage("The Share Sheet could not be opened. Please try again.");
    } finally {
      pdfButton.textContent = pdfLabel;
      pdfButton.disabled = false;
      pdfButton.focus();
    }
  });
}

void start();

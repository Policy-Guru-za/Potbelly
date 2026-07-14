const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("search supports natural intent and preserves stable routes", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Potbelly/);
  const desktopBrand = await page.evaluate(() => ({
    mark: document.querySelector(".brand-mark").getBoundingClientRect().width,
    name: Number.parseFloat(getComputedStyle(document.querySelector(".brand-name")).fontSize),
    tagline: Number.parseFloat(getComputedStyle(document.querySelector(".brand-tagline")).fontSize),
  }));
  expect(desktopBrand.mark).toBeCloseTo(76.8, 1);
  expect(desktopBrand.name).toBeCloseTo(38.4, 1);
  expect(desktopBrand.tagline).toBeCloseTo(16.2, 1);
  await expect(page.getByText("A Curation of Instant Pot Recipes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What are we making?" })).toBeVisible();
  await expect(page.locator("#sortRecipes")).toHaveCount(0);
  const search = page.getByLabel("What do you want to cook?");
  await expect(search).toBeEnabled();
  await expect(page.locator("#listCount")).toHaveText("150 recipes");
  await expect(page.locator("#results li:visible")).toHaveCount(24);
  await page.getByRole("button", { name: "Show 24 more recipes" }).click();
  await expect(page.locator("#results li:visible")).toHaveCount(48);
  await search.fill("weeknight chicken");
  await expect(page.locator("#appStatus")).toContainText(/recipe/);
  await expect(page.locator("#results li:visible")).not.toHaveCount(0);
  await expect(page.locator("#results li:visible").first()).toContainText("Chicken");
  await search.fill("dinner for six");
  await expect(page.locator("#results li:visible")).not.toHaveCount(0);
  await search.fill("  INSTANT-pot butter chicken!!!  ");
  await expect(page.locator("#results li:visible").first()).toContainText("Instant Pot Butter Chicken");
  await search.fill("cheesec");
  await expect(page.locator("#results li:visible").first()).toContainText("Cheesecake");
  await search.fill("shrimp sausage corn");
  await expect(page.locator("#results li:visible").first()).toContainText("Instant Pot Shrimp Boil");
  await search.fill("query-that-cannot-match");
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#empty")).toContainText("Try fewer words or a different ingredient.");
  await search.fill("");
  await page.getByRole("button", { name: "Under 30 min" }).click();
  const fastCount = Number.parseInt(await page.locator("#listCount").textContent(), 10);
  expect(fastCount).toBeGreaterThan(0);
  expect(fastCount).toBeLessThan(150);
  await expect(page.locator("#results li:visible").first()).toBeVisible();
});

test("standalone dashboard and iPad master-detail surface personal cooking state", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(display-mode: standalone)"
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }
      : original(query);
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What are we making?" })).toBeVisible();
  await expect(page.locator("#recipePreview")).toBeVisible();
  const firstTitle = await page.locator("#results li:visible .rtitle").first().textContent();
  await page.locator("#results li:visible a").first().focus();
  await expect(page.locator("#previewTitle")).toHaveText(firstTitle);
  await page.getByRole("button", { name: /Save favourite/ }).click();
  await expect(page.locator("#favouriteItems")).toContainText(firstTitle);
  await page.reload();
  await expect(page.locator("#favouriteItems")).toContainText(firstTitle);
});

test("homepage and recipe pass serious accessibility checks", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      errors.push(location ? `${message.text()} (${location})` : message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  for (const path of ["/", "/recipe/instant-pot-butter-chicken"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((item) => ["critical", "serious"].includes(item.impact));
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("mobile controls, keyboard focus, recipe, and PDF remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByLabel("What do you want to cook?")).toBeEnabled();
  const mobileBrand = await page.evaluate(() => ({
    mark: document.querySelector(".brand-mark").getBoundingClientRect().width,
    name: Number.parseFloat(getComputedStyle(document.querySelector(".brand-name")).fontSize),
    tagline: Number.parseFloat(getComputedStyle(document.querySelector(".brand-tagline")).fontSize),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(mobileBrand.mark).toBeCloseTo(54, 1);
  expect(mobileBrand.name).toBeCloseTo(29, 1);
  expect(mobileBrand.tagline).toBeCloseTo(10.8, 1);
  expect(mobileBrand.overflow).toBeFalsy();
  await page.getByLabel("What do you want to cook?").focus();
  await expect(page.locator("#q")).toBeFocused();
  const box = await page.locator("#q").boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".chips")).toHaveCount(0);
  await page.goto("/recipe/instant-pot-butter-chicken");
  await expect(page.getByRole("heading", { name: "Instant Pot Butter Chicken" })).toBeVisible();
  const pdf = await page.request.get("/pdfs/instant-pot-butter-chicken.pdf");
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  await page.addInitScript(() => {
    window.__sharedPdf = null;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: ({ files }) => files?.[0]?.type === "application/pdf" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async ({ files }) => {
      window.__sharedPdf = { name: files[0].name, type: files[0].type };
    } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect.poll(() => page.evaluate(() => window.__sharedPdf)).toEqual({
    name: "potbelly-instant-pot-butter-chicken.pdf", type: "application/pdf",
  });
  await expect(page).toHaveURL(/instant-pot-butter-chicken/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBeFalsy();
});

test("Cooking Mode focuses the active step, advances, persists, and supports kitchen controls", async ({ page }) => {
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(page.locator("#cookingDock")).toBeVisible();
  await page.getByRole("button", { name: "Ingredients", exact: true }).click();
  const firstIngredient = page.locator("[data-ingredient-id]").first();
  await firstIngredient.check();
  await page.getByRole("button", { name: "Close ingredients" }).click();
  const firstStep = page.locator("[data-step-id]").first();
  const secondStep = page.locator("[data-step-id]").nth(1);
  await expect(firstStep).toBeVisible();
  await expect(secondStep).toBeHidden();
  expect(await firstStep.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"1"');
  await firstStep.getByRole("button", { name: "Done — next step" }).click();
  await expect(secondStep).toBeVisible();
  expect(await secondStep.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"2"');
  await secondStep.getByRole("button", { name: "Start 10 min timer" }).click();
  await expect(page.locator("#timerRail")).toContainText("10 min timer");
  await page.getByRole("button", { name: "Text size", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-text-scale", "large");
  await page.getByRole("button", { name: "Ingredients", exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/ingredients-open/);
  await page.locator("#ingredientsBackdrop").click({ position: { x: 900, y: 300 } });
  await expect(page.locator("body")).not.toHaveClass(/ingredients-open/);
  const stepCount = await page.locator("[data-step-id]").count();
  for (let index = 2; index < stepCount; index += 1) await page.locator("#nextStep").click();
  const finalStep = page.locator("[data-step-id]").last();
  await expect(finalStep).toBeVisible();
  await expect(finalStep.getByRole("button", { name: "Finish cooking" })).toBeVisible();
  await finalStep.getByRole("button", { name: "Finish cooking" }).click();
  await expect(page.locator("#cookingDock")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/cooking-mode/);
  await expect(page.getByRole("button", { name: "Start cooking" })).toBeFocused();
  await page.reload();
  await expect(firstIngredient).toBeChecked();
  await expect(page.locator("[data-step-id]").first()).toHaveClass(/is-complete/);
  await expect(page.locator("#timerRail")).toContainText("10 min timer");
  await expect(page.locator("html")).toHaveAttribute("data-text-scale", "large");
});

test("recipe favourites, shopping, notes, and JSON backup remain local", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.getByRole("button", { name: "♡ Favourite" }).click();
  await page.getByRole("button", { name: "Add to shopping" }).click();
  const note = page.getByLabel("My notes");
  await note.fill("Use the mild chilli next time.");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(note).toHaveValue("Use the mild chilli next time.");
  await page.getByRole("button", { name: "About, installation and local data" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/^potbelly-backup-.*\.json$/);
  const now = new Date().toISOString();
  await page.locator("#importBackup").setInputFiles({
    name: "potbelly-backup-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "potbelly-backup", schemaVersion: 1, exportedAt: now, appVersion: "2.0.0",
      progress: [{ recipeSlug: "instant-pot-butter-chicken", checkedIngredientIds: [], completedStepIds: [], activeStepId: "step-1-1", timers: [], updatedAt: now }],
      favourites: [{ slug: "instant-pot-butter-chicken", title: "Instant Pot Butter Chicken", savedAt: now }],
      shopping: [], notes: [{ recipeSlug: "instant-pot-butter-chicken", text: "Restored from backup.", updatedAt: now }],
      recents: [], preferences: { textScale: "extra-large", installationHelpDismissed: false },
    })),
  });
  await expect(page.locator("#importSummary")).toContainText("1 cooking session and 2 saved items");
  await page.getByRole("button", { name: "Replace local data" }).click();
  await page.waitForLoadState();
  await expect(page.getByLabel("My notes")).toHaveValue("Restored from backup.");
  await expect(page.locator("html")).toHaveAttribute("data-text-scale", "extra-large");
});

test("service worker cold-launches the cookbook offline", async ({ page }) => {
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.context().setOffline(true);
  const cachedShell = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const request = (await cache.keys()).find(({ url }) => url.includes("/recipe/instant-pot-butter-chicken"));
      if (request) return (await cache.match(request))?.text() ?? "";
    }
    return "";
  });
  expect(cachedShell).toContain("Instant Pot Butter Chicken");
  expect(cachedShell).toContain('id="startCooking"');
  await page.context().setOffline(false);
});

test("AI assistant explains offline availability without losing the recipe", async ({ page }) => {
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Ask Potbelly" }).click();
  await expect(page.getByRole("heading", { name: "Assistant unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instant Pot Butter Chicken" })).toBeVisible();
  await page.context().setOffline(false);
});

test("voice AI requires an explicit start and exposes no typed input", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    window.__micCalls = 0;
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => { window.__micCalls += 1; throw new DOMException("blocked", "NotAllowedError"); },
    });
  });
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { aiEnabled: true } }));
  await page.route("**/api/ai/realtime-session", (route) => route.fulfill({ json: {
    clientSecret: "ek_test_not_a_real_secret", expiresAt: Date.now() + 60_000,
    model: "gpt-realtime-2.1-mini", voice: "marin", promptVersion: "1",
    instructions: "You are a careful recipe assistant. Answer only the selected cooking question.",
  } }));
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.getByRole("button", { name: "Ask Potbelly" }).click();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.locator("#typedQuestion")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start listening" })).toBeVisible();
  expect(await page.evaluate(() => window.__micCalls)).toBe(0);
  await page.getByRole("button", { name: "Start listening" }).click();
  if (browserName === "chromium") {
    await expect.poll(() => page.evaluate(() => window.__micCalls)).toBe(1);
  } else {
    await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  }
});

test("missing routes render the branded 404", async ({ page }) => {
  const response = await page.goto("/recipe/not-real");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "That one isn't in the pot." })).toBeVisible();
});

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("search supports natural intent and preserves stable routes", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Potbelly/);
  const desktopBrand = await page.evaluate(() => ({
    mark: document.querySelector(".brand-mark").getBoundingClientRect().width,
    name: Number.parseFloat(getComputedStyle(document.querySelector(".brand-name")).fontSize),
  }));
  expect(desktopBrand.mark).toBeCloseTo(76.8, 1);
  expect(desktopBrand.name).toBeCloseTo(38.4, 1);
  const headerGap = await page.evaluate(() => {
    const brand = document.querySelector(".brand").getBoundingClientRect();
    const kicker = document.querySelector(".hero-kicker").getBoundingClientRect();
    return Math.round(kicker.top - brand.bottom);
  });
  expect(headerGap).toBeGreaterThanOrEqual(54);
  expect(headerGap).toBeLessThanOrEqual(58);
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
  await page.locator("#sortRecipes").selectOption("fastest");
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
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(mobileBrand.mark).toBeCloseTo(76.8, 1);
  expect(mobileBrand.name).toBeCloseTo(38.4, 1);
  expect(mobileBrand.overflow).toBeFalsy();
  await page.getByLabel("What do you want to cook?").focus();
  await expect(page.locator("#q")).toBeFocused();
  const mobileHeaderGap = await page.evaluate(() => {
    const brand = document.querySelector(".brand").getBoundingClientRect();
    const kicker = document.querySelector(".hero-kicker").getBoundingClientRect();
    return Math.round(kicker.top - brand.bottom);
  });
  expect(mobileHeaderGap).toBeGreaterThanOrEqual(32);
  expect(mobileHeaderGap).toBeLessThanOrEqual(36);
  const box = await page.locator("#q").boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".chips")).toHaveCount(0);
  await page.goto("/recipe/instant-pot-butter-chicken");
  await expect(page.getByRole("heading", { name: "Instant Pot Butter Chicken" })).toBeVisible();
  const pdf = await page.request.get("/pdfs/instant-pot-butter-chicken.pdf");
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
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
  await firstStep.getByRole("button", { name: "Done — next step" }).click();
  await expect(secondStep).toBeVisible();
  await secondStep.getByRole("button", { name: "Start 10 min timer" }).click();
  await expect(page.locator("#timerRail")).toContainText("10 min timer");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-text-scale", "large");
  await page.getByRole("button", { name: "Ingredients", exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/ingredients-open/);
  await page.getByRole("button", { name: "Close ingredients" }).click();
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
  await page.getByRole("button", { name: "About and install Potbelly" }).click();
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

test("typed AI is independent and never requests microphone access", async ({ page }) => {
  await page.addInitScript(() => {
    window.__micCalls = 0;
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {} });
    navigator.mediaDevices.getUserMedia = async () => { window.__micCalls += 1; throw new DOMException("blocked", "NotAllowedError"); };
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
  await page.getByLabel("Type a question").fill("What should I check?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__micCalls)).toBe(0);
});

test("missing routes render the branded 404", async ({ page }) => {
  const response = await page.goto("/recipe/not-real");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "That one isn't in the pot." })).toBeVisible();
});

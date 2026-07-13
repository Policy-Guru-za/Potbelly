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

test("Cooking Mode persists checklist and step progress", async ({ page }) => {
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(page.locator("#cookingDock")).toBeVisible();
  const firstIngredient = page.locator("[data-ingredient-id]").first();
  await firstIngredient.check();
  await page.locator("[data-step-id]").first().getByRole("button", { name: "Mark complete" }).click();
  await page.reload();
  await expect(firstIngredient).toBeChecked();
  await expect(page.locator("[data-step-id]").first()).toHaveClass(/is-complete/);
});

test("AI assistant explains offline availability without losing the recipe", async ({ page }) => {
  await page.goto("/recipe/instant-pot-butter-chicken");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Ask Potbelly" }).click();
  await expect(page.getByRole("heading", { name: "Assistant unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instant Pot Butter Chicken" })).toBeVisible();
  await page.context().setOffline(false);
});

test("missing routes render the branded 404", async ({ page }) => {
  const response = await page.goto("/recipe/not-real");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "That one isn't in the pot." })).toBeVisible();
});

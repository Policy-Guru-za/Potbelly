"use strict";

const article = document.querySelector("article[data-recipe-slug]");
if (article) {
  try {
    const key = "potbelly-recents";
    const current = JSON.parse(localStorage.getItem(key) || "[]");
    const seen = Array.isArray(current) ? current : [];
    const slug = article.dataset.recipeSlug;
    localStorage.setItem(key, JSON.stringify([slug, ...seen.filter((item) => item !== slug)].slice(0, 8)));
  } catch {
    localStorage.removeItem("potbelly-recents");
  }
}

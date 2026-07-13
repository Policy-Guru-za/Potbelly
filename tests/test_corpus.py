import json
import unittest
from pathlib import Path

from potbelly.model import load_corpus
from potbelly.site import search_record


ROOT = Path(__file__).resolve().parent.parent
CURATED_SLUGS = {
    "instant-pot-short-ribs",
    "instant-pot-lasagna",
    "instant-pot-french-dip",
    "red-lentil-masoor-dal-instant-pot",
    "instant-pot-roast-beef",
    "instant-pot-honey-baked-ham",
    "instant-pot-pork-roast",
    "instant-pot-birria",
    "instant-pot-oxtail",
    "pressure-cooker-beef-curry-japanese",
    "beef-gyros-slow-cooker-instant-pot",
    "instant-pot-chipotle-chicken-bowls-with-cilantro-lime-quinoa",
    "instant-pot-hk-egg-custard",
    "instant-pot-shrimp-boil",
    "instant-pot-rice-pudding",
}


class ProductionCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = load_corpus(ROOT / "data.json", legacy=True)
        cls.curated = load_corpus(ROOT / "pipeline" / "curated_additions.json")

    def test_production_contains_exactly_150_unique_recipes(self):
        self.assertEqual(len(self.recipes), 150)
        self.assertEqual(len({recipe["source_id"] for recipe in self.recipes}), 150)
        self.assertEqual(len({recipe["source_url"] for recipe in self.recipes}), 150)
        self.assertEqual(len({recipe["slug"] for recipe in self.recipes}), 150)

    def test_curated_additions_are_complete_and_quality_gated(self):
        self.assertEqual({recipe["slug"] for recipe in self.curated}, CURATED_SLUGS)
        self.assertTrue(all(recipe["rating"] >= 4.6 for recipe in self.curated))
        self.assertTrue(all(recipe["rating_count"] >= 30 for recipe in self.curated))
        production_ids = {recipe["source_id"] for recipe in self.recipes}
        self.assertTrue(all(recipe["source_id"] in production_ids for recipe in self.curated))

    def test_method_only_supplies_are_declared_as_ingredients(self):
        by_slug = {recipe["slug"]: recipe for recipe in self.curated}
        expected = {
            "instant-pot-lasagna": "1-1/2 cups water (for pressure cooking)",
            "instant-pot-roast-beef": "1.5 tablespoons (12g) all-purpose flour",
            "instant-pot-oxtail": "Cornstarch slurry (optional, for thickening)",
            "pressure-cooker-beef-curry-japanese": "1 tablespoon (15ml) olive oil",
            "beef-gyros-slow-cooker-instant-pot": "1/3 cup water (for Instant Pot method)",
            "instant-pot-hk-egg-custard": "1 cup (250ml) cold water (for pressure cooking)",
        }
        for slug, ingredient in expected.items():
            with self.subTest(slug=slug):
                items = [
                    item
                    for group in by_slug[slug]["ingredient_groups"]
                    for item in group["items"]
                ]
                self.assertIn(ingredient, items)

    def test_search_index_represents_every_recipe(self):
        records = [search_record(recipe) for recipe in self.recipes]
        self.assertEqual(len(records), 150)
        self.assertEqual(len({record["slug"] for record in records}), 150)
        shrimp = next(record for record in records if record["slug"] == "instant-pot-shrimp-boil")
        self.assertIn("shrimp", shrimp["ingredients"].lower())
        self.assertIn("seafood", shrimp["keywords"].lower())

    def test_curated_artifact_is_valid_json(self):
        raw = json.loads((ROOT / "pipeline" / "curated_additions.json").read_text())
        self.assertEqual(len(raw), 15)


if __name__ == "__main__":
    unittest.main()

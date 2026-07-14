import json
import unittest

from potbelly.site import duration_minutes, human_duration_to_iso, index_page, normalized_course, recipe_page, safe_json, search_record
from tests.test_model import recipe
from potbelly.model import normalize_recipe


class SiteGenerationTests(unittest.TestCase):
    def setUp(self):
        self.recipe = normalize_recipe(recipe())

    def test_duration_conversion_is_fail_closed(self):
        self.assertEqual(human_duration_to_iso("1 hr 40 min"), "PT1H40M")
        self.assertEqual(human_duration_to_iso("2 days 3 hr"), "P2DT3H")
        self.assertIsNone(human_duration_to_iso("40 min active (plus chilling)"))

    def test_json_ld_escapes_script_closing_sequence(self):
        payload = safe_json({"name": "</script><script>alert(1)</script>"})
        self.assertNotIn("</script>", payload)
        self.assertIn("\\u003c", payload)

    def test_index_uses_external_search_assets(self):
        page = index_page([self.recipe], "https://potbelly.example")
        self.assertIn('src="/assets/app.js"', page)
        self.assertNotIn("const DATA", page)
        self.assertNotIn("fonts.googleapis.com", page)

    def test_brand_uses_chef_mascot_and_new_strapline(self):
        page = index_page([self.recipe], "https://potbelly.example")
        self.assertIn('src="/icons/chef-mark.png"', page)
        self.assertIn("Pot Luck with Laupie", page)
        self.assertIn('rel="icon" href="/icons/icon-192.png"', page)
        self.assertNotIn("Pressure cooking, beautifully clear.", page)

    def test_homepage_uses_personal_copy_without_search_chips(self):
        page = index_page([self.recipe], "https://potbelly.example")
        self.assertIn("A Curation of Instant Pot Recipes", page)
        self.assertIn("What are we making?", page)
        self.assertNotIn("Laupie puts dinner under pressure.", page)
        self.assertNotIn("Good food. No life story.", page)
        self.assertNotIn('class="chips"', page)
        self.assertNotIn("Weeknight chicken", page)
        self.assertNotIn('id="surprise"', page)
        self.assertIn("Try fewer words or a different ingredient.", page)

    def test_homepage_has_universal_dashboard_filters_and_master_detail(self):
        page = index_page([self.recipe], "https://potbelly.example")
        self.assertIn('id="dashboardTitle"', page)
        self.assertIn('id="continueCard"', page)
        self.assertIn('data-filter="under-30"', page)
        self.assertNotIn('id="sortRecipes"', page)
        self.assertIn('id="recipePreview"', page)
        self.assertIn('id="showMore"', page)
        self.assertIn('id="shoppingDialog"', page)
        self.assertIn("Export Backup", page)
        self.assertIn("Import Backup", page)

    def test_recipe_page_contains_canonical_and_recipe_json_ld(self):
        page = recipe_page(self.recipe, "https://potbelly.example")
        self.assertIn('rel="canonical" href="https://potbelly.example/recipe/instant-pot-stew"', page)
        self.assertIn('"@type":"Recipe"', page)
        self.assertIn('src="/assets/recipe.js"', page)
        self.assertIn('id="startCooking" type="button" disabled', page)
        self.assertIn('id="askPotbelly"', page)
        self.assertIn('data-ai-stage="consent"', page)
        self.assertNotIn('data-ai-stage="unlock"', page)
        self.assertNotIn('id="aiAccessCode"', page)
        self.assertIn('data-step-id="step-1-1"', page)
        self.assertIn('data-step-number="1"', page)
        self.assertIn("Finish cooking", page)
        self.assertIn('id="timerRail"', page)
        self.assertIn('id="textSize"', page)
        self.assertIn('id="personalNote"', page)
        self.assertIn('id="favouriteRecipe"', page)
        self.assertIn('class="ai-panel"', page)
        self.assertIn("Start listening", page)
        self.assertNotIn("Type a question", page)
        self.assertIn('id="savePdf" type="button"', page)

    def test_pipeline_keywords_survive_search_index(self):
        value = search_record(self.recipe)
        self.assertEqual(value["keywords"], "stew dinner")
        json.dumps(value)

    def test_search_index_has_normalized_discovery_metadata(self):
        value = search_record(self.recipe)
        self.assertEqual(duration_minutes("1 hr 40 min"), 100)
        self.assertEqual(normalized_course("Main Course"), "main")
        self.assertEqual(value["normalizedCourse"], "main")
        self.assertIn("durationMinutes", value)
        self.assertIn("primaryIngredients", value)


if __name__ == "__main__":
    unittest.main()

import unittest

from pipeline.expand_corpus import numbers_in, select, validate
from potbelly.model import normalize_recipe
from tests.test_model import recipe


def candidate(**overrides):
    value = {
        "slug": "instant-pot-stew",
        "title": "Pressure Cooker Beef Supper",
        "source_url": "https://other.example/instant-pot-stew/",
        "rating": 4.9,
        "rating_count": 200,
        "step_groups_RAW": [{"name": "", "steps": ["Cook for 30 minutes."]}],
        "ingredient_groups": [{"name": "", "items": ["1 lb beef"]}],
    }
    value.update(overrides)
    return value


class PipelineTests(unittest.TestCase):
    def test_cross_publisher_slug_collision_reaches_route_assignment(self):
        existing = [normalize_recipe(recipe())]
        selected = select([candidate()], existing, 1)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["source_url"], "https://other.example/instant-pot-stew/")

    def test_number_validation_is_fail_closed(self):
        raw = candidate()
        clean = {
            "title": "Beef Supper", "description": "Dinner.", "course": "Main",
            "cuisine": "American", "servings": "4", "prep_time": "", "cook_time": "",
            "total_time": "30 min", "ingredient_groups": raw["ingredient_groups"],
            "step_groups": [{"name": "", "steps": ["Cook until tender."]}],
            "notes": [], "nutrition": "", "keywords": ["beef"],
        }
        self.assertIn("lost numbers: ['30']", validate(raw, clean))
        self.assertEqual(numbers_in("½ cup, then 1/2 cup"), {"1/2": 2})


if __name__ == "__main__":
    unittest.main()

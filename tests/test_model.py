import copy
import unittest

from potbelly.model import (
    RecipeValidationError,
    assert_unique,
    assign_unique_slugs,
    canonical_source_url,
    normalize_recipe,
    source_id,
)


def recipe(**overrides):
    value = {
        "slug": "instant-pot-stew",
        "title": "Instant Pot Stew",
        "description": "A concise stew.",
        "category": "Beef",
        "course": "Main Course",
        "cuisine": "American",
        "servings": "6",
        "prep_time": "10 min",
        "cook_time": "30 min",
        "total_time": "40 min",
        "ingredient_groups": [{"name": "", "items": ["1 lb beef"]}],
        "step_groups": [{"name": "", "steps": ["Cook for 30 minutes."]}],
        "notes": [],
        "nutrition": "",
        "keywords": ["stew", "dinner"],
        "rating": 4.8,
        "rating_count": 120,
        "source_name": "Example Kitchen",
        "source_url": "https://example.com/instant-pot-stew/",
    }
    value.update(overrides)
    return value


class RecipeModelTests(unittest.TestCase):
    def test_source_identity_uses_canonical_https_url(self):
        a = "https://EXAMPLE.com/instant-pot-stew"
        b = "https://example.com/instant-pot-stew/"
        self.assertEqual(canonical_source_url(a), b)
        self.assertEqual(source_id(a), source_id(b))

    def test_rejects_active_and_credentialed_urls(self):
        for url in ("javascript:alert(1)", "http://example.com/a", "https://u:p@example.com/a"):
            with self.subTest(url=url), self.assertRaises(RecipeValidationError):
                normalize_recipe(recipe(source_url=url))

    def test_legacy_keywords_are_only_a_fallback(self):
        custom = normalize_recipe(recipe(keywords=["custom", "phrase"]))
        self.assertEqual(custom["keywords"], ["custom", "phrase"])

        legacy = normalize_recipe(recipe(slug="instant-pot-chili", keywords=None))
        self.assertIn("game", legacy["keywords"])

    def test_duplicate_routes_fail_closed(self):
        first = normalize_recipe(recipe())
        second = copy.deepcopy(first)
        second["source_url"] = "https://other.example/instant-pot-stew/"
        second["source_id"] = source_id(second["source_url"])
        with self.assertRaisesRegex(RecipeValidationError, "duplicate slug"):
            assert_unique([first, second])

    def test_cross_host_slug_collision_gets_deterministic_routes(self):
        candidates = [
            recipe(source_url="https://alpha.example/instant-pot-brisket/", slug="instant-pot-brisket"),
            recipe(source_url="https://beta.example/instant-pot-brisket/", slug="instant-pot-brisket"),
        ]
        assigned = assign_unique_slugs(candidates)
        self.assertEqual(
            {item["slug"] for item in assigned},
            {"instant-pot-brisket-alpha", "instant-pot-brisket-beta"},
        )

    def test_existing_route_is_preserved(self):
        current = normalize_recipe(recipe())
        incoming = recipe(source_url=current["source_url"], slug="changed-slug")
        assigned = assign_unique_slugs([incoming], [current])
        self.assertEqual(assigned[0]["slug"], current["slug"])

    def test_rejects_invalid_structural_data(self):
        for field, value in (
            ("slug", "../escape"),
            ("ingredient_groups", []),
            ("step_groups", [{"name": "", "steps": [""]}]),
            ("rating", 7),
        ):
            with self.subTest(field=field), self.assertRaises(RecipeValidationError):
                normalize_recipe(recipe(**{field: value}))


if __name__ == "__main__":
    unittest.main()

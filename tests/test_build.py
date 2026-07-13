import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build
from tests.test_model import recipe


class AtomicBuildTests(unittest.TestCase):
    def test_build_replaces_output_and_removes_stale_routes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corpus = root / "data.json"
            corpus.write_text(json.dumps([recipe()]), encoding="utf-8")
            output = root / "public"
            (output / "recipe").mkdir(parents=True)
            (output / "recipe" / "stale.html").write_text("stale", encoding="utf-8")

            def fake_pdfs(recipes, target, fonts):
                target.mkdir(parents=True, exist_ok=True)
                for item in recipes:
                    (target / f'{item["slug"]}.pdf').write_bytes(b"%PDF-1.4 test")

            with patch("build.render_pdfs", side_effect=fake_pdfs):
                report = build.atomic_build(corpus, output, "https://potbelly.example")
            self.assertEqual(report["recipes"], 1)
            self.assertFalse((output / "recipe" / "stale.html").exists())
            self.assertTrue((output / "recipe" / "instant-pot-stew.html").exists())


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path

from scripts.check_links import validate


class ReleaseArtifactValidationTests(unittest.TestCase):
    def write_artifact(self, root: Path, canonical: str) -> None:
        (root / "assets").mkdir()
        (root / "assets" / "site.css").write_text("body {}", encoding="utf-8")
        (root / "index.html").write_text(
            '<link rel="canonical" href="'
            + canonical
            + '"><link rel="stylesheet" href="/assets/site.css">',
            encoding="utf-8",
        )

    def test_accepts_expected_production_canonical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_artifact(root, "https://potbelly.example/")

            _checked, failures = validate(root, "https://potbelly.example")

            self.assertEqual(failures, [])

    def test_rejects_artifact_rebuilt_for_localhost(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_artifact(root, "http://127.0.0.1:4173/")

            _checked, failures = validate(root, "https://potbelly.example")

            self.assertEqual(len(failures), 1)
            self.assertIn("canonical", failures[0])
            self.assertIn("127.0.0.1", failures[0])


if __name__ == "__main__":
    unittest.main()

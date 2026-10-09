"""Repo integrity tests. Run: python3 -m unittest discover -s tests -v"""
import json, os, subprocess, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMAS = os.path.join(ROOT, "08_AUTOMATION", "schemas")

VALID_EPISODE = {  # neutral placeholder, not canon
    "id": "EP000", "format": "mini", "status": "idea", "target_age": "2-5",
    "idea": "A lost sound is found by listening carefully.", "emotion": "curiosity",
    "beats": {k: "placeholder" for k in ["hook", "setup", "problem", "attempt", "discovery", "resolution", "payoff"]},
    "pauses": [{"at_s": 12, "len_s": 2.5, "prompted_sound": "placeholder"}],
    "audio_mode": "A_no_dialogue", "duration_target_s": 45,
}


class Integrity(unittest.TestCase):
    def test_validator_passes(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "08_AUTOMATION/scripts/validate_assets.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_autonomy_safe_defaults(self):
        import yaml
        cfg = yaml.safe_load(open(os.path.join(ROOT, "08_AUTOMATION/configs/autonomy.yml")))
        self.assertFalse(cfg["spending_enabled"])
        self.assertFalse(cfg["publishing_enabled"])
        self.assertGreaterEqual(cfg["budget"]["reserve_pct"], 30)

    def test_schemas_are_valid_json(self):
        for f in os.listdir(SCHEMAS):
            if f.endswith(".json"):
                json.load(open(os.path.join(SCHEMAS, f)))


@unittest.skipUnless(__import__("importlib").util.find_spec("jsonschema"), "jsonschema not installed")
class EpisodeSchema(unittest.TestCase):
    def setUp(self):
        import jsonschema
        self.v = jsonschema.Draft202012Validator(json.load(open(os.path.join(SCHEMAS, "episode.schema.json"))))

    def test_valid(self):
        self.assertEqual(list(self.v.iter_errors(VALID_EPISODE)), [])

    def test_missing_beat_rejected(self):
        bad = json.loads(json.dumps(VALID_EPISODE)); del bad["beats"]["payoff"]
        self.assertTrue(list(self.v.iter_errors(bad)))

    def test_pause_too_short_rejected(self):
        bad = json.loads(json.dumps(VALID_EPISODE)); bad["pauses"][0]["len_s"] = 0.5
        self.assertTrue(list(self.v.iter_errors(bad)))


if __name__ == "__main__":
    unittest.main()

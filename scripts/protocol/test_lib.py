"""Tests for lib.label_applier: whose approval label the protocol check may count (D-24).
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/protocol -p 'test_*.py'"""
import unittest

from lib import label_applier


def event(login, kind="User", app=None):
    e = {"event": "labeled", "actor": {"login": login, "type": kind}}
    if app is not None:
        e["performed_via_github_app"] = app
    return e


class LabelApplier(unittest.TestCase):
    def test_person_by_hand(self):
        self.assertEqual(label_applier(event("ar835")), "ar835")

    def test_person_with_null_app(self):
        self.assertEqual(label_applier(event("ar835", app={})), "ar835")
        e = event("ar835")
        e["performed_via_github_app"] = None
        self.assertEqual(label_applier(e), "ar835")

    def test_person_through_their_claude_code_session(self):
        self.assertEqual(label_applier(event("abnutrivo", app={"slug": "claude", "id": 1236702})), "abnutrivo")

    def test_person_through_another_app(self):
        self.assertIsNone(label_applier(event("ar835", app={"slug": "some-other-app"})))

    def test_bot_accounts_never_count(self):
        self.assertIsNone(label_applier(event("claude[bot]", kind="Bot")))
        self.assertIsNone(label_applier(event("claude[bot]", kind="Bot", app={"slug": "claude"})))
        self.assertIsNone(label_applier(event("github-actions[bot]", kind="Bot")))
        self.assertIsNone(label_applier(event("dependabot[bot]", kind="Bot", app={"slug": "dependabot"})))

    def test_missing_actor(self):
        self.assertIsNone(label_applier({"event": "labeled"}))
        self.assertIsNone(label_applier({"event": "labeled", "actor": None}))


if __name__ == "__main__":
    unittest.main()

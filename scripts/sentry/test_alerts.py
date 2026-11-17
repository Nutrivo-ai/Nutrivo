"""Tests for Sentry alert routing (T-1102): the config against docs/17 and spec/nfr.yaml, and a fake Sentry API.
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/sentry -p 'test_*.py'"""
import os, unittest

import yaml

import alerts

ENV = {"SENTRY_PROJECT_WEB": "nutrivo-web", "SENTRY_PROJECT_WORKER": "nutrivo-worker"}.get
CFG = alerts.load()


def nfr():
    with open(os.path.join(alerts.ROOT, "spec/nfr.yaml"), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


class FakeApi(alerts.Api):
    def __init__(self, existing=None, answer=201):
        super().__init__("https://de.sentry.io", "nutrivo", "token")
        self.existing, self.answer, self.calls = existing or {}, answer, []

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET":
            return 200, self.existing.get(path, [])
        return self.answer, {}


class Config(unittest.TestCase):
    def test_new_production_issues_reach_email_and_github(self):
        rule = next(r for r in CFG["issue_alerts"] if r["name"] == "New issue in production")
        self.assertEqual(rule["environment"], "prod")
        self.assertEqual(set(rule["notify"]), {"email", "github_issue"})
        self.assertEqual(set(rule["projects"]), {"web", "worker", "functions"})

    def test_missed_crons_alert_in_every_project_that_has_monitors(self):
        rule = next(r for r in CFG["issue_alerts"] if r.get("category") == "cron")
        with open(os.path.join(alerts.ROOT, "config/monitors.yaml"), encoding="utf-8") as fh:
            projects = {m["project"] for m in yaml.safe_load(fh)["monitors"]}
        self.assertTrue(projects <= set(rule["projects"]), projects)
        self.assertIsNone(rule["environment"])

    def test_an_error_rate_alert_for_web_and_worker(self):
        rates = {r["project"] for r in CFG["metric_alerts"] if r["aggregate"] == "failure_rate()"}
        self.assertEqual(rates, {"web", "worker"})

    def test_nfr_every_performance_budget_has_an_alert_or_a_reason(self):
        budgets = {f"performance.{k}" for k in nfr()["performance"]}
        alerted = {r["budget"] for r in CFG["metric_alerts"] if r.get("budget")}
        reasons = set(CFG.get("not_alerted") or {})
        self.assertEqual(budgets - alerted - reasons, set())
        self.assertEqual((alerted | reasons) - budgets, set())     # nothing names a budget that is gone
        self.assertEqual(alerted & reasons, set())

    def test_nfr_latency_thresholds_equal_the_budgets(self):
        perf = nfr()["performance"]
        for rule in (r for r in CFG["metric_alerts"] if r.get("budget")):
            key = rule["budget"].split(".", 1)[1]
            budget_ms = perf[key] * 1000 if key.endswith("_s") else perf[key]
            self.assertEqual(rule["above_ms"], budget_ms, rule["name"])

    def test_docs_17_describes_the_routing(self):
        with open(os.path.join(alerts.ROOT, "docs/17-observability.md"), encoding="utf-8") as fh:
            docs = fh.read()
        for text in ("config/sentry-alerts.yaml", "SENTRY_ALERT_TEAM", "sentry-alerts.yml"):
            self.assertIn(text, docs)

    def test_names_are_unique(self):
        names = [r["name"] for r in CFG["issue_alerts"] + CFG["metric_alerts"]]
        self.assertEqual(len(names), len(set(names)))


class Payloads(unittest.TestCase):
    def test_issue_alert_payload(self):
        rules = alerts.desired(CFG, "42", "7", ENV)
        new = [(p, b) for k, p, b in rules if b["name"] == "New issue in production"]
        self.assertEqual([p for p, _ in new], ["nutrivo-web", "nutrivo-worker", "nutrivo-functions"])
        body = new[0][1]
        self.assertEqual(body["conditions"], [{"id": alerts.FIRST_SEEN}])
        self.assertEqual(body["actions"][0], {"id": alerts.EMAIL_ACTION, "targetType": "Team", "targetIdentifier": 42,
                                              "fallthroughType": "ActiveMembers"})
        self.assertEqual(body["actions"][1]["repo"], "Nutrivo-ai/Nutrivo")
        self.assertEqual(body["actions"][1]["integration"], "7")

    def test_cron_alert_filters_on_the_cron_category_in_every_environment(self):
        body = next(b for _, _, b in alerts.desired(CFG, 1, "7", ENV) if b["name"] == "Missed or failed cron")
        self.assertEqual(body["filters"], [{"id": alerts.CATEGORY_FILTER, "value": "4"}])
        self.assertIsNone(body["environment"])

    def test_metric_alerts_are_production_only_and_email_the_team(self):
        for kind, _, body in alerts.desired(CFG, 42, "7", ENV):
            if kind == "metric":
                self.assertEqual(body["environment"], "prod")
                self.assertEqual(body["triggers"][0]["actions"][0]["targetIdentifier"], "42")

    def test_github_issue_without_the_integration_is_refused(self):
        with self.assertRaisesRegex(ValueError, "GitHub integration is not installed"):
            alerts.desired(CFG, 1, None, ENV)

    def test_a_missing_project_variable_stops(self):
        with self.assertRaises(SystemExit):
            alerts.desired(CFG, 1, "7", {}.get)


class Sync(unittest.TestCase):
    def rules(self):
        return alerts.desired(CFG, 42, "7", ENV)

    def test_check_reports_missing_rules_and_writes_nothing(self):
        api, lines = FakeApi(), []
        drift = alerts.sync(api, self.rules(), apply=False, out=lines.append)
        self.assertEqual(drift, len(self.rules()))
        self.assertTrue(all(m == "GET" for m, _, _ in api.calls))
        self.assertTrue(all(l.endswith(": missing") for l in lines))

    def test_apply_creates_missing_and_updates_different_rules_by_name(self):
        rules = self.rules()
        _, project, first = rules[0]
        path = f"projects/nutrivo/{project}/rules/"
        changed = {**first, "id": "99", "frequency": 5}
        same_kind, same_project, same = next(r for r in rules if r[0] == "metric")
        metric_path = "organizations/nutrivo/alert-rules/"
        up_to_date = {**same, "id": "100", "triggers": [{**same["triggers"][0], "id": "t1"}]}
        api = FakeApi({path: [changed], metric_path: [up_to_date]})
        lines = []
        alerts.sync(api, rules, apply=True, out=lines.append)
        writes = [(m, p) for m, p, _ in api.calls if m != "GET"]
        self.assertIn(("PUT", f"{path}99/"), writes)
        self.assertNotIn(("PUT", f"{metric_path}100/"), writes)
        self.assertEqual(len(writes), len(rules) - 1)
        self.assertIn(f"metric alert '{same['name']}': up to date", lines)

    def test_a_refused_write_stops(self):
        with self.assertRaises(SystemExit):
            alerts.sync(FakeApi(answer=400), self.rules(), apply=True, out=lambda _: None)

    def test_differs_is_loose_about_ids_and_numbers(self):
        self.assertFalse(alerts.differs({"a": 42, "b": [1]}, {"a": "42", "b": [1.0], "extra": 1}))
        self.assertTrue(alerts.differs({"a": 42}, {"a": 43}))
        self.assertTrue(alerts.differs({"a": None}, {"a": "prod"}))


if __name__ == "__main__":
    unittest.main()

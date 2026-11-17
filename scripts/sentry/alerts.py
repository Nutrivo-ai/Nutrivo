"""Sentry alert routing as code (T-1102, docs/17 "Alerts"), from config/sentry-alerts.yaml.

  alerts.py check     read-only: list each rule that is missing or differs; exit 1 when any does
  alerts.py apply     create or update each rule by name; rules the file does not name are left alone
  alerts.py plan      print the payloads that would be sent, with placeholder ids; needs no keys or network

Runs only in GitHub Actions (sentry-alerts.yml, production environment), with SENTRY_AUTH_TOKEN (scopes alerts:write,
project:read, team:read, org:read), SENTRY_ORG, SENTRY_PROJECT_WEB, SENTRY_PROJECT_WORKER and optionally
SENTRY_PROJECT_FUNCTIONS, SENTRY_ALERT_TEAM and SENTRY_URL. Prints rule names and outcomes, never a token."""
import argparse, json, os, sys, urllib.error, urllib.parse, urllib.request

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG = os.path.join(ROOT, "config/sentry-alerts.yaml")
E = os.environ.get

FIRST_SEEN = "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"
CATEGORY_FILTER = "sentry.rules.filters.issue_category.IssueCategoryFilter"
CATEGORIES = {"error": "1", "performance": "2", "cron": "4"}       # Sentry's GroupCategory values
EMAIL_ACTION = "sentry.mail.actions.NotifyEmailAction"
GITHUB_ACTION = "sentry.integrations.github.notify_action.GitHubCreateTicketAction"
DEFAULT_PROJECTS = {"SENTRY_PROJECT_FUNCTIONS": "nutrivo-functions"}


def load(path=CONFIG):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def project_slug(cfg, role, env=E):
    var = cfg["projects"][role]
    slug = env(var) or DEFAULT_PROJECTS.get(var)
    if not slug:
        raise SystemExit(f"{var} is not set (the Sentry project for {role})")
    return slug


def issue_rule(rule, team_id, github=None, cfg=None):
    """The body of POST /api/0/projects/{org}/{project}/rules/ for one issue alert."""
    if rule.get("when") != "first_seen":
        raise ValueError(f"{rule['name']}: only `when: first_seen` is supported")
    actions = []
    for target in rule["notify"]:
        if target == "email":
            actions.append({"id": EMAIL_ACTION, "targetType": "Team", "targetIdentifier": int(team_id),
                            "fallthroughType": "ActiveMembers"})
        elif target == "github_issue":
            if github is None:
                raise ValueError(f"{rule['name']}: Sentry's GitHub integration is not installed in the organisation")
            actions.append({"id": GITHUB_ACTION, "integration": str(github), "repo": cfg["github_repo"],
                            "labels": list(cfg.get("github_labels") or [])})
        else:
            raise ValueError(f"{rule['name']}: unknown target {target!r}")
    filters = []
    if rule.get("category"):
        filters.append({"id": CATEGORY_FILTER, "value": CATEGORIES[rule["category"]]})
    return {"name": rule["name"], "environment": rule.get("environment"), "actionMatch": "any",
            "filterMatch": "all", "frequency": int(rule["frequency_min"]), "conditions": [{"id": FIRST_SEEN}],
            "filters": filters, "actions": actions}


def metric_rule(rule, team_id, project):
    """The body of POST /api/0/organizations/{org}/alert-rules/ for one metric alert (production only)."""
    threshold = rule["above_ms"] if "above_ms" in rule else rule["above"]
    return {"name": rule["name"], "dataset": "transactions", "eventTypes": ["transaction"],
            "aggregate": rule["aggregate"], "query": rule.get("query") or "", "timeWindow": int(rule["window_min"]),
            "thresholdType": 0, "resolveThreshold": None, "environment": "prod", "projects": [project],
            "triggers": [{"label": "critical", "alertThreshold": threshold,
                          "actions": [{"type": "email", "targetType": "team", "targetIdentifier": str(team_id)}]}]}


def desired(cfg, team_id, github, env=E):
    """[(kind, project or None, payload)] for every rule in the file."""
    out = []
    for rule in cfg.get("issue_alerts") or []:
        for role in rule["projects"]:
            out.append(("issue", project_slug(cfg, role, env), issue_rule(rule, team_id, github, cfg)))
    for rule in cfg.get("metric_alerts") or []:
        project = project_slug(cfg, rule["project"], env)
        out.append(("metric", None, metric_rule(rule, team_id, project)))
    return out


def differs(want, have):
    """Loose comparison: every key we send must come back equal; ids and numbers are compared as text."""
    if isinstance(want, dict):
        return not isinstance(have, dict) or any(differs(v, have.get(k)) for k, v in want.items())
    if isinstance(want, list):
        return not isinstance(have, list) or len(want) != len(have) or any(differs(a, b) for a, b in zip(want, have))
    if want is None:
        return have not in (None, "")
    if isinstance(want, (int, float)) and not isinstance(want, bool):
        try:
            return float(want) != float(have)
        except (TypeError, ValueError):
            return True
    return str(want) != str(have)


class Api:
    def __init__(self, base, org, token):
        self.base, self.org, self.token = base.rstrip("/"), org, token

    def call(self, method, path, body=None):
        req = urllib.request.Request(f"{self.base}/api/0/{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {self.token}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, None

    def get(self, path):
        status, body = self.call("GET", path)
        if status != 200:
            raise SystemExit(f"GET {path.split('?')[0]} answered {status}")
        return body


def resolve(api, team_slug):
    team = api.get(f"teams/{api.org}/{urllib.parse.quote(team_slug)}/")
    integrations = api.get(f"organizations/{api.org}/integrations/?provider_key=github")
    return team["id"], (integrations[0]["id"] if integrations else None)


def sync(api, rules, apply, out=print):
    """Compare (and with apply, create or update) each rule; returns how many were missing or differed."""
    drift, cache = 0, {}
    for kind, project, payload in rules:
        path = (f"projects/{api.org}/{project}/rules/" if kind == "issue"
                else f"organizations/{api.org}/alert-rules/")
        if path not in cache:
            cache[path] = api.get(path)
        existing = next((r for r in cache[path] if r.get("name") == payload["name"]), None)
        label = f"{kind} alert '{payload['name']}'" + (f" ({project})" if project else "")
        if existing is not None and not differs(payload, existing):
            out(f"{label}: up to date")
            continue
        drift += 1
        state = "missing" if existing is None else "differs"
        if not apply:
            out(f"{label}: {state}")
            continue
        method, target = ("POST", path) if existing is None else ("PUT", f"{path}{existing['id']}/")
        status, _ = api.call(method, target, payload)
        if status not in (200, 201, 202):
            raise SystemExit(f"{label}: {method} answered {status}")
        out(f"{label}: {'created' if existing is None else 'updated'}")
    return drift


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["check", "apply", "plan"])
    args = ap.parse_args(argv)
    cfg = load()
    team_slug = E("SENTRY_ALERT_TEAM") or cfg["team"]
    if args.mode == "plan":
        env = lambda n: E(n) or f"<{n}>"   # noqa: E731
        for kind, project, payload in desired(cfg, 0, "<github>", env):
            print(json.dumps({"kind": kind, "project": project, "payload": payload}))
        return 0
    missing = [n for n in ("SENTRY_AUTH_TOKEN", "SENTRY_ORG") if not E(n)]
    if missing:
        raise SystemExit("missing " + ", ".join(missing))
    api = Api(E("SENTRY_URL") or "https://de.sentry.io", E("SENTRY_ORG"), E("SENTRY_AUTH_TOKEN"))
    team_id, github = resolve(api, team_slug)
    drift = sync(api, desired(cfg, team_id, github), apply=args.mode == "apply")
    print(f"{drift} rule(s) {'changed' if args.mode == 'apply' else 'missing or different'}; team {team_slug}")
    return 1 if drift and args.mode == "check" else 0


if __name__ == "__main__":
    sys.exit(main())

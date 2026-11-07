"""Pull request actions for founder sessions, guarded by the D-24 rules (CLAUDE.md non-negotiable 11).

  make pr-check PR=123                       read-only: would pr-merge merge it, and if not, why
  make pr-merge PR=123                       squash-merge, only when every rule below holds
  make pr-update PR=123                      merge main into the PR branch (GitHub's "Update branch")
  make pr-review PR=123 EVENT=APPROVE BODY=file.md    APPROVE, REQUEST_CHANGES or COMMENT
  make pr-comment PR=123 BODY=file.md        a comment on a PR or issue

Merge requires, re-read from GitHub at the moment of merging:
  - the PR is open, not a draft, and its head is up to date with main (behind_by == 0);
  - every required check in .github/rulesets/main.json succeeded on the head SHA;
  - no reviewer's latest review requests changes;
  - every review thread is resolved;
  - the merge is pinned to the head SHA that was checked, so a push in between fails the merge.
Approve requires that this account did not author the PR and is not behind its last commit.

These are the only GitHub writes a session makes outside lib.api's claim and sync scripts. `.claude/settings.json`
still denies `gh api -X` from the shell, so a session cannot skip these checks. Repository-scoped REST only, so it
also runs in Claude Code on the web.
"""
import argparse, json, subprocess, sys
from lib import ROOT, api, gh_failure, gh_json, sh

RULESET = ROOT / ".github/rulesets/main.json"


def required_checks():
    rules = json.loads(RULESET.read_text(encoding="utf-8"))["rules"]
    for r in rules:
        if r["type"] == "required_status_checks":
            return [c["context"] for c in r["parameters"]["required_status_checks"]]
    sys.exit(f"no required_status_checks rule in {RULESET.relative_to(ROOT)}: refusing to merge without one")


def me():
    try:
        return gh_json("api", "user")["login"].lower()
    except subprocess.CalledProcessError as e:
        sys.exit(gh_failure(e))


def pages(path):
    return [x for page in api(path, "--paginate", "--slurp") for x in page]


def checks_on(sha):
    """name -> 'success' when any run of that check succeeded (or was skipped), else its latest conclusion/status."""
    out = {}
    runs = [r for page in api(f"commits/{sha}/check-runs?per_page=100", "--paginate", "--slurp") for r in page["check_runs"]]
    for run in runs:
        state = run.get("conclusion") or run.get("status")
        if out.get(run["name"]) not in ("success", "skipped"):
            out[run["name"]] = state
    return out


def unresolved_threads(n):
    threads = api(f"pulls/{n}/ccr/review_threads") or []
    if isinstance(threads, dict):
        threads = threads.get("threads") or threads.get("data") or []
    return [t for t in threads if not (t.get("isResolved") or t.get("is_resolved") or t.get("resolved"))]


def blocking_reviews(n):
    latest = {}
    for r in pages(f"pulls/{n}/reviews?per_page=100"):
        if r["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[r["user"]["login"]] = r["state"]
    return sorted(u for u, s in latest.items() if s == "CHANGES_REQUESTED")


def merge(n, dry=False):
    pr = api(f"pulls/{n}")
    sha, problems = pr["head"]["sha"], []
    if pr["state"] != "open":
        sys.exit(f"#{n} is {pr['state']}")
    if pr["draft"]:
        problems.append("it is a draft")
    behind = api(f"compare/{pr['base']['ref']}...{sha}")["behind_by"]
    if pr["base"]["ref"] != "main":
        problems.append(f"its base is {pr['base']['ref']}, not main")
    if behind:
        problems.append(f"it is {behind} commit(s) behind main: make pr-update PR={n}, then wait for the checks")
    got = checks_on(sha)
    bad = [f"{c}={got.get(c, 'missing')}" for c in required_checks() if got.get(c) not in ("success", "skipped")]
    if bad:
        problems.append("required checks not green on " + sha[:7] + ": " + ", ".join(bad))
    if who := blocking_reviews(n):
        problems.append("changes requested by " + ", ".join(who))
    if threads := unresolved_threads(n):
        problems.append(f"{len(threads)} review thread(s) unresolved")
    if problems:
        sys.exit(f"not merging #{n}:\n  - " + "\n  - ".join(problems))
    if dry:
        print(f"#{n} at {sha[:7]} is ready to merge")
        return
    res = api(f"pulls/{n}/merge", "-X", "PUT", "-f", "merge_method=squash", "-f", f"sha={sha}")
    print(f"merged #{n} at {sha[:7]} as {res['sha'][:7]}")


def update(n):
    pr = api(f"pulls/{n}")
    res = api(f"pulls/{n}/update-branch", "-X", "PUT", "-f", f"expected_head_sha={pr['head']['sha']}")
    print(res.get("message", "updated"))


def review(n, event, body):
    if event not in ("APPROVE", "REQUEST_CHANGES", "COMMENT"):
        sys.exit("EVENT must be APPROVE, REQUEST_CHANGES or COMMENT")
    if event == "APPROVE":
        pr, login = api(f"pulls/{n}"), me()
        if pr["user"]["login"].lower() == login:
            sys.exit(f"not approving #{n}: you authored it (D-24)")
        last = pages(f"pulls/{n}/commits?per_page=100")[-1]
        pushers = {((last.get(k) or {}).get("login") or "").lower() for k in ("author", "committer")}
        if login in pushers:
            sys.exit(f"not approving #{n}: its last commit is yours (D-24)")
    res = api(f"pulls/{n}/reviews", "-X", "POST", "-f", f"event={event}", "-F", f"body=@{body}")
    print(f"{res['state']} on #{n}: {res['html_url']}")


def comment(n, body):
    res = api(f"issues/{n}/comments", "-X", "POST", "-F", f"body=@{body}")
    print(res["html_url"])


ap = argparse.ArgumentParser()
ap.add_argument("action", choices=["check", "merge", "update", "review", "comment"])
ap.add_argument("pr", type=int)
ap.add_argument("--event", default="COMMENT")
ap.add_argument("--body")
a = ap.parse_args()
try:
    if a.action in ("review", "comment") and not a.body:
        sys.exit("BODY=<file> is required")
    {"check": lambda: merge(a.pr, dry=True), "merge": lambda: merge(a.pr), "update": lambda: update(a.pr),
     "review": lambda: review(a.pr, a.event, a.body), "comment": lambda: comment(a.pr, a.body)}[a.action]()
except subprocess.CalledProcessError as e:
    sys.exit(gh_failure(e))

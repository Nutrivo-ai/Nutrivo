"""Shared helpers for the build protocol scripts. Run them with: uv run --no-project --with pyyaml python <script>."""
import json, os, re, subprocess
from fnmatch import fnmatch
from functools import cache
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
# An acceptance ID in a test title: [A01.main], 'ok 3 - [A01.must.1]', or pytest's test_D04_must_1_x (docs/19).
# Not \b: '_' is a word character, so \b never matches inside test_A01_main.
ID_RE = re.compile(r"(?<![A-Za-z0-9])([A-P]\d{2})[._](main|must[._]\d+|fail[._]\d+)(?![A-Za-z0-9])")


def load(rel):
    return yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))


def plan():
    return load("plan/tasks.yaml")


def acceptance():
    return load("spec/acceptance.yaml")["workflows"]


def task_by_id(p, tid):
    return next((t for t in p["tasks"] if t["id"] == tid), None)


def acceptance_ids(task, acc):
    ids = []
    for wf in task.get("wf", []):
        ids += list((acc.get(wf) or {}).get("tests", {}).keys())
    return ids


def allowed_paths(p, task):
    paths = list(p.get("always_allowed", []))
    for lane in task.get("lanes", []):
        paths += p["lanes"][lane]
    return paths


def matches(path, patterns):
    return any(fnmatch(path, pat) for pat in patterns)


def normalise_id(m):
    return f"{m.group(1)}.{m.group(2).replace('_', '.')}"


def sh(*cmd, check=True):
    return subprocess.run(cmd, check=check, capture_output=True, text=True, cwd=ROOT).stdout


def gh_json(*args):
    return json.loads(sh("gh", *args) or "null")


@cache
def repo():
    """owner/name: GH_REPO, else the origin remote (https, ssh or a cloud session's git proxy URL all end in it)."""
    src = os.environ.get("GH_REPO") or sh("git", "remote", "get-url", "origin").strip()
    return "/".join(re.sub(r"\.git$", "", src.rstrip("/")).replace(":", "/").split("/")[-2:])


def api(path, *args):
    """Repository-scoped REST: gh api repos/{owner}/{name}/<path>. The GitHub proxy of Claude Code on the web serves
    only these; it refuses GraphQL (gh issue, gh pr) and paths outside the repository (gh api user)."""
    return gh_json("api", f"repos/{repo()}/{path}", *args)


# D-24: a Claude Code session acts through the Claude GitHub App on its founder's own account, so a label it applies is
# that founder's. Any other app, and every bot account (the autopilot is claude[bot]), never counts as a person.
SESSION_APPS = {"claude"}


def label_applier(event):
    """The login of the person behind an issue event, or None when a bot or an app outside SESSION_APPS made it."""
    actor = event.get("actor") or {}
    app = (event.get("performed_via_github_app") or {}).get("slug")
    if actor.get("type") != "User" or (app is not None and app not in SESSION_APPS):
        return None
    return actor.get("login")


def gh_failure(e):
    """A failed gh or git call as a message for sys.exit, with gh's own words instead of a traceback."""
    why = (e.stderr or "").strip() or f"exit {e.returncode}"
    if tuple(e.cmd[:2]) in (("gh", "issue"), ("gh", "pr")) and re.search(r"403|graphql", why, re.I):
        why += "\n(gh issue and gh pr use GraphQL, which Claude Code on the web refuses: run it on a laptop or in Actions)"
    return f"{' '.join(e.cmd[:3])} failed: {why}"


def ms_rank(p, ms):
    return p["milestone_order"].index(ms)


def task_num(tid):
    return int(tid.split("-")[1])

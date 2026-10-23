"""CI 'protocol' check for pull requests: a task (closing its own open issue), its lanes only, no protected files
without approval.
Without a task: a Dependabot PR that changes only dependency files; 'Incident: #N' for a PR that closes an incident or
nightly issue; 'Task: none' for a founder's change to the target, with 'human-approved'. An approval label counts only
when a founder applied it: a code owner on the base branch or a repository admin, by hand or through their Claude Code
session (D-24), never a bot or another app.
The plan and CODEOWNERS are read as committed on the base branch, so a PR cannot loosen the rules it is checked by."""
import os, re, subprocess, sys
from functools import cache
import yaml
from lib import allowed_paths, gh_json, label_applier, matches, plan, repo, sh, task_by_id

DEPENDENCY_FILES = [".github/workflows/*.yml", ".github/actions/*/action.yml", "apps/web/package.json", "pnpm-lock.yaml",
                    "apps/web/pnpm-lock.yaml", "worker/pyproject.toml", "worker/uv.lock", "worker/Dockerfile"]
TYPES = "apps/web/src/lib/database.types.ts"  # make typegen output, part of a migration change (CLAUDE.md)
# GitHub's closing keywords, with '#N', 'owner/repo#N' or the issue's URL
CLOSES = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+"
                    r"(?:https://github\.com/[\w.-]+/[\w.-]+/issues/|(?:[\w.-]+/[\w.-]+)?#)(\d+)\b", re.I)

pr, base = os.environ["PR_NUMBER"], os.environ["BASE_SHA"]
# From the base commit: otherwise a PR could empty 'protected' or widen its own lanes in plan/tasks.yaml and pass.
p = yaml.safe_load(sh("git", "show", f"{base}:plan/tasks.yaml", check=False) or "null") or plan()
info = gh_json("pr", "view", pr, "--json", "author,body,labels,headRefName")
labels = {l["name"] for l in info["labels"]}
body = info.get("body") or ""
author = (info.get("author") or {}).get("login", "")
# --no-renames: a moved file also lists its old path, as a deletion, so moving a gate test out of the oracle is seen.
# Only additions to the legacy/ archive are skipped. -z: paths may hold spaces.
diff = sh("git", "diff", "--no-renames", "--name-status", "-z", f"{base}...HEAD").split("\0")
files = [f for st, f in zip(diff[::2], diff[1::2]) if not (st == "A" and f.startswith("legacy/"))]


@cache
def founders():
    """Logins on the '*' line of .github/CODEOWNERS as committed on the base branch, so a PR cannot add its own author."""
    owners = sh("git", "show", f"{base}:.github/CODEOWNERS", check=False)
    line = ([l.split() for l in owners.splitlines() if l.split()[:1] == ["*"]] or [[]])[-1]  # the last match wins
    return {o[1:].lower() for o in line[1:] if o.startswith("@") and "/" not in o}


def gh_or_none(*args):
    try:
        return gh_json(*args)
    except subprocess.CalledProcessError:
        return None


@cache
def unapproved(label):
    """Why `label` does not count, or None: its latest 'labeled' event must be by a founder (a code owner on main, or a
    repository admin), by hand or through their Claude Code session (D-24), never a bot or another app."""
    if label not in labels:
        return f"a founder must add '{label}'"
    pages = gh_json("api", "--paginate", "--slurp", f"repos/{repo()}/issues/{pr}/events")
    events = [e for page in pages for e in page if e.get("event") == "labeled" and e["label"]["name"] == label]
    if not events:
        return f"no 'labeled' event found for '{label}'"
    who = label_applier(events[-1])
    if who is None:
        who = (events[-1].get("actor") or {}).get("login", "unknown")
        return f"'{label}' was applied by {who}, a bot or app; a founder must apply it"
    if who.lower() in founders():
        return None
    perm = (gh_or_none("api", f"repos/{repo()}/collaborators/{who}/permission") or {}).get("permission", "none")
    if perm != "admin":
        return f"'{label}' was applied by {who}, who is not a code owner or admin; a founder must apply it"
    return None


errors = []
task, kind = None, None
m = re.search(r"Task:\s*(T-\d+|none)\b", body)
incident = re.search(r"Incident:\s*#(\d+)", body)
if author in ("app/dependabot", "dependabot[bot]"):
    kind = "Dependabot"
    other = [f for f in files if not matches(f, DEPENDENCY_FILES)]
    if other:
        errors.append("a Dependabot PR may change only dependency manifests and lockfiles:\n    " + "\n    ".join(other))
elif m and m.group(1) == "none":
    kind = "no task (a founder's change to the target)"
    if why := unapproved("human-approved"):
        errors.append(f"'Task: none' needs a founder's approval: {why}")
elif incident and not m:
    n = incident.group(1)
    kind = f"incident #{n}"
    closes = set(CLOSES.findall(body))
    if n not in closes:
        errors.append(f"an incident PR must close its issue: 'Closes #{n}'")
    elif extra := sorted(closes - {n}, key=int):  # merging closes them too; tracker.yml readies their dependants
        errors.append(f"an incident PR closes only its own issue #{n}, not {', '.join('#' + x for x in extra)}")
    issue = gh_or_none("issue", "view", n, "--json", "labels")
    if issue is None:
        errors.append(f"cannot read issue #{n} to confirm it is an incident or nightly issue")
    elif not {l["name"] for l in issue["labels"]} & {"incident", "nightly"}:
        errors.append(f"issue #{n} is not labelled incident or nightly; name a task instead: 'Task: T-123'")
else:
    task = task_by_id(p, m.group(1)) if m else None
    if not task:
        errors.append("the PR body must name an existing task: 'Task: T-123' (plan/tasks.yaml), "
                      "or 'Incident: #N' for an incident or nightly fix")
    # Merging closes every issue named, and tracker.yml then readies their dependants: only the task's own, open.
    closes = sorted(set(CLOSES.findall(body)), key=int)
    if not closes:
        errors.append("the PR body must close its issue: 'Closes #N'")
    elif task and len(closes) > 1:
        errors.append(f"a task PR closes only its own issue, not {', '.join('#' + n for n in closes)}")
    elif task:
        issue = gh_or_none("api", f"repos/{repo()}/issues/{closes[0]}")
        if not issue or "pull_request" in issue:
            errors.append(f"cannot read issue #{closes[0]}")
        elif issue["title"].split(":")[0].strip() != task["id"]:
            errors.append(f"#{closes[0]} is not the issue of {task['id']}: '{issue['title']}'")
        elif issue["state"] != "open":
            errors.append(f"#{closes[0]} ({task['id']}) is closed: name the open task this PR implements")
if task:
    allowed = allowed_paths(p, task)
    if any(f.startswith("supabase/migrations/") for f in files):
        allowed.append(TYPES)
    outside = [f for f in files if not matches(f, allowed) and not matches(f, p["protected"])]
    if outside and (why := unapproved("scope-approved")):
        errors.append(f"files outside lanes {task['lanes']} ({why}):\n    " + "\n    ".join(outside))
protected = [f for f in files if matches(f, p["protected"])]
if protected and (why := unapproved("human-approved")):
    errors.append(f"protected files changed ({why}):\n    " + "\n    ".join(protected))
if errors:
    print("protocol check failed:\n  - " + "\n  - ".join(errors))
    sys.exit(1)
if task:
    print(f"protocol ok: {task['id']}, {len(files)} files within lanes {task['lanes']}")
else:
    print(f"protocol ok: {kind}, {len(files)} files")

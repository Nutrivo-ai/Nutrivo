"""CI 'protocol' check for pull requests: a task, its lanes only, no protected files without approval."""
import os, re, sys
from lib import allowed_paths, gh_json, matches, plan, sh, task_by_id

pr, base = os.environ["PR_NUMBER"], os.environ["BASE_SHA"]
p = plan()
info = gh_json("pr", "view", pr, "--json", "body,labels,headRefName")
labels = {l["name"] for l in info["labels"]}
body = info.get("body") or ""
errors = []
m = re.search(r"Task:\s*(T-\d+)", body)
task = task_by_id(p, m.group(1)) if m else None
if not task:
    errors.append("the PR body must name an existing task: 'Task: T-123' (plan/tasks.yaml)")
if not re.search(r"(Closes|Fixes|Resolves)\s+#\d+", body):
    errors.append("the PR body must close its issue: 'Closes #N'")
files = [f for f in sh("git", "diff", "--name-only", f"{base}...HEAD").split() if f]
files = [f for f in files if not f.startswith("legacy/")]
if task:
    outside = [f for f in files if not matches(f, allowed_paths(p, task)) and not matches(f, p["protected"])]
    if outside and "scope-approved" not in labels:
        errors.append(f"files outside lanes {task['lanes']} (a founder can add 'scope-approved'):\n    " + "\n    ".join(outside))
protected = [f for f in files if matches(f, p["protected"])]
if protected and "human-approved" not in labels:
    errors.append("protected files changed (a founder must add 'human-approved'):\n    " + "\n    ".join(protected))
if errors:
    print("protocol check failed:\n  - " + "\n  - ".join(errors))
    sys.exit(1)
print(f"protocol ok: {task['id']}, {len(files)} files within lanes {task['lanes']}")

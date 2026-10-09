"""Create or update one GitHub issue per task, with lanes, dependencies, acceptance IDs and ready/blocked status."""
import sys
from lib import acceptance, acceptance_ids, gh_json, plan, sh

p, acc = plan(), acceptance()
existing = {i["title"].split(":")[0].strip(): i for i in gh_json(
    "issue", "list", "--label", "task", "--state", "all", "--limit", "500", "--json", "number,title,state,labels")}


def body(t, numbers):
    deps = ", ".join(f"#{numbers[d]} ({d})" if d in numbers else d for d in t.get("deps", [])) or "none"
    ids = acceptance_ids(t, acc)
    lines = [f"**Task {t['id']}** · milestone {t['ms']} · lanes {', '.join(t['lanes'])}",
             f"**Depends on:** {deps}",
             f"**Workflows:** {', '.join(t.get('wf', [])) or '—'} (docs/workflows/)",
             f"**Human gate:** {'yes, the autopilot stops here' if t.get('gate') == 'human' else 'no'}", "",
             "**Acceptance:** every ID below has a test carrying it in its title, passing in CI and on staging:"]
    lines += [f"- [ ] `{i}`: {acc[i.split('.')[0]]['tests'][i]}" for i in ids] or ["- (no workflow IDs: see checks)"]
    lines += [f"- [ ] `{c}`" for c in t.get("checks", [])]
    lines += ["", "Protocol: docs/15-build-protocol.md. Claim with `make next`; verify with `make verify-task T=" + t["id"] + "`."]
    return "\n".join(lines)


created = 0
for t in p["tasks"]:
    if t["id"] in existing:
        continue
    labels = ["task", f"ms:{t['ms']}", *[f"lane:{l}" for l in t["lanes"]]]
    if t.get("gate") == "human":
        labels.append("gate:human")
    url = sh("gh", "issue", "create", "--title", f"{t['id']}: {t['title']}", "--body", "(syncing…)",
             "--label", ",".join(labels)).strip()
    existing[t["id"]] = {"number": int(url.rsplit("/", 1)[1]), "state": "OPEN", "labels": []}
    created += 1
numbers = {tid: i["number"] for tid, i in existing.items()}
closed = {tid for tid, i in existing.items() if i["state"] == "CLOSED"}
for t in p["tasks"]:
    n = str(numbers[t["id"]])
    ready = all(d in closed for d in t.get("deps", []))
    add, remove = ("status:ready", "status:blocked") if ready else ("status:blocked", "status:ready")
    sh("gh", "issue", "edit", n, "--body", body(t, numbers), "--add-label", add, "--remove-label", remove, check=False)
    sh("gh", "issue", "edit", n, "--milestone", t["ms"], check=False)
print(f"synced {len(p['tasks'])} tasks ({created} created)")
sys.exit(0)

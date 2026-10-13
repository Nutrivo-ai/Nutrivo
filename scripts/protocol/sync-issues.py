"""Create or update one GitHub issue per task, with lanes, dependencies, acceptance IDs and ready/blocked status.
Idempotent: an existing issue is edited only where its body, status label or milestone differs from the plan, so the
tracker workflow can run it on every task issue that closes or reopens. Exits non-zero if any create or edit fails.
gh issue is GraphQL, so this runs on a laptop or in Actions; from Claude Code on the web, run the tracker workflow."""
import subprocess, sys
from lib import ROOT, acceptance, acceptance_ids, gh_failure, gh_json, plan

p, acc = plan(), acceptance()
try:
    existing = {i["title"].split(":")[0].strip(): i for i in gh_json(
        "issue", "list", "--label", "task", "--state", "all", "--limit", "500",
        "--json", "number,title,state,labels,body,milestone")}
except subprocess.CalledProcessError as e:
    sys.exit(gh_failure(e))
failed = []


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, cwd=ROOT)
    if r.returncode:
        failed.append(f"gh {' '.join(args[:3])}: {r.stderr.strip()}")
    return r


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
    r = gh("issue", "create", "--title", f"{t['id']}: {t['title']}", "--body", "(syncing…)", "--label", ",".join(labels))
    if r.returncode:
        continue
    existing[t["id"]] = {"number": int(r.stdout.strip().rsplit("/", 1)[1]), "state": "OPEN", "labels": [],
                         "body": "", "milestone": None}
    created += 1

numbers = {tid: i["number"] for tid, i in existing.items()}
closed = {tid for tid, i in existing.items() if i["state"] == "CLOSED"}
edited = 0
for t in p["tasks"]:
    issue = existing.get(t["id"])
    if not issue:
        continue
    have = {l["name"] for l in issue.get("labels") or []}
    if issue["state"] == "CLOSED":
        want, drop = set(), {"status:ready", "status:blocked"}
    elif all(d in closed for d in t.get("deps", [])):
        want, drop = {"status:ready"}, {"status:blocked"}
    else:
        want, drop = {"status:blocked"}, {"status:ready"}
    args, text = [], body(t, numbers)
    if (issue.get("body") or "").replace("\r\n", "\n").strip() != text.strip():
        args += ["--body", text]
    for label in sorted(want - have):
        args += ["--add-label", label]
    for label in sorted(drop & have):
        args += ["--remove-label", label]
    if ((issue.get("milestone") or {}).get("title")) != t["ms"]:
        args += ["--milestone", t["ms"]]
    if args and not gh("issue", "edit", str(issue["number"]), *args).returncode:
        edited += 1

synced = sum(1 for t in p["tasks"] if t["id"] in existing)
ready = sum(1 for t in p["tasks"] if t["id"] in existing and existing[t["id"]]["state"] != "CLOSED"
            and all(d in closed for d in t.get("deps", [])))
print(f"synced {synced}/{len(p['tasks'])} tasks: {created} created, {edited} updated, {ready} ready")
if failed:
    print("failed:\n  " + "\n  ".join(failed), file=sys.stderr)
sys.exit(1 if failed or synced != len(p["tasks"]) else 0)

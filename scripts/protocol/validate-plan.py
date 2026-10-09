"""CI: the plan is a valid DAG and covers every BUILD workflow."""
import sys
from lib import acceptance, plan

p, acc = plan(), acceptance()
ids = [t["id"] for t in p["tasks"]]
errors = []
if len(ids) != len(set(ids)):
    errors.append("duplicate task ids")
known = set(ids)
for t in p["tasks"]:
    for d in t.get("deps", []):
        if d not in known:
            errors.append(f"{t['id']}: unknown dependency {d}")
    for lane in t.get("lanes", []):
        if lane not in p["lanes"]:
            errors.append(f"{t['id']}: unknown lane {lane}")
    for wf in t.get("wf", []):
        if wf not in acc:
            errors.append(f"{t['id']}: unknown workflow {wf}")
    if t["ms"] not in p["milestone_order"]:
        errors.append(f"{t['id']}: unknown milestone {t['ms']}")
graph = {t["id"]: t.get("deps", []) for t in p["tasks"]}
state = {}


def visit(n, stack):
    if state.get(n) == 1:
        errors.append("cycle: " + " -> ".join(stack + [n]))
        return
    if state.get(n) == 2:
        return
    state[n] = 1
    for d in graph.get(n, []):
        visit(d, stack + [n])
    state[n] = 2


for n in graph:
    visit(n, [])
covered = {wf for t in p["tasks"] for wf in t.get("wf", [])}
for wf, spec in acc.items():
    if spec["scope"] in ("BUILD", "MANUAL") and wf not in covered:
        errors.append(f"workflow {wf} ({spec['scope']}) is not covered by any task")
if errors:
    print("plan invalid:\n  " + "\n  ".join(errors))
    sys.exit(1)
print(f"plan valid: {len(ids)} tasks, {len(covered)} workflows covered, no cycles")

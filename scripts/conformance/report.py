"""Map test results (JUnit XML, TAP) to acceptance IDs; write CONFORMANCE.md; enforce the ratchet.
  --enforce          fail when an ID in spec/conformance-baseline.json does not pass now
  --baseline-ref R   the baseline as committed on R counts too (CI: the PR's base), so a PR cannot shrink it
  --update-baseline  add every passing ID to the baseline (the baseline never shrinks)"""
import argparse, glob, json, re, subprocess, sys, xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/protocol"))
from lib import ID_RE, normalise_id  # the same ID pattern as make verify-task
ap = argparse.ArgumentParser()
ap.add_argument("--results", nargs="*", default=["reports/**/*.xml", "reports/**/*.tap"])
ap.add_argument("--enforce", action="store_true")
ap.add_argument("--baseline-ref")
ap.add_argument("--update-baseline", action="store_true")
ap.add_argument("--summary")
ap.add_argument("--out", default=str(ROOT / "CONFORMANCE.md"))
a = ap.parse_args()

outcome = defaultdict(set)  # id -> {"pass", "fail"}


def record(text, ok):
    for m in ID_RE.finditer(text):
        outcome[normalise_id(m)].add("pass" if ok else "fail")


for pattern in a.results:
    for f in glob.glob(pattern, recursive=True):
        if f.endswith(".xml"):
            for tc in ET.parse(f).getroot().iter("testcase"):
                bad = any(tc.find(x) is not None for x in ("failure", "error", "skipped"))
                record(f"{tc.get('classname', '')} {tc.get('name', '')}", not bad)
        else:
            for line in Path(f).read_text(errors="ignore").splitlines():
                if line.startswith(("ok ", "not ok ")):
                    record(line, line.startswith("ok ") and "# SKIP" not in line and "# TODO" not in line)

spec = yaml.safe_load((ROOT / "spec/acceptance.yaml").read_text())["workflows"]
required = {i: (wf, s) for wf, s in spec.items() if s["scope"] == "BUILD" for i in s["tests"]}
status = {i: ("pass" if outcome.get(i) == {"pass"} else "fail" if "fail" in outcome.get(i, set()) else "missing") for i in required}
passing = sorted(i for i, s in status.items() if s == "pass")
baseline_path = ROOT / "spec/conformance-baseline.json"
baseline = set(json.loads(baseline_path.read_text())) if baseline_path.exists() else set()
if a.baseline_ref:
    git = ["git", "-C", str(ROOT)]
    if subprocess.run([*git, "cat-file", "-e", f"{a.baseline_ref}^{{commit}}"], capture_output=True).returncode:
        sys.exit(f"--baseline-ref {a.baseline_ref} is not a commit here (actions/checkout needs fetch-depth: 0)")
    committed = subprocess.run([*git, "show", f"{a.baseline_ref}:spec/conformance-baseline.json"], capture_output=True,
                               text=True)  # no baseline on that commit: []
    baseline |= set(json.loads(committed.stdout)) if committed.returncode == 0 else set()
# Only IDs the spec still requires: one a founder removed from spec/acceptance.yaml (protected) stays in the base's
# baseline, and no later PR could pass.
regressions = sorted(i for i in baseline if i in required and status[i] != "pass")

by_ms = defaultdict(lambda: [0, 0])
for i, (wf, s) in required.items():
    by_ms[s["milestone"]][1] += 1
    by_ms[s["milestone"]][0] += status[i] == "pass"
total = len(required)
lines = [f"# Conformance\n", f"**{len(passing)} of {total} required acceptance IDs pass ({100 * len(passing) // max(total, 1)}%).** "
         f"Regressions against the baseline: {len(regressions)}.\n", "| Milestone | Passing | Required |", "|---|---|---|"]
lines += [f"| {ms} | {p} | {r} |" for ms, (p, r) in sorted(by_ms.items(), key=lambda kv: int(re.sub(r"\D", "", kv[0]) or 99))]
lines += ["", "| Workflow | Pass | Fail | Missing |", "|---|---|---|---|"]
for wf, s in spec.items():
    if s["scope"] != "BUILD":
        continue
    st = [status[i] for i in s["tests"]]
    lines.append(f"| {wf} {s['name']} | {st.count('pass')} | {st.count('fail')} | {st.count('missing')} |")
if regressions:
    lines += ["", "## Regressions", *[f"- `{i}` {required[i][1]['tests'][i]}" for i in regressions]]
report = "\n".join(lines) + "\n"
Path(a.out).write_text(report)
if a.summary:
    Path(a.summary).open("a").write(report)
if a.update_baseline:
    # A local run (make verify-task) may lack a suite such as e2e: only an ID that ran and failed blocks the update;
    # an ID with no result at all is still a regression for --enforce in CI.
    failing = [i for i in regressions if status.get(i) == "fail"]
    if failing:
        sys.exit("refusing to update the baseline while baseline IDs fail: " + ", ".join(failing))
    baseline_path.write_text(json.dumps(sorted(baseline | set(passing)), indent=0) + "\n")
print(f"conformance: {len(passing)}/{total} passing, {len(regressions)} regressions")
sys.exit(1 if (a.enforce and regressions) else 0)

"""Map test results (JUnit XML, TAP) to acceptance IDs; write CONFORMANCE.md; enforce the ratchet.
  --enforce          fail when an ID in spec/conformance-baseline.json does not pass now
  --update-baseline  add every passing ID to the baseline (the baseline never shrinks)"""
import argparse, glob, json, re, sys, xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
ID_RE = re.compile(r"\b([A-P]\d{2})[._](main|must[._]\d+|fail[._]\d+)\b")
ap = argparse.ArgumentParser()
ap.add_argument("--results", nargs="*", default=["reports/**/*.xml", "reports/**/*.tap"])
ap.add_argument("--enforce", action="store_true")
ap.add_argument("--update-baseline", action="store_true")
ap.add_argument("--summary")
ap.add_argument("--out", default=str(ROOT / "CONFORMANCE.md"))
a = ap.parse_args()

outcome = defaultdict(set)  # id -> {"pass", "fail"}


def record(text, ok):
    for m in ID_RE.finditer(text):
        outcome[f"{m.group(1)}.{m.group(2).replace('_', '.')}"].add("pass" if ok else "fail")


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
regressions = sorted(i for i in baseline if status.get(i) != "pass")

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
    if regressions:
        sys.exit("refusing to update the baseline while regressions exist")
    baseline_path.write_text(json.dumps(sorted(baseline | set(passing)), indent=0) + "\n")
print(f"conformance: {len(passing)}/{total} passing, {len(regressions)} regressions")
sys.exit(1 if (a.enforce and regressions) else 0)

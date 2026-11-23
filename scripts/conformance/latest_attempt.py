"""Keep only each CI job's latest attempt of its test reports (incident: a re-run's results were overwritten).

Usage: latest_attempt.py SRC DEST
SRC holds one folder per downloaded artifact, named reports-<job>-attempt-<n> (actions/download-artifact without
merge-multiple). For each job only the folder with the highest n is copied to DEST/<job>/. Re-running a failed job
adds a new attempt beside the failed one in the same workflow run; reading both into one folder let the older
report overwrite the newer, so conformance kept failing on a job that had since passed.
A folder named reports-<job> with no attempt (an older run's naming) counts as attempt 0.
"""
import re, shutil, sys
from pathlib import Path

NAME = re.compile(r"^reports-(?P<job>.+?)(?:-attempt-(?P<n>\d+))?$")


def latest(src: Path) -> dict[str, Path]:
    best: dict[str, tuple[int, Path]] = {}
    for d in sorted(p for p in src.iterdir() if p.is_dir()):
        m = NAME.match(d.name)
        if not m:
            continue
        job, n = m["job"], int(m["n"] or 0)
        if job not in best or n > best[job][0]:
            best[job] = (n, d)
    return {job: d for job, (_, d) in best.items()}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.splitlines()[2], file=sys.stderr)
        return 2
    src, dest = Path(argv[0]), Path(argv[1])
    if not src.is_dir():
        print(f"latest_attempt: no reports downloaded ({src} missing); conformance will report every ID as missing")
        dest.mkdir(parents=True, exist_ok=True)
        return 0
    chosen = latest(src)
    dest.mkdir(parents=True, exist_ok=True)
    for job, d in sorted(chosen.items()):
        shutil.copytree(d, dest / job, dirs_exist_ok=True)
        print(f"latest_attempt: {job} <- {d.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

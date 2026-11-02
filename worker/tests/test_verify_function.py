"""The verify Edge Function's own tests (supabase/functions/verify/verify.test.mjs) under Node's test runner, so they
run in CI's worker job with the rest of T-406. Node 20 or later: fetch, Request, Response."""
import shutil
import subprocess
from pathlib import Path

from pgtest import skip_no_service

FUNCTION = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "verify"


def test_I04_main_the_verify_function_answers_through_verify_reference_only():
    """[I04.main] [I04.must.1] [I04.must.2] [I04.fail.1] The function's node tests: the four-field whitelist, the anon
    key only, nothing but the reference sent, identical unknown answers, rate limits and unavailability."""
    node = shutil.which("node")
    if node is None:
        skip_no_service("node", "install Node 20 or later")
    run = subprocess.run([node, "--test", "verify.test.mjs"], cwd=FUNCTION, capture_output=True, text=True, check=False,
                         timeout=120)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
    assert "# fail 0" in run.stdout and "# pass 11" in run.stdout

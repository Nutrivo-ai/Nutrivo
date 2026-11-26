"""The share Edge Function's own tests (supabase/functions/share/share.test.mjs) under Node's test runner, so they run
in CI's worker job like the verify function's (T-604, D-30). Node 20 or later: fetch, Request, Response."""
import shutil
import subprocess
from pathlib import Path

from pgtest import skip_no_service

FUNCTION = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "share"


def test_I02_main_the_share_function_answers_through_open_share_only():
    """[I02.main] [I02.must.1] The function's node tests: the face facts only, the service role never leaving it, one
    identical unknown answer for revoked, expired, unknown and malformed tokens, the 300 s PDF link, rate limits and
    unavailability."""
    node = shutil.which("node")
    if node is None:
        skip_no_service("node", "install Node 20 or later")
    run = subprocess.run([node, "--test", "share.test.mjs"], cwd=FUNCTION, capture_output=True, text=True, check=False,
                         timeout=120)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
    assert "# fail 0" in run.stdout and "# pass 12" in run.stdout

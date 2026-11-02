"""The stripe-webhook Edge Function's own tests (supabase/functions/stripe-webhook/webhook.test.mjs) under Node's test
runner, so they run in CI's worker job with the rest of T-702. Node 20 or later: Web Crypto, fetch, Request."""
import shutil
import subprocess
from pathlib import Path

from pgtest import skip_no_service

FUNCTION = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "stripe-webhook"


def test_M04_main_the_stripe_webhook_function_verifies_signatures_and_stores_through_the_rpc():
    node = shutil.which("node")
    if node is None:
        skip_no_service("node", "install Node 20 or later")
    run = subprocess.run([node, "--test", "webhook.test.mjs"], cwd=FUNCTION, capture_output=True, text=True, check=False,
                         timeout=120)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
    assert "# fail 0" in run.stdout and "# pass 7" in run.stdout

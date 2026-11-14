"""T-1103 security sweep (#81): the settings that guard the public surface, read from the repository so a change to any
of them fails here first. The database half is supabase/tests/app/99_security_sweep.test.sql."""
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "supabase" / "config.toml"
WEB_RULES = ROOT / "apps" / "web" / "src" / "lib" / "auth" / "rules.ts"
FUNCTIONS = ROOT / "supabase" / "functions"

# Functions that a caller without a Supabase session reaches. stripe-webhook is not rate limited: only a request
# carrying Stripe's signature over the exact payload, within five minutes, ever reaches the database (docs/08).
SIGNED_ONLY = {"stripe-webhook"}


def _auth() -> dict:
    return tomllib.loads(CONFIG.read_text())["auth"]


def test_T1103_auth_minimum_password_length_matches_the_web_rule():
    """[T-1103] The Auth API refuses the passwords the web refuses: a direct GoTrue call cannot set a shorter one."""
    web = int(re.search(r"export const MIN_PASSWORD = (\d+);", WEB_RULES.read_text()).group(1))
    assert _auth().get("minimum_password_length") == web >= 12


def test_T1103_auth_rate_limits_are_written_down_and_bounded():
    """[T-1103] Auth's per-IP limits are explicit in config.toml (the hosted projects match them), and sign-in, sign-up
    and code verification stay at or below Supabase's defaults."""
    limits = _auth()["rate_limit"]
    for key in ("email_sent", "token_refresh", "sign_in_sign_ups", "token_verifications"):
        assert isinstance(limits.get(key), int) and limits[key] > 0, key
    assert limits["sign_in_sign_ups"] <= 30 and limits["token_verifications"] <= 30 and limits["token_refresh"] <= 150


def test_T1103_every_public_edge_function_is_rate_limited():
    """[T-1103] Every Edge Function except the signature-checked webhook has a per-client and per-instance limit and
    answers 429 with Retry-After past it, so a new public function (the D-30 share function) cannot ship without one."""
    functions = sorted(p for p in FUNCTIONS.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))
    assert {"verify", "supplier-upload"} <= {p.name for p in functions}
    for fn in functions:
        if fn.name in SIGNED_ONLY:
            continue
        source = "\n".join(p.read_text() for p in fn.glob("*.js") if not p.name.endswith(".test.mjs"))
        assert re.search(r"export const PER_CLIENT_PER_MINUTE = \d+", source), fn.name
        assert re.search(r"export const PER_INSTANCE_PER_MINUTE = \d+", source), fn.name
        assert "429" in source and "Retry-After" in source, fn.name


def test_T1103_the_webhook_verifies_stripes_signature_before_anything_else():
    """[T-1103] The one public function without a rate limit refuses an unsigned, badly signed or stale request."""
    source = (FUNCTIONS / "stripe-webhook" / "webhook.js").read_text()
    assert "export async function verifySignature" in source and "TOLERANCE_S = 300" in source
    assert "MAX_BYTES" in source

"""T-504 · G02.must.1: never build an endpoint that submits to an authority (Handoff §07). Filing, paying and
corresponding are the operator's own acts: no worker job kind and no Edge Function exists for them."""
import os
import re

from nutrivo_worker.jobs import KINDS

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUBMITS = re.compile(r"submit|file_with|filing|authority|pay_fee|lodge|apply_registration", re.IGNORECASE)


def test_G02_must_1_no_job_kind_submits_to_an_authority():
    assert [k for k in KINDS if SUBMITS.search(k)] == []


def test_G02_must_1_no_edge_function_submits_to_an_authority():
    # CLAUDE.md: Edge Functions only for verify, share (D-30), supplier-upload and stripe-webhook. A new one is added here
    # on purpose.
    functions = sorted(d for d in os.listdir(os.path.join(ROOT, "supabase", "functions"))
                       if os.path.isdir(os.path.join(ROOT, "supabase", "functions", d)) and not d.startswith(("_", ".")))
    assert set(functions) <= {"verify", "share", "supplier-upload", "stripe-webhook"}, functions


def test_G02_must_1_the_share_function_only_reads_a_share_and_signs_its_pdf():
    """D-30 (T-604): share calls app.open_share and Storage's sign endpoint for the reports bucket, and nothing else."""
    with open(os.path.join(ROOT, "supabase", "functions", "share", "share.js"), encoding="utf-8") as f:
        source = f.read()
    calls = re.findall(r"fetchFn\(`\$\{base\}([^`$]*)", source)
    assert calls == ["/rest/v1/rpc/open_share", "/storage/v1/object/sign/reports/"], calls
    assert not SUBMITS.search(re.sub(r"//.*", "", source))

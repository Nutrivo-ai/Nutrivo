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
    # CLAUDE.md: Edge Functions only for verify, supplier-upload and stripe-webhook. A new one is added here on purpose.
    functions = sorted(d for d in os.listdir(os.path.join(ROOT, "supabase", "functions"))
                       if os.path.isdir(os.path.join(ROOT, "supabase", "functions", d)) and not d.startswith(("_", ".")))
    assert set(functions) <= {"verify", "supplier-upload", "stripe-webhook"}, functions

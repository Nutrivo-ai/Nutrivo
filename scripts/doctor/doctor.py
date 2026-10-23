"""Prove every external service works with the stored keys. Run inside scripts/env/run.sh (make doctor ENV=...).
Never prints a secret. Sentry and Langfuse are proven by a round-trip: send, then read back through their APIs."""
import argparse, base64, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, uuid
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REQUIRED = {
    "dev": ["bedrock", "stripe", "sentry", "langfuse", "infisical-scope"],
    "staging": ["supabase", "supabase-management", "postgres", "bedrock", "ses", "stripe", "sentry", "langfuse",
                "posthog", "vercel", "render"],
    "prod": ["supabase", "supabase-management", "postgres", "bedrock", "ses", "stripe", "sentry", "langfuse",
             "posthog", "vercel", "render"],
}
WRITES = {"sentry", "langfuse", "posthog", "bedrock"}  # skipped with --readonly
E = os.environ.get


def _read(rel):
    try:
        with open(os.path.join(ROOT, rel)) as fh:
            return fh.read()
    except OSError:
        return ""


def _secret_values():
    """Values of every canonical secret name (config/secrets.yaml), alias and INFISICAL_* variable."""
    names = set(re.findall(r"name: ([A-Z0-9_]+)", _read("config/secrets.yaml")))
    names |= set(re.findall(r"^\s*[A-Z0-9_]+\s*=\s*([A-Z0-9_]+)", _read("config/secret-aliases.env"), re.M))
    names |= {n for n in os.environ if n.startswith("INFISICAL_")}
    out = set()
    for v in (E(n, "").strip() for n in names):
        # the value, its escaped form (as a bytes repr shows it) and each part of a value with whitespace inside
        out |= {p for p in (v, v.encode("unicode_escape").decode(), *v.split()) if len(p) >= 6}
    return out


SECRETS = _secret_values()


def redact(text):
    """Exception messages can quote a credential (http.client echoes a malformed header in full): mask them all."""
    for v in sorted(SECRETS, key=len, reverse=True):
        text = text.replace(v, "***")
    return text


class Skip(Exception):
    pass


def http(method, url, headers=None, data=None, timeout=20):
    body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
    req = urllib.request.Request(url, data=body, method=method, headers=dict(headers or {}))
    if isinstance(data, (dict, list)):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def need(*names):
    missing = [n for n in names if not E(n)]
    if missing:
        raise AssertionError("missing " + ", ".join(missing))


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def poll(fn, seconds=90, every=5):
    end = time.time() + seconds
    while time.time() < end:
        if fn():
            return True
        time.sleep(every)
    return False


def c_supabase(env):
    need("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    url, anon = E("SUPABASE_URL").rstrip("/"), E("SUPABASE_ANON_KEY")
    s, b = http("POST", f"{url}/rest/v1/rpc/coverage_snapshot", {"apikey": anon, **bearer(anon)}, {})
    assert s not in (401, 403), f"the anon key was rejected ({s})"
    if s == 404:
        raise Skip("keys accepted; schema not deployed yet (deploy-staging, from T-010)")
    assert s == 200, f"coverage_snapshot returned {s} (are migrations applied and schemas exposed?)"
    rs = json.loads(b).get("ruleset_version")
    svc = E("SUPABASE_SERVICE_ROLE_KEY")
    s, _ = http("GET", f"{url}/rest/v1/jurisdictions?select=id&limit=1", {"apikey": svc, **bearer(svc), "Accept-Profile": "ref"})
    assert s == 200, f"ref schema not reachable with the service key ({s}); expose app and ref in API settings"
    return f"migrations live, ruleset {rs}"


def c_supabase_management(env):
    need("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF")
    s, b = http("GET", f"https://api.supabase.com/v1/projects/{E('SUPABASE_PROJECT_REF')}", bearer(E("SUPABASE_ACCESS_TOKEN")))
    assert s == 200, f"management API returned {s}"
    region = json.loads(b).get("region")
    assert region == "eu-central-1", f"project region is {region}; decision D-02 says eu-central-1"
    return f"project in {region}"


def c_postgres(env):
    need("DATABASE_URL")
    if not shutil.which("psql"):
        raise Skip("psql not installed")
    def psql(sql):
        r = subprocess.run(["psql", E("DATABASE_URL"), "-Atc", sql], capture_output=True, text=True, timeout=30)
        # psql's errors can quote parts of the URL, password included: report the exit code only.
        assert r.returncode == 0, f"connection or query failed (psql exit {r.returncode})"
        return r.stdout.strip()
    if psql("select to_regclass('ref.jurisdictions') is not null") != "t":
        raise Skip("connected; schema not deployed yet (deploy-staging, from T-010)")
    return f"{psql('select count(*) from ref.jurisdictions')} jurisdictions"


def c_bedrock(env):
    need("AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BEDROCK_MODEL_TRIAGE",
         "BEDROCK_MODEL_JUDGEMENT", "BEDROCK_MODEL_EXTRACTION")
    import boto3
    rt = boto3.client("bedrock-runtime", region_name=E("AWS_REGION"))
    for key in ("BEDROCK_MODEL_TRIAGE", "BEDROCK_MODEL_JUDGEMENT", "BEDROCK_MODEL_EXTRACTION"):
        rt.converse(modelId=E(key), messages=[{"role": "user", "content": [{"text": "Reply with OK."}]}],
                    inferenceConfig={"maxTokens": 5})
    return f"3 models answer in {E('AWS_REGION')}"


def c_ses(env):
    need("AWS_REGION", "SES_FROM_ADDRESS")
    import boto3
    ses = boto3.client("sesv2", region_name=E("AWS_REGION"))
    acct = ses.get_account()
    assert acct.get("SendingEnabled"), "sending is disabled"
    domain = E("SES_FROM_ADDRESS").split("@")[-1]
    ident = ses.get_email_identity(EmailIdentity=domain)
    assert ident.get("VerifiedForSendingStatus"), f"{domain} is not verified"
    return f"{domain} verified" + ("" if acct.get("ProductionAccessEnabled") else ", SANDBOX: request production access")


def c_anthropic(env):
    need("ANTHROPIC_API_KEY")
    s, _ = http("GET", "https://api.anthropic.com/v1/models", {"x-api-key": E("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"})
    assert s == 200, f"models endpoint returned {s}"
    return "key valid"


def c_stripe(env):
    need("STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY")
    sk, pk = E("STRIPE_SECRET_KEY"), E("STRIPE_PUBLISHABLE_KEY")
    s, _ = http("GET", "https://api.stripe.com/v1/balance", bearer(sk))
    assert s == 200, f"balance returned {s}"
    live = sk.startswith(("sk_live", "rk_live"))
    assert live == pk.startswith("pk_live"), "secret and publishable keys are in different modes"
    if env in ("dev", "staging"):
        assert not live, "live keys in a non-production environment"
    return "live mode" if live else "test mode"


def _sentry_roundtrip(env, dsn_var, project_var):
    dsn = urllib.parse.urlparse(E(dsn_var))
    key, host, project_id = dsn.username, dsn.hostname, dsn.path.strip("/")
    event_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    items = [{"event_id": event_id, "sent_at": now, "dsn": E(dsn_var)}, {"type": "event"},
             {"event_id": event_id, "timestamp": time.time(), "platform": "other", "level": "info", "environment": env,
              "message": {"formatted": f"nutrivo doctor round-trip ({env})"}, "tags": {"source": "doctor"}}]
    s, _ = http("POST", f"https://{host}/api/{project_id}/envelope/",
                {"Content-Type": "application/x-sentry-envelope",
                 "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_key={key}, sentry_client=nutrivo-doctor/1.0"},
                "\n".join(json.dumps(i) for i in items).encode())
    assert s == 200, f"{dsn_var}: ingest returned {s}"
    api = E("SENTRY_URL") or ("https://de.sentry.io" if ".de.sentry.io" in host else "https://sentry.io")
    url = f"{api}/api/0/projects/{E('SENTRY_ORG')}/{E(project_var)}/events/{event_id}/"
    assert poll(lambda: http("GET", url, bearer(E("SENTRY_AUTH_TOKEN")))[0] == 200), f"{dsn_var}: event not readable within 90 s"
    return E(project_var)


def c_sentry(env):
    need("SENTRY_DSN_WEB", "SENTRY_DSN_WORKER", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT_WEB", "SENTRY_PROJECT_WORKER")
    a = _sentry_roundtrip(env, "SENTRY_DSN_WEB", "SENTRY_PROJECT_WEB")
    b = _sentry_roundtrip(env, "SENTRY_DSN_WORKER", "SENTRY_PROJECT_WORKER")
    return f"round-trip ok: {a}, {b}"


def _otlp_span(trace_id, span_id, start_ns, env):
    """One finished OTLP/JSON span (ids in hex, times as decimal nanosecond strings, as OTLP/JSON requires)."""
    attr = lambda k, v: {"key": k, "value": {"stringValue": v}}  # noqa: E731
    span = {"traceId": trace_id, "spanId": span_id, "name": "nutrivo-doctor", "kind": 1,
            "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(start_ns + 1_000_000),
            "attributes": [attr("env", env), attr("source", "doctor")]}
    return {"resourceSpans": [{"resource": {"attributes": [attr("service.name", "nutrivo-doctor")]},
                               "scopeSpans": [{"scope": {"name": "nutrivo-doctor"}, "spans": [span]}]}]}


def c_langfuse(env):
    # Langfuse Cloud retires the v3 ingestion API on 2026-11-16 and already answers 410 to GET /api/public/traces/{id}
    # for new projects (#13): write through its OpenTelemetry endpoint, read back through v2 observations.
    need("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL")
    base = E("LANGFUSE_BASE_URL").rstrip("/")
    auth = {"Authorization": "Basic " + base64.b64encode(f"{E('LANGFUSE_PUBLIC_KEY')}:{E('LANGFUSE_SECRET_KEY')}".encode()).decode(),
            "x-langfuse-ingestion-version": "4"}  # without it, OTLP data can take up to 10 minutes to become readable
    trace_id, span_id, start = uuid.uuid4().hex, uuid.uuid4().hex[:16], time.time_ns()
    s, b = http("POST", f"{base}/api/public/otel/v1/traces", auth, _otlp_span(trace_id, span_id, start, env))
    assert s == 200, f"OTLP ingestion returned {s}"
    rejected = int((json.loads(b or b"{}").get("partialSuccess") or {}).get("rejectedSpans") or 0)
    assert not rejected, "OTLP ingestion rejected the span"
    iso = lambda ns: datetime.fromtimestamp(ns / 1e9, timezone.utc).isoformat(timespec="milliseconds")  # noqa: E731
    query = urllib.parse.urlencode({"traceId": trace_id, "fromStartTime": iso(start - 60 * 10**9),
                                    "toStartTime": iso(start + 600 * 10**9), "limit": 10})

    def readable():
        s, b = http("GET", f"{base}/api/public/v2/observations?{query}", auth)
        return s == 200 and any(o.get("id") == span_id for o in json.loads(b).get("data") or [])

    assert poll(readable, seconds=120), "span not readable through /api/public/v2/observations within 120 s"
    return "round-trip ok (OTLP write, v2 observations read)"


def c_posthog(env):
    need("POSTHOG_KEY", "POSTHOG_HOST")
    s, _ = http("POST", f"{E('POSTHOG_HOST').rstrip('/')}/capture/",
                data={"api_key": E("POSTHOG_KEY"), "event": "nutrivo_doctor_ping", "distinct_id": "nutrivo-doctor",
                      "properties": {"env": env}})
    assert s == 200, f"capture returned {s}"
    return "capture accepted"


def c_vercel(env):
    need("VERCEL_TOKEN")
    if not E("VERCEL_PROJECT_ID"):
        raise Skip("no Vercel project yet (T-010)")
    team = f"?teamId={E('VERCEL_ORG_ID')}" if E("VERCEL_ORG_ID") else ""
    s, _ = http("GET", f"https://api.vercel.com/v9/projects/{E('VERCEL_PROJECT_ID')}{team}", bearer(E("VERCEL_TOKEN")))
    assert s == 200, f"project lookup returned {s}"
    return "project reachable"


def c_render(env):
    need("RENDER_API_KEY")
    if not E("RENDER_WORKER_SERVICE_ID"):
        raise Skip("no worker service yet (T-010)")
    s, b = http("GET", f"https://api.render.com/v1/services/{E('RENDER_WORKER_SERVICE_ID')}", bearer(E("RENDER_API_KEY")))
    assert s == 200, f"service lookup returned {s}"
    region = (json.loads(b).get("serviceDetails") or {}).get("region")
    return f"worker service found ({region or 'region unknown'})"


def c_app(env):
    need("APP_BASE_URL")
    s, _ = http("GET", f"{E('APP_BASE_URL').rstrip('/')}/api/health")
    if s == 404:
        raise Skip("no /api/health yet (added in T-007, deployed in T-010)")
    assert s == 200, f"/api/health returned {s}"
    return "healthy"


def c_github(env):
    if not shutil.which("gh"):
        raise Skip("gh not installed")
    assert subprocess.run(["gh", "auth", "status"], capture_output=True).returncode == 0, "gh is not authenticated"
    return "authenticated"


def _count_names(body):
    try:
        return len(json.loads(body).get("secrets") or [])
    except (ValueError, AttributeError):
        return -1  # an answer that cannot be read counts as a leak


def c_infisical_scope(env):
    """A dev identity (the session's token, and the client id and secret Infisical dev holds) must read dev and must
    not read staging or prod (docs/22 §3). Prints statuses and name counts only: viewSecretValue=false keeps values out
    of the answers. An environment that answers with no names (the unused staging and prod of a dev-only project when
    there is one project per environment) exposes nothing."""
    if env != "dev":
        raise Skip("dev only")
    if not (E("INFISICAL_TOKEN") or E("INFISICAL_CLIENT_ID")):
        raise Skip("no Infisical machine identity in this environment")
    cfg = json.loads(_read(".infisical.json") or "{}")
    pid = E("INFISICAL_PROJECT_ID") or cfg.get("workspaceId", "")
    if not pid or pid.startswith("<"):
        raise Skip("no Infisical project id (.infisical.json)")
    domain = E("INFISICAL_DOMAIN") or cfg.get("domain") or "https://app.infisical.com"
    api = domain.rstrip("/").removesuffix("/api") + "/api"
    tokens = {"token": E("INFISICAL_TOKEN")} if E("INFISICAL_TOKEN") else {}
    if E("INFISICAL_CLIENT_ID"):
        need("INFISICAL_CLIENT_SECRET")
        form = urllib.parse.urlencode({"clientId": E("INFISICAL_CLIENT_ID"),
                                       "clientSecret": E("INFISICAL_CLIENT_SECRET")})
        s, b = http("POST", f"{api}/v1/auth/universal-auth/login",
                    {"Content-Type": "application/x-www-form-urlencoded"}, form.encode())
        assert s == 200, f"universal-auth login with INFISICAL_CLIENT_ID returned {s}"
        tokens["client id"] = json.loads(b)["accessToken"]
        SECRETS.add(tokens["client id"])
    report, leaks = [], []
    for who, tok in tokens.items():
        st, names = {}, {}
        for e in ("dev", "staging", "prod"):
            st[e], b = http("GET", f"{api}/v4/secrets?" + urllib.parse.urlencode(
                {"projectId": pid, "environment": e, "secretPath": "/", "viewSecretValue": "false"}), bearer(tok))
            if e != "dev" and 200 <= st[e] < 300:
                names[e] = _count_names(b)
        report.append(f"{who}: " + ", ".join(f"{e} {s}" + (f" (names: {names[e]})" if e in names else "")
                                             for e, s in st.items()))
        assert st["dev"] == 200, f"{report[-1]}: this identity cannot read dev, so the check proves nothing"
        leaks += [f"{who} reads {e}" for e, n in names.items() if n != 0]
    assert not leaks, (f"{', '.join(leaks)} ({'; '.join(report)}): "
                       "a dev identity must not read staging or prod (docs/22 §3)")
    return "; ".join(report)


CHECKS = {"supabase": c_supabase, "supabase-management": c_supabase_management, "postgres": c_postgres,
          "bedrock": c_bedrock, "ses": c_ses, "anthropic": c_anthropic, "stripe": c_stripe, "sentry": c_sentry,
          "langfuse": c_langfuse, "posthog": c_posthog, "vercel": c_vercel, "render": c_render, "app": c_app,
          "github": c_github, "infisical-scope": c_infisical_scope}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=list(REQUIRED))
    ap.add_argument("--readonly", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--json")
    a = ap.parse_args()
    results, failed = [], False
    for name, fn in CHECKS.items():
        if a.only and name not in a.only:
            continue
        required = name in REQUIRED[a.env]
        t0 = time.time()
        if a.readonly and name in WRITES:
            status, detail = "skip", "read-only run"
        else:
            try:
                status, detail = "ok", fn(a.env)
            except Skip as e:
                status, detail = "skip", redact(str(e))
            except AssertionError as e:
                status, detail = ("fail" if required else "warn"), redact(str(e))
            except Exception as e:  # noqa: BLE001 - report, never crash the doctor
                # redact before truncating: a cut could leave part of a secret that no longer matches
                status, detail = ("fail" if required else "warn"), f"{type(e).__name__}: {redact(str(e))[:160]}"
        failed |= status == "fail"
        mark = {"ok": "✓", "fail": "✗", "warn": "!", "skip": "·"}[status]
        print(f"  {mark} {name:<20} {int((time.time() - t0) * 1000):>6} ms  {detail}")
        results.append({"check": name, "status": status, "detail": detail, "required": required})
    if a.json:
        with open(a.json, "w") as fh:
            json.dump({"env": a.env, "results": results}, fh, indent=1)
    print(f"doctor {a.env}: {'FAILED' if failed else 'all required checks green'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

"""Synthetic check of production's critical paths (T-1102, docs/17, docs/19). Standard library only.

Run by .github/workflows/synthetic.yml every 15 minutes, only once vars.SYNTHETIC_ENABLED is 'true', inside the
Sentry check-in synthetic-smoke-prod: a non-zero exit is an error check-in, and a run that never happens is a missed
one. Each path is tried twice before it counts as failed, so one dropped connection does not page anyone.

  health   GET  {APP_BASE_URL}/api/health        200, {"status": "ok"}, an x-request-id header
  sign-in  GET  {APP_BASE_URL}/sign-in           200, an HTML page
  verify   GET  {SUPABASE_URL}/functions/v1/verify/<ref> with the anon key (as the /verify page calls it):
           a well-formed reference that cannot exist must answer exactly {"status": "unknown"}, which needs the
           function and public.verify_reference to answer; with SYNTHETIC_VERIFY_REF set (a report of the synthetic
           workspace), that reference must answer current or superseded.

Before launch the Vercel firewall's "pre-launch: app closed" rule sends app routes such as /sign-in to the pilot page
(docs/24 §7). With SYNTHETIC_BYPASS_TOKEN set, the two app paths carry it in the x-nutrivo-synthetic header, which a
Vercel firewall rule placed above the pre-launch rules matches and bypasses, so the check reads the real app while
production stays closed to everyone else. The header is never sent to Supabase and never printed.

Prints one line per path: name, ok or FAILED, the HTTP status and the time taken. Never a URL's query, a key, a
reference or a response body."""
import argparse, json, os, sys, time, urllib.error, urllib.request, uuid

E = os.environ.get
TIMEOUT_S = 15
BYPASS_HEADER = "x-nutrivo-synthetic"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect. urllib copies request headers to the redirect target whatever its host, so following
    one could hand the firewall-bypass header to another origin; a 3xx on these paths fails as HTTP 3xx instead."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_get(url, headers=None, timeout=TIMEOUT_S, opener=None):
    req = urllib.request.Request(url, method="GET", headers=dict(headers or {}))
    req.add_header("User-Agent", "nutrivo-synthetic/1.0")
    try:
        with (opener or _OPENER).open(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


class Failed(Exception):
    pass


def _json(body):
    try:
        return json.loads(body)
    except ValueError:
        raise Failed("not JSON")


def app_headers(env=E):
    """The firewall-bypass header for the app's own paths only (docs/24 §6), when its secret is set."""
    token = env("SYNTHETIC_BYPASS_TOKEN")
    return {BYPASS_HEADER: token} if token else {}


def check_health(get, base, headers_out=None):
    status, headers, body = get(f"{base}/api/health", headers_out or {})
    if status != 200:
        raise Failed(f"HTTP {status}")
    if _json(body).get("status") != "ok":
        raise Failed("status is not ok")
    if not headers.get("x-request-id"):
        raise Failed("no x-request-id")
    return status


def check_sign_in(get, base, headers_out=None):
    status, headers, body = get(f"{base}/sign-in", headers_out or {})
    if status != 200:
        raise Failed(f"HTTP {status}")
    if "text/html" not in headers.get("content-type", ""):
        raise Failed("not an HTML page")
    if b"<form" not in body.lower() and b"sign in" not in body.lower():
        # before launch: the pre-launch firewall rule answers with the pilot page unless the bypass header passes
        raise Failed("no sign-in form" + ("" if headers_out else " (no SYNTHETIC_BYPASS_TOKEN: the pre-launch "
                                                                   "firewall may have sent it to the pilot page)"))
    return status


def unknown_reference():
    """Well-formed (20–64 of [A-Za-z0-9-], docs/04) and never issued: a fresh UUID with a prefix no report uses."""
    return f"synthetic-{uuid.uuid4()}"


def check_verify(get, supabase_url, anon_key, ref=None):
    headers = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}
    probe = ref or unknown_reference()
    status, _, body = get(f"{supabase_url}/functions/v1/verify/{probe}", headers)
    if status != 200:
        raise Failed(f"HTTP {status}")    # 503: the database could not answer; 429: rate limited
    answer = _json(body)
    if ref:
        if answer.get("status") not in ("current", "superseded"):
            raise Failed(f"the synthetic reference answered {answer.get('status')!r}")
    elif answer != {"status": "unknown"}:
        raise Failed("an unknown reference did not answer exactly {\"status\": \"unknown\"}")
    return status


def run(get=http_get, env=E, retries=1, pause_s=5.0, out=print):
    missing = [n for n in ("APP_BASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY") if not env(n)]
    if missing:
        out(f"config FAILED: missing {', '.join(missing)}")
        return 1
    base, supabase_url = env("APP_BASE_URL").rstrip("/"), env("SUPABASE_URL").rstrip("/")
    app = app_headers(env)
    checks = [
        ("health", lambda: check_health(get, base, app)),
        ("sign-in", lambda: check_sign_in(get, base, app)),
        ("verify", lambda: check_verify(get, supabase_url, env("SUPABASE_ANON_KEY"), env("SYNTHETIC_VERIFY_REF"))),
    ]
    failed = 0
    for name, fn in checks:
        for attempt in range(retries + 1):
            started = time.monotonic()
            try:
                status = fn()
                out(f"{name} ok HTTP {status} {int((time.monotonic() - started) * 1000)} ms")
                break
            except (Failed, OSError) as exc:
                reason = str(exc) if isinstance(exc, Failed) else type(exc).__name__
                if attempt < retries:
                    time.sleep(pause_s)
                    continue
                out(f"{name} FAILED: {reason} ({int((time.monotonic() - started) * 1000)} ms)")
                failed += 1
    return 1 if failed else 0


def main(argv=None):
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args(argv)
    return run()


if __name__ == "__main__":
    sys.exit(main())

"""Download the design set into design/ and verify every file by exact size (design/MANIFEST.json).
Strategy: 1) already present and correct; 2) Drive API with GOOGLE_SERVICE_ACCOUNT_JSON (folder shared with that
account); 3) public link download (folder shared 'anyone with the link'). Otherwise ask a founder (gate G3).
Usage: fetch.py [--check]"""
import json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / "design"
manifest = json.loads((DESIGN / "MANIFEST.json").read_text())["files"]


def ok(f):
    p = DESIGN / f["path"]
    return p.exists() and p.stat().st_size == f["size"]


def token_from_service_account():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        return None
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    creds.refresh(Request())
    return creds.token


def download(f, token):
    if token:
        url = f"https://www.googleapis.com/drive/v3/files/{f['drive_id']}?alt=media"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    else:
        req = urllib.request.Request(f"https://drive.google.com/uc?export=download&id={f['drive_id']}")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if len(data) != f["size"]:
        raise ValueError(f"size {len(data)} != {f['size']} (not shared, or Drive returned a sign-in page)")
    target = DESIGN / f["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


check_only = "--check" in sys.argv
todo = [f for f in manifest if not ok(f)]
if todo and not check_only:
    try:
        token = token_from_service_account()
    except Exception as e:  # noqa: BLE001
        print(f"service-account download unavailable: {e}")
        token = None
    for f in todo:
        try:
            download(f, token)
            print(f"  ✓ {f['path']}")
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {f['path']}: {e}")
    todo = [f for f in manifest if not ok(f)]
if todo:
    print(f"design set incomplete: {len(todo)} of {len(manifest)} files missing or wrong size")
    print("GATE G3: download the Google Drive design folder and unzip it into design/ keeping its folders, then run make design-check")
    sys.exit(1)
print(f"design set complete: {len(manifest)} files verified")

"""Malware scanning of supplier uploads (T-802, H03 step 2, docs/09): ClamAV's clamscan in the worker image.

The bytes go to clamscan on stdin, so nothing is written to the worker's disk. clamscan's exit status is the verdict:
0 clean, 1 infected, anything else (a missing binary, a missing signature database, a timeout) is a ScanError, which
the job loop retries and finally fails visibly: a file that could not be scanned is never promoted (withhold rather
than guess, docs/18). No outside service is called; the signatures are fetched by freshclam when the image is built.

`EicarOnlyScanner` flags only the EICAR test file. It is CI's end-to-end scanner (its worker has no ClamAV) and the
configuration refuses it in staging and prod (config.Settings)."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Literal, Protocol

from .config import Settings
from .errors import SafeError

Verdict = Literal["clean", "infected"]

# The industry's standard anti-virus test file (eicar.org): harmless, and every scanner reports it.
EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


class ScanError(SafeError):
    """The file could not be scanned: retry, never pass."""


@dataclass(frozen=True)
class ScanResult:
    verdict: Verdict
    signature: str | None = None    # the scanner's name for what it found; never customer text


class Scanner(Protocol):
    name: str

    def scan(self, data: bytes) -> ScanResult: ...


@dataclass(frozen=True)
class ClamScanner:
    path: str = "clamscan"
    timeout_s: int = 300
    name: str = "clamav"

    def scan(self, data: bytes) -> ScanResult:
        try:
            run = subprocess.run([self.path, "--no-summary", "--infected", "--stdout", "-"], input=data,
                                 capture_output=True, timeout=self.timeout_s, check=False)
        except FileNotFoundError:
            raise ScanError("clamscan is not installed") from None
        except subprocess.TimeoutExpired:
            raise ScanError(f"clamscan did not finish within {self.timeout_s} s") from None
        if run.returncode == 0:
            return ScanResult("clean")
        if run.returncode == 1:
            # "stdin: Eicar-Signature FOUND"
            line = run.stdout.decode("utf-8", "replace").strip().splitlines()
            found = line[0].split(":", 1)[-1].removesuffix("FOUND").strip() if line else ""
            return ScanResult("infected", found[:120] or None)
        raise ScanError(f"clamscan exited with status {run.returncode}")


@dataclass(frozen=True)
class EicarOnlyScanner:
    name: str = "eicar_only"

    def scan(self, data: bytes) -> ScanResult:
        return ScanResult("infected", "Eicar-Test-Signature") if EICAR in data else ScanResult("clean")


def scanner_for(settings: Settings) -> Scanner:
    if settings.scan_mode == "eicar_only":
        return EicarOnlyScanner()
    return ClamScanner(settings.clamscan_path, settings.scan_timeout_s)

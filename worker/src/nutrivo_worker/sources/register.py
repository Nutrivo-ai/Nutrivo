"""The EU Register of Feed Additives → ref.feed_additives (T-202, docs/12, docs/14 §6).

Since 5 April 2023 the register is an online database in the Food and Feed Information Portal, without numbered
editions or a download. The portal's own application reads it from a JSON API (`PORTAL_API`, the base its
`assets/env-json-config.json` names), and that is what is pulled here: the whole register in one answer, the
legislation it cites, and the reference labels. Each pull is stored byte for byte with its sha256 (ref.sources, kind
'register'); a ruleset pins that snapshot.

A row is written only where the register lets us write it without guessing (docs/18, withhold rather than guess):
the identification number is present and on one register entry only, no authorisation carries a deletion date, and
no linked act withdraws, repeals, denies or suspends it. Everything else is reported as skipped with a reason and
stays in the stored pull. The register does not serve maximum contents or conditions (they are in each authorising
act), so those columns, and `category`, are never written here."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Protocol

from psycopg.rows import dict_row

from ..logs import get_logger, kv
from .http import PoliteClient, SourceError
from .imports import Outcome, failed
from .store import Meta, PullStore

log = get_logger(__name__)

REGISTER = "feed-additives"
PORTAL_API = "https://ec.europa.eu/food/food-feed-portal/backend/api"
PORTAL_PAGE = "https://ec.europa.eu/food/food-feed-portal/screen/feed-additives/search"
# name → (url, language of the body, title for ref.sources). The portal serves these labels in English only.
ENDPOINTS = {
    "policy-items": (f"{PORTAL_API}/policy-items?foodDomain=fed&authorisationType=fed_auth", None,
                     "EU Register of Feed Additives · register entries (Food and Feed Information Portal)"),
    "legislations": (f"{PORTAL_API}/food_legislations?domain_code=fed", "en",
                     "EU Register of Feed Additives · legislation cited (Food and Feed Information Portal)"),
    "refdata": (f"{PORTAL_API}/feed-refdata/en", "en",
                "EU Register of Feed Additives · reference labels (Food and Feed Information Portal)"),
}
JSON = "application/json"

# Legislation link types by the label the register gives them (refDataFeedLegislationType). A label outside these
# three lists makes the entry skipped (`unknown_legislation_type`), so a new kind of link is never read as harmless.
PRIMARY = frozenset({"Primary"})
ENDING = frozenset({"Withdrawn by", "Repealed by", "Authorisation denied", "Authorisation denied by",
                    "Autorisation suspended by", "Authorisation suspended by"})
NEUTRAL = frozenset({"Amended by", "Corrigendum in", "Corrected by", "Corrected and replaced by", "See also",
                     "Not provided"})
_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})(T.*)?$")


@dataclass(frozen=True)
class Pull:
    register: str
    name: str
    url: str
    language: str | None
    content_type: str
    body: bytes
    sha256: str


@dataclass(frozen=True)
class Authorisation:
    animal: str | None
    expiry: date | None
    deleted_on: date | None
    links: tuple[tuple[str | None, str | None], ...]     # (link type code, legislation id)


@dataclass(frozen=True)
class Entry:
    policy_item: str
    code: str
    name: str | None
    functional_group: str | None                        # the register's code, e.g. 'cat_func_group_3_b'
    authorisations: tuple[Authorisation, ...]


@dataclass(frozen=True)
class AdditiveRow:
    id: str
    name: str
    functional_group: str | None
    species: list[str]
    authorising_act: str | None
    expiry: date | None


def fetch(client: PoliteClient, name: str) -> Pull:
    url, language, _ = ENDPOINTS[name]
    resp = client.get(url, {"Accept": JSON})
    if resp.status != 200:
        raise SourceError(f"HTTP {resp.status} for register {name}", f"http_{resp.status}")
    content_type = resp.header("content-type") or ""
    if not content_type.startswith(JSON):
        raise SourceError(f"register {name} came as {content_type[:60]!r}", "unexpected_content_type")
    if not resp.body.strip():
        raise SourceError(f"register {name} came empty", "empty_body")
    return Pull(REGISTER, name, url, language, content_type, resp.body, hashlib.sha256(resp.body).hexdigest())


# ── reading the portal's value trees ───────────────────────────────────────────────────────────────
def _shape(msg: str) -> SourceError:
    return SourceError(msg, "unexpected_shape")


def _load(pull: Pull) -> Any:
    try:
        return json.loads(pull.body)
    except ValueError as exc:
        raise _shape(f"register {pull.name} is not JSON") from exc


def _children(node: Any, ident: str) -> list[dict]:
    if not isinstance(node, dict) or not isinstance(node.get("childrenValues"), list):
        raise _shape(f"register node without childrenValues (looking for {ident})")
    return [c for c in node["childrenValues"] if isinstance(c, dict) and c.get("valueIdentifier") == ident]


def _one(node: Any, ident: str, *, required: bool = False) -> Any:
    found = _children(node, ident)
    if len(found) > 1:
        raise _shape(f"register node has {len(found)} values for {ident}")
    if not found:
        if required:
            raise _shape(f"register node lacks {ident}")
        return None
    return found[0].get("value")


def _date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    m = _DATE.match(str(value))
    if not m:
        raise _shape(f"register date {str(value)[:40]!r} is not ISO 8601")
    return date.fromisoformat(m.group(1))


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def parse_entries(pull: Pull) -> list[Entry]:
    data = _load(pull)
    if not isinstance(data, list) or not data:
        raise _shape("register entries are not a non-empty list")
    entries = []
    for node in data:
        policy_item = _one(node, "policyItemCode", required=True)
        wrappers = _children(node, "additiveWrapper")
        auth_wrappers = _children(node, "authorisationWrapper")
        if len(wrappers) != 1 or len(auth_wrappers) != 1:
            raise _shape(f"register entry {str(policy_item)[:40]} lacks its additive or authorisation wrapper")
        additive = wrappers[0]
        auths = []
        for c in _children(auth_wrappers[0], "policyItemComplex"):
            links = tuple((_one(leg, "feedLegislationType"), _text(_one(leg, "feedLegislationTitle")))
                          for leg in _children(c, "legislationComplex"))
            auths.append(Authorisation(_text(_one(c, "feedAnimal")), _date(_one(c, "feedExpiryDate")),
                                       _date(_one(c, "feedDeletionDate")), links))
        entries.append(Entry(str(policy_item), (_text(_one(additive, "feedAdditiveCode")) or ""),
                             _text(_one(additive, "feedAdditiveName")),
                             _text(_one(additive, "feedCategoryFunctionalGroup")), tuple(auths)))
    return entries


def parse_legislations(pull: Pull) -> dict[str, str]:
    """Legislation id → its title as the register gives it (refDataLegislationEN)."""
    data = _load(pull)
    if not isinstance(data, list) or not data:
        raise _shape("register legislations are not a non-empty list")
    out = {}
    for node in data:
        if not isinstance(node, dict) or "id" not in node:
            raise _shape("register legislation without an id")
        title = _text(_one(node, "refDataLegislationEN"))
        if title:
            out[str(node["id"])] = title
    return out


def parse_refdata(pull: Pull) -> tuple[dict[str, str], dict[str, str]]:
    """(functional group code → label, legislation link type code → label)."""
    data = _load(pull)
    try:
        groups, types = data["refDataFunctionalGroup"], data["refDataFeedLegislationType"]
    except (KeyError, TypeError) as exc:
        raise _shape("register reference labels lack functional groups or legislation types") from exc
    if not (isinstance(groups, dict) and isinstance(types, dict)):
        raise _shape("register reference labels are not maps")
    return ({str(k): " ".join(str(v).split()) for k, v in groups.items()},
            {str(k): " ".join(str(v).split()) for k, v in types.items()})


# ── deciding what may be written ───────────────────────────────────────────────────────────────────
def plan(entries: list[Entry], titles: dict[str, str], groups: dict[str, str],
         link_types: dict[str, str]) -> tuple[list[tuple[Entry, AdditiveRow]], list[Outcome]]:
    """Rows to write, and a skipped outcome for every entry that cannot be written without a guess."""
    uses = Counter(e.code for e in entries)
    rows, skipped = [], []

    def skip(e: Entry, reason: str, note: str | None = None) -> None:
        skipped.append(Outcome("additive", e.policy_item, "skipped", id=e.code or None, reason=reason, note=note))

    for e in entries:
        labels = [link_types.get(t) if t else None for a in e.authorisations for t, _ in a.links]
        if not any(ch.isalnum() for ch in e.code):
            skip(e, "no_identification_number")
        elif uses[e.code] > 1:
            skip(e, "ambiguous_identification_number", f"{uses[e.code]} register entries carry this number")
        elif not e.name:
            skip(e, "no_name")
        elif any(a.deleted_on for a in e.authorisations):
            skip(e, "deleted")
        elif any(lb not in PRIMARY | ENDING | NEUTRAL for lb in labels):
            skip(e, "unknown_legislation_type")
        elif any(lb in ENDING for lb in labels):
            skip(e, "withdrawn", "linked act: " + ", ".join(sorted({lb for lb in labels if lb in ENDING})))
        elif any(lid and lid not in titles for a in e.authorisations for _, lid in a.links):
            skip(e, "unknown_legislation")
        else:
            rows.append((e, _row(e, titles, groups, link_types)))
    return rows, skipped


def _row(e: Entry, titles: dict[str, str], groups: dict[str, str], link_types: dict[str, str]) -> AdditiveRow:
    species = list(dict.fromkeys(a.animal for a in e.authorisations if a.animal))
    primary = [titles[lid] for a in e.authorisations for t, lid in a.links
               if lid and t and link_types.get(t) in PRIMARY]
    expiries = {a.expiry for a in e.authorisations}
    return AdditiveRow(
        id=e.code, name=e.name or "",
        functional_group=groups.get(e.functional_group) if e.functional_group else None,
        species=species,
        authorising_act="; ".join(dict.fromkeys(primary)) or None,
        expiry=next(iter(expiries)) if len(expiries) == 1 else None)   # differing expiries: not one date


# ── writing ────────────────────────────────────────────────────────────────────────────────────────
class AdditiveTable(Protocol):
    def upsert(self, row: AdditiveRow, source_id: str) -> bool: ...    # True when inserted or changed
    def ids(self) -> set[str]: ...


class PgAdditiveTable:
    """ref.feed_additives with the service role. `max_content`, `conditions` and `category` are never touched."""

    def __init__(self, conn):  # type: ignore[no-untyped-def]
        self.conn = conn

    def upsert(self, row: AdditiveRow, source_id: str) -> bool:
        with self.conn.cursor(row_factory=dict_row) as cur:
            got = cur.execute(
                """insert into ref.feed_additives as t (id, name, functional_group, species, authorising_act, expiry,
                                                        source_id)
                   values (%s, %s, %s, %s, %s, %s, %s)
                   on conflict (id) do update set name = excluded.name, functional_group = excluded.functional_group,
                       species = excluded.species, authorising_act = excluded.authorising_act,
                       expiry = excluded.expiry, source_id = excluded.source_id
                   where (t.name, t.functional_group, t.species, t.authorising_act, t.expiry, t.source_id)
                         is distinct from (excluded.name, excluded.functional_group, excluded.species,
                                           excluded.authorising_act, excluded.expiry, excluded.source_id)
                   returning id""",
                (row.id, row.name, row.functional_group, row.species, row.authorising_act, row.expiry, source_id),
            ).fetchone()
        return got is not None

    def ids(self) -> set[str]:
        return {r["id"] for r in self.conn.execute("select id from ref.feed_additives").fetchall()}


def run(client: PoliteClient, store: PullStore | None, table: AdditiveTable | None, *, licence: str = "eu_reuse",
        transaction: Callable[[], AbstractContextManager[Any]] = nullcontext,
        now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> list[Outcome]:
    """Pull, store and import. With `store` None it is a dry run: pulled, hashed and planned, nothing written.
    Any pull or shape failure writes no rows at all: a partial register is never imported."""
    outcomes: list[Outcome] = []
    pulls: dict[str, Pull] = {}
    for name in ENDPOINTS:
        try:
            pulls[name] = fetch(client, name)
        except Exception as exc:  # noqa: BLE001  visible, and the import stops before writing anything
            outcomes.append(failed("pull", name, exc, register=REGISTER, url=ENDPOINTS[name][0]))
    if len(pulls) != len(ENDPOINTS):
        return outcomes
    try:
        entries = parse_entries(pulls["policy-items"])
        titles = parse_legislations(pulls["legislations"])
        groups, link_types = parse_refdata(pulls["refdata"])
        rows, skipped = plan(entries, titles, groups, link_types)
    except Exception as exc:  # noqa: BLE001
        outcomes.append(failed("pull", "policy-items", exc, register=REGISTER, sha256=pulls["policy-items"].sha256))
        return outcomes

    if store is None or table is None:
        outcomes += [Outcome("pull", p.name, "fetched", sha256=p.sha256, url=p.url) for p in pulls.values()]
        outcomes += [Outcome("additive", e.policy_item, "importable", id=r.id) for e, r in rows]
        return outcomes + skipped

    pull_outcomes, written = [], []
    try:
        with transaction():
            source_ids = {}
            for p in pulls.values():
                status, source_ids[p.name] = store.save_pull(p, Meta(ENDPOINTS[p.name][2], licence), now())
                pull_outcomes.append(Outcome("pull", p.name, status, sha256=p.sha256, url=p.url,
                                             source_id=source_ids[p.name]))
            source_id = source_ids["policy-items"]
            for e, r in rows:
                changed = table.upsert(r, source_id)
                written.append(Outcome("additive", e.policy_item, "imported" if changed else "unchanged", id=r.id,
                                       source_id=source_id))
            supported = {r.id for _, r in rows}
            reasons = {o.id: o.reason for o in skipped if o.id}
            stale = [Outcome("additive", i, "stale", id=i, reason=reasons.get(i, "not_in_register"),
                             note="left in place: removing a row is a founder decision (issue #32)")
                     for i in sorted(table.ids() - supported)]
    except Exception as exc:  # noqa: BLE001  the transaction rolled back: nothing of this import is written
        return outcomes + [failed("pull", "policy-items", exc, register=REGISTER,
                                  sha256=pulls["policy-items"].sha256)]
    if stale:
        log.warning("register rows not supported by this pull", extra=kv(register=REGISTER, stale=len(stale)))
    return outcomes + pull_outcomes + written + skipped + stale


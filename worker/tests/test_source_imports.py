"""T-202: the Feed Additives Register and Catalogue of feed materials importers, offline against responses recorded
from the live sources (tests/recordings/register and tests/recordings/catalogue). Nothing here reaches the network."""
import gzip
import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from test_sources import FakeStore, Scripted, SwapLanguage

from nutrivo_worker import cli
from nutrivo_worker.sources import catalogue, register
from nutrivo_worker.sources.http import PoliteClient, ReplayTransport, Response
from nutrivo_worker.sources.imports import summary
from nutrivo_worker.sources.register import AdditiveRow, Authorisation, Entry
from nutrivo_worker.sources.store import pull_path

REC_REGISTER = Path(__file__).parent / "recordings" / "register"
REC_CATALOGUE = Path(__file__).parent / "recordings" / "catalogue"
LANGS = ["en", "sv", "da", "fi", "de"]
TODAY = date(2026, 10, 23)
NOW = datetime(2026, 10, 23, 8, 0, tzinfo=UTC)
TITLE = "Commission Regulation (EU) No 68/2013 on the Catalogue of feed materials"


def client(rec, transport=None):
    return PoliteClient(transport or ReplayTransport(rec), min_interval_s=0.0, sleep=lambda s: None)


def recorded(rec):
    """url → sha256 of every recorded 200 body."""
    out = {}
    for meta_path in rec.glob("*.json"):
        meta = json.loads(meta_path.read_text())
        if meta["status"] == 200:
            out[meta["url"]] = hashlib.sha256(gzip.decompress(
                meta_path.with_suffix("").with_suffix(".body.gz").read_bytes())).hexdigest()
    return out


class FakePullStore:
    """ref.sources semantics for register pulls in memory: one row per (url, sha256)."""

    def __init__(self):
        self.rows, self.objects = {}, {}

    def save_pull(self, pull, meta, retrieved_at):
        key = (pull.url, pull.sha256)
        if key in self.rows:
            return "unchanged", self.rows[key]["id"]
        self.objects[pull_path(pull)] = pull.body
        self.rows[key] = {"id": f"pull-{len(self.rows) + 1}", "title": meta.title, "licence": meta.licence,
                          "language": pull.language, "retrieved_at": retrieved_at}
        return "stored", self.rows[key]["id"]


class FakeTable:
    def __init__(self, existing=()):
        self.rows = {k: ("earlier", None) for k in existing}
        self.fail = False

    def upsert(self, row, source_id):
        if self.fail:
            raise RuntimeError("database went away")
        key = getattr(row, "id", None) or row.number
        value = (row, source_id)
        changed = self.rows.get(key) != value
        self.rows[key] = value
        return changed

    def ids(self):
        return set(self.rows)

    numbers = ids


def by_status(outcomes, kind):
    return [o for o in outcomes if o.kind == kind]


# ── the Feed Additives Register ────────────────────────────────────────────────────────────────────
def run_register(store=None, table=None, transport=None):
    return register.run(client(REC_REGISTER, transport), store, table, now=lambda: NOW)


def test_register_pulls_are_stored_byte_for_byte_with_sha256_and_retrieval_date():
    store, table = FakePullStore(), FakeTable()
    outcomes = run_register(store, table)
    pulls = by_status(outcomes, "pull")
    assert [(p.item, p.status) for p in pulls] == [(n, "stored") for n in register.ENDPOINTS]
    bodies = recorded(REC_REGISTER)
    for p in pulls:
        assert p.sha256 == bodies[p.url]
        path = f"register/feed-additives/{p.item}/{p.sha256}.json"
        assert hashlib.sha256(store.objects[path]).hexdigest() == p.sha256
        row = store.rows[(p.url, p.sha256)]
        assert (row["licence"], row["retrieved_at"]) == ("eu_reuse", NOW)
        assert row["title"].startswith("EU Register of Feed Additives")


def test_register_rows_point_at_the_stored_entries_pull():
    store, table = FakePullStore(), FakeTable()
    outcomes = run_register(store, table)
    entries_pull = next(o for o in outcomes if o.kind == "pull" and o.item == "policy-items")
    imported = [o for o in outcomes if o.kind == "additive" and o.status == "imported"]
    assert len(imported) == len(table.rows) == 1055
    assert {sid for _, sid in table.rows.values()} == {entries_pull.source_id}


def test_register_import_twice_is_unchanged_and_changes_no_row():
    store, table = FakePullStore(), FakeTable()
    run_register(store, table)
    again = run_register(store, table)
    assert {o.status for o in by_status(again, "pull")} == {"unchanged"}
    assert {o.status for o in again if o.kind == "additive" and o.status != "skipped"} == {"unchanged"}
    assert len(store.rows) == 3


def test_register_dry_run_plans_every_entry_and_writes_nothing():
    outcomes = run_register()
    assert summary(outcomes) == {
        "pull": {"fetched": 3},
        "additive": {"importable": 1055, "skipped:ambiguous_identification_number": 399,
                     "skipped:no_identification_number": 473, "skipped:withdrawn": 70, "skipped:deleted": 23,
                     "skipped:unknown_legislation_type": 6}}
    assert len(by_status(outcomes, "additive")) == 2026        # every register entry ends visibly


def test_register_number_shared_by_several_entries_is_never_written():
    outcomes = run_register(FakePullStore(), table := FakeTable())
    ambiguous = {o.id for o in outcomes if o.reason == "ambiguous_identification_number"}
    assert ambiguous and not ambiguous & set(table.rows)


AUTH = Authorisation("Cats; Dogs", date(2030, 1, 1), None, (("t_primary", "L1"),))
TYPES = {"t_primary": "Primary", "t_amend": "Amended by", "t_withdrawn": "Withdrawn by", "t_new": "Revoked in part"}


def entry(code="9z901", auths=(AUTH,), name="Test additive", item="POL-T-1", group="g1"):
    return Entry(item, code, name, group, tuple(auths))


def plan(*entries):
    return register.plan(list(entries), {"L1": "Act one", "L2": "Act two"}, {"g1": "Group one"}, TYPES)


@pytest.mark.parametrize(("e", "reason"), [
    (entry(code="."), "no_identification_number"),
    (entry(code=""), "no_identification_number"),
    (entry(name=None), "no_name"),
    (entry(auths=[Authorisation("Cats", None, date(2024, 1, 3), (("t_primary", "L1"),))]), "deleted"),
    (entry(auths=[Authorisation("Cats", None, None, (("t_primary", "L1"), ("t_withdrawn", "L2")))]), "withdrawn"),
    (entry(auths=[Authorisation("Cats", None, None, (("t_new", "L1"),))]), "unknown_legislation_type"),
    (entry(auths=[Authorisation("Cats", None, None, ((None, "L1"),))]), "unknown_legislation_type"),
    (entry(auths=[Authorisation("Cats", None, None, (("t_primary", "L9"),))]), "unknown_legislation"),
])
def test_register_entry_that_needs_a_guess_is_skipped_with_its_reason(e, reason):
    rows, skipped = plan(e)
    assert rows == [] and [(o.status, o.reason) for o in skipped] == [("skipped", reason)]


def test_register_row_keeps_the_register_values_as_served():
    two = [AUTH, Authorisation("Horses", date(2030, 1, 1), None, (("t_primary", "L2"), ("t_amend", "L1")))]
    (_, row), = plan(entry(auths=two))[0]
    assert row == AdditiveRow(id="9z901", name="Test additive", functional_group="Group one",
                              species=["Cats; Dogs", "Horses"], authorising_act="Act one; Act two",
                              expiry=date(2030, 1, 1))


def test_register_expiry_is_written_only_when_every_authorisation_agrees():
    differing = [AUTH, Authorisation("Horses", date(2031, 1, 1), None, (("t_primary", "L1"),))]
    missing = [AUTH, Authorisation("Horses", None, None, (("t_primary", "L1"),))]
    assert plan(entry(auths=differing))[0][0][1].expiry is None
    assert plan(entry(auths=missing))[0][0][1].expiry is None


def test_register_rows_that_this_pull_no_longer_supports_are_reported_stale_not_removed():
    table = FakeTable(existing=["9z999"])
    outcomes = run_register(FakePullStore(), table)
    stale = [o for o in outcomes if o.status == "stale"]
    assert [(o.id, o.reason) for o in stale] == [("9z999", "not_in_register")]
    assert "9z999" in table.rows


def test_register_pull_failure_is_visible_and_writes_nothing():
    store, table = FakePullStore(), FakeTable()
    outcomes = run_register(store, table, Scripted(*[Response(404, {}, b"", "u")] * 3))
    assert {(o.kind, o.status, o.reason) for o in outcomes} == {("pull", "failed", "http_404")}
    assert store.rows == {} and table.rows == {}


def test_register_answer_of_an_unexpected_shape_fails_and_writes_nothing():
    store, table = FakePullStore(), FakeTable()
    body = json.dumps([{"childrenValues": [{"valueIdentifier": "unrelated", "value": 1}]}]).encode()
    outcomes = run_register(store, table, Scripted(ok_json(body), ok_json(b"[]"), ok_json(b"{}")))
    assert [(o.status, o.reason) for o in outcomes] == [("failed", "unexpected_shape")]
    assert store.rows == {} and table.rows == {}


def test_register_answer_that_is_not_json_fails_as_unexpected_content_type():
    html = Response(200, {"content-type": "text/html"}, b"<html/>", "u")
    outcomes = run_register(FakePullStore(), FakeTable(), Scripted(html, html, html))
    assert {o.reason for o in outcomes} == {"unexpected_content_type"}


def test_register_write_failure_reports_failed_and_nothing_counts_as_imported():
    table = FakeTable()
    table.fail = True
    outcomes = run_register(FakePullStore(), table)
    assert [o.status for o in outcomes] == ["failed"]


def ok_json(body):
    return Response(200, {"content-type": "application/json"}, body, "u")


class CatalogueSwap(SwapLanguage):
    def __init__(self, asked, served):
        self.inner, self.asked, self.served = ReplayTransport(REC_CATALOGUE), asked, served


# ── the Catalogue of feed materials ────────────────────────────────────────────────────────────────
def run_catalogue(store=None, table=None, transport=None):
    return catalogue.run(client(REC_CATALOGUE, transport), store, table, LANGS, title=TITLE, today=TODAY,
                         now=lambda: NOW)


@pytest.fixture(scope="module")
def imported():
    store, table = FakeStore(), FakeTable()
    return run_catalogue(store, table), store, table


def test_catalogue_text_in_five_languages_is_stored_with_sha256(imported):
    outcomes, store, _ = imported
    pulls = by_status(outcomes, "pull")
    assert [(p.language, p.status, p.item) for p in pulls] == [(lang, "stored", "02013R0068-20220724")
                                                               for lang in LANGS]
    bodies = recorded(REC_CATALOGUE)
    assert all(p.sha256 == bodies[p.url] for p in pulls)
    assert {r["title"] for r in store.rows.values()} == {f"{TITLE} · consolidated text 2022-07-24"}


def test_catalogue_names_come_from_each_language_version(imported):
    _, _, table = imported
    row, _ = table.rows["1.1.1"]
    assert row.names == {"en": "Barley", "sv": "Korn", "da": "Byg", "fi": "Ohra", "de": "Gerste"}
    assert len(table.rows) == 655


def test_catalogue_language_without_the_entry_is_left_out_and_reported(imported):
    outcomes, _, table = imported
    row, _ = table.rows["5.41.1"]
    assert "da" not in row.names and set(row.names) == {"en", "sv", "fi", "de"}
    missing = [(o.item, o.languages_missing) for o in outcomes if o.reason == "language_missing"]
    assert missing == [("5.41.1", ["da"])]


def test_catalogue_footnote_references_and_consolidation_markers_are_dropped(imported):
    _, _, table = imported
    assert table.rows["9.2.1"][0].names["en"] == "Animal fat"            # <a href="#…">(2)</a>
    assert table.rows["5.41.1"][0].names["en"] == "Pomegranate expeller"  # (<span class="superscript">5</span>)
    assert table.rows["2.18.12"][0].names["da"] == "Sojabønneflager"      # ►C3 … ◄
    text = json.dumps([[r.names, r.description, r.compulsory_declarations] for r, _ in table.rows.values()],
                      ensure_ascii=False)
    assert "►" not in text and "◄" not in text and "\\u0000" not in text


def test_catalogue_declarations_are_the_printed_lines_and_description_is_english(imported):
    _, _, table = imported
    row, _ = table.rows["1.1.3"]
    assert row.compulsory_declarations == ["Starch, if > 10 %", "Crude protein, if > 15 %"]
    assert row.description.startswith("Product of barley roasting process")
    assert table.rows["1.1.1"][0].compulsory_declarations == []


def test_catalogue_rows_point_at_the_english_source_row(imported):
    outcomes, _, table = imported
    en = next(o for o in outcomes if o.kind == "pull" and o.language == "en")
    assert {sid for _, sid in table.rows.values()} == {en.source_id}


def test_catalogue_import_twice_is_unchanged():
    store, table = FakeStore(), FakeTable()
    run_catalogue(store, table)
    again = run_catalogue(store, table)
    assert {o.status for o in again} == {"unchanged"}
    assert len(store.rows) == 5


def test_catalogue_dry_run_writes_nothing():
    outcomes = run_catalogue()
    assert summary(outcomes) == {"pull": {"fetched": 5}, "material": {"importable": 655}}


def test_catalogue_language_that_fails_its_check_stops_the_import_before_any_write():
    store, table = FakeStore(), FakeTable()
    outcomes = run_catalogue(store, table, CatalogueSwap("dan", "swe"))
    assert [(o.status, o.language, o.reason) for o in outcomes] == [("failed", "da", "language_mismatch")]
    assert store.rows == {} and table.rows == {}


def test_catalogue_numbers_printed_with_a_trailing_period_are_read():
    body = ("<html><body><table><tr><td><p>1.2.3.</p></td><td><p>Name <a href='#n1'>(<span class='superscript'>1"
            "</span>)</a></p></td><td><p>Desc</p></td><td><p>A</p><p>B</p></td></tr></table></body></html>")
    entries = catalogue.parse_part_c(body.encode(), "da")
    assert entries["1.2.3"] == catalogue.CatalogueEntry("1.2.3", "Name", "Desc", ["A", "B"])


@pytest.mark.parametrize("rows", [
    "",
    "<tr><td>1.2.3</td><td>A</td><td/><td/></tr><tr><td>1.2.3</td><td>B</td><td/><td/></tr>",
    "<tr><td>1.2.3</td><td></td><td/><td/></tr>",
])
def test_catalogue_text_of_an_unexpected_shape_fails(rows):
    with pytest.raises(Exception) as err:
        catalogue.parse_part_c(f"<html><body><table>{rows}</table></body></html>".encode(), "en")
    assert getattr(err.value, "reason", None) == "unexpected_shape"


# ── the command ────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(("what", "rec", "expected"), [
    ("additives", REC_REGISTER, {"fetched": 3}),
    ("materials", REC_CATALOGUE, {"fetched": 5}),
])
def test_cli_import_dry_run_from_recordings(capsys, what, rec, expected):
    assert cli.main(["sources", "import", what, "--dry-run", "--replay", str(rec)]) == 0
    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["summary"]["pull"] == expected


def test_cli_import_exits_non_zero_when_a_pull_fails(capsys, tmp_path):
    assert cli.main(["sources", "import", "additives", "--dry-run", "--replay", str(tmp_path)]) == 1
    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["summary"] == {"pull": {"failed": 3}}

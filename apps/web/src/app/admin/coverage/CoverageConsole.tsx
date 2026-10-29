"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Blueprint, Button, EmptyState, Panel, SectionHeading, cx } from "@/components/kit";
import type { CoverageRow, Draft, DraftDetail, Jurisdiction } from "@/lib/admin/reads";
import { COVERAGE_STATES, DOMAINS, REASON_CODES, label, type ActionResult } from "@/lib/admin/staff";
import { createDraft, openGap, releaseRuleset, setDraftCoverage, setDraftMember } from "../actions";

const field = "block w-full mt-[4px] border border-n400 rounded-control bg-paper py-[6px] px-[8px] text-[13px] text-ink";
const caption = "block font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600";
const STATE_TONE: Record<string, string> = { complete: "text-clear", partial: "text-action", not_encoded: "text-na" };

type Outcome = { tone: "done" | "refused"; text: string } | null;

/** One write: run it, show what the database said, and re-read the page when it changed something. */
function useWrite() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>(null);
  function write<T>(call: () => Promise<ActionResult<T>>, done: (value: T) => string) {
    start(async () => {
      const result = await call();
      if (result.ok) {
        setOutcome({ tone: "done", text: done(result.value) });
        router.refresh();
      } else setOutcome({ tone: "refused", text: result.message });
    });
  }
  return { pending, outcome, write };
}

function Said({ outcome, name }: { outcome: Outcome; name: string }) {
  return (
    <p role="status" data-said={name} data-tone={outcome?.tone ?? ""} className={cx("m-0 text-[13px]", outcome?.tone === "refused" ? "text-blocked" : "text-n700")}>
      {outcome?.text ?? ""}
    </p>
  );
}

function CreateDraft() {
  const { pending, outcome, write } = useWrite();
  const router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    write(() => createDraft(form), (id) => {
      router.push(`/admin/coverage?draft=${encodeURIComponent(id)}`);
      return `Draft ${id} started from the latest release.`;
    });
  }
  return (
    <form onSubmit={submit} aria-label="Start a draft" className="mt-[12px] flex flex-col gap-[8px]">
      <label className="text-[13px]">
        <span className={caption}>New draft id</span>
        <input name="id" required pattern="[0-9]{4}\.[0-9]{2}-[a-z0-9]+" placeholder="2026.11-a" className={field} />
      </label>
      <label className="text-[13px]">
        <span className={caption}>Notes</span>
        <input name="notes" className={field} />
      </label>
      <Button type="submit" disabled={pending}>Start a draft</Button>
      <Said outcome={outcome} name="create-draft" />
    </form>
  );
}

function Release({ draft, blockers, detail }: { draft: Draft; blockers: string[]; detail: DraftDetail }) {
  const { pending, outcome, write } = useWrite();
  const run = detail.latestRun;
  return (
    <Blueprint edge={blockers.length ? "border-l-4 border-l-action" : "border-l-4 border-l-clear"} className="py-[16px] px-[18px]">
      <div data-release-gate={blockers.length ? "blocked" : "open"}>
        <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Release gate · K05</p>
        <p className="mt-[8px] mb-0 text-[15px] font-semibold">
          {blockers.length ? `Draft ${draft.id} cannot be released yet` : `Draft ${draft.id} passed its fixture run`}
        </p>
        <p className="mt-[6px] mb-0 text-[13px] text-n700">
          {run
            ? `Latest fixture run: ${run.passed ? "passed" : "failed"}, ${run.ruleFixturesRan} of ${detail.fixturesExpected} fixtures judged, by ${run.runner}, ${run.ranAt.slice(0, 16).replace("T", " ")}.`
            : "No fixture run is recorded for this draft."}
        </p>
        {blockers.length ? (
          <ul data-blockers className="mt-[8px] mb-0 pl-[18px] text-[13px] leading-[1.5] text-n800">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        ) : null}
        <p className="mt-[8px] mb-0 text-[12px] text-n600">
          The database decides: it re-checks members, fixtures and the run against the draft as it is now, and refuses
          with its reason.
        </p>
        <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              write(() => releaseRuleset(draft.id), (v) => {
                const r = v as { diffs?: unknown[]; fanout_jobs?: unknown[] } | null;
                return `Released ${draft.id}: ${r?.diffs?.length ?? 0} diffs, ${r?.fanout_jobs?.length ?? 0} alert jobs.`;
              })
            }
          >
            Release {draft.id}
          </Button>
          <Said outcome={outcome} name="release" />
        </div>
      </div>
    </Blueprint>
  );
}

function Members({ draft, detail }: { draft: Draft; detail: DraftDetail }) {
  const { pending, outcome, write } = useWrite();
  // A rule not in the draft is offered at any accepted version; one in it only at a newer version (going back is
  // not decided yet, #34).
  const pinned = new Map(detail.members.map((m) => [m.ruleKey, m.version]));
  const offer = detail.accepted.filter((a) => a.version > (pinned.get(a.ruleKey) ?? 0));
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("member") ?? "");
    const at = value.lastIndexOf(":");
    const ruleKey = value.slice(0, at);
    const version = Number(value.slice(at + 1));
    write(() => setDraftMember(draft.id, ruleKey, version), () => `${ruleKey} v${version} is in draft ${draft.id}.`);
  }
  return (
    <section aria-label="Member rules">
      <SectionHeading note="Accepted rule versions only (P0038)">Member rules</SectionHeading>
      {detail.members.length === 0 ? (
        <p className="mt-[10px] text-[13px] text-n700">No rule is in this draft yet.</p>
      ) : (
        <table className="mt-[4px] w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left">
              {["Rule", "Version", "Domain · node", "Fixtures", ""].map((h) => (
                <th key={h} scope="col" className="py-[8px] pr-[10px] font-mono text-[9.5px] tracking-[0.12em] uppercase font-normal text-n600 border-b border-rule">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => {
              const tested = ["failed", "passed", "withheld"].every((o) => m.fixtureOutcomes.includes(o));
              return (
                <tr key={m.ruleKey} data-member={m.ruleKey} className="border-b border-rule align-baseline">
                  <td className="py-[9px] pr-[10px] break-all">{m.ruleKey}<br /><span className="text-n600">{m.title}</span></td>
                  <td className="py-[9px] pr-[10px] font-mono">v{m.version}</td>
                  <td className="py-[9px] pr-[10px]">{label(m.domain ?? "")} · {m.nodeId}</td>
                  <td className={cx("py-[9px] pr-[10px] font-mono text-[11px]", tested ? "text-clear" : "text-action")}>
                    {m.fixtures} · {tested ? "TESTED" : `MISSING ${["failed", "passed", "withheld"].filter((o) => !m.fixtureOutcomes.includes(o)).join(", ").toUpperCase()}`}
                  </td>
                  <td className="py-[9px] text-right">
                    {draft.released ? null : (
                      <Button variant="ghost" disabled={pending} onClick={() => write(() => setDraftMember(draft.id, m.ruleKey, null), () => `${m.ruleKey} left draft ${draft.id}.`)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {draft.released ? null : offer.length ? (
        <form onSubmit={add} aria-label="Add a rule version" className="mt-[10px] flex flex-wrap items-end gap-[8px]">
          <label className="text-[13px] min-w-[280px]">
            <span className={caption}>Accepted rule version</span>
            <select name="member" required defaultValue="" className={field}>
              <option value="" disabled>Choose</option>
              {offer.map((a) => <option key={`${a.ruleKey}:${a.version}`} value={`${a.ruleKey}:${a.version}`}>{a.ruleKey} v{a.version} · {a.title}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={pending}>Put in the draft</Button>
        </form>
      ) : (
        <div data-offer="none" className="mt-[10px]">
          <p className="m-0 text-[12.5px] text-n600">Every accepted rule version is already in the draft.</p>
          <p className="mt-[4px] mb-0 font-mono text-[10.5px]">
            <Link href="/admin/rules" className="underline">Review rule candidates →</Link>
          </p>
        </div>
      )}
      <div className="mt-[6px]"><Said outcome={outcome} name="members" /></div>
    </section>
  );
}

/** A released draft is frozen: its coverage is shown, never offered for editing (every change would be refused). */
function FrozenCell({ row }: { row: CoverageRow }) {
  return (
    <div data-coverage={`${row.nodeId}:${row.domain}`} data-state={row.state}
      className="grid grid-cols-1 md:grid-cols-[170px_120px_minmax(0,1fr)_140px] gap-[10px] items-baseline border-b border-rule py-[10px] text-[13px]">
      <p className="m-0 font-semibold">{label(row.domain)}</p>
      <p className={cx("m-0 font-mono text-[10px] tracking-[0.08em] uppercase", STATE_TONE[row.state])}>{label(row.state)}</p>
      <p className="m-0">{row.gapId ?? "No gap"} · {label(row.method)}</p>
      <p className="m-0 font-mono text-[11.5px]">{row.lastCheckedAt ?? "Not checked"}</p>
    </div>
  );
}

function CoverageCell({ draft, row, gaps }: { draft: Draft; row: CoverageRow; gaps: DraftDetail["gaps"] }) {
  const { pending, outcome, write } = useWrite();
  const own = gaps.filter((g) => g.nodeId === row.nodeId && g.domain === row.domain);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    write(
      () => setDraftCoverage(draft.id, row.nodeId, row.domain, form),
      () => `${row.nodeId} ${label(row.domain)} is now ${label(String(form.get("state")))} in draft ${draft.id}.`,
    );
  }
  return (
    <form onSubmit={save} aria-label={`${row.nodeId} ${label(row.domain)}`} data-coverage={`${row.nodeId}:${row.domain}`} data-state={row.state}
      className="grid grid-cols-1 md:grid-cols-[170px_120px_minmax(0,1fr)_140px_auto] gap-[10px] items-end border-b border-rule py-[10px]">
      <div>
        <p className="m-0 text-[13px] font-semibold">{label(row.domain)}</p>
        <p className={cx("m-0 font-mono text-[10px] tracking-[0.08em] uppercase", STATE_TONE[row.state])}>{label(row.state)}</p>
        <p className="m-0 text-[11.5px] text-n600">Method: {label(row.method)}</p>
      </div>
      <label className="text-[13px]">
        <span className={caption}>State</span>
        <select name="state" defaultValue={row.state} className={field}>
          {COVERAGE_STATES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </label>
      <label className="text-[13px]">
        <span className={caption}>Gap (needed unless complete)</span>
        <select name="gap_id" defaultValue={row.gapId ?? ""} className={field}>
          <option value="">None</option>
          {own.map((g) => <option key={g.gapId} value={g.gapId}>{g.gapId} · {label(g.reasonCode)}</option>)}
          {row.gapId && !own.some((g) => g.gapId === row.gapId) ? <option value={row.gapId}>{row.gapId}</option> : null}
        </select>
      </label>
      <label className="text-[13px]">
        <span className={caption}>Last checked</span>
        <input type="date" name="last_checked_at" defaultValue={row.lastCheckedAt ?? ""} className={field} />
      </label>
      <Button type="submit" disabled={pending}>Save</Button>
      <input type="hidden" name="method" value={row.method} />
      <div className="md:col-span-5"><Said outcome={outcome} name={`coverage-${row.domain}`} /></div>
    </form>
  );
}

function OpenGap({ node, nodes }: { node: string | null; nodes: Jurisdiction[] }) {
  const { pending, outcome, write } = useWrite();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    write(() => openGap(form), (id) => `Gap ${id} is open.`);
  }
  return (
    <Panel title="Open a gap" aside="Says plainly what is missing">
      <form onSubmit={submit} aria-label="Open a gap" className="flex flex-col gap-[8px]">
        <label className="text-[13px]">
          <span className={caption}>Gap id</span>
          <input name="gap_id" required pattern="GAP-[A-Z0-9_\-]+" placeholder="GAP-EU-SE-TYPE_GEOMETRY" className={field} />
        </label>
        <label className="text-[13px]">
          <span className={caption}>Node</span>
          <select name="node" required defaultValue={node ?? ""} className={field}>
            {nodes.filter((n) => n.nodeType !== "region").map((n) => <option key={n.id} value={n.id}>{n.id} · {n.name}</option>)}
          </select>
        </label>
        <label className="text-[13px]">
          <span className={caption}>Domain</span>
          <select name="domain" required defaultValue={DOMAINS[0]} className={field}>
            {DOMAINS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
          </select>
        </label>
        <label className="text-[13px]">
          <span className={caption}>Reason</span>
          <select name="reason_code" required defaultValue={REASON_CODES[0]} className={field}>
            {REASON_CODES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </label>
        <label className="text-[13px]">
          <span className={caption}>What is missing</span>
          <textarea name="description" required rows={3} className={field} />
        </label>
        <Button type="submit" disabled={pending}>Open the gap</Button>
        <Said outcome={outcome} name="open-gap" />
      </form>
    </Panel>
  );
}

export function CoverageConsole({
  drafts,
  latestRelease,
  draft,
  detail,
  blockers,
  nodes,
  coverageNodes,
  node,
}: {
  drafts: Draft[];
  latestRelease: string | null;
  draft: Draft | null;
  detail: DraftDetail | null;
  blockers: string[];
  nodes: Jurisdiction[];
  coverageNodes: string[];
  node: string | null;
}) {
  const router = useRouter();
  const rows = detail && node ? detail.coverage.filter((c) => c.nodeId === node).sort((a, b) => DOMAINS.indexOf(a.domain as never) - DOMAINS.indexOf(b.domain as never)) : [];
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-[22px] items-start">
        <div className="flex flex-col gap-[18px]">
          <Panel title="Drafts" aside={latestRelease ? `LATEST ${latestRelease}` : undefined}>
            {drafts.length === 0 ? (
              <p className="m-0 text-[13px] text-n700">No draft yet. A draft starts as a copy of the latest release.</p>
            ) : (
              <ul aria-label="Drafts" className="m-0 p-0 list-none">
                {drafts.map((d) => (
                  <li key={d.id} className="py-[4px]">
                    <Link href={`/admin/coverage?draft=${encodeURIComponent(d.id)}`} aria-current={d.id === draft?.id ? "page" : undefined}
                      className={cx("font-mono text-[12px]", d.id === draft?.id ? "font-medium text-ink" : "text-accent-700")}>
                      {d.id}
                    </Link>
                    <span className="ml-[6px] font-mono text-[10px] text-n600">{d.released ? "RELEASED" : "OPEN"}</span>
                  </li>
                ))}
              </ul>
            )}
            <CreateDraft />
          </Panel>
          <OpenGap node={node} nodes={nodes} />
        </div>

        <div className="flex flex-col gap-[22px] min-w-0">
          {!draft || !detail ? (
            <EmptyState
              where="COVERAGE · DRAFT"
              title="Coverage is edited on a draft"
              body="Start a draft: it copies the latest release's member rules and coverage. Coverage changes reach customers only when the draft is released."
            />
          ) : (
            <>
              {draft.released ? (
                <p className="m-0 text-[13px] text-n700">Draft {draft.id} is released and frozen. Start a new draft to change coverage.</p>
              ) : (
                <Release draft={draft} blockers={blockers} detail={detail} />
              )}
              <Members draft={draft} detail={detail} />
              <section aria-label="Coverage">
                <SectionHeading note="Complete only when every member rule of the node and domain is accepted and tested (BE-10)">
                  Coverage
                </SectionHeading>
                {coverageNodes.length ? (
                  <label className="mt-[10px] block text-[13px] max-w-[360px]">
                    <span className={caption}>Node</span>
                    <select
                      value={node ?? ""}
                      onChange={(e) => router.push(`/admin/coverage?draft=${encodeURIComponent(draft.id)}&node=${encodeURIComponent(e.target.value)}`)}
                      className={field}
                    >
                      {coverageNodes.map((n) => <option key={n} value={n}>{n} · {name(n)}</option>)}
                    </select>
                  </label>
                ) : (
                  <p className="mt-[10px] text-[13px] text-n700">This draft holds no coverage rows.</p>
                )}
                <div className="mt-[6px]">
                  {rows.map((row) =>
                    draft.released ? (
                      <FrozenCell key={`${row.nodeId}:${row.domain}`} row={row} />
                    ) : (
                      <CoverageCell key={`${row.nodeId}:${row.domain}`} draft={draft} row={row} gaps={detail.gaps} />
                    ),
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

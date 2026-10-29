"use client";

import { useState } from "react";
import {
  EmptyState,
  ErrorState,
  Finding,
  NoPermissionState,
  ProvenanceTag,
  StateBadge,
  StateGlyph,
  cx,
  STATE_BORDER,
  STATE_LABEL,
  STATE_TEXT,
  STATE_TINT,
} from "@/components/kit";
import { ScreenHeader, useShell } from "@/components/shell";
import type { ReportPage } from "@/lib/report/queries";
import type { MarketTile, Pin, ReportFinding, ResultSet } from "@/lib/report/model";
import { ROLE_LABEL, roleAllows, routeFor } from "@/lib/shell/routes";

// The artwork is drawn to its own scale, no taller than this, so a tall panel still fits beside its findings.
const MAX_DRAWING_PX = 560;

// S-NV2-003 Label report (Nutrivo 2.0, screen "report"), D07. One result set per market × printed language panel:
// the switcher picks the set, the artwork shows that panel's text where it was printed, and the findings are that
// check's own. Out of scope here, left out rather than drawn as dead controls (#46): the Compliance Worker panel
// (LATER, #24), "What you must register" (D08) and Issue Certificate of Check (I-workflows).
export function LabelReport({
  route,
  workspaceId,
  productId,
  page,
}: {
  route: string;
  workspaceId: string;
  productId: string;
  page: ReportPage;
}) {
  const screen = routeFor(route);
  const { current } = useShell();
  const allowed = roleAllows(current.role, screen.role);
  const loaded = page.kind === "loaded" ? page : null;
  const sets = loaded?.report.sets ?? [];
  const [selected, setSelected] = useState<string | null>(sets[0]?.checkId ?? null);
  const set = sets.find((s) => s.checkId === selected) ?? sets[0] ?? null;

  const title = loaded
    ? `${loaded.product.name} · ${count(loaded.markets, "jurisdiction node")}, ${count(loaded.report.languages, "language")}`
    : screen.title;
  return (
    <>
      <ScreenHeader crumb="Check your label · Report" title={title} aside={set ? <RulesetChip set={set} /> : null} />
      <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
        {!allowed ? (
          <div className="max-w-[640px]">
            <NoPermissionState
              where="NO PERMISSION · LABEL REPORT"
              title="Your role cannot open the label report"
              body={`You are a ${ROLE_LABEL[current.role]} in ${current.name}. The label report needs a ${ROLE_LABEL[screen.role]} or a role above it.`}
              aside={`An admin of ${current.name} can change your role.`}
            />
          </div>
        ) : page.kind === "not-found" ? (
          <div className="max-w-[640px]">
            <ErrorState
              where="LABEL REPORT"
              title={`This product is not in ${current.name}`}
              body="It may have been moved, or the link is wrong. Nothing was read or changed."
              reference={{ label: "Board", href: `/w/${workspaceId}/board` }}
            />
          </div>
        ) : !set ? (
          <div className="max-w-[640px]">
            <EmptyState
              where="LABEL REPORT"
              title="No check has run on this product yet"
              body="When a check runs, its results appear here: one set per printed language panel, each finding pinned to the artwork, and everything not assessed linked to the coverage gap behind it."
              action={{ label: "Upload & scope", href: `/w/${workspaceId}/products/${productId}/check` }}
            />
          </div>
        ) : (
          <Report workspaceId={workspaceId} productId={productId} tiles={loaded!.report.markets} sets={sets} set={set} onSelect={setSelected} />
        )}
      </main>
    </>
  );
}

function Report({
  workspaceId,
  productId,
  tiles,
  sets,
  set,
  onSelect,
}: {
  workspaceId: string;
  productId: string;
  tiles: MarketTile[];
  sets: ResultSet[];
  set: ResultSet;
  onSelect: (checkId: string) => void;
}) {
  const shown = set.findings.filter((f) => f.state !== "info");
  return (
    // The design's content width beside its Compliance Worker panel, which is LATER (#24).
    <div data-screen="S-NV2-003" className="max-w-[948px]">
      <div data-region="markets" className="flex gap-px border border-rule bg-rule">
        {tiles.map((m) => (
          <MarketTileView
            key={m.nodeId}
            tile={m}
            active={m.nodeId === set.nodeId}
            href={`/w/${workspaceId}/products/${productId}/nodes/${encodeURIComponent(m.nodeId)}`}
          />
        ))}
      </div>

      <div className="mt-[16px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-[20px] items-start">
        <section aria-label="Artwork">
          <div data-region="switcher" className="flex items-center flex-wrap gap-[10px] mb-[10px]">
            <span className="font-mono text-[10px] tracking-[0.13em] uppercase whitespace-nowrap text-n600">
              Artwork · {set.label} panel
            </span>
            <span className="flex-1 min-w-[12px]" />
            <span id="report-language" className="font-mono text-[10px] tracking-[0.1em] uppercase whitespace-nowrap text-n600">
              Language
            </span>
            <div role="group" aria-labelledby="report-language" className="flex flex-wrap gap-px bg-rule border border-rule">
              {sets.map((s) => (
                <button
                  key={s.checkId}
                  type="button"
                  aria-pressed={s.checkId === set.checkId}
                  aria-label={`${s.label}: ${s.nodeName}, ${(s.language ?? "unknown").toUpperCase()} panel, ${STATE_LABEL[s.state]}`}
                  data-check-id={s.checkId}
                  onClick={() => onSelect(s.checkId)}
                  className={cx(
                    "border-0 py-[5px] px-[9px] font-mono text-[10.5px] tracking-[0.06em] cursor-pointer kit-transition",
                    s.checkId === set.checkId ? "bg-accent text-paper" : "bg-paper text-ink hover:brightness-95",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <Artwork set={set} />
        </section>

        <section aria-labelledby="report-findings" data-check-id={set.checkId} data-region="findings">
          <div className="flex items-baseline gap-[10px] border-b border-ink pb-[6px]">
            <h2 id="report-findings" className="m-0 font-head text-[16px] font-semibold">
              What is missing, and what to do
            </h2>
            <span className="flex-1" />
            <span className="font-mono text-[10.5px] text-n600">
              {set.label} · {count(shown.length, "finding")}
            </span>
          </div>
          {shown.length === 0 ? (
            <div className="border-b border-rule pt-[12px] px-[2px] pb-[13px] flex items-center gap-[9px]">
              <StateBadge state={set.state} />
              <span className="text-[13px] text-n700">No findings on this panel.</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {shown.map((f) => (
                <FindingRow key={f.id} f={f} />
              ))}
            </div>
          )}
          {set.findings.some((f) => f.state === "info") ? (
            <ul className="mt-[14px] mb-0 p-0 list-none">
              {set.findings
                .filter((f) => f.state === "info")
                .map((f) => (
                  <li key={f.id} className="py-[6px] text-[12.5px] text-n700 flex gap-[10px] flex-wrap">
                    <span>{f.title}</span>
                    <ProvenanceTag provenance={f.provenance} className="text-[10px]" />
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function MarketTileView({ tile, active, href }: { tile: MarketTile; active: boolean; href: string }) {
  // A tile opens its market's product × node view (S-MOB-003 and its desktop counterpart); the switcher picks panels.
  return (
    <a
      href={href}
      data-node={tile.nodeId}
      aria-current={active ? "true" : undefined}
      aria-label={`${tile.name}: ${STATE_LABEL[tile.state]}, ${tile.detail}`}
      className={cx(
        "flex-1 min-w-0 block no-underline text-left py-[11px] px-[13px] border-b-[3px] kit-transition hover:brightness-[0.97]",
        STATE_TINT[tile.state],
        STATE_BORDER[tile.state],
      )}
    >
      {/* --n700, not the design's --n600: on a state tint --n600 falls below 4.5:1 (axe). */}
      <p className="m-0 font-mono text-[10px] tracking-[0.1em] text-n700">{tile.code}</p>
      <p className={cx("mt-[4px] mb-0 font-head text-[14px] font-semibold leading-[1.15] flex items-center gap-[6px]", STATE_TEXT[tile.state])}>
        <StateGlyph state={tile.state} size="sm" />
        {STATE_LABEL[tile.state]}
      </p>
      <p className="mt-[3px] mb-0 font-mono text-[10.5px] text-n700">{tile.detail}</p>
    </a>
  );
}

function Artwork({ set }: { set: ResultSet }) {
  const panel = set.panel;
  return (
    <div data-region="artwork">
      <div className="relative border border-ink bg-panel p-[26px] min-h-[460px]">
        <p className="mt-0 mb-[14px] font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">
          {panel ? panel.caption : "No panel recorded for this check"}
        </p>
        {panel ? (
          <div
            data-panel-id={panel.id}
            className="relative bg-paper border border-rule mx-auto"
            style={{
              aspectRatio: `${panel.widthMm} / ${panel.heightMm}`,
              width: `min(100%, ${Math.round((MAX_DRAWING_PX * panel.widthMm) / panel.heightMm)}px)`,
              containerType: "inline-size",
            }}
          >
            {panel.pins.map((p) => (
              <PinBox key={p.id} p={p} widthMm={panel.widthMm} heightMm={panel.heightMm} />
            ))}
          </div>
        ) : null}
        <p className="mt-[20px] mb-0 font-mono text-[9.5px] text-n600">
          Findings are pinned to coordinates on the extracted sheet. Character heights measured from vector outlines, not
          estimated from point size.
        </p>
      </div>
      <p className="mt-[8px] mb-0 font-mono text-[10px] text-n600" data-pinned>
        Ruleset {set.rulesetVersion} · artwork {shortSha(set.artworkSha)} · checked {when(set.checkedAt)}
      </p>
    </div>
  );
}

function PinBox({ p, widthMm, heightMm }: { p: Pin; widthMm: number; heightMm: number }) {
  // Positions and type size scale with the drawing (cqw: a percentage of the drawing's width).
  const pct = (v: number, of: number) => `${(100 * v) / of}%`;
  // Type about the printed size: a box of several lines is not one line of that height, so the size is capped.
  const fontCqw = (Math.min(p.box.h * 0.6, 2.6) * 100) / widthMm;
  return (
    <div
      data-text-object={p.id}
      data-pin={p.pin ?? ""}
      title={p.text}
      className={cx("absolute border border-dashed", p.state ? STATE_BORDER[p.state] : "border-n300")}
      style={{ left: pct(p.box.x, widthMm), top: pct(p.box.y, heightMm), width: pct(p.box.w, widthMm), height: pct(p.box.h, heightMm) }}
    >
      {p.pin && p.state ? (
        <span
          aria-hidden="true"
          className={cx(
            "absolute -top-[9px] -left-[9px] w-[18px] h-[18px] border font-mono text-[10px] flex items-center justify-center",
            STATE_BORDER[p.state],
            STATE_TINT[p.state],
            STATE_TEXT[p.state],
          )}
        >
          {p.pin}
        </span>
      ) : null}
      <p
        className="m-0 h-full overflow-hidden leading-[1.15] text-n800"
        style={{ fontSize: `max(6px, ${fontCqw.toFixed(2)}cqw)` }}
      >
        {p.text}
      </p>
    </div>
  );
}

function FindingRow({ f }: { f: ReportFinding }) {
  if (f.state === "action") {
    return (
      <Finding
        state="action"
        title={f.title}
        action={f.action}
        pin={f.pin}
        measure={f.measure}
        provenance={f.provenance}
        ruleKey={f.ruleKey}
        citation={f.citation}
      />
    );
  }
  if (f.state === "not_assessed") {
    return f.gapId !== null ? (
      <Finding
        state="not_assessed"
        title={f.title}
        action={f.action}
        pin={f.pin}
        measure={f.measure}
        provenance={f.provenance}
        reasonCode={f.reasonCode}
        gapId={f.gapId}
        gapHref={f.gapHref}
        ruleKey={f.ruleKey}
        citation={f.citation}
      />
    ) : (
      <Finding
        state="not_assessed"
        title={f.title}
        action={f.action}
        pin={f.pin}
        measure={f.measure}
        provenance={f.provenance}
        reasonCode={f.reasonCode}
        gapId={null}
        ruleKey={f.ruleKey}
        citation={f.citation}
      />
    );
  }
  return null;
}

function RulesetChip({ set }: { set: ResultSet }) {
  return (
    <span className="border border-rule py-[5px] px-[9px] font-mono text-[10.5px] tracking-[0.06em] text-n600 whitespace-nowrap">
      RULESET {set.rulesetVersion} · {set.rulesetCurrent ? "current" : "superseded"}
    </span>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function shortSha(sha: string | null) {
  return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : "not recorded";
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

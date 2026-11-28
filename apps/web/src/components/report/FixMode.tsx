"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ButtonLink,
  ErrorState,
  GapLink,
  ProvenanceTag,
  StateGlyph,
  cx,
  STATE_TEXT,
  STATE_TINT,
} from "@/components/kit";
import { Screen, useShell } from "@/components/shell";
import { requestCheck, type CheckRefusal } from "@/lib/checks/run";
import { resolveRequestId } from "@/lib/observability/request-id";
import { bannerFor, pinLine, plural, type FixBanner, type FixItem, type FixMarket, type FixPanel } from "@/lib/report/fix";
import type { FixPage } from "@/lib/report/fix-queries";
import { roleAllows } from "@/lib/shell/routes";
import { createClient } from "@/lib/supabase/client";

const ROUTE = "/w/[workspace]/products/[product]/report";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
// Each panel is drawn to its own scale, no taller than this at 100 %, two to a row, as the design lays the label out.
const PANEL_PX = 300;
const ZOOM_BUTTON =
  "font-head w-[36px] h-[36px] border border-rule rounded-control bg-paper text-ink cursor-pointer kit-transition hover:border-accent disabled:opacity-45 disabled:cursor-not-allowed";

// S-FIX-001 to S-FIX-013 · the label report as Fix mode (D-33, T-1114; D07, D08), page content inside the built rail.
// The label's panels beside the checklist: the selected market's findings, panel by panel, each with its rule and
// citation, Copy required term only from an accepted register entry in the panel's language (D-31), and Upload
// revision; then what was not assessed, each linked to its gap. Pins and findings clear only through a new check of a
// new artwork version: there is no mark-as-done. Not built before release 1.5: Assign and Send to expert.
export function FixMode({ workspaceId, productId, page }: { workspaceId: string; productId: string; page: FixPage }) {
  const loaded = page.kind === "loaded" ? page : null;
  const initial = loaded?.model.initialMarket ?? null;
  const pinned = (loaded?.model.markets ?? []).find((m) => m.nodeId === initial && m.rulesetVersion);
  // T-505 (D09, #55 q2): the chip opens this product's coverage, at the ruleset its markets were checked against.
  const chip = pinned ? (
    <a
      href={`/w/${workspaceId}/library/coverage?product=${productId}`}
      title="Coverage for this product's markets"
      className="border border-rule py-[5px] px-[9px] font-mono text-[10.5px] tracking-[0.06em] text-n600 whitespace-nowrap no-underline hover:border-accent hover:text-accent-700 kit-transition"
    >
      RULESET {pinned.rulesetVersion} · {pinned.rulesetCurrent ? "current" : "superseded"}
    </a>
  ) : null;
  return (
    <Screen route={ROUTE} crumb="Products · Label report" title={loaded?.product.name} aside={chip}>
      {loaded?.outsidePlan.length ? (
        <p data-outside-plan className="mt-0 mb-[14px] max-w-[948px] text-[12.5px] leading-[1.5] text-n700">
          Not shown: {loaded.outsidePlan.map((m) => m.name).join(", ")}. Your plan does not include{" "}
          {[...new Set(loaded.outsidePlan.map((m) => m.regionName))].join(" or ")}, so these findings cannot be opened.
        </p>
      ) : null}
      {!loaded ? (
        <NoAccess />
      ) : !loaded.checked || loaded.model.markets.length === 0 ? (
        <NeverChecked workspaceId={workspaceId} productId={productId} hasArtwork={loaded.hasArtwork} />
      ) : (
        <Fix workspaceId={workspaceId} productId={productId} page={loaded} />
      )}
    </Screen>
  );
}

type Loaded = Extract<FixPage, { kind: "loaded" }>;

/**
 * S-FIX-012. RLS returns no product: one outside the person's workspace or market scope and one that never existed read
 * the same, so nothing about it leaks. No "Request access": it has no flow behind it.
 */
function NoAccess() {
  return (
    <section data-fix-state="no-permission" className="border border-rule rounded-control p-[24px] md:p-[40px] flex flex-col gap-[12px] max-w-[640px]">
      <h2 className="m-0 text-[20px] font-semibold">You don’t have access to this label report</h2>
      <p className="m-0 text-[15px] leading-[1.5] text-n700">
        A workspace admin can give you access to this product. A link from another workspace, or one that is wrong, reads the
        same.
      </p>
    </section>
  );
}

function useCanEdit() {
  const { current } = useShell();
  return roleAllows(current.role, "editor");
}

/** Runs app.request_check and opens Check in progress (S-NV2-024); the refusal, if any, is shown where it was asked. */
function useRecheck(workspaceId: string, productId: string) {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<CheckRefusal | null>(null);
  async function run() {
    setBusy(true);
    setRefusal(null);
    const requestId = resolveRequestId(null);
    const result = await Sentry.startSpan({ name: "check.request", op: "rpc", attributes: { request_id: requestId, screen: "S-FIX-001" } }, () =>
      requestCheck(db, productId, requestId),
    );
    if (!result.ok) {
      if (result.refusal.code === "unknown") Sentry.captureMessage("request_check failed", { tags: { request_id: requestId, screen: "S-FIX-001" } });
      setRefusal(result.refusal);
      setBusy(false);
      return;
    }
    router.push(`/w/${workspaceId}/products/${productId}/checks/${result.jobId}`);
  }
  return { run, busy, refusal };
}

function NeverChecked({ workspaceId, productId, hasArtwork }: { workspaceId: string; productId: string; hasArtwork: boolean }) {
  const canEdit = useCanEdit();
  const recheck = useRecheck(workspaceId, productId);
  const upload = `/w/${workspaceId}/products/${productId}/check`;
  return (
    <div data-region="report" data-fix-state="never" className="max-w-[720px]">
      <p data-pinned className="mt-0 mb-[16px] font-mono text-[12px] text-n600">
        Not checked yet
      </p>
      <section className="border border-rule rounded-control p-[24px] md:p-[48px] flex flex-col gap-[14px] items-start">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.08em] text-n600">Not checked yet</p>
        <h2 className="m-0 text-[22px] md:text-[26px] font-semibold">This product has no check yet</h2>
        <p className="m-0 text-[15px] md:text-[16px] leading-[1.5] text-n700">
          {hasArtwork ? "Run a check on its current artwork, or upload a label first." : "Upload a label first, then run a check on it."}
        </p>
        {canEdit ? (
          <div className="flex flex-col md:flex-row gap-[10px] w-full md:w-auto">
            {hasArtwork ? (
              <Button variant="primary" size="md" disabled={recheck.busy} onClick={() => void recheck.run()}>
                Run check
              </Button>
            ) : null}
            <ButtonLink variant={hasArtwork ? "secondary" : "primary"} size="md" href={upload}>
              Upload a label
            </ButtonLink>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-n700">An editor of this product can upload a label and run its check.</p>
        )}
        {recheck.refusal ? <ErrorState where={`CHECK · ${recheck.refusal.code}`} title={recheck.refusal.title} body={recheck.refusal.body} /> : null}
      </section>
    </div>
  );
}

function Fix({ workspaceId, productId, page }: { workspaceId: string; productId: string; page: Loaded }) {
  const markets = page.model.markets;
  const [nodeId, setNodeId] = useState(page.model.initialMarket ?? markets[0].nodeId);
  const market = markets.find((m) => m.nodeId === nodeId) ?? markets[0];
  const firstItem = (m: FixMarket) => m.groups[0]?.items[0]?.id ?? m.notAssessed[0]?.id ?? null;
  const [sel, setSel] = useState<string | null>(firstItem(market));
  const [zoom, setZoom] = useState(1);
  const [labelOpen, setLabelOpen] = useState(false);
  const canEdit = useCanEdit();
  const base = `/w/${workspaceId}/products/${productId}`;
  const banner = bannerFor(market, { workspaceId, productId, activeJob: page.activeJob, currentRuleset: page.currentRuleset });
  const readOnly = market.superseded;
  const pick = (id: string) => {
    setNodeId(id);
    setSel(firstItem(markets.find((m) => m.nodeId === id) ?? market));
  };

  return (
    <div data-region="report" data-node={market.nodeId} data-fix-state={readOnly ? "superseded" : market.state} className="max-w-[1500px]">
      <div className="flex flex-wrap items-center gap-[12px_24px] justify-between">
        <p data-pinned className="m-0 font-mono text-[12px] text-n600">
          {pinLine(market)}
        </p>
        <div role="group" aria-label="Market" data-region="markets" className="hidden md:flex border border-rule rounded-control overflow-hidden">
          {markets.map((m, i) => (
            <button
              key={m.nodeId}
              type="button"
              data-node={m.nodeId}
              aria-pressed={m.nodeId === market.nodeId}
              onClick={() => pick(m.nodeId)}
              className={cx(
                "font-head text-[14px] font-medium py-[8px] px-[14px] min-h-[40px] border-0 cursor-pointer text-ink kit-transition",
                i > 0 && "border-l border-rule",
                m.nodeId === market.nodeId ? "bg-panel" : "bg-paper hover:bg-panel",
              )}
            >
              {m.name} <span className="font-mono text-[12px] text-n600">{m.code}</span>
            </button>
          ))}
        </div>
        <div className="hidden md:flex gap-[8px]">
          <ButtonLink size="md" href={`${base}/report/send`}>
            Download report (PDF)
          </ButtonLink>
          {canEdit && !readOnly ? (
            <ButtonLink variant="primary" size="md" href={`${base}/check`}>
              Upload revision
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {/* At 390 px: the market as a select, and View label opens the artwork full screen with its pins. */}
      <div className="flex md:hidden gap-[8px] mt-[12px]">
        <label className="flex-1 flex flex-col gap-[2px] text-[11px] text-n600">
          Market
          <select
            value={market.nodeId}
            onChange={(e) => pick(e.target.value)}
            className="font-head text-[15px] text-ink min-h-[44px] px-[10px] border border-rule rounded-control bg-paper"
          >
            {markets.map((m) => (
              <option key={m.nodeId} value={m.nodeId}>
                {m.name} · {m.code}
              </option>
            ))}
          </select>
        </label>
        <Button size="md" className="self-end min-h-[44px]" onClick={() => setLabelOpen(true)}>
          View label
        </Button>
      </div>

      {banner ? <Banner banner={banner} canEdit={canEdit} workspaceId={workspaceId} productId={productId} /> : null}

      <div className="mt-[20px] flex flex-wrap gap-[24px] items-start">
        <section aria-label="Label artwork" data-region="artwork" className="hidden md:flex flex-[1_1_680px] min-w-0 flex-col gap-[10px]">
          <div className="flex justify-between items-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-n600">
              Label · {plural(market.panels.length, "language panel", "language panels")}
            </span>
            <div role="group" aria-label="Zoom" className="flex gap-[4px] items-center">
              <button type="button" aria-label="Zoom out" className={ZOOM_BUTTON} disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => clampZoom(z - 0.25))}>
                −
              </button>
              <span className="font-mono text-[12px] w-[52px] text-center" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" aria-label="Zoom in" className={ZOOM_BUTTON} disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => clampZoom(z + 0.25))}>
                +
              </button>
              <button type="button" className={cx(ZOOM_BUTTON, "w-auto px-[12px] text-[13px]")} disabled={zoom === 1} onClick={() => setZoom(1)}>
                Fit
              </button>
            </div>
          </div>
          <div className="border border-rule rounded-control bg-panel p-[24px] overflow-auto max-h-[780px]">
            <div style={{ zoom }}>
              <Panels market={market} sel={sel} onSelect={setSel} />
            </div>
          </div>
          <span className="font-mono text-[11px] text-n600">
            The label as extracted: each panel to scale, its text where it was printed, pins at the findings’ coordinates.
          </span>
        </section>

        <Checklist market={market} sel={sel} onSelect={setSel} readOnly={readOnly} canEdit={canEdit} base={base} />
      </div>

      <LabelView open={labelOpen} onClose={() => setLabelOpen(false)} title={`Label · ${page.product.name}`}>
        <Panels market={market} sel={sel} onSelect={(id) => {
          setSel(id);
          setLabelOpen(false);
        }} compact />
      </LabelView>
    </div>
  );
}

function clampZoom(z: number) {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

function Banner({ banner, canEdit, workspaceId, productId }: { banner: FixBanner; canEdit: boolean; workspaceId: string; productId: string }) {
  const recheck = useRecheck(workspaceId, productId);
  return (
    <div
      role="status"
      data-banner={banner.kind}
      className="mt-[16px] py-[12px] px-[16px] border border-rule rounded-control bg-panel flex flex-wrap gap-[8px_16px] items-center justify-between"
    >
      <span className="text-[14px]">
        <strong className="font-semibold">{banner.title}</strong> {banner.text}
      </span>
      {banner.kind === "older" ? (
        canEdit ? (
          <Button variant="primary" size="md" disabled={recheck.busy} onClick={() => void recheck.run()}>
            Re-check against {banner.current}
          </Button>
        ) : (
          <span className="text-[13px] text-n700">An editor can re-check it against the current ruleset.</span>
        )
      ) : (
        <a href={banner.href} className="text-[14px] font-semibold">
          {banner.kind === "rechecking" ? "View check in progress" : "Open it"}
        </a>
      )}
      {recheck.refusal ? (
        <div className="basis-full">
          <ErrorState where={`CHECK · ${recheck.refusal.code}`} title={recheck.refusal.title} body={recheck.refusal.body} />
        </div>
      ) : null}
    </div>
  );
}

// ─── The label ────────────────────────────────────────────────────────────────────────────────────
function Panels({ market, sel, onSelect, compact = false }: { market: FixMarket; sel: string | null; onSelect: (id: string) => void; compact?: boolean }) {
  if (market.panels.length === 0) {
    return <p className="m-0 font-mono text-[11px] text-n600">No panel was recorded for this market’s check.</p>;
  }
  return (
    <div className={cx("grid gap-[12px] bg-paper border border-rule rounded-control p-[14px]", compact ? "grid-cols-2" : "grid-cols-2 w-[640px]")}>
      {market.panels.map((p) => (
        <PanelView key={p.id} p={p} sel={sel} onSelect={onSelect} compact={compact} />
      ))}
    </div>
  );
}

function PanelView({ p, sel, onSelect, compact }: { p: FixPanel; sel: string | null; onSelect: (id: string) => void; compact: boolean }) {
  const outlined = p.missing;
  return (
    <div
      data-panel={p.id}
      data-check-id={p.checkId}
      data-judged={p.judged}
      className={cx(
        "relative rounded-control p-[10px_12px_14px] flex flex-col gap-[7px] min-h-[300px]",
        outlined ? "border-2 border-dashed border-action" : !p.readable ? "border border-dashed border-n600 bg-panel" : "border border-rule bg-paper",
      )}
    >
      <div className="flex justify-between items-center gap-[6px]">
        <span className="font-mono text-[11px] font-medium">{p.label}</span>
        {p.chip ? (
          <span data-panel-state={p.chip.state} className={cx("inline-flex items-center gap-[4px] py-[1px] px-[7px] rounded-control text-[11px] font-semibold whitespace-nowrap", STATE_TINT[p.chip.state], STATE_TEXT[p.chip.state])}>
            <StateGlyph state={p.chip.state} size="sm" />
            {p.chip.label}
          </span>
        ) : (
          <span className="text-[11px] text-n600 whitespace-nowrap">{p.notLine}</span>
        )}
      </div>
      {!p.readable ? (
        <div className="flex-1 flex flex-col gap-[10px] items-start justify-center p-[12px]">
          <span className="text-[14px] font-semibold">Couldn’t read this panel</span>
          <span className="text-[12px] text-n700 leading-[1.4]">{p.failureNote}</span>
        </div>
      ) : (
        <div
          className="relative mx-auto bg-paper"
          style={{
            aspectRatio: `${p.widthMm} / ${p.heightMm}`,
            width: `min(100%, ${Math.round(((compact ? PANEL_PX * 0.6 : PANEL_PX) * p.widthMm) / p.heightMm)}px)`,
            containerType: "inline-size",
          }}
        >
          {p.objects.map((o) => (
            <p
              key={o.id}
              data-text-object={o.id}
              lang={p.lang ?? undefined}
              className="absolute m-0 overflow-hidden leading-[1.15] text-n800"
              style={{
                left: pct(o.box.x, p.widthMm),
                top: pct(o.box.y, p.heightMm),
                width: pct(o.box.w, p.widthMm),
                height: pct(o.box.h, p.heightMm),
                fontSize: `max(5px, ${((Math.min(o.box.h * 0.6, 2.6) * 100) / p.widthMm).toFixed(2)}cqw)`,
              }}
            >
              {o.text}
            </p>
          ))}
          {p.pins.map((pin) => {
            const pressed = sel === pin.itemId;
            return (
              <span key={pin.itemId}>
                <span
                  aria-hidden="true"
                  className={cx("absolute rounded-control pointer-events-none", pressed ? "outline outline-2 outline-accent" : "")}
                  style={{ left: pct(pin.box.x, p.widthMm), top: pct(pin.box.y, p.heightMm), width: pct(pin.box.w, p.widthMm), height: pct(pin.box.h, p.heightMm) }}
                />
                <button
                  type="button"
                  data-pin={pin.pin}
                  data-pin-kind={pin.kind}
                  aria-label={pin.label}
                  aria-pressed={pressed}
                  onClick={() => onSelect(pin.itemId)}
                  className={cx(
                    "absolute w-[24px] h-[24px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-0 text-paper font-mono text-[12px] font-semibold cursor-pointer",
                    pin.kind === "fix" ? "bg-action" : "bg-na",
                    pressed && "ring-2 ring-paper outline outline-2 outline-offset-2 outline-accent",
                  )}
                  style={{ left: pct(pin.box.x, p.widthMm), top: pct(pin.box.y, p.heightMm) }}
                >
                  {pin.pin}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <span className="font-mono text-[9.5px] text-n600">{p.caption}</span>
    </div>
  );
}

function pct(v: number, of: number) {
  return `${(100 * v) / of}%`;
}

/** The artwork full screen at 390 px (S-FIX-002 "View label"): a native modal dialog, Escape and × close it. */
function LabelView({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="kit-dialog m-0 p-0 w-screen h-screen max-w-none max-h-none bg-ink text-paper"
    >
      <div className="flex justify-between items-center py-[6px] pr-[8px] pl-[16px]">
        <span className="text-[15px] font-semibold">{title}</span>
        <button type="button" aria-label="Close label view" onClick={onClose} className="w-[44px] h-[44px] border-0 bg-transparent text-paper text-[20px] cursor-pointer">
          ×
        </button>
      </div>
      <div className="p-[16px] overflow-auto">{open ? children : null}</div>
      <p className="m-0 pt-[12px] px-[16px] pb-[20px] text-center text-[13px]">Pinch to zoom · tap a pin to see its finding</p>
    </dialog>
  );
}

// ─── The checklist ────────────────────────────────────────────────────────────────────────────────
function Checklist({
  market,
  sel,
  onSelect,
  readOnly,
  canEdit,
  base,
}: {
  market: FixMarket;
  sel: string | null;
  onSelect: (id: string) => void;
  readOnly: boolean;
  canEdit: boolean;
  base: string;
}) {
  const na = market.heading.tone === "not_assessed";
  return (
    <section aria-labelledby="todo-h" data-region="findings" data-node={market.nodeId} className="flex-[1_1_520px] max-w-[600px] min-w-0 flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <h2 id="todo-h" data-heading-tone={market.heading.tone} className={cx("m-0 text-[20px] md:text-[22px] font-semibold tracking-[-0.01em] flex items-center gap-[8px]", na ? "text-n600" : "text-ink")}>
          {na ? <StateGlyph state="not_assessed" /> : null}
          {market.heading.text}
        </h2>
        <span className="text-[14px] text-n700">{market.heading.sub}</span>
      </div>

      {market.groups.map((g) => (
        <div key={g.checkId} data-result-set data-check-id={g.checkId} className="flex flex-col gap-[10px]">
          <div className="flex justify-between items-center border-b border-rule pb-[6px]">
            <h3 className="m-0 text-[15px] font-semibold">{g.title}</h3>
            <span className="inline-flex items-center gap-[5px] py-[2px] px-[8px] rounded-control bg-action-bg text-action text-[12px] font-semibold">
              <StateGlyph state="action" size="sm" />
              Action needed · {g.open} open
            </span>
          </div>
          {g.items.map((f) => (
            <FixCard key={f.id} f={f} sel={sel} onSelect={onSelect} readOnly={readOnly} canEdit={canEdit} base={base} />
          ))}
        </div>
      ))}

      {market.notAssessed.length ? (
        <div className="flex flex-col gap-[10px]">
          <div className="flex justify-between items-center border-b border-rule pb-[6px]">
            <h3 className="m-0 text-[15px] font-semibold">Not assessed</h3>
            <span className="inline-flex items-center gap-[5px] py-[2px] px-[8px] rounded-control bg-na-bg text-n700 text-[12px] font-semibold">
              <StateGlyph state="not_assessed" size="sm" />
              {market.notAssessed.length}
            </span>
          </div>
          {market.notAssessed.map((f) => (
            <NotAssessedCard key={f.id} f={f} sel={sel} onSelect={onSelect} />
          ))}
        </div>
      ) : null}

      {market.notes.length ? (
        <ul className="m-0 p-0 list-none">
          {market.notes.map((n) => (
            <li key={n.id} className="py-[6px] text-[12.5px] text-n700 flex gap-[10px] flex-wrap">
              <span>{n.title}</span>
              <ProvenanceTag provenance={n.provenance} className="text-[10px]" />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ItemHead({ f }: { f: FixItem }) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap">
      {f.pin ? (
        <span aria-hidden="true" className={cx("w-[24px] h-[24px] rounded-[50%] text-paper font-mono text-[12px] font-semibold inline-flex items-center justify-center", f.kind === "fix" ? "bg-action" : "bg-na")}>
          {f.pin}
        </span>
      ) : null}
      {f.missing ? (
        <span data-missing className="font-mono text-[11px] py-[2px] px-[7px] border border-dashed border-action rounded-control text-action">
          Missing from this panel · not on the artwork
        </span>
      ) : null}
      <span className="text-[12px] text-n700">{f.panelLabel}</span>
    </div>
  );
}

function Printed({ f }: { f: FixItem }) {
  if (!f.printed) return null;
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-n600">Printed on the label · {f.langName ?? "undetermined language"}</span>
      <q lang={f.lang ?? undefined} className="text-[14px] bg-panel rounded-control py-[6px] px-[10px] [quotes:none]">
        {f.printed}
      </q>
    </div>
  );
}

function Provenance({ f }: { f: FixItem }) {
  return (
    <div className="flex flex-wrap gap-[6px_12px] items-center font-mono text-[12px] text-n600">
      {f.ruleKey ? <span data-rule-key={f.ruleKey}>{f.ruleKey}</span> : null}
      {f.citation && f.citation !== f.ruleKey ? <span data-citation>{f.citation}</span> : null}
      <ProvenanceTag provenance={f.provenance} className="py-[1px] px-[6px] border border-rule rounded-control text-ink text-[11px]" />
      {f.modelDetail ? <span data-model-detail>{f.modelDetail}</span> : null}
      {f.measure ? <span>{f.measure}</span> : null}
    </div>
  );
}

function FixCard({
  f,
  sel,
  onSelect,
  readOnly,
  canEdit,
  base,
}: {
  f: FixItem;
  sel: string | null;
  onSelect: (id: string) => void;
  readOnly: boolean;
  canEdit: boolean;
  base: string;
}) {
  const pressed = sel === f.id;
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    if (!f.term) return;
    try {
      await navigator.clipboard.writeText(f.term.text);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }
  const actions = !readOnly && canEdit;
  return (
    <article
      aria-labelledby={`h-${f.id}`}
      data-finding-state="action"
      data-finding-id={f.id}
      data-check-id={f.checkId}
      className={cx("border rounded-control p-[14px_16px] flex flex-col gap-[8px] bg-paper", pressed ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-rule")}
    >
      <ItemHead f={f} />
      <h4 id={`h-${f.id}`} className="m-0">
        <button
          type="button"
          aria-pressed={pressed}
          onClick={() => onSelect(f.id)}
          className="font-head text-[15px] font-semibold leading-[1.35] text-left border-0 bg-transparent p-0 text-ink cursor-pointer"
        >
          {f.title}
        </button>
      </h4>
      <Printed f={f} />
      {f.action ? <p className="m-0 text-[13px] text-n700 leading-[1.45]">{f.action}</p> : null}
      <Provenance f={f} />
      {f.term ? (
        <p data-term className="m-0 text-[14px]">
          <span lang={f.term.lang} className="font-mono font-medium py-[2px] px-[6px] bg-accent-100 rounded-control">
            {f.term.text}
          </span>{" "}
          <span className="text-[12px] text-n700">{f.term.langName} · accepted term register</span>
        </p>
      ) : (
        <p data-no-term className="m-0 text-[13px] text-n700">
          No accepted wording · see the rule and citation
        </p>
      )}
      {actions ? (
        <div className="flex flex-wrap gap-[8px_10px] items-center pt-[4px] min-h-[44px]">
          {f.term ? (
            <>
              <Button variant="primary" size="md" onClick={() => void copy()}>
                Copy required term
              </Button>
              <ButtonLink size="md" href={`${base}/check`}>
                Upload revision
              </ButtonLink>
            </>
          ) : (
            <ButtonLink variant="primary" size="md" href={`${base}/check`}>
              Upload revision
            </ButtonLink>
          )}
          <span aria-live="polite" className="text-[12px] text-n700">
            {copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy: select the term and copy it" : ""}
          </span>
        </div>
      ) : null}
    </article>
  );
}

function NotAssessedCard({ f, sel, onSelect }: { f: FixItem; sel: string | null; onSelect: (id: string) => void }) {
  const pressed = sel === f.id;
  return (
    <article
      data-finding-state="not_assessed"
      data-finding-id={f.id}
      data-check-id={f.checkId}
      className={cx("border rounded-control p-[12px_16px] flex flex-col gap-[6px] bg-paper", pressed ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-rule")}
    >
      <ItemHead f={f} />
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onSelect(f.id)}
        className="font-head text-[14px] font-semibold text-left border-0 bg-transparent p-0 text-ink cursor-pointer"
      >
        {f.title}
      </button>
      <Printed f={f} />
      <p className="m-0 text-[13px] text-n700 leading-[1.45]">{f.action}</p>
      <div className="flex flex-wrap gap-[6px_12px] items-center text-[12px]">
        {f.gapId && f.gapHref ? (
          <GapLink gapId={f.gapId} href={f.gapHref} />
        ) : (
          <span data-no-gap className="font-mono text-n700">
            No coverage gap recorded · {(f.reasonCode ?? "withheld").replace(/_/g, " ")}
          </span>
        )}
      </div>
      <Provenance f={f} />
    </article>
  );
}

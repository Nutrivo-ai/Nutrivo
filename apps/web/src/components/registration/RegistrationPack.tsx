import { Blueprint, EmptyState, STATE_LABEL, STATE_TEXT, StateBadge, cx } from "@/components/kit";
import { typeLabel } from "@/lib/documents/library";
import { REGISTRATION_NOTE, REGISTRATION_STATES, checklist, displayBadge, registrationWords, type RegistrationState } from "@/lib/registration/model";
import type { RegistrationPage } from "@/lib/registration/queries";
import { ObligationFacts } from "./Obligations";
import { RecordRegistration } from "./RecordRegistration";

// S-NV2-020 Registration pack (design: product/Nutrivo 2.0.dc.html, screen "reg"). G02 and G03 (T-504): the market's
// verdict (app.product_nodes.display_state, never label_state) and its registration state in words, the obligation
// named when a sourced one is held, a read-only evidence checklist, and the latest recorded registration with the G03
// form for an editor. Left out, never drawn dead: the design's "Status you maintain" radios and Deadline (no backing
// data, #54 Q5) and the Compliance Worker panel with PREPARE PACK and DOWNLOAD FORM SET (G02.must.1: nothing here
// submits, files or pays).

const EDGE: Record<string, string> = {
  clear: "border-t-[3px] border-t-clear",
  action: "border-t-[3px] border-t-action",
  not_assessed: "border-t-[3px] border-t-na",
  blocked: "border-t-[3px] border-t-blocked",
};

const KICKER = "m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600";

export function RegistrationPack({
  page,
  workspaceId,
  canEdit,
  gap,
}: {
  page: Extract<RegistrationPage, { kind: "loaded" }>;
  workspaceId: string;
  canEdit: boolean;
  gap: { gapId: string; href: string } | null;
}) {
  const badge = displayBadge(page.displayState);
  const state: RegistrationState = (REGISTRATION_STATES as readonly string[]).includes(page.registrationState)
    ? (page.registrationState as RegistrationState)
    : "unknown";
  const list = checklist(page.obligation);
  return (
    <div className="grid gap-[22px] items-start md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]" data-registration-pack>
      <div className="min-w-0">
        <Blueprint edge={EDGE[badge]} className="py-[18px] px-[20px]">
          <div data-region="header" className="flex flex-wrap items-baseline gap-[10px]">
            <p className={cx("m-0 font-mono text-[10px] tracking-[0.13em] uppercase", STATE_TEXT[badge])}>
              {STATE_LABEL[badge]} · registration
            </p>
            <span className="flex-1" />
            <span className="font-mono text-[10px] uppercase text-n600">{page.market.name}</span>
          </div>
          <p className="mt-[8px] mb-0 text-[22px] font-semibold leading-[1.2]">{page.product.name}</p>
          <div className="mt-[10px] flex flex-wrap items-center gap-x-[18px] gap-y-[6px]">
            <span data-testid="display-state" className="inline-flex items-center gap-[8px] text-[12.5px] text-n700">
              Market state <StateBadge state={badge} size="md" />
            </span>
            <span data-testid="registration-state" data-registration-state={state} className="text-[12.5px] text-n700">
              Registration: <span className="font-semibold text-ink">{registrationWords(state)}</span>
            </span>
          </div>
          <p className="mt-[8px] mb-0 text-[13.5px] leading-[1.55] text-n700 max-w-[66ch]">
            {REGISTRATION_NOTE[state]} Registration is its own state on this market, separate from the label, and an
            unknown registration never renders clear.
          </p>
        </Blueprint>

        <section aria-labelledby="obligation-named" className="mt-[22px]">
          <div className="flex items-baseline gap-[12px] border-b border-ink pb-[6px]">
            <h2 id="obligation-named" className="m-0 text-[17px] font-semibold">
              The obligation, named
            </h2>
          </div>
          {page.obligation ? (
            <div className="mt-[12px]">
              <ObligationFacts obligation={page.obligation} />
            </div>
          ) : (
            <div className="mt-[12px] max-w-[640px]">
              <EmptyState
                where={`OBLIGATION · ${page.market.nodeId}`}
                title="No sourced obligation held for this market."
                body="Registration not assessed. Nothing is named until an obligation is researched from an official source, dated and accepted by a person."
                reference={gap ? { href: gap.href, label: `GAP ${gap.gapId} · why is this not assessed` } : undefined}
              />
            </div>
          )}
        </section>

        <section aria-labelledby="evidence-pack" className="mt-[26px]" data-checklist={list.kind}>
          <div className="flex flex-wrap items-baseline gap-[12px] border-b border-ink pb-[6px]">
            <h2 id="evidence-pack" className="m-0 text-[17px] font-semibold">
              Evidence pack
            </h2>
            <span className="font-mono text-[10.5px] text-n600">read only · you assemble and submit it</span>
          </div>
          {list.kind === "not_assessed" ? (
            <div className="mt-[12px] max-w-[640px]">
              <EmptyState
                where="EVIDENCE · NOT ASSESSED"
                title="No sourced evidence list held. Checklist not assessed."
                body="The checklist is drawn from a sourced obligation's evidence list against this workspace's documents. None is held for this market, so nothing is listed as present or missing."
              />
            </div>
          ) : (
            <ul aria-label="Evidence" className="m-0 p-0 list-none">
              {list.items.map((item, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-[10px] items-baseline border-b border-rule py-[11px]">
                  <span className="text-[13.5px]">{item}</span>
                  <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-na">Not matched</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-[18px] min-w-0">
        <section aria-labelledby="recorded-registration" className="border border-ink py-[16px] px-[18px]" data-recorded={page.latest ? "yes" : "none"}>
          <h2 id="recorded-registration" className={KICKER}>
            Registration you hold
          </h2>
          {page.latest ? (
            <dl className="mt-[10px] mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[12px] gap-y-[6px] text-[13px]">
              <dt className="text-n600">Number</dt>
              <dd className="m-0 font-mono text-[12px] break-words" data-testid="recorded-number">{page.latest.number ?? "not held"}</dd>
              <dt className="text-n600">Registered on</dt>
              <dd className="m-0 font-mono text-[12px]">{page.latest.registeredOn ?? "not held"}</dd>
              <dt className="text-n600">Expires</dt>
              <dd className="m-0 font-mono text-[12px]">{page.latest.expiresAt ?? "no expiry date"}</dd>
              <dt className="text-n600">Evidence</dt>
              <dd className="m-0 text-[12.5px]">{page.latest.evidenceDocType ? typeLabel(page.latest.evidenceDocType) : "none cited"}</dd>
            </dl>
          ) : (
            <p className="mt-[10px] mb-0 text-[13px] leading-[1.5] text-n700">No registration is recorded for this product in this market.</p>
          )}
          {canEdit ? (
            <RecordRegistration workspaceId={workspaceId} productId={page.product.id} nodeId={page.market.nodeId} documents={page.documents} hasLatest={!!page.latest} />
          ) : (
            <p className="mt-[12px] mb-0 text-[12px] leading-[1.5] text-n600" data-testid="record-no-permission">
              An editor with this market in scope, or an admin, can record a registration. Your role reads it.
            </p>
          )}
          <p className="mt-[12px] mb-0 text-[12px] leading-[1.5] text-n600">
            We record what you tell us and date it. We do not confirm that a registration is valid.
          </p>
        </section>

        <div className="border border-rule py-[16px] px-[18px] bg-panel">
          <p className={KICKER}>What we never do</p>
          <ul className="mt-[10px] mb-0 pl-[16px] text-[12.5px] leading-[1.65] text-n700">
            <li>Represent the applicant</li>
            <li>Submit, pay or correspond</li>
            <li>Confirm a registration is valid</li>
            <li>Guarantee acceptance</li>
          </ul>
          <p className="mt-[10px] mb-0 text-[12px] leading-[1.5] text-n600">Only the responsible operator named on the label can register.</p>
        </div>
      </div>
    </div>
  );
}

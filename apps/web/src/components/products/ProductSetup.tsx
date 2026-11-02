"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, cx } from "@/components/kit";
import { addMarkets, setStage, type MarketsFormState, type StageFormState } from "@/lib/products/actions";
import { STAGE_CARDS, STAGES, marketGroups, marketLine, type JurisdictionNode, type Stage } from "@/lib/products/rules";
import { RefusalCard } from "./AddProduct";

const LABEL = "block mb-[6px] font-mono text-[10px] tracking-[0.13em] uppercase text-n600";
const INPUT =
  "w-full box-border py-[8px] px-[10px] border border-n400 bg-paper text-[13px] text-ink font-head " +
  "focus:outline-2 focus:outline-accent focus:outline-offset-2";

/**
 * On Upload & scope (S-NV2-002): the product's stage (C04) and its markets (C01 step 3). The stage is reversible and
 * audited; a discontinue may carry its reason. Markets are added, never removed here, and adding one never uses a
 * free label (B02.must.1).
 */
export function ProductSetup({
  workspaceId,
  productId,
  stage,
  nodes,
  available,
  regions,
  canEdit,
}: {
  workspaceId: string;
  productId: string;
  stage: Stage;
  nodes: string[];
  available: JurisdictionNode[];
  regions: string[];
  canEdit: boolean;
}) {
  return (
    <section aria-labelledby="product-setup" className="flex flex-col gap-[14px]" data-product-setup>
      <h2 id="product-setup" className="m-0 font-mono text-[10px] font-normal tracking-[0.13em] uppercase text-n600">
        2 · Where it is sold, and its stage
      </h2>
      <Markets workspaceId={workspaceId} productId={productId} nodes={nodes} available={available} regions={regions} canEdit={canEdit} />
      <StageControl workspaceId={workspaceId} productId={productId} stage={stage} canEdit={canEdit} />
    </section>
  );
}

function StageControl({ workspaceId, productId, stage, canEdit }: { workspaceId: string; productId: string; stage: Stage; canEdit: boolean }) {
  const [state, action, pending] = useActionState<StageFormState, FormData>(setStage, { status: "idle" });
  const [next, setNext] = useState<Stage>(stage);
  const changed = next !== stage;
  return (
    <form action={action} className="border border-rule py-[12px] px-[14px]" data-stage-control>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Lifecycle stage</p>
      <p className="mt-[6px] mb-0 text-[13px] text-ink" data-current-stage={stage}>
        <span className="font-semibold">{STAGE_CARDS[stage].label}</span>
        <span className="text-n700"> · {STAGE_CARDS[stage].body}</span>
      </p>
      {canEdit ? (
        <>
          <label htmlFor="stage-next" className={cx(LABEL, "mt-[12px]")}>Change to</label>
          <select id="stage-next" name="stage" className={INPUT} value={next} onChange={(e) => setNext(e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_CARDS[s].label}</option>
            ))}
          </select>
          {next === "discontinued" && changed ? (
            <>
              <label htmlFor="stage-reason" className={cx(LABEL, "mt-[10px]")}>Reason recorded (optional)</label>
              <input id="stage-reason" name="reason" maxLength={500} className={INPUT} placeholder="Pack size withdrawn from retail" />
              <p className="mt-[6px] mb-0 text-[12px] leading-[1.5] text-n600">
                It leaves the board, counts, freshness and monitoring. Its reports and certificates stay resolvable, and it
                can be made active again.
              </p>
            </>
          ) : null}
          <Button type="submit" className="mt-[10px]" disabled={!changed || pending}>
            {pending ? "Saving…" : "Change stage"}
          </Button>
        </>
      ) : (
        <p className="mt-[8px] mb-0 text-[12px] text-n600">An editor or a role above it can change the stage.</p>
      )}
      {state.status === "done" ? (
        <p role="status" className="mt-[8px] mb-0 text-[12.5px] text-n700">Stage changed to {STAGE_CARDS[state.stage as Stage]?.label ?? state.stage}; recorded in the audit log.</p>
      ) : null}
      {state.status === "refused" ? <RefusalCard refusal={state.refusal} /> : null}
    </form>
  );
}

function Markets({
  workspaceId,
  productId,
  nodes,
  available,
  regions,
  canEdit,
}: {
  workspaceId: string;
  productId: string;
  nodes: string[];
  available: JurisdictionNode[];
  regions: string[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<MarketsFormState, FormData>(addMarkets, { status: "idle" });
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () => marketGroups(available, regions).map((g) => ({ ...g, nodes: g.nodes.filter((n) => !nodes.includes(n.id)) })).filter((g) => g.nodes.length),
    [available, regions, nodes],
  );
  return (
    <form action={action} className="border border-rule py-[12px] px-[14px]" data-markets>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Jurisdiction nodes</p>
      <p className="mt-[6px] mb-0 text-[13px] text-ink" data-market-line>
        {nodes.length ? marketLine(nodes) : "No market yet: the check needs at least one."}
      </p>
      {canEdit && groups.length > 0 ? (
        open ? (
          <div className="mt-[10px] flex flex-col gap-[8px]">
            {groups.map((g) => (
              <div key={g.region} className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
                <span className="font-mono text-[10.5px] text-n600 w-[28px]">{g.region}</span>
                {g.nodes.map((n) => (
                  <label key={n.id} className="inline-flex items-center gap-[5px] text-[13px] cursor-pointer" title={n.name}>
                    <input type="checkbox" name="nodes" value={n.id} />
                    {n.id.slice(g.region.length + 1)}
                  </label>
                ))}
              </div>
            ))}
            <div className="flex items-center gap-[10px]">
              <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add markets"}</Button>
              <span className="text-[12px] text-n600">Adding a market never uses a free label.</span>
            </div>
          </div>
        ) : (
          <Button className="mt-[10px]" onClick={() => setOpen(true)}>Add markets</Button>
        )
      ) : null}
      {state.status === "done" && state.added > 0 ? (
        <p role="status" className="mt-[8px] mb-0 text-[12.5px] text-n700">
          {state.added} {state.added === 1 ? "market" : "markets"} added, each Not assessed until it is checked.
        </p>
      ) : null}
      {state.status === "refused" ? <RefusalCard refusal={state.refusal} /> : null}
    </form>
  );
}

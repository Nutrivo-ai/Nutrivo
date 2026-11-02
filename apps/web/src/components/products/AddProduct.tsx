"use client";

import { useActionState, useMemo, useState } from "react";
import { Blueprint, Button, ErrorState, cx } from "@/components/kit";
import { createProduct, type ProductFormState } from "@/lib/products/actions";
import type { AddProductData, Family } from "@/lib/products/queries";
import {
  CREATE_STAGES,
  STAGE_CARDS,
  STAGES,
  marketGroups,
  type Refusal,
  type Stage,
} from "@/lib/products/rules";
import { StartFromLabel } from "./StartFromLabel";

const IDLE: ProductFormState = { status: "idle" };

const LABEL = "block mb-[6px] font-mono text-[10px] tracking-[0.13em] uppercase text-n600";
const INPUT =
  "w-full box-border py-[11px] px-[11px] border border-n400 rounded-none bg-paper text-[14px] text-ink font-head " +
  "focus:outline-2 focus:outline-accent focus:outline-offset-2";
const HELP = "mt-[6px] mb-0 text-[12px] leading-[1.5] text-n600";

const STAGE_TEXT: Record<Stage, string> = {
  brief: "BRIEF",
  in_development: "IN DEVELOPMENT",
  active: "ACTIVE",
  discontinued: "DISCONTINUED",
};

/**
 * S-NV2-022 Add a product (C01, C03). The product exists before it is checked: this creates it, its family unless one
 * is picked, its markets and its stage through app.create_product. `?family=<id>` opens it as a variant of that
 * family (C03): a pack size or recipe variant, never a new billable family.
 */
export function AddProduct({
  workspaceId,
  data,
  initialFamily,
}: {
  workspaceId: string;
  data: AddProductData;
  initialFamily: string | null;
}) {
  const [state, action, pending] = useActionState(createProduct, IDLE);
  const known = initialFamily && data.families.some((f) => f.id === initialFamily) ? initialFamily : null;
  const [family, setFamily] = useState<string>(known ?? "new");
  const [familyName, setFamilyName] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>("in_development");
  const [nodes, setNodes] = useState<string[]>([]);
  const groups = useMemo(() => marketGroups(data.nodes, data.regions), [data.nodes, data.regions]);
  const picked: Family | null = data.families.find((f) => f.id === family) ?? null;
  const toggle = (id: string) => setNodes((n) => (n.includes(id) ? n.filter((x) => x !== id) : [...n, id]));
  const languages = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    return nodes.filter((id) => byId.has(id)).length;
  }, [nodes, data.nodes]);

  return (
    <div className="grid gap-[22px] items-start md:grid-cols-[minmax(0,606px)_320px]">
      <form action={action} className="min-w-0" data-add-product aria-describedby="add-product-intro">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <p id="add-product-intro" className="m-0 mb-[18px] text-[13.5px] leading-[1.6] text-n800 max-w-[606px]">
          A product exists before it is checked. Adding one creates the object, its family and its lifecycle stage; a
          check is an event recorded against it afterwards, and never what brings it into being.
        </p>

        <div className="grid gap-x-[22px] gap-y-[18px] md:grid-cols-2">
          <div>
            <label htmlFor="product-name" className={LABEL}>Product name</label>
            <input
              id="product-name"
              name="name"
              required
              maxLength={200}
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Salmon & Rice Adult 12 kg"
            />
            <p className={HELP}>As it will appear on the label.</p>
          </div>
          <div>
            <label htmlFor="product-family" className={LABEL}>Family</label>
            <select id="product-family" name="family" className={INPUT} value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="new">A new family</option>
              {data.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.products.length} linked {f.products.length === 1 ? "product" : "products"}
                </option>
              ))}
            </select>
            <p className={HELP}>Pack sizes and recipe variants are separate products, linked here.</p>
          </div>
          {family === "new" ? (
            <div className="md:col-span-2">
              <label htmlFor="family-name" className={LABEL}>New family name</label>
              <input
                id="family-name"
                name="familyName"
                maxLength={200}
                className={INPUT}
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder={name.trim() || "The recipe, without its pack size"}
              />
              <p className={HELP}>A family is one recipe, the unit your plan counts. Left empty, it takes the product&apos;s name.</p>
            </div>
          ) : null}
          <fieldset className="md:col-span-2 m-0 p-0 border-0 min-w-0">
            <legend className={LABEL}>Species and category</legend>
            <div className="grid gap-[10px] md:grid-cols-3">
              <select name="species" aria-label="Species" className={INPUT} defaultValue="dog">
                <option value="dog">Dog</option>
                <option value="cat">Cat</option>
                <option value="other">Other</option>
              </select>
              <input name="lifeStage" aria-label="Life stage" maxLength={100} className={INPUT} placeholder="adult maintenance" />
              <input name="format" aria-label="Format" maxLength={100} className={INPUT} placeholder="complete feed · dry" />
            </div>
            <p className={HELP}>Sets which rulebook applies before any check runs.</p>
          </fieldset>
        </div>

        <fieldset className="mt-[18px] m-0 p-0 border-0 min-w-0">
          <legend className={LABEL}>Jurisdiction nodes</legend>
          <div className="border border-n400 py-[10px] px-[11px] flex flex-col gap-[10px]">
            {groups.length === 0 ? (
              <p className="m-0 text-[13px] text-n700">This workspace has no regions to sell in yet.</p>
            ) : (
              groups.map((g) => (
                <div key={g.region} className="flex flex-wrap items-center gap-x-[14px] gap-y-[6px]">
                  <span className="font-mono text-[10.5px] tracking-[0.08em] text-n600 w-[28px]">{g.region}</span>
                  {g.nodes.map((n) => (
                    <label key={n.id} className="inline-flex items-center gap-[5px] text-[13px] cursor-pointer" title={n.name}>
                      <input type="checkbox" name="nodes" value={n.id} checked={nodes.includes(n.id)} onChange={() => toggle(n.id)} />
                      {n.id.slice(g.region.length + 1)}
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>
          <p className={HELP}>
            {nodes.length === 0
              ? "Pick the markets it will be sold in. You can add more later; adding markets never uses a free label."
              : `${languages} ${languages === 1 ? "node" : "nodes"} picked. Each starts Not assessed until it is checked.`}
          </p>
        </fieldset>

        <fieldset className="mt-[18px] m-0 p-0 border-0 min-w-0">
          <legend className={LABEL}>Responsible operator</legend>
          <div className="grid gap-[10px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <input name="operatorName" aria-label="Operator name as printed" maxLength={300} className={INPUT} placeholder={data.defaultOperator?.name ?? "Name as printed"} />
            <input name="operatorAddress" aria-label="Operator address as printed" maxLength={500} className={INPUT} placeholder={data.defaultOperator?.address ?? "Address as printed, ending with the country"} />
          </div>
          <p className={HELP}>
            Only this operator can register the product.
            {data.defaultOperator ? ` Left empty, it is the workspace's: ${data.defaultOperator.name}.` : " Left empty, it is the workspace's once one is set."}
          </p>
        </fieldset>

        <div className="mt-[22px] border-b border-ink pb-[6px]">
          <h2 className="m-0 font-head text-[17px] font-semibold">Lifecycle stage</h2>
        </div>
        <div role="radiogroup" aria-label="Lifecycle stage" className="mt-[12px] grid gap-[10px] md:grid-cols-2">
          {STAGES.map((s) => {
            const allowed = CREATE_STAGES.includes(s);
            const on = stage === s;
            return (
              <label
                key={s}
                className={cx(
                  "block py-[14px] px-[15px] border border-t-[3px]",
                  on ? "border-accent bg-accent-100" : "border-rule border-t-rule",
                  allowed ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                )}
              >
                <input type="radio" name="stage" value={s} checked={on} disabled={!allowed} onChange={() => setStage(s)} className="sr-only" />
                <span className={cx("block font-mono text-[10px] tracking-[0.13em]", on ? "text-accent-700" : "text-n600")}>{STAGE_TEXT[s]}</span>
                <span className="block mt-[8px] text-[13px] leading-[1.5] text-n800">{STAGE_CARDS[s].body}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-[14px] mb-0 text-[12.5px] leading-[1.6] text-n700">
          A brief added on path B is this same object at an earlier stage, keeping its id and its history when it becomes
          active. Nothing is ever deleted: a product leaves the board by becoming discontinued.
        </p>

        {state.status === "problem" ? (
          <p role="alert" className="mt-[16px] mb-0 text-[13px] text-blocked">{state.problem}</p>
        ) : null}
        {state.status === "refused" ? <RefusalCard refusal={state.refusal} /> : null}

        <div className="mt-[22px] flex flex-wrap items-center gap-[10px]">
          <Button type="submit" variant="primary" size="md" name="next" value="created" disabled={pending} className="font-mono uppercase tracking-[0.08em] text-[11.5px]">
            {pending ? "Creating…" : "Create product"}
          </Button>
          <Button type="submit" size="md" name="next" value="check" disabled={pending} className="font-mono uppercase tracking-[0.08em] text-[11.5px]">
            Create and run a check
          </Button>
          <span className="text-[12.5px] leading-[1.5] text-n700 max-w-[300px]">
            Re-checks are unlimited, so running one now costs nothing later.
          </span>
        </div>
      </form>

      <aside className="flex flex-col gap-[18px] min-w-0">
        <FamilyPanel family={picked} draftName={name} newFamilyName={familyName} workspaceId={workspaceId} />
        <div className="bg-panel border border-rule py-[16px] px-[18px]">
          <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Also accepted later</p>
          <ul className="mt-[10px] mb-0 pl-[16px] text-[12.5px] leading-[1.65] text-n700">
            <li>Artwork versions, per language</li>
            <li>Supplier specifications</li>
            <li>Analytical constants</li>
            <li>Registration status per node</li>
          </ul>
        </div>
        <StartFromLabel workspaceId={workspaceId} familyId={picked?.id ?? null} />
      </aside>
    </div>
  );
}

function FamilyPanel({
  family,
  draftName,
  newFamilyName,
  workspaceId,
}: {
  family: Family | null;
  draftName: string;
  newFamilyName: string;
  workspaceId: string;
}) {
  const title = family ? family.name : newFamilyName.trim() || draftName.trim() || "A new family";
  const count = (family?.products.length ?? 0) + 1;
  return (
    <Blueprint className="py-[18px] px-[18px]" as="section">
      <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Family</p>
      <h2 className="mt-[8px] mb-[6px] font-head text-[18px] font-semibold leading-[1.25]" data-family-title>
        {title} · {count} {count === 1 ? "product" : "products"}
      </h2>
      <ul className="m-0 p-0 list-none">
        {(family?.products ?? []).map((p) => (
          <li key={p.id} className="flex items-baseline gap-[10px] py-[10px] border-t border-rule">
            <a href={`/w/${workspaceId}/products/${p.id}/check`} className="flex-1 min-w-0 text-[13.5px] text-ink no-underline hover:text-accent-700">
              {p.name}
            </a>
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-n600">{STAGE_TEXT[p.stage]}</span>
          </li>
        ))}
        <li className="flex items-baseline gap-[10px] py-[10px] border-t border-rule">
          <span className="flex-1 min-w-0 text-[13.5px] text-ink">{draftName.trim() || "This product"}</span>
          <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-n600">This product</span>
        </li>
      </ul>
      <p className="mt-[12px] mb-0 pt-[12px] border-t border-rule text-[12.5px] leading-[1.5] text-n700">
        Pack sizes and recipe variants check differently, so each is its own product linked by the family id.
        {family ? " Adding one never creates a new billable family." : ""}
      </p>
    </Blueprint>
  );
}

export function RefusalCard({ refusal }: { refusal: Refusal }) {
  return (
    <div className="mt-[16px]" role="alert" data-refusal={refusal.code}>
      <ErrorState
        where={`NOT CREATED · ${refusal.code}`}
        title={refusal.title}
        body={refusal.body}
        action={refusal.offer ? { label: refusal.offer.label, href: refusal.offer.href, variant: "primary" } : undefined}
      />
    </div>
  );
}


"use client";

import { useId, type ReactNode } from "react";
import { cx } from "@/components/kit";
import { ROLE_TITLE, ROLES_DESC, type Family, type Market } from "@/lib/settings/people";
import type { Role } from "@/lib/shell/routes";

// The form parts the settings screens share, drawn as the Workspace Settings file draws its inputs (`.ntv-in`).

export const INPUT =
  "w-full box-border border border-n400 rounded-control py-[10px] px-[12px] text-[13.5px] font-head bg-paper text-ink " +
  "placeholder:text-n500 read-only:bg-panel read-only:text-n700 disabled:bg-panel disabled:text-n700";
export const LABEL = "block text-[12.5px] font-medium mb-[5px]";
export const HELP = "mt-[5px] mb-0 text-[12px] leading-[1.45] text-n600";
export const KICKER = "m-0 font-mono text-[10px] tracking-[0.12em] uppercase";

export function Field({ label, help, children, id }: { label: string; help?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {help ? <p className={HELP}>{help}</p> : null}
    </div>
  );
}

export type ScopeState = {
  role: Role;
  external: boolean;
  /** null: every recipe. */
  familyIds: string[] | null;
  /** null: every market. */
  nodeIds: string[] | null;
  /** yyyy-mm-dd or "". */
  endsOn: string;
};

/** The ISO end of the chosen day (UTC), or null for no end date. */
export function endsAt(endsOn: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? `${endsOn}T23:59:59Z` : null;
}

function Choice({
  legend,
  all,
  options,
  value,
  onChange,
}: {
  legend: string;
  all: string;
  options: { id: string; label: string }[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 p-0 border-0">
      <legend className={LABEL}>{legend}</legend>
      <div className="flex flex-wrap gap-x-[16px] gap-y-[4px] text-[13px]">
        <label className="flex items-center gap-[6px]">
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} /> {all}
        </label>
        <label className={cx("flex items-center gap-[6px]", options.length === 0 && "text-n600")}>
          <input
            type="radio"
            name={name}
            checked={value !== null}
            disabled={options.length === 0}
            onChange={() => onChange(options.length ? [options[0].id] : null)}
          />{" "}
          Only some
        </label>
      </div>
      {value !== null ? (
        <div className="mt-[6px] max-h-[132px] overflow-y-auto border border-n300 py-[6px] px-[10px] flex flex-col gap-[3px] text-[12.5px]">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-[6px]">
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id);
                  // An empty list is refused by the RPCs (null means everything), so the last box stays ticked.
                  if (next.length) onChange(next);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Role, external flag, scope and end date: what an invitation carries and a membership keeps (A03 step 1, A05). */
export function ScopeFields({
  value,
  onChange,
  families,
  markets,
}: {
  value: ScopeState;
  onChange: (next: ScopeState) => void;
  families: Family[];
  markets: Market[];
}) {
  const roleId = useId();
  const endId = useId();
  const set = (patch: Partial<ScopeState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-[13px]">
      <Field id={roleId} label="Role" help={value.role === "viewer" ? "Viewers are free and never use a seat." : "Uses an editor seat, external or not."}>
        <select id={roleId} className={INPUT} value={value.role} onChange={(e) => set({ role: e.target.value as Role })}>
          {ROLES_DESC.map((r) => (
            <option key={r} value={r}>
              {ROLE_TITLE[r]}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-start gap-[8px] text-[13px]">
        <input type="checkbox" className="mt-[3px]" checked={value.external} onChange={(e) => set({ external: e.target.checked })} />
        <span>
          External: outside your company
          <span className="block text-[12px] text-n600">Never offered signing authority; every event they generate carries the flag.</span>
        </span>
      </label>
      <Choice
        legend="Recipes"
        all="Every recipe"
        options={families.map((f) => ({ id: f.id, label: f.name }))}
        value={value.familyIds}
        onChange={(familyIds) => set({ familyIds })}
      />
      <Choice
        legend="Markets"
        all="Every market"
        options={markets.map((m) => ({ id: m.id, label: m.parentId ? `${m.id.replace("-", " · ")} · ${m.name}` : `${m.id} · all of ${m.name}` }))}
        value={value.nodeIds}
        onChange={(nodeIds) => set({ nodeIds })}
      />
      <Field id={endId} label="Access ends" help="Optional. Access ends on the date without anybody remembering to remove them.">
        <input id={endId} type="date" className={INPUT} value={value.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
      </Field>
    </div>
  );
}

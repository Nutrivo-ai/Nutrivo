"use client";

// S-NV2-004 Brief & formula (T-1001, E01), built to design/product/Nutrivo 2.0 "brief" with the decisions on #76:
// the formula's note column shows only "not matched to the register" (Q2); the person picks each register row, never
// matched automatically (Q3); the "What we can answer with this" panel waits for the envelope (T-1002) and the
// formula heading says instead that the formula changes check results (Q4); Paste is the one way in (Q5). The right
// column holds the intended claims per language (E01 step 3), the customer's own text.
import { useId, useMemo, useState, useTransition } from "react";
import { Button, Dialog, EmptyState } from "@/components/kit";
import { findInRegister, saveClaims, saveFormula, type BriefRefusal } from "@/lib/briefs/actions";
import type { Brief } from "@/lib/briefs/queries";
import {
  FORMULA_CHANGES_OUTCOMES,
  NOT_MATCHED_NOTE,
  MAX_LINES,
  formulaProblems,
  isMatched,
  matchedSummary,
  parsePaste,
  parseQuantity,
  quantityText,
  readClaims,
  registerLabel,
  targetNodes,
  type FormulaLineInput,
  type RegisterRow,
} from "@/lib/briefs/rules";

type Row = { key: string; ingredient: string; qty: string; feed_material_ref: string | null; additive_ref: string | null; registerName: string | null };

const SPECIES: Record<string, string> = { dog: "Dog", cat: "Cat", other: "Other" };
const CLASS: Record<string, string> = {
  complete: "Complete feed", complementary: "Complementary feed", treat: "Treat", mineral: "Mineral feed",
  dietetic: "Dietetic feed", other: "Other",
};
const REFUSAL: Record<BriefRefusal, string> = {
  "no-permission": "Your role cannot change this brief. An editor or an admin of the workspace can.",
  invalid: "The database refused a value. Check each line, then save again.",
  error: "It was not saved. Nothing you entered is lost: save again, and if it fails twice, tell us.",
};

let seq = 0;
const key = () => `row-${++seq}`;

function toRows(lines: Brief["lines"]): Row[] {
  return lines.map((l) => ({
    key: key(),
    ingredient: l.ingredient,
    qty: quantityText(l),
    feed_material_ref: l.feed_material_ref,
    additive_ref: l.additive_ref,
    registerName: l.registerName,
  }));
}

function toInput(rows: Row[]): (FormulaLineInput | null)[] {
  return rows.map((r) => {
    const q = parseQuantity(r.qty);
    return q ? { ingredient: r.ingredient, ...q, feed_material_ref: r.feed_material_ref, additive_ref: r.additive_ref } : null;
  });
}

const LABEL = "m-0 mb-[4px] font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600";
const TH = "font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-rule py-[8px]";
const TD = "border-b border-rule py-[9px] align-middle";
const CELL_INPUT = "w-full bg-transparent border border-transparent hover:border-rule focus:border-accent py-[4px] px-[6px] -mx-[6px] rounded-control";

export function BriefForm({ workspaceId, brief }: { workspaceId: string; brief: Brief }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(brief.lines));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "refused"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  const inputs = useMemo(() => toInput(rows), [rows]);
  const badQty = rows.filter((_, i) => inputs[i] === null).map((r) => rows.indexOf(r) + 1);
  const problems = [
    ...formulaProblems(inputs.filter((x): x is FormulaLineInput => x !== null)),
    ...badQty.map((n) => `Line ${n}: the quantity reads as a percent ("38.0") or an amount with its unit ("180 mg/kg").`),
  ];

  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setStatus(null);
  };
  const update = (k: string, patch: Partial<Row>) => change(rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const save = () =>
    startSaving(async () => {
      const lines = inputs.filter((x): x is FormulaLineInput => x !== null);
      const result = await saveFormula(workspaceId, brief.id, lines);
      if (result.ok) {
        setDirty(false);
        setStatus({
          kind: "saved",
          text: result.count
            ? `Formula saved: ${result.count} ${result.count === 1 ? "line" : "lines"}. The next check of this product runs on it.`
            : "Formula removed. Additive rules are withheld again until a formula is entered.",
        });
      } else setStatus({ kind: "refused", text: REFUSAL[result.reason] });
    });

  const applyPaste = () => {
    const pasted = parsePaste(pasteText).map((l) => ({
      key: key(), ingredient: l.ingredient, qty: quantityText(l), feed_material_ref: null, additive_ref: null, registerName: null,
    }));
    change([...rows.filter((r) => r.ingredient.trim() !== ""), ...pasted].slice(0, MAX_LINES));
    setPasteText("");
    setPasteOpen(false);
  };

  const pickingRow = rows.find((r) => r.key === picking) ?? null;
  const matched = matchedSummary(rows.filter((r) => r.ingredient.trim() !== ""));
  const productClass = brief.productClass ? (CLASS[brief.productClass] ?? brief.productClass) : "Not determined";
  const firstClaim = Object.values(brief.claims).flat()[0];
  const fields = [
    { k: "Working name", v: brief.name },
    { k: "Species", v: brief.species ? (SPECIES[brief.species] ?? brief.species) : "Not stated" },
    { k: "Life stage", v: brief.lifeStage ?? "Not stated" },
    { k: "Product class", v: productClass },
    { k: "Target nodes", v: brief.nodes.length ? targetNodes(brief.nodes) : "No markets yet" },
    { k: "Intended claim", v: firstClaim ?? "None entered" },
  ];

  return (
    <div className="grid gap-[22px] items-start md:grid-cols-[minmax(0,1fr)_340px] md:max-w-[948px]" data-brief>
      <div className="min-w-0">
        <section aria-labelledby="the-brief" className="border border-ink py-[18px] px-[20px]">
          <h2 id="the-brief" className="m-0 font-mono text-[10px] font-normal leading-[1.55] tracking-[0.13em] uppercase text-accent">
            The brief
          </h2>
          <dl className="mt-[12px] mb-0 grid grid-cols-1 sm:grid-cols-3 gap-[14px]">
            {fields.map((f) => (
              <div key={f.k} className="min-w-0">
                <dt className={LABEL}>{f.k}</dt>
                <dd className="m-0 border border-rule bg-panel py-[8px] px-[10px] text-[13.5px] text-ink break-words" data-field={f.k}>
                  {f.v}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="formula" className="mt-[18px]">
          <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px] border-b border-ink pb-[6px]">
            <h2 id="formula" className="m-0 font-head text-[17px] font-semibold">
              Formula
            </h2>
            <span className="font-mono text-[10.5px] text-n600" data-matched>
              {matched}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setPasteOpen(true)}
              className="kit-transition bg-transparent border-0 p-0 cursor-pointer font-mono text-[10.5px] uppercase text-accent-700 hover:text-accent"
            >
              Paste
            </button>
          </div>
          <p className="mt-[8px] mb-0 text-[12.5px] leading-[1.5] text-n700" data-formula-changes-outcomes>
            {FORMULA_CHANGES_OUTCOMES}
          </p>

          {rows.length === 0 ? (
            <div className="mt-[12px]">
              <EmptyState
                where="FORMULA"
                title="No formula has been entered"
                body="Without one, every additive rule on this product's checks is withheld as missing data, never passed. Paste the formula from a spec sheet, or add it line by line."
                action={{ label: "Add a line", onClick: () => change([{ key: key(), ingredient: "", qty: "", feed_material_ref: null, additive_ref: null, registerName: null }]) }}
                aside="Paste takes one ingredient per line, with its percent."
              />
            </div>
          ) : (
            <table className="w-full border-collapse mt-[2px]" aria-labelledby="formula">
              <thead>
                <tr>
                  <th scope="col" className={`${TH} text-left pr-[8px]`}>Ingredient as entered</th>
                  <th scope="col" className={`${TH} text-left px-[8px]`}>Register match</th>
                  <th scope="col" className={`${TH} text-right px-[8px] w-[96px]`}>%</th>
                  <th scope="col" className={`${TH} text-left px-[8px]`}>Note</th>
                  <th scope="col" className={`${TH} w-[28px]`}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} data-line={i + 1}>
                    <td className={`${TD} pr-[8px] text-[13.5px]`}>
                      <input
                        aria-label={`Line ${i + 1}: ingredient as entered`}
                        value={r.ingredient}
                        maxLength={300}
                        onChange={(e) => update(r.key, { ingredient: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>
                    <td className={`${TD} px-[8px]`}>
                      <button
                        type="button"
                        onClick={() => setPicking(r.key)}
                        className={`kit-transition text-left bg-transparent border-0 p-0 cursor-pointer font-mono text-[11px] hover:underline ${isMatched(r) ? "text-accent-700" : "text-n600"}`}
                      >
                        <span className="sr-only">{`Line ${i + 1}: register match, `}</span>
                        {registerLabel(r)}
                        {r.registerName ? <span className="block text-n600 normal-case">{r.registerName}</span> : null}
                        <span className="sr-only">. Change</span>
                      </button>
                    </td>
                    <td className={`${TD} px-[8px] text-right font-mono text-[12px]`}>
                      <input
                        aria-label={`Line ${i + 1}: percent or amount`}
                        aria-invalid={inputs[i] === null}
                        value={r.qty}
                        maxLength={24}
                        onChange={(e) => update(r.key, { qty: e.target.value })}
                        className={`${CELL_INPUT} text-right`}
                      />
                    </td>
                    <td className={`${TD} px-[8px] text-[12.5px] text-n700`} data-note={isMatched(r) ? undefined : "not-matched"}>{isMatched(r) ? "" : NOT_MATCHED_NOTE}</td>
                    <td className={`${TD} text-right`}>
                      <button
                        type="button"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => change(rows.filter((x) => x.key !== r.key))}
                        className="kit-transition bg-transparent border-0 p-0 cursor-pointer font-mono text-[13px] text-n600 hover:text-accent-700"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {problems.length ? (
            <ul className="mt-[10px] mb-0 pl-[18px] text-[12.5px] text-n700" aria-live="polite" data-problems>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : null}
          {status ? (
            <p role="status" className={`mt-[10px] mb-0 text-[12.5px] ${status.kind === "saved" ? "text-n700" : "text-ink font-medium"}`} data-status={status.kind}>
              {status.text}
            </p>
          ) : null}
          {rows.length || dirty ? (
            <div className="mt-[12px] flex flex-wrap items-center gap-[10px]">
              <Button variant="primary" onClick={save} disabled={!dirty || saving || problems.length > 0}>
                {saving ? "Saving…" : rows.length ? "Save formula" : "Save: remove the formula"}
              </Button>
              {rows.length && rows.length < MAX_LINES ? (
                <Button
                  onClick={() => change([...rows, { key: key(), ingredient: "", qty: "", feed_material_ref: null, additive_ref: null, registerName: null }])}
                >
                  Add a line
                </Button>
              ) : null}
              {dirty ? (
                <Button variant="ghost" onClick={() => { setRows(toRows(brief.lines)); setDirty(false); setStatus(null); }}>
                  Discard changes
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <IntendedClaims workspaceId={workspaceId} brief={brief} />

      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        kicker="FORMULA · PASTE"
        title="Paste the formula"
        confirmLabel="Add these lines"
        onConfirm={applyPaste}
      >
        <PasteBody value={pasteText} onChange={setPasteText} />
      </Dialog>

      <RegisterPicker
        row={pickingRow}
        onClose={() => setPicking(null)}
        onPick={(pick) => {
          if (!pickingRow) return;
          update(pickingRow.key, {
            feed_material_ref: pick?.kind === "feed_material" ? pick.ref : null,
            additive_ref: pick?.kind === "additive" ? pick.ref : null,
            registerName: pick?.name ?? null,
          });
          setPicking(null);
        }}
      />
    </div>
  );
}

function PasteBody({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const preview = parsePaste(value);
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] text-n700">
        One ingredient per line, as on the spec, with its percent or amount: “Chicken liver, 12.0” or “Zinc chelate 180 mg/kg”.
        Each line arrives not matched to the register; you pick its row.
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        className="mt-[10px] w-full border border-n400 rounded-control py-[8px] px-[10px] font-mono text-[12px] text-ink bg-paper"
      />
      <p className="mt-[6px] mb-0 font-mono text-[10.5px] text-n600" aria-live="polite">
        {preview.length} {preview.length === 1 ? "line" : "lines"} read
      </p>
    </div>
  );
}

function RegisterPicker({ row, onClose, onPick }: { row: Row | null; onClose: () => void; onPick: (pick: RegisterRow | null) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "rows"; rows: RegisterRow[] } | { kind: "error" }>({ kind: "idle" });
  const [searching, startSearch] = useTransition();
  const search = () =>
    startSearch(async () => {
      const r = await findInRegister(q);
      setState(r.ok ? { kind: "rows", rows: r.rows } : { kind: "error" });
    });
  return (
    <Dialog open={row !== null} onClose={() => { setQ(""); setState({ kind: "idle" }); onClose(); }} kicker={row ? `REGISTER MATCH · ${row.ingredient || "NEW LINE"}` : undefined} title="Pick the register row">
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-[8px]">
        <label htmlFor={id} className="sr-only">Feed material or additive: name or number</label>
        <input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or number, e.g. 9.3.1 or 3b606"
          className="flex-1 min-w-0 border border-n400 rounded-control py-[7px] px-[10px] text-[13px] bg-paper"
        />
        <Button type="submit" disabled={searching || q.trim().length < 2}>{searching ? "Searching…" : "Search"}</Button>
      </form>
      <div className="mt-[12px]" aria-live="polite">
        {state.kind === "error" ? (
          <p className="m-0 text-[13px] text-ink">The register could not be read. Search again.</p>
        ) : state.kind === "rows" && state.rows.length === 0 ? (
          <p className="m-0 text-[13px] text-n700">
            No feed material or additive in the register matches. Leave the line not matched: additive rules are then
            withheld, never passed.
          </p>
        ) : state.kind === "rows" ? (
          <ul className="m-0 p-0 list-none flex flex-col">
            {state.rows.map((r) => (
              <li key={`${r.kind}:${r.ref}`} className="border-t border-rule">
                <button type="button" onClick={() => onPick(r)} className="kit-transition w-full text-left bg-transparent border-0 py-[8px] px-0 cursor-pointer hover:text-accent-700">
                  <span className="font-mono text-[11px] text-accent-700">{r.kind === "additive" ? `Additive ${r.ref}` : `Feed material ${r.ref}`}</span>
                  <span className="block text-[13px]">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[12.5px] text-n600">Rows come from the imported catalogue of feed materials and register of feed additives.</p>
        )}
      </div>
      {row && isMatched(row) ? (
        <p className="mt-[12px] mb-0">
          <Button variant="ghost" onClick={() => onPick(null)}>Clear the match</Button>
        </p>
      ) : null}
    </Dialog>
  );
}

function IntendedClaims({ workspaceId, brief }: { workspaceId: string; brief: Brief }) {
  const id = useId();
  const marketLanguages = brief.languages;
  const initial = Object.keys(brief.claims)[0] ?? (marketLanguages.includes("en") ? "en" : marketLanguages[0] ?? "en");
  const [language, setLanguage] = useState(initial);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(brief.claims).map(([l, c]) => [l, c.join("\n")])),
  );
  const [saved, setSaved] = useState<Record<string, string>>(texts);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const text = texts[language] ?? "";
  const dirty = text !== (saved[language] ?? "");
  const entered = Object.entries(saved).filter(([, t]) => readClaims(t).length > 0);

  const save = () =>
    startSaving(async () => {
      const claims = readClaims(text);
      const r = await saveClaims(workspaceId, brief.id, language, claims);
      if (r.ok) {
        setSaved({ ...saved, [language]: claims.join("\n") });
        setTexts({ ...texts, [language]: claims.join("\n") });
        setStatus(`Saved ${r.count} ${r.count === 1 ? "claim" : "claims"} in ${language.toUpperCase()}.`);
      } else setStatus(REFUSAL[r.reason]);
    });

  return (
    <section aria-labelledby="claims" className="border border-ink py-[17px] px-[17px]" data-claims>
      <h2 id="claims" className="m-0 font-mono text-[10px] font-normal leading-[1.55] tracking-[0.13em] uppercase text-accent">
        Intended claims
      </h2>
      <p className="mt-[8px] mb-0 text-[12.5px] leading-[1.5] text-n700">
        Your wording, per language, exactly as it would be printed. Claims are judged on the printed string in each
        language, never on a translation.
      </p>
      <label htmlFor={`${id}-lang`} className={`${LABEL} block mt-[12px]`}>Language</label>
      <select
        id={`${id}-lang`}
        value={language}
        onChange={(e) => { setLanguage(e.target.value); setStatus(null); }}
        className="w-full border border-n400 rounded-control py-[6px] px-[8px] text-[13px] bg-paper"
      >
        {marketLanguages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
      <label htmlFor={`${id}-text`} className={`${LABEL} block mt-[12px]`}>Claims, one per line</label>
      <textarea
        id={`${id}-text`}
        lang={language}
        value={text}
        rows={5}
        onChange={(e) => { setTexts({ ...texts, [language]: e.target.value }); setStatus(null); }}
        className="w-full border border-n400 rounded-control py-[8px] px-[10px] text-[13px] bg-paper"
      />
      <div className="mt-[10px] flex items-center gap-[10px]">
        <Button onClick={save} disabled={!dirty || saving || readClaims(text).length > 50}>
          {saving ? "Saving…" : `Save ${language.toUpperCase()} claims`}
        </Button>
      </div>
      {status ? <p role="status" className="mt-[8px] mb-0 text-[12.5px] text-n700">{status}</p> : null}
      <div className="mt-[14px] border-t border-rule pt-[10px]">
        <p className={LABEL}>Entered</p>
        {entered.length ? (
          <ul className="m-0 p-0 list-none flex flex-col gap-[6px]">
            {entered.map(([l, t]) => (
              <li key={l} className="text-[12.5px]" lang={l}>
                <span className="font-mono text-[10.5px] text-n600 mr-[6px]">{l.toUpperCase()}</span>
                {readClaims(t).join(" · ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[12.5px] text-n600">No intended claims yet.</p>
        )}
      </div>
    </section>
  );
}

import { EmptyState, ErrorState, LoadingState } from "@/components/kit";
import { describe, type ClassificationRow } from "@/lib/classification/describe";

export type ClassificationState =
  | { kind: "loaded"; row: ClassificationRow }
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "error" };

/**
 * S-NV2-002 "3 · Which rulebook applies" (D03, T-402): the product's classification, determined before any check
 * runs. A suggestion is the model's, from the printed label text, with the words it rests on; an unsure field stays
 * empty for a person (D03.fail.1). No rule uses it until a person confirms it (BE-19).
 *
 * The design's "Challenge this determination" button is not drawn: the confirmation write path is not built yet
 * (question Q1 on #44), and a control that does nothing is never drawn. The note under the list says what is true
 * instead. The design's accent-800 note colour is the nearest Cobalt token, accent-700 (docs/10 has no 800), and its
 * neutral-600 labels are n700: n600 on accent-100 is below 4.5:1 (axe colour-contrast).
 */
export function ClassificationPanel({ state }: { state: ClassificationState }) {
  return (
    <section
      aria-labelledby="which-rulebook"
      data-testid="classification"
      className="blueprint relative border border-ink p-[18px] bg-accent-100"
    >
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <h2 id="which-rulebook" className="m-0 font-mono text-[10px] font-normal leading-[1.55] tracking-[0.13em] uppercase text-accent">
        3 · Which rulebook applies
      </h2>
      <p className="mt-[7px] mb-0 font-head text-[19px] font-semibold leading-[1.15] tracking-normal">
        Classification, determined before any check runs
      </p>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: { state: ClassificationState }) {
  if (state.kind === "loading") {
    return (
      <div className="mt-[14px]">
        <LoadingState label="READING THE LABEL">
          The classification is suggested from the label text once the artwork is read.
        </LoadingState>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mt-[14px]">
        <ErrorState
          where="CLASSIFICATION"
          title="The classification could not be read."
          body="Nothing was changed. Reload the page to try again."
          aside="If it keeps failing, support has the request id."
        />
      </div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div className="mt-[14px]">
        <EmptyState
          where="CLASSIFICATION"
          title="No classification yet."
          body="It is suggested from the label text after the artwork is read, and a person confirms it before any rule uses it."
          aside="Add the artwork under 1 · What you have."
        />
      </div>
    );
  }
  const view = describe(state.row);
  return (
    <>
      <dl className="mt-[14px] mb-0 flex flex-col" data-confirmed={view.confirmed}>
        {view.fields.map((f) => (
          <div key={f.field} data-field={f.field} className="border-t border-accent-200 py-[9px]">
            <dt className="flex items-baseline gap-[8px]">
              <span className="flex-1 font-mono text-[10px] tracking-[0.08em] uppercase text-n700">{f.label}</span>
              <span className="font-mono text-[9.5px] tracking-[0.06em] text-n700" data-source>
                {f.source}
              </span>
            </dt>
            <dd className="m-0">
              <p className={f.value === null ? "mt-[3px] mb-0 text-[14px] font-medium text-n700" : "mt-[3px] mb-0 text-[14px] font-medium"}>
                {f.value ?? "Not determined"}
              </p>
              <p className="mt-[2px] mb-0 font-mono text-[10.5px] text-accent-700">{f.cite}</p>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-[9px] mb-0 font-mono text-[10px] tracking-[0.06em] uppercase text-n700" data-testid="classification-status">
        {view.status}
      </p>
      <p className="mt-[9px] mb-0 text-[12px] leading-[1.45] text-accent-700">
        {view.confirmed
          ? "Everything downstream is scoped by these five values."
          : "A person confirms these values before any rule uses them. Until then, every rule that depends on them is Not assessed."}
      </p>
    </>
  );
}

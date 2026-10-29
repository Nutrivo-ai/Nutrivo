import { ScreenHeader } from "@/components/shell";
import { readJurisdictions, readRuleQueue } from "@/lib/admin/reads";
import { staffReader } from "@/lib/admin/server";
import { RuleQueue } from "./RuleQueue";

// The rule review queue (no design yet, #35 question 1): each K01/K02 candidate with its two independent extractions
// side by side, the stored source they came from, and the docs/12 checklist. Accepting is the person's click on
// app.accept_candidate: params, article and excerpt come only from the extraction they choose; the person adds what
// the extraction does not hold (title, shape, domain and node for a new rule key, applicability, effect, dates).
export default async function RulesPage() {
  const db = await staffReader();
  const [candidates, nodes] = await Promise.all([readRuleQueue(db), readJurisdictions(db)]);
  return (
    <>
      <ScreenHeader crumb="Content operations · K01–K02" title="Rule review queue" />
      <RuleQueue candidates={candidates} nodes={nodes} />
    </>
  );
}

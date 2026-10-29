import { ScreenHeader } from "@/components/shell";
import { readRuleQueue, readTermQueue } from "@/lib/admin/reads";
import { staffReader } from "@/lib/admin/server";
import { TermQueue } from "./TermQueue";

// S-NV2-029 Term acceptance queue (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "term"). K03: a
// person accepts or rejects each language's prescribed term, read from that language's stored official text, never
// derived from the English row (BE-11). Read as the service role after the staff check; decisions go through
// app.decide_term under the person's own session.
export default async function TermsPage({ searchParams }: PageProps<"/admin/terms">) {
  const { entry } = await searchParams;
  const db = await staffReader();
  const [terms, rules] = await Promise.all([readTermQueue(db), readRuleQueue(db)]);
  return (
    <>
      <ScreenHeader crumb="Library · term register" title="Acceptance queue" />
      <TermQueue terms={terms} rules={rules} initial={typeof entry === "string" ? entry : null} />
    </>
  );
}

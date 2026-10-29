import { EmptyState, SectionHeading } from "@/components/kit";
import { ScreenHeader } from "@/components/shell";
import { readDrafts, readGlossary } from "@/lib/admin/reads";
import { staffReader } from "@/lib/admin/server";

// The glossary of the latest release (BE-11: authored definitions, returned verbatim). Read only: no K-workflow edits
// it, and a release copies the previous release's entries forward unchanged (#34 question 5).
export default async function GlossaryPage() {
  const db = await staffReader();
  const { latestRelease } = await readDrafts(db);
  const entries = latestRelease ? await readGlossary(db, latestRelease) : [];
  return (
    <>
      <ScreenHeader crumb="Content operations · glossary" title="Glossary" />
      <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px] max-w-[980px]">
        <SectionHeading note={latestRelease ? `RULESET ${latestRelease} · read only` : "No release yet"}>Authored definitions</SectionHeading>
        {entries.length === 0 ? (
          <div className="mt-[14px] max-w-[640px]">
            <EmptyState
              where="GLOSSARY · READ ONLY"
              title="The current release holds no glossary entries"
              body="Definitions are authored and carried by a release. Nothing on this page edits them."
            />
          </div>
        ) : (
          <dl className="mt-[6px] mb-0">
            {entries.map((e) => (
              <div key={e.key} data-glossary={e.key} className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-[12px] border-b border-rule py-[10px]">
                <dt className="font-mono text-[11.5px] text-n800">{e.key}</dt>
                <dd className="m-0 text-[13px] leading-[1.55]">{e.definition}</dd>
              </div>
            ))}
          </dl>
        )}
      </main>
    </>
  );
}

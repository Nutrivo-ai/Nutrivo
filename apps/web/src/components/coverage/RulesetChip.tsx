/** The header's ruleset chip, as S-NV2-013 and S-NV2-021 draw it: "RULESET 2026.08-b · current". */
export function RulesetChip({ version, current }: { version: string | null; current: boolean }) {
  return (
    <span data-ruleset={version ?? ""} className="border border-rule py-[5px] px-[9px] font-mono text-[10.5px] tracking-[0.06em] text-n600 whitespace-nowrap">
      {version ? `RULESET ${version} · ${current ? "current" : "superseded"}` : "NO RULESET RELEASED"}
    </span>
  );
}

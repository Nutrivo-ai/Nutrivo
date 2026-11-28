"use client";

import { useRouter } from "next/navigation";

/** The market filter (S-MTX-001): a native select whose choice is a URL, so it survives a reload or a shared link. */
export function MarketSelect({
  value,
  options,
}: {
  value: string;
  /** "all" first, then each market in the plan, with the board URL each one opens. */
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-[8px] text-[14px]">
      Market
      <select
        name="market"
        value={value}
        onChange={(e) => {
          const to = options.find((o) => o.value === e.target.value);
          if (to) router.push(to.href);
        }}
        className="font-[inherit] text-[14px] py-[8px] px-[10px] min-h-[40px] border border-rule rounded-[8px] bg-paper text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

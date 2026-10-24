import { cx } from "@/components/kit";

/** The wordmark as Nutrivo 2.0's rail draws it (22 px), or as the Mobile file's top bar does (15 px). */
export function Wordmark({ size = "rail", className }: { size?: "rail" | "phone"; className?: string }) {
  const rail = size === "rail";
  return (
    <span
      className={cx(
        "m-0 flex items-end font-head font-semibold tracking-[-0.045em] leading-none text-ink",
        rail ? "gap-[4px] text-[22px]" : "gap-[3px] text-[15px]",
        className,
      )}
    >
      <span>nutrivo</span>
      <span
        aria-hidden="true"
        className={cx("flex-none bg-accent mb-[2px]", rail ? "w-[6px] h-[6px]" : "w-[4px] h-[4px]")}
      />
    </span>
  );
}

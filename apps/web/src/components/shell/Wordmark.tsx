import { cx } from "@/components/kit";

// Nutrivo 2.0's rail (22 px), Account Recovery's header (21 px) and card (20 px), Workspace Settings' nav (20 px), the Mobile file's top bar (15 px).
const SIZE = {
  rail: { text: "gap-[4px] text-[22px]", dot: "w-[6px] h-[6px]" },
  header: { text: "gap-[4px] text-[21px]", dot: "w-[6px] h-[6px]" },
  settings: { text: "gap-[4px] text-[20px]", dot: "w-[6px] h-[6px]" },
  card: { text: "gap-[4px] text-[20px]", dot: "w-[5px] h-[5px]" },
  phone: { text: "gap-[3px] text-[15px]", dot: "w-[4px] h-[4px]" },
} as const;

/** The wordmark, at the size each design file draws it. */
export function Wordmark({ size = "rail", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <span
      className={cx(
        "m-0 flex items-end font-head font-semibold tracking-[-0.045em] leading-none text-ink",
        SIZE[size].text,
        className,
      )}
    >
      <span>nutrivo</span>
      <span aria-hidden="true" className={cx("flex-none bg-accent mb-[2px]", SIZE[size].dot)} />
    </span>
  );
}

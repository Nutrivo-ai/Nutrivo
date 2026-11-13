import { LoadingState } from "@/components/kit";

// S-NV2-004 loading: the brief, its formula and its claims are being read.
export default function Loading() {
  return (
    <main id="main" className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]" data-screen="S-NV2-004">
      <div className="max-w-[640px]">
        <LoadingState label="LOADING · BRIEF & FORMULA">Reading the brief, its formula and its intended claims.</LoadingState>
      </div>
    </main>
  );
}

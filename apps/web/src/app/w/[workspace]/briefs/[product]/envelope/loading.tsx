import { LoadingState } from "@/components/kit";

// S-NV2-005 loading: the brief's latest envelope is being read.
export default function Loading() {
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]" data-screen="S-NV2-005">
      <div className="max-w-[640px]">
        <LoadingState label="LOADING · DESIGN ENVELOPE">Reading the brief&apos;s latest envelope.</LoadingState>
      </div>
    </main>
  );
}

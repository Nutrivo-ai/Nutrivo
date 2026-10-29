import { LoadingState } from "@/components/kit";

// While /onboarding reads where the person is.
export default function Loading() {
  return (
    <div className="min-h-screen bg-panel pt-[34px] px-[16px] md:px-[32px]">
      <div className="max-w-[1040px] mx-auto">
        <LoadingState label="READING · YOUR WORKSPACE">One moment while we check where you left off.</LoadingState>
      </div>
    </div>
  );
}

import { LoadingState } from "@/components/kit";

export default function AdminLoading() {
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <LoadingState label="LOADING · ADMIN">Reading the content tables.</LoadingState>
    </main>
  );
}

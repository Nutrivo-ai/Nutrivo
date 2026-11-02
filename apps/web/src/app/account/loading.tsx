import { LoadingState } from "@/components/kit";

// S-WSS-006 while the account, its factors and its workspaces are read.
export default function Loading() {
  return (
    <div className="min-h-screen bg-panel pt-[26px] px-[16px] md:px-[28px]">
      <div className="max-w-[640px]">
        <LoadingState label="LOADING · YOUR ACCOUNT">Reading your account.</LoadingState>
      </div>
    </div>
  );
}

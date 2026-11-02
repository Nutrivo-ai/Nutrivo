import { LoadingState } from "@/components/kit";
import { AuthPage } from "@/components/auth/AuthCard";

// While /invite/<token> reads who is signed in.
export default function Loading() {
  return (
    <AuthPage>
      <LoadingState label="LOADING · INVITATION">One moment.</LoadingState>
    </AuthPage>
  );
}

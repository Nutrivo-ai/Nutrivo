import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/AuthCard";
import { AcceptInvitation, InvitationExpired, InvitedSignedOut } from "@/components/invite/Invite";
import { isInviteToken } from "@/lib/invite/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invitation · Nutrivo", referrer: "no-referrer" };

// /invite/<token> (spec/screens.yaml S-ONB-008, and S-REC-003 when expired; A04, T-107). The token is the emailed
// secret: it stays in this URL and the form that sends it to app.accept_invitation, and is never logged. The page
// reads nothing about the invitation; the database decides on accept.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!isInviteToken(token)) {
    return (
      <AuthPage>
        <InvitationExpired />
      </AuthPage>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return (
    <AuthPage>
      {data.user ? <AcceptInvitation token={token} email={data.user.email ?? ""} /> : <InvitedSignedOut token={token} />}
    </AuthPage>
  );
}

"use client";

import { useActionState } from "react";
import { AuthCard, FactList, Field, Fields, Primary, Problem, QuietLink, Secondary } from "@/components/auth/AuthCard";
import { acceptInvitation, createInvitedUser, signOutForInvite, type InviteState } from "@/lib/invite/actions";
import { invitePath } from "@/lib/invite/rules";

// /invite/<token> (S-ONB-008, and S-REC-003 when the link no longer works). Nothing can be read about an invitation
// before the invitee is signed in (question 3 on issue #29), so the cards name nobody: signed out, the invitee creates
// their user or signs in, and the confirmation returns here; signed in, they accept, and app.accept_invitation decides.

const IDLE: InviteState = { status: "idle" };

/** S-REC-003: the link has lapsed, was replaced by a newer one, or was withdrawn. It never says which. */
export function InvitationExpired() {
  return (
    <AuthCard
      testId="invite-expired"
      mark={{ label: "INVITATION EXPIRED", tone: "action", glyph: "triangle" }}
      title="This invitation has expired"
      body="The link in your email no longer works. Invitations lapse after a few days, and a newer email or a withdrawn invitation replaces the link."
    >
      <FactList
        items={[
          { text: "Nothing was lost — the workspace and its recipes are untouched", tone: "clear" },
          { text: "Ask for a new invitation and it arrives at this same address", tone: "action" },
          { text: "Your role and scope will be whatever the admin sets now, not what was set then", tone: "n600" },
        ]}
      />
      <Secondary>
        Ask the person who invited you to send it again. <QuietLink href="/auth/continue">Or go to your workspaces</QuietLink>
      </Secondary>
    </AuthCard>
  );
}

/** Signed out: create the invited user (two fields), or sign in and come back. */
export function InvitedSignedOut({ token }: { token: string }) {
  const [state, action, pending] = useActionState(createInvitedUser, IDLE);
  if (state.status === "refused") return <InvitationExpired />;
  if (state.status === "sent") {
    return (
      <AuthCard
        testId="invite-sent"
        mark={{ label: "CONFIRM YOUR ADDRESS", tone: "clear", glyph: "square" }}
        title="Check your email"
        body={`A link is on its way to ${state.email}. It brings you back to this invitation, signed in, to accept it.`}
      >
        <Secondary>
          Wrong address? <QuietLink href={invitePath(token)}>Use another one</QuietLink>
        </Secondary>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      testId="invite-create"
      mark={{ label: "INVITATION", tone: "accent", glyph: "circle" }}
      title="Two fields, then straight to the workspace"
      body="You have been invited to a Nutrivo workspace. It is already set up: there is no region to pick, no recipe to enter and no artwork to upload."
    >
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <Fields>
          <Field
            label="Work email"
            name="email"
            type="email"
            autoComplete="email"
            hint="THE ADDRESS THE INVITATION WAS SENT TO"
            required
          />
          <Field label="Password" name="password" type="password" autoComplete="new-password" placeholder="Choose a password" hint="AT LEAST 12 CHARACTERS" />
        </Fields>
        {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
        <Primary disabled={pending}>{pending ? "Creating…" : "Create user and continue"}</Primary>
      </form>
      <Secondary>
        Already have an account? <QuietLink href={`/sign-in?next=${encodeURIComponent(invitePath(token))}`}>Sign in to accept</QuietLink>
      </Secondary>
      <Secondary>Not expecting this? Ignore the email and nothing is created.</Secondary>
    </AuthCard>
  );
}

/** Signed in: one action. The database checks the token, its expiry and that it was sent to this address. */
export function AcceptInvitation({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, IDLE);
  if (state.status === "refused" && state.reason === "expired") return <InvitationExpired />;
  if (state.status === "refused" && state.reason === "other-email") {
    return (
      <AuthCard
        testId="invite-other-email"
        mark={{ label: "A DIFFERENT ADDRESS", tone: "action", glyph: "triangle" }}
        title="This invitation was sent to another address"
        body={`You are signed in as ${email}. An invitation works only for the address it was sent to, so sign in with that one to accept it.`}
      >
        <form action={signOutForInvite}>
          <input type="hidden" name="token" value={token} />
          <Primary>Sign out and use the invited address</Primary>
        </form>
      </AuthCard>
    );
  }
  if (state.status === "refused" && state.reason === "member") {
    return (
      <AuthCard
        testId="invite-member"
        mark={{ label: "ALREADY A MEMBER", tone: "clear", glyph: "square" }}
        title="You are already in this workspace"
        body="Nothing needed accepting: your access is already there, with the role and scope an admin gave you."
      >
        <form action="/auth/continue" method="get">
          <Primary>Go to your workspaces</Primary>
        </form>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      testId="invite-accept"
      mark={{ label: "INVITATION", tone: "accent", glyph: "circle" }}
      title="Accept the invitation"
      body={`You are signed in as ${email}. Accepting adds you to the workspace with the role and scope the admin chose, and takes you there.`}
    >
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
        <Primary disabled={pending}>{pending ? "Accepting…" : "Accept the invitation"}</Primary>
      </form>
      <Secondary>Not expecting this? Leave this page and nothing is created.</Secondary>
    </AuthCard>
  );
}

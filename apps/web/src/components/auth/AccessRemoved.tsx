import { AuthCard, AuthPage, FactList, PrimaryLink, QuietLink, Secondary } from "./AuthCard";

export type EndedAccess = {
  workspace_name: string;
  ended_on: string;
  admin_name: string | null;
  admin_email: string | null;
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * S-REC-004 (A02.fail.1): what /w/<id> shows after the person's membership ended or its end date passed. It is not an
 * error: it says when access ended, never why ("It never says which"), and offers the route back, which is the admin.
 */
export function AccessRemoved({ access }: { access: EndedAccess }) {
  const admin = access.admin_name && access.admin_email ? { name: access.admin_name, email: access.admin_email } : null;
  const subject = `Access to ${access.workspace_name} in Nutrivo`;
  return (
    <AuthPage>
      <AuthCard
        testId="access-removed"
        mark={{ label: "NO LONGER HAS ACCESS", tone: "blocked", glyph: "barred" }}
        title="You no longer have access to this workspace"
        body={`Your access to ${access.workspace_name} ended on ${DAY.format(new Date(access.ended_on))}. This can happen because an end date passed, or because an admin removed it.`}
      >
        <FactList
          items={[
            { text: "Your name remains on every check you ran and every document you signed", tone: "n600" },
            { text: "Reports you sent are still verifiable by whoever holds them", tone: "clear" },
            { text: "You cannot see recipes, findings or documents from here", tone: "blocked" },
          ]}
        />
        {admin ? (
          <PrimaryLink href={`mailto:${admin.email}?subject=${encodeURIComponent(subject)}`}>Ask {admin.name} for access</PrimaryLink>
        ) : (
          <PrimaryLink href="/auth/continue">Go to your workspaces</PrimaryLink>
        )}
        <Secondary>
          <QuietLink href="/auth/continue">Or sign in to a different workspace</QuietLink>
        </Secondary>
      </AuthCard>
    </AuthPage>
  );
}

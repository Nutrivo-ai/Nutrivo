import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Account } from "@/components/settings/Account";
import { SettingsNav } from "@/components/settings/SettingsFrame";
import { sessionGate } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/rules";
import { browserOf, type Channels } from "@/lib/settings/account";
import { formatDate } from "@/lib/settings/people";
import { createClient } from "@/lib/supabase/server";
import { readMemberships, ShellReadError } from "@/lib/workspace/memberships";

// S-WSS-006 Your account (spec/screens.yaml: route /account, role authenticated; design: product/Nutrivo Workspace
// Settings.dc.html, screen "account"). A07 (T-107). The design draws it inside a workspace's settings, so ?w= names
// the workspace the person came from; without it, their first workspace; without any, the account alone (question 5
// on issue #29). Reads only, under the person's session.

export default async function Page({ searchParams }: PageProps<"/account">) {
  const { w } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(signInHref(typeof w === "string" ? `/account?w=${w}` : "/account"));
  if ((await sessionGate(supabase, auth.user.id)) !== "ok") redirect(`/auth/mfa?next=${encodeURIComponent("/account")}`);

  const { data: person, error } = await supabase
    .schema("app")
    .from("people")
    .select("id, display_name")
    .eq("user_id", auth.user.id)
    .is("tombstoned_at", null)
    .maybeSingle();
  if (error) throw new ShellReadError("the person", error);
  const memberships = person ? await readMemberships(supabase, person.id) : [];
  const current = memberships.find((m) => m.workspaceId === (typeof w === "string" ? w.toLowerCase() : "")) ?? memberships[0] ?? null;

  const [prefs, admins, factors] = await Promise.all([
    person
      ? supabase.schema("app").from("notification_prefs").select("kind, channel, enabled").eq("person_id", person.id)
      : Promise.resolve({ data: [], error: null }),
    current && current.role === "admin"
      ? supabase
          .schema("app")
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", current.workspaceId)
          .eq("role", "admin")
          .is("ended_at", null)
          .is("access_ends_at", null)
          .neq("person_id", person!.id)
      : Promise.resolve({ count: 0, error: null }),
    supabase.auth.mfa.listFactors(),
  ]);
  if (prefs.error) throw new ShellReadError("notification preferences", prefs.error);
  if (admins.error) throw new ShellReadError("admins", admins.error);
  if (factors.error) throw new ShellReadError("two-step factors", { message: factors.error.message, code: factors.error.code });

  // A missing row means enabled (docs/04, notify).
  const channels = (kind: string): Channels => {
    const on = (channel: string) => prefs.data?.find((p) => p.kind === kind && p.channel === channel)?.enabled ?? true;
    return { email: on("email"), inApp: on("in_app") };
  };
  const signedIn = auth.user.last_sign_in_at;
  const browser = browserOf((await headers()).get("user-agent") ?? "");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[216px_minmax(0,1fr)] text-[14px] text-ink bg-panel">
      <SettingsNav ws={current?.workspaceId ?? null} active="account" />
      <div className="flex flex-col min-w-0 min-h-screen">
        <Account
          view={{
            name: person?.display_name ?? auth.user.email ?? "",
            email: auth.user.email ?? "",
            twoStep: factors.data.totp.some((f) => f.status === "verified"),
            thisBrowser: signedIn ? `${browser} · signed in ${formatDate(signedIn)}` : browser,
            notices: { ruleChanged: channels("rule_changed"), documentExpiring: channels("document_expiring") },
            current,
            memberships,
            otherAdmins: admins.count ?? 0,
          }}
        />
      </div>
    </div>
  );
}

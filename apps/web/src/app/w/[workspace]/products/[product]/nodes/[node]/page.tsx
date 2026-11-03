import * as Sentry from "@sentry/nextjs";
import { Verdict } from "@/components/mobile/Verdict";
import { readVerdict } from "@/lib/verdict/queries";
import { createClient } from "@/lib/supabase/server";

// S-MOB-003 The verdict (spec/screens.yaml; design: product/Nutrivo Mobile.dc.html, "Read a verdict"). One product in
// one market, read under RLS. The desktop Product × node layout (S-NV2-007) is T-504's. A read failure goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/nodes/[node]">) {
  const { workspace, product, node } = await params;
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "verdict.read", op: "db.read" }, () =>
    readVerdict(supabase, workspace, product, decodeURIComponent(node)),
  );
  return <Verdict route="/w/[workspace]/products/[product]/nodes/[node]" workspaceId={workspace} page={page} />;
}

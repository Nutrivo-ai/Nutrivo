// Playwright global setup (T-703): when STRIPE_API_BASE points at this machine (scripts/ci/e2e.sh sets it for the
// local stack), start the fake Stripe there for the whole run. Against a deployed environment (BASE_URL) nothing
// starts: those runs skip the @local-only billing tests and use the environment's own Stripe test mode.
import { startFakeStripe } from "./server";

export default async function globalSetup() {
  const base = process.env.STRIPE_API_BASE;
  if (!base || process.env.BASE_URL) return;
  const url = new URL(base);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return;
  const server = await startFakeStripe(Number(url.port || 80));
  return async () => {
    await server.close();
  };
}

// The local stack's Mailpit (scripts/ci/e2e.sh exports MAILPIT_URL from `supabase status`): the emails Supabase Auth
// sends, read back so a test can follow a link the way a person would.
import { expect } from "@playwright/test";

type Summary = { ID: string; Subject: string; Created: string };

function mailpit() {
  const url = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL;
  if (!url) throw new Error("MAILPIT_URL is not set: scripts/ci/e2e.sh exports it from the local Supabase stack");
  return url.replace(/\/$/, "");
}

export function haveMail() {
  return Boolean(process.env.MAILPIT_URL ?? process.env.INBUCKET_URL);
}

async function messagesTo(email: string): Promise<Summary[]> {
  const response = await fetch(`${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  return ((await response.json()) as { messages: Summary[] }).messages;
}

/** Waits for the `count`-th email to `email` and returns the Supabase Auth link in it (the verify URL). */
export async function linkFromEmail(email: string, count = 1): Promise<string> {
  let found: Summary[] = [];
  await expect
    .poll(async () => (found = await messagesTo(email)).length, { timeout: 20_000, message: `email ${count} to the test address` })
    .toBeGreaterThanOrEqual(count);
  const newest = found.sort((a, b) => b.Created.localeCompare(a.Created))[0];
  const message = (await (await fetch(`${mailpit()}/api/v1/message/${newest.ID}`)).json()) as { HTML: string; Text: string };
  const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(message.HTML)?.[1] ?? /(\S*\/auth\/v1\/verify\S*)/.exec(message.Text)?.[1];
  if (!href) throw new Error("no sign-in link in the email");
  return href.replace(/&amp;/g, "&");
}

/** Waits for the `count`-th email to `email` and returns the invitation link in it (Template 02, /invite/<token>). */
export async function inviteLinkFromEmail(email: string, count = 1): Promise<string> {
  let found: Summary[] = [];
  await expect
    .poll(async () => (found = await messagesTo(email)).length, { timeout: 60_000, message: `invitation email ${count} to the test address` })
    .toBeGreaterThanOrEqual(count);
  const newest = found.sort((a, b) => b.Created.localeCompare(a.Created))[0];
  const message = (await (await fetch(`${mailpit()}/api/v1/message/${newest.ID}`)).json()) as { HTML: string; Text: string };
  const href = /href="([^"]*\/invite\/[A-Za-z0-9_-]+)"/.exec(message.HTML)?.[1] ?? /(\S*\/invite\/[A-Za-z0-9_-]+)/.exec(message.Text)?.[1];
  if (!href) throw new Error("no invitation link in the email");
  return new URL(href).pathname;
}

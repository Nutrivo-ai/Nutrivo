// S-WSS-006 Your account (T-107): the pure parts, tested without a stack.
import type { WorkspaceMembership } from "@/lib/workspace/memberships";

/** A person's channels for one kind of notification (app.notification_prefs; a missing row means on). */
export type Channels = { email: boolean; inApp: boolean };

/** "Chrome on macOS" from the User-Agent, or "A browser" when it says nothing recognisable. */
export function browserOf(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return browser ? `${browser}${os ? ` on ${os}` : ""}` : "A browser";
}

export function channelsText(c: Channels | null): string {
  if (!c || (!c.email && !c.inApp)) return "OFF";
  if (c.email && c.inApp) return "EMAIL + IN APP";
  return c.email ? "EMAIL ONLY" : "IN APP ONLY";
}

/** "Leaving this workspace", worded for the person's own case. */
export function leavingText(current: WorkspaceMembership | null, otherAdmins: number): string | null {
  if (!current) return null;
  if (current.role === "admin" && otherAdmins === 0) {
    return "You are the only admin, so somebody else has to be made admin before you can leave. Your name stays on the work you did either way.";
  }
  if (current.role === "admin") {
    return `Another admin of ${current.name} can remove you from People and roles. Your name stays on the work you did either way.`;
  }
  return `An admin of ${current.name} removes you from People and roles when you leave. Your name stays on the work you did either way.`;
}

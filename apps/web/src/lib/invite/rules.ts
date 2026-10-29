// A04 (T-107): what an invitation link may look like. The worker mints 32 random bytes and emails them base64url
// encoded (docs/04, notify); anything else is not a token, and the page treats it as an invitation that no longer works.
export const isInviteToken = (token: string) => /^[A-Za-z0-9_-]{32,128}$/.test(token);

export const invitePath = (token: string) => `/invite/${encodeURIComponent(token)}`;

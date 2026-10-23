// docs/17 Correlation: a request_id is created at the web edge and carried to RPCs, job payloads, Sentry and logs.
export const REQUEST_ID_HEADER = "x-request-id";

const VALID = /^[A-Za-z0-9-]{8,64}$/;

// Keeps an upstream id only if it is a plain token, so a client cannot inject arbitrary text into logs and tags.
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
}

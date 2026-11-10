import { describe, expect, it } from "vitest";
import { buildSuppliers, requestState, type RequestRow } from "./requests";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const base: RequestRow = {
  id: "r1",
  supplierId: "s1",
  title: "Current premix specification",
  docType: "spec",
  createdAt: "2026-11-09T09:00:00Z",
  expiresAt: "2026-11-23T09:00:00Z",
  issued: true,
  consumedAt: null,
  fulfilledAt: null,
};
const at = (r: Partial<RequestRow>, o: { rejected?: boolean; emailFailed?: boolean } = {}) =>
  requestState({ ...base, ...r }, { rejected: false, emailFailed: false, now: NOW, ...o });

describe("supplier requests (H02, H03)", () => {
  it("[H02.main] a request reads sending, then awaiting upload once the email went out", () => {
    expect(at({ issued: false })).toBe("sending");
    expect(at({})).toBe("sent");
  });
  it("[H02.main] a failed email is a visible terminal state, never a silent wait", () => {
    expect(at({ issued: false }, { emailFailed: true })).toBe("email_failed");
  });
  it("[H03.main] an upload is scanning, then received once promoted", () => {
    expect(at({ consumedAt: "2026-11-10T10:00:00Z" })).toBe("scanning");
    expect(at({ consumedAt: "2026-11-10T10:00:00Z", fulfilledAt: "2026-11-10T10:01:00Z" })).toBe("received");
  });
  it("[H03.must.1] a rejected upload stays rejected and an unused link expires", () => {
    expect(at({ consumedAt: "2026-11-10T10:00:00Z" }, { rejected: true })).toBe("rejected");
    expect(at({ expiresAt: "2026-11-10T11:59:00Z" })).toBe("expired");
  });
  it("[H02.main] each supplier shows received against requested and its latest request", () => {
    const built = buildSuppliers({
      suppliers: [
        { id: "s2", name: "Peptico", email: null },
        { id: "s1", name: "Aldrich", email: "specs@aldrich.test" },
      ],
      requests: [
        { ...base, id: "old", createdAt: "2026-11-01T09:00:00Z", consumedAt: "2026-11-02T09:00:00Z", fulfilledAt: "2026-11-02T09:01:00Z" },
        { ...base, id: "new", title: "Certificate of analysis" },
      ],
      rejectedRequests: new Set(),
      failedEmails: new Set(),
      now: NOW,
    });
    expect(built.openRequests).toBe(1);
    expect(built.suppliers.map((s) => s.name)).toEqual(["Aldrich", "Peptico"]);
    expect(built.suppliers[0]).toMatchObject({ requested: 2, received: 1, latest: { title: "Certificate of analysis", state: "sent" } });
    expect(built.suppliers[1]).toMatchObject({ requested: 0, received: 0, latest: null });
  });
});

import { describe, expect, it } from "vitest";
import { invitePath, isInviteToken } from "./rules";

describe("invitation links (A04)", () => {
  it("accepts the worker's token_urlsafe(32) shape and nothing that could carry a path or a script", () => {
    expect(isInviteToken("Zk3_Qp9-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX")).toBe(true);
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isInviteToken("<script>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</script>")).toBe(false);
    expect(invitePath("Zk3_Qp9-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX")).toBe("/invite/Zk3_Qp9-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX");
  });
});

import { describe, expect, it } from "vitest";
import { constantTimeEqual, createSessionCookie, deriveCodeVerifier, hasValidSession } from "../../worker/src/security";

describe("AI access security", () => {
  it("derives stable salted verifiers", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    expect(await deriveCodeVerifier("4451", salt)).toBe(await deriveCodeVerifier("4451", salt));
    expect(await deriveCodeVerifier("4451", salt)).not.toBe(await deriveCodeVerifier("4452", salt));
  });

  it("compares without accepting unequal lengths", () => {
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "same-longer")).toBe(false);
  });

  it("signs and validates the trusted-device cookie", async () => {
    const value = await createSessionCookie("a-secret-long-enough-for-testing", "1");
    const request = new Request("https://potbelly.test/api", { headers: { cookie: value.split(";")[0] ?? "" } });
    expect(await hasValidSession(request, "a-secret-long-enough-for-testing", "1")).toBe(true);
    expect(await hasValidSession(request, "wrong-secret", "1")).toBe(false);
    expect(await hasValidSession(request, "a-secret-long-enough-for-testing", "2")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { privacyHash } from "../../worker/src/security";

describe("AI rate-limit privacy", () => {
  it("creates stable, scoped identifiers without exposing the source value", async () => {
    const secret = "a-secret-long-enough-for-testing";
    const dailyDevice = await privacyHash("device-id", secret, "device:2026-07-13");
    expect(dailyDevice).toBe(await privacyHash("device-id", secret, "device:2026-07-13"));
    expect(dailyDevice).not.toContain("device-id");
    expect(dailyDevice).not.toBe(await privacyHash("device-id", secret, "device:2026-07-14"));
  });
});

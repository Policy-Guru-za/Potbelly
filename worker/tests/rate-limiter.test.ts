import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const bindings = env;

describe("RateLimiter Durable Object", () => {
  it("counts and atomically enforces a limit", async () => {
    const stub = bindings.RATE_LIMITER.getByName(crypto.randomUUID());
    expect(await stub.count("session", 60_000)).toBe(0);
    expect(await stub.consume("session", 60_000, 2)).toBe(true);
    expect(await stub.consume("session", 60_000, 2)).toBe(true);
    expect(await stub.consume("session", 60_000, 2)).toBe(false);
    expect(await stub.count("session", 60_000)).toBe(2);
  });
});

describe("Worker boundary", () => {
  it("returns a no-store health response without exposing secrets", async () => {
    const result = await worker.fetch(new Request("https://potbelly.test/api/health"), bindings);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      ok: true,
      aiEnabled: false,
      model: "gpt-realtime-2.1-mini",
    });
  });

  it("reports public AI availability without an unlock state", async () => {
    const result = await worker.fetch(new Request("https://potbelly.test/api/ai/status"), bindings);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ aiEnabled: false });
  });

  it("does not expose the retired unlock endpoint", async () => {
    const result = await worker.fetch(new Request("https://potbelly.test/api/ai/unlock", { method: "POST" }), bindings);
    expect(result.status).toBe(404);
  });
});

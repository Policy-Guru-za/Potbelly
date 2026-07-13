const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error("BASE_URL is required");

const response = await fetch(new URL("/api/health", baseUrl), {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`AI health returned HTTP ${response.status}`);

const health = await response.json();
if (health?.ok !== true || health?.aiEnabled !== true || health?.model !== "gpt-realtime-2.1-mini") {
  throw new Error(`Unexpected AI health response: ${JSON.stringify(health)}`);
}

console.log(JSON.stringify({ ok: true, aiEnabled: true, model: health.model }));

import OpenAI from "openai";
import { z } from "zod";
import { buildInstructions, findRecipe, validIngredientIds, validStepIds } from "./recipes";
import { RateLimiter } from "./rate-limiter";
import { privacyHash } from "./security";

export { RateLimiter };

const realtimeSchema = z.object({
  recipeSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  anonymousDeviceId: z.uuid(),
  activeStepId: z.string().max(80).nullable(),
  checkedIngredientIds: z.array(z.string().max(80)).max(80),
  completedStepIds: z.array(z.string().max(80)).max(80),
}).strict();

function response(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(body, { status, headers });
}

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin));
}

function ipAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

function limiter(env: Env, identity: string): DurableObjectStub<RateLimiter> {
  return env.RATE_LIMITER.getByName(identity);
}

async function realtimeSession(request: Request, env: Env): Promise<Response> {
  if (!allowedOrigin(request, env)) return response({ error: "Request not accepted." }, 403);
  if (env.AI_ENABLED !== "true") return response({ error: "AI is unavailable." }, 503);
  const parsed = realtimeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Request not accepted." }, 400);
  const recipe = findRecipe(parsed.data.recipeSlug);
  if (!recipe) return response({ error: "Recipe not found." }, 404);
  const ingredientIds = validIngredientIds(recipe);
  const stepIds = validStepIds(recipe);
  if (parsed.data.checkedIngredientIds.some((id) => !ingredientIds.has(id)) ||
      parsed.data.completedStepIds.some((id) => !stepIds.has(id)) ||
      (parsed.data.activeStepId !== null && !stepIds.has(parsed.data.activeStepId))) {
    return response({ error: "Recipe state is invalid." }, 400);
  }

  const day = new Date().toISOString().slice(0, 10);
  const deviceKey = await privacyHash(parsed.data.anonymousDeviceId, env.AI_RATE_LIMIT_HASH_SECRET, `device:${day}`);
  const ipKey = await privacyHash(ipAddress(request), env.AI_RATE_LIMIT_HASH_SECRET, `ip:${day}`);
  const deviceAllowed = await limiter(env, deviceKey).consume("realtime-session", 86_400_000, 6);
  const ipAllowed = await limiter(env, ipKey).consume("realtime-session", 86_400_000, 20);
  if (!deviceAllowed || !ipAllowed) return response({ error: "Daily AI allowance reached." }, 429);

  const instructions = buildInstructions(recipe, parsed.data.activeStepId);
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1, timeout: 15_000 });
  const secret = await client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "realtime",
      model: env.OPENAI_REALTIME_MODEL,
      instructions,
      output_modalities: ["audio"],
      max_output_tokens: 900,
      tracing: null,
      audio: {
        input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", create_response: true, interrupt_response: true, eagerness: "auto" } },
        output: { voice: env.OPENAI_REALTIME_VOICE, speed: 1 },
      },
    },
  }, { headers: { "OpenAI-Safety-Identifier": deviceKey } });
  return response({
    clientSecret: secret.value,
    expiresAt: secret.expires_at,
    model: env.OPENAI_REALTIME_MODEL,
    voice: env.OPENAI_REALTIME_VOICE,
    promptVersion: "1",
    instructions,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const url = new URL(request.url);
    let result: Response;
    try {
      if (url.pathname === "/api/health" && request.method === "GET") result = response({ ok: true, aiEnabled: env.AI_ENABLED === "true", model: env.OPENAI_REALTIME_MODEL });
      else if (url.pathname === "/api/ai/status" && request.method === "GET") result = response({ aiEnabled: env.AI_ENABLED === "true" });
      else if (url.pathname === "/api/ai/realtime-session" && request.method === "POST") result = await realtimeSession(request, env);
      else result = response({ error: "Not found." }, 404);
    } catch {
      result = response({ error: "Service temporarily unavailable." }, 503);
    }
    console.log(JSON.stringify({ requestId, path: url.pathname, method: request.method, status: result.status, latencyMs: Date.now() - started }));
    return result;
  },
} satisfies ExportedHandler<Env>;

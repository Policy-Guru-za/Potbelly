import type { RateLimiter } from "./rate-limiter";

export interface Env {
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  OPENAI_API_KEY: string;
  OPENAI_REALTIME_MODEL: string;
  OPENAI_REALTIME_VOICE: string;
  AI_ACCESS_CODE_VERIFIER: string;
  AI_ACCESS_CODE_SALT: string;
  AI_SESSION_HMAC_SECRET: string;
  AI_RATE_LIMIT_HASH_SECRET: string;
  AI_ACCESS_VERSION: string;
  AI_ENABLED: string;
}

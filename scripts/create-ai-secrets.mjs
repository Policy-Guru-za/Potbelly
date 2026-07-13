import { pbkdf2Sync, randomBytes } from "node:crypto";

const codeIndex = process.argv.indexOf("--code");
const code = codeIndex >= 0 ? process.argv[codeIndex + 1] : undefined;
if (!code || code.length < 4 || code.length > 32) {
  throw new Error("Usage: pnpm ai:secrets --code \"shared-code\" (4–32 characters)");
}

const salt = randomBytes(16);
const verifier = pbkdf2Sync(code, salt, 210_000, 32, "sha256");
console.log(`AI_ACCESS_CODE_SALT=${salt.toString("hex")}`);
console.log(`AI_ACCESS_CODE_VERIFIER=${verifier.toString("hex")}`);
console.log(`AI_SESSION_HMAC_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`AI_RATE_LIMIT_HASH_SECRET=${randomBytes(32).toString("hex")}`);

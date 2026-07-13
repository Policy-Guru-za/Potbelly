const encoder = new TextEncoder();
const COOKIE_NAME = "__Host-potbelly_ai";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function deriveCodeVerifier(code: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
  const material = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

export async function verifyAccessCode(code: string, salt: string, verifier: string): Promise<boolean> {
  return constantTimeEqual(await deriveCodeVerifier(code, salt), verifier.toLocaleLowerCase("en"));
}

export async function createSessionCookie(secret: string, version: string): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + 30 * 24 * 60 * 60 * 1000, version })));
  const signature = base64Url(await hmac(payload, secret));
  return `${COOKIE_NAME}=${payload}.${signature}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export async function hasValidSession(request: Request, secret: string, version: string): Promise<boolean> {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  const token = cookie?.slice(COOKIE_NAME.length + 1);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantTimeEqual(base64Url(await hmac(payload, secret)), signature)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { exp?: number; version?: string };
    return typeof data.exp === "number" && data.exp > Date.now() && data.version === version;
  } catch {
    return false;
  }
}

export async function privacyHash(value: string, secret: string, scope: string): Promise<string> {
  return base64Url(await hmac(`${scope}:${value}`, secret));
}

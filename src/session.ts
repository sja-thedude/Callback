import type { Env } from "./env";

const COOKIE = "cb_session";
const MAX_AGE = 60 * 60 * 24 * 30;

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function createSession(env: Env, channelId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${channelId}.${exp}`;
  const value = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearSession(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getSession(env: Env, req: Request): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [channelId, exp, sig] = raw.split(".");
  if (!channelId || !exp || !sig) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  const expected = await hmac(env.SESSION_SECRET, `${channelId}.${exp}`);
  return timingSafeEqual(sig, expected) ? channelId : null;
}

export { hmac };

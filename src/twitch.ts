import type { Env } from "./env";

const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";

export const USER_SCOPES = ["user:write:chat", "user:read:chat"];

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface HelixClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
}

export class TwitchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let appToken: TokenSet | null = null;

export function twitchConfigured(env: Env): boolean {
  return Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

async function getAppToken(env: Env): Promise<string> {
  if (appToken && appToken.expires_at > Date.now() + 60_000) return appToken.access_token;
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new TwitchError(res.status, "Could not get an app token from Twitch.");
  const body = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 };
  return appToken.access_token;
}

/**
 * Calls Helix, honouring Ratelimit-Remaining / Ratelimit-Reset and retrying on 429.
 * Pass a user token to act as the broadcaster; otherwise an app token is used.
 */
export async function helix<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; userToken?: string } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = init.userToken ?? (await getAppToken(env));
    const res = await fetch(`${HELIX}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "client-id": env.TWITCH_CLIENT_ID,
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (res.status === 429) {
      const reset = Number(res.headers.get("ratelimit-reset") ?? 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 500), 15_000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 && !init.userToken && attempt === 0) {
      appToken = null;
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new TwitchError(res.status, text.slice(0, 300) || res.statusText);
    }

    // Back off gently when the bucket is nearly empty, before Twitch has to tell us.
    const remaining = Number(res.headers.get("ratelimit-remaining") ?? 100);
    if (remaining < 5) {
      const reset = Number(res.headers.get("ratelimit-reset") ?? 0) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(reset - Date.now(), 0), 10_000)));
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  throw new TwitchError(429, "Twitch kept rate limiting the request.");
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: USER_SCOPES.join(" "),
    state,
    force_verify: "true",
  });
  return `${OAUTH}/authorize?${params}`;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) throw new TwitchError(res.status, "Twitch rejected the sign-in.");
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };
}

export function exchangeCode(env: Env, code: string, redirectUri: string) {
  return tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: redirectUri });
}

export function refreshToken(env: Env, refresh: string) {
  return tokenRequest(env, { refresh_token: refresh, grant_type: "refresh_token" });
}

import type { Env } from "./env";
import { clearSession, createSession, getSession, hmac, readCookie } from "./session";
import { authorizeUrl, exchangeCode, helix, twitchConfigured, TwitchError } from "./twitch";
import { clipText, clipTokens, embedPassages, embedQuery, rank, writeReason, type IndexedClip, type MatchQuery } from "./retrieval";
import type { Profile } from "./channel";

export { Channel } from "./channel";

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const fail = (status: number, error: string) => json({ error }, status);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/auth/")) return await auth(req, env, url);
      if (url.pathname.startsWith("/api/demo/")) return await demo(req, env, url, ctx);
      if (url.pathname === "/api/overlay/ws") return await overlaySocket(req, env, url);
      if (url.pathname.startsWith("/api/")) return await api(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (err instanceof TwitchError) {
        const msg =
          err.status === 401
            ? "Twitch says the sign-in expired. Connect your account again."
            : err.status === 429
              ? "Twitch is rate limiting us. Give it a minute and try again."
              : "Twitch returned an error. Try again in a moment.";
        return fail(502, msg);
      }
      console.error(err);
      return fail(500, err instanceof Error ? err.message : "Something went wrong on our side.");
    }
  },
} satisfies ExportedHandler<Env>;

// ---------- auth ----------

async function auth(req: Request, env: Env, url: URL): Promise<Response> {
  const redirectUri = `${url.origin}/auth/callback`;

  if (url.pathname === "/auth/login") {
    if (!twitchConfigured(env) || !env.SESSION_SECRET) {
      return Response.redirect(`${url.origin}/panel?error=not_configured`, 302);
    }
    const nonce = crypto.randomUUID();
    const state = `${nonce}.${await hmac(env.SESSION_SECRET, nonce)}`;
    return new Response(null, {
      status: 302,
      headers: {
        location: authorizeUrl(env, redirectUri, state),
        "set-cookie": `cb_state=${nonce}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    });
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const [nonce, sig] = state.split(".");
    const cookieNonce = readCookie(req, "cb_state");
    if (url.searchParams.get("error")) return Response.redirect(`${url.origin}/panel?error=denied`, 302);
    if (!code || !nonce || nonce !== cookieNonce || sig !== (await hmac(env.SESSION_SECRET, nonce))) {
      return Response.redirect(`${url.origin}/panel?error=state`, 302);
    }
    const tokens = await exchangeCode(env, code, redirectUri);
    const me = await helix<{ data: Profile[] }>(env, "/users", { userToken: tokens.access_token });
    const profile = me.data[0];
    await env.CHANNEL.get(env.CHANNEL.idFromName(profile.id)).link(
      { id: profile.id, login: profile.login, display_name: profile.display_name, profile_image_url: profile.profile_image_url },
      tokens,
    );
    const headers = new Headers({ location: `${url.origin}/panel` });
    headers.append("set-cookie", await createSession(env, profile.id));
    headers.append("set-cookie", "cb_state=; Path=/auth; Max-Age=0");
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/auth/logout" && req.method === "POST") {
    const id = await getSession(env, req);
    if (id) await env.CHANNEL.get(env.CHANNEL.idFromName(id)).disconnect();
    return json({ ok: true }, 200, { "set-cookie": clearSession() });
  }

  return fail(404, "Not found");
}

// ---------- signed-in API ----------

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/config") {
    return json({ twitchConfigured: twitchConfigured(env) && Boolean(env.SESSION_SECRET) });
  }

  const id = await getSession(env, req);
  if (!id) return fail(401, "You're not signed in. Connect your Twitch account first.");
  const channel = env.CHANNEL.get(env.CHANNEL.idFromName(id));
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};

  switch (url.pathname) {
    case "/api/me":
      return json({ ...((await channel.state()) as object), overlays: await channel.overlayCount() });
    case "/api/clips":
      return json(await channel.listClips());
    case "/api/channel":
      return json(await channel.channelInfo());
    case "/api/settings":
      return json(await channel.saveSettings(body));
    case "/api/index":
      return json(await channel.startIndex());
    case "/api/match": {
      const q = parseQuery(body);
      if (!q) return fail(400, "Nothing to match yet.");
      const qvec = await embedQuery(env, q.text);
      const candidates = await channel.search([...qvec], q);
      return json(await withReason(env, candidates, q, Number(body.threshold ?? 0.72)));
    }
    case "/api/fire": {
      const clip = await channel.clipById(String(body.clipId ?? ""));
      if (!clip) return fail(404, "That clip isn't in your index.");
      return json(
        await channel.fire({
          clip,
          reason: String(body.reason ?? "").slice(0, 160),
          confidence: Number(body.confidence ?? 0),
          manual: Boolean(body.manual),
        }),
      );
    }
    case "/api/test-overlay":
      await channel.test();
      return json({ ok: true, overlays: await channel.overlayCount() });
  }
  return fail(404, "Not found");
}

function parseQuery(body: Record<string, any>): MatchQuery | null {
  const text = String(body.text ?? "").slice(0, 1200).trim();
  if (!text) return null;
  return {
    text,
    phrases: Array.isArray(body.phrases) ? body.phrases.slice(0, 6).map((p: unknown) => String(p).slice(0, 80)) : [],
    game: body.game ? String(body.game).slice(0, 80) : undefined,
    trigger: String(body.trigger ?? "velocity").slice(0, 20),
  };
}

async function withReason(env: Env, candidates: ReturnType<typeof rank>, q: MatchQuery, threshold: number) {
  const top = candidates[0];
  const reason = top && top.confidence >= threshold ? await writeReason(env, top, q) : null;
  return { candidates, reason };
}

async function overlaySocket(req: Request, env: Env, url: URL): Promise<Response> {
  const c = url.searchParams.get("c");
  if (!c || !/^\d+$/.test(c)) return fail(400, "Overlay link is missing its channel.");
  const stub = env.CHANNEL.get(env.CHANNEL.idFromName(c));
  return stub.fetch(req);
}

// ---------- demo (no account needed) ----------

let demoClips: IndexedClip[] | null = null;

async function loadDemoClips(env: Env, origin: string): Promise<IndexedClip[]> {
  if (demoClips) return demoClips;
  const res = await env.ASSETS.fetch(new Request(`${origin}/demo/clips.json`));
  const lib = (await res.json()) as { clips: Omit<IndexedClip, "vec" | "tokens">[] };

  const key = new Request(`https://cache.callback/demo-vectors/${lib.clips.length}-${lib.clips[0]?.id}-v2`);
  const hit = await caches.default.match(key);
  let vectors: Float32Array[];
  if (hit) {
    const flat = new Float32Array(await hit.arrayBuffer());
    const dim = flat.length / lib.clips.length;
    vectors = lib.clips.map((_, i) => flat.subarray(i * dim, (i + 1) * dim));
  } else {
    vectors = await embedPassages(env, lib.clips.map(clipText));
    const flat = new Float32Array(vectors.length * vectors[0].length);
    vectors.forEach((v, i) => flat.set(v, i * v.length));
    await caches.default.put(key, new Response(flat.buffer as ArrayBuffer, { headers: { "cache-control": "max-age=2592000" } }));
  }
  demoClips = lib.clips.map((c, i) => ({ ...c, vec: vectors[i], tokens: clipTokens(c) }));
  return demoClips;
}

async function demo(req: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (url.pathname === "/api/demo/match" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const q = parseQuery(body);
    if (!q) return fail(400, "Nothing to match yet.");
    const [clips, qvec] = await Promise.all([loadDemoClips(env, url.origin), embedQuery(env, q.text)]);
    return json(await withReason(env, rank(clips, qvec, q), q, Number(body.threshold ?? 0.72)));
  }
  if (url.pathname === "/api/demo/warm") {
    ctx.waitUntil(loadDemoClips(env, url.origin).then(() => undefined));
    return json({ ok: true });
  }
  return fail(404, "Not found");
}

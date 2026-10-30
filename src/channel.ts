import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { helix, refreshToken, type HelixClip, type TokenSet } from "./twitch";
import { clipText, clipTokens, embedPassages, rank, type IndexedClip, type MatchQuery } from "./retrieval";

export interface Profile {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface Settings {
  threshold: number;
  cooldownSec: number;
  chatBot: boolean;
  triggers: { velocity: boolean; phrase: boolean; events: boolean };
}

export interface IndexStatus {
  state: "idle" | "running" | "done" | "error";
  phase: string;
  fetched: number;
  embedded: number;
  windowIndex: number;
  windowCount: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

interface IndexJob {
  windows: [string, string][];
  windowIndex: number;
  cursor?: string;
  pagesInWindow: number;
}

const DEFAULT_SETTINGS: Settings = {
  threshold: 0.72,
  cooldownSec: 240,
  chatBot: true,
  triggers: { velocity: true, phrase: true, events: true },
};

const MAX_CLIPS = 1500;
const PAGES_PER_WINDOW = 3;

export class Channel extends DurableObject<Env> {
  private sql: SqlStorage;
  private clipCache: IndexedClip[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, meta TEXT, vec BLOB)`);
  }

  private get<T>(k: string): T | null {
    const row = this.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : null;
  }

  private put(k: string, v: unknown) {
    this.sql.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)`, k, JSON.stringify(v));
  }

  // ---------- account ----------

  async link(profile: Profile, tokens: TokenSet): Promise<void> {
    this.put("profile", profile);
    this.put("tokens", tokens);
    if (!this.get("overlayKey")) this.put("overlayKey", crypto.randomUUID().replace(/-/g, ""));
  }

  async disconnect(): Promise<void> {
    this.sql.exec(`DELETE FROM kv WHERE k = 'tokens'`);
  }

  async state() {
    const clipCount = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM clips`).one().n;
    return {
      profile: this.get<Profile>("profile"),
      settings: { ...DEFAULT_SETTINGS, ...(this.get<Settings>("settings") ?? {}) },
      overlayKey: this.get<string>("overlayKey"),
      index: this.get<IndexStatus>("indexStatus") ?? { state: "idle", phase: "", fetched: 0, embedded: 0, windowIndex: 0, windowCount: 0 },
      clipCount,
      history: this.get<unknown[]>("history") ?? [],
    };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = { ...DEFAULT_SETTINGS, ...(this.get<Settings>("settings") ?? {}) };
    const next: Settings = {
      threshold: clamp(Number(patch.threshold ?? current.threshold), 0.5, 0.95),
      cooldownSec: clamp(Math.round(Number(patch.cooldownSec ?? current.cooldownSec)), 30, 1800),
      chatBot: Boolean(patch.chatBot ?? current.chatBot),
      triggers: { ...current.triggers, ...(patch.triggers ?? {}) },
    };
    this.put("settings", next);
    return next;
  }

  private async userToken(): Promise<string> {
    const tokens = this.get<TokenSet>("tokens");
    if (!tokens) throw new Error("Twitch is not connected.");
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    if (!tokens.refresh_token) throw new Error("Twitch sign-in expired. Connect again.");
    const fresh = await refreshToken(this.env, tokens.refresh_token);
    this.put("tokens", fresh);
    return fresh.access_token;
  }

  async channelInfo(): Promise<{ game: string; title: string } | null> {
    const profile = this.get<Profile>("profile");
    if (!profile) return null;
    const res = await helix<{ data: { game_name: string; title: string }[] }>(
      this.env,
      `/channels?broadcaster_id=${profile.id}`,
    );
    const ch = res.data[0];
    return ch ? { game: ch.game_name, title: ch.title } : null;
  }

  // ---------- indexing ----------

  async startIndex(): Promise<IndexStatus> {
    const profile = this.get<Profile>("profile");
    if (!profile) throw new Error("Connect Twitch before indexing.");
    const current = this.get<IndexStatus>("indexStatus");
    if (current?.state === "running") return current;

    // Helix returns the most-viewed clips per date range, so walk back in half-year windows
    // to cover the channel's whole history rather than just the all-time top 1000.
    const windows: [string, string][] = [];
    let end = new Date();
    for (let i = 0; i < 12; i++) {
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      windows.push([start.toISOString(), end.toISOString()]);
      end = start;
    }
    this.sql.exec(`DELETE FROM clips`);
    this.clipCache = null;
    this.put("indexJob", { windows, windowIndex: 0, pagesInWindow: 0 } satisfies IndexJob);
    const status: IndexStatus = {
      state: "running",
      phase: "Asking Twitch for your clips",
      fetched: 0,
      embedded: 0,
      windowIndex: 0,
      windowCount: windows.length,
      startedAt: Date.now(),
    };
    this.put("indexStatus", status);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return status;
  }

  async alarm(): Promise<void> {
    const job = this.get<IndexJob>("indexJob");
    const status = this.get<IndexStatus>("indexStatus");
    const profile = this.get<Profile>("profile");
    if (!job || !status || status.state !== "running" || !profile) return;

    try {
      const [from, to] = job.windows[job.windowIndex];
      const params = new URLSearchParams({ broadcaster_id: profile.id, first: "100", started_at: from, ended_at: to });
      if (job.cursor) params.set("after", job.cursor);
      status.phase = `Fetching clips from ${monthYear(from)} to ${monthYear(to)}`;
      this.put("indexStatus", status);

      const page = await helix<{ data: HelixClip[]; pagination: { cursor?: string } }>(this.env, `/clips?${params}`);
      const fresh = page.data.filter(
        (c) => this.sql.exec(`SELECT 1 FROM clips WHERE id = ?`, c.id).toArray().length === 0,
      );
      status.fetched += fresh.length;

      if (fresh.length) {
        const gameIds = [...new Set(fresh.map((c) => c.game_id).filter(Boolean))];
        const games = new Map<string, string>();
        if (gameIds.length) {
          const g = await helix<{ data: { id: string; name: string }[] }>(
            this.env,
            `/games?${gameIds.map((id) => `id=${id}`).join("&")}`,
          );
          for (const row of g.data) games.set(row.id, row.name);
        }
        status.phase = `Embedding ${fresh.length} clips`;
        this.put("indexStatus", status);

        const metas = fresh.map((c) => ({
          id: c.id,
          title: c.title,
          game: games.get(c.game_id) ?? "",
          created_at: c.created_at,
          view_count: c.view_count,
          duration: c.duration,
          url: c.url,
          thumbnail: c.thumbnail_url,
          creator: c.creator_name,
          embeddable: true,
        }));
        const vecs = await embedPassages(this.env, metas.map(clipText));
        metas.forEach((m, i) => {
          this.sql.exec(
            `INSERT OR REPLACE INTO clips (id, meta, vec) VALUES (?, ?, ?)`,
            m.id,
            JSON.stringify(m),
            vecs[i].buffer as ArrayBuffer,
          );
        });
        status.embedded += metas.length;
      }

      job.pagesInWindow += 1;
      const total = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM clips`).one().n;
      if (page.pagination.cursor && job.pagesInWindow < PAGES_PER_WINDOW && total < MAX_CLIPS) {
        job.cursor = page.pagination.cursor;
      } else {
        job.windowIndex += 1;
        job.cursor = undefined;
        job.pagesInWindow = 0;
      }
      status.windowIndex = job.windowIndex;

      if (job.windowIndex >= job.windows.length || total >= MAX_CLIPS) {
        status.state = "done";
        status.phase = `Indexed ${total} clips`;
        status.finishedAt = Date.now();
        this.clipCache = null;
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 200);
      }
      this.put("indexJob", job);
      this.put("indexStatus", status);
    } catch (err) {
      status.state = "error";
      status.error = err instanceof Error ? err.message : "Indexing stopped unexpectedly.";
      status.phase = "Indexing stopped";
      this.put("indexStatus", status);
    }
  }

  // ---------- retrieval ----------

  private clips(): IndexedClip[] {
    if (this.clipCache) return this.clipCache;
    const rows = this.sql.exec<{ meta: string; vec: ArrayBuffer }>(`SELECT meta, vec FROM clips`).toArray();
    this.clipCache = rows.map((r) => {
      const meta = JSON.parse(r.meta) as Omit<IndexedClip, "vec" | "tokens">;
      return { ...meta, vec: new Float32Array(r.vec), tokens: clipTokens(meta) };
    });
    return this.clipCache;
  }

  async search(qvec: number[], q: MatchQuery) {
    // The live product only ever searches clips this channel indexed itself.
    return rank(this.clips(), Float32Array.from(qvec), q);
  }

  async listClips(limit = 120) {
    return this.clips()
      .map(({ vec: _v, tokens: _t, ...clip }) => clip)
      .sort((a, b) => b.view_count - a.view_count)
      .slice(0, limit);
  }

  async clipById(id: string) {
    const c = this.clips().find((x) => x.id === id);
    if (!c) return null;
    const { vec: _v, tokens: _t, ...clip } = c;
    return clip;
  }

  // ---------- firing ----------

  async fire(payload: { clip: object; reason: string; confidence: number; manual: boolean }) {
    const settings = { ...DEFAULT_SETTINGS, ...(this.get<Settings>("settings") ?? {}) };
    const last = this.get<number>("lastFired") ?? 0;
    const since = (Date.now() - last) / 1000;
    if (!payload.manual && since < settings.cooldownSec) {
      return { ok: false, error: `Cooling down. Next callback allowed in ${Math.ceil(settings.cooldownSec - since)}s.` };
    }
    this.put("lastFired", Date.now());
    const event = { type: "callback", at: Date.now(), ...payload };
    this.broadcast(event);

    const history = this.get<unknown[]>("history") ?? [];
    history.unshift({ at: event.at, clip: payload.clip, reason: payload.reason, confidence: payload.confidence, manual: payload.manual });
    this.put("history", history.slice(0, 30));

    let chat: string | null = null;
    if (settings.chatBot) {
      chat = await this.postChat(payload.clip as { title: string; url: string; created_at: string }, payload.reason).catch(
        (e: Error) => `Chat post failed: ${e.message}`,
      );
    }
    return { ok: true, chat };
  }

  private async postChat(clip: { title: string; url: string; created_at: string }, reason: string): Promise<string> {
    const profile = this.get<Profile>("profile");
    if (!profile) throw new Error("not connected");
    const date = new Date(clip.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const message = `CALLBACK ⏪ ${reason} "${clip.title}" (${date}) ${clip.url}`.slice(0, 495);
    await helix(this.env, "/chat/messages", {
      method: "POST",
      userToken: await this.userToken(),
      body: { broadcaster_id: profile.id, sender_id: profile.id, message },
    });
    return "Posted in chat";
  }

  // ---------- overlay sockets (hibernatable) ----------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.searchParams.get("k") !== this.get<string>("overlayKey")) {
      return new Response("Overlay link is not valid. Copy it again from the control panel.", { status: 403 });
    }
    if (req.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ type: "hello", at: Date.now() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === "ping") ws.send("pong");
  }

  async overlayCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  async test(): Promise<void> {
    this.broadcast({ type: "test", at: Date.now() });
  }

  private broadcast(event: unknown) {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket already gone
      }
    }
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

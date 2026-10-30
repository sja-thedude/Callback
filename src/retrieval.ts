import type { Env } from "./env";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const REASON_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export interface IndexedClip {
  id: string;
  title: string;
  game: string;
  created_at: string;
  view_count: number;
  duration: number;
  url: string;
  thumbnail: string;
  creator: string;
  context?: string;
  embeddable: boolean;
  vec: Float32Array;
  tokens: string[];
}

export interface MatchQuery {
  text: string;
  phrases: string[];
  game?: string;
  trigger: string;
}

export interface Candidate {
  clip: Omit<IndexedClip, "vec" | "tokens">;
  confidence: number;
  semantic: number;
  lexical: number;
  gameMatch: boolean;
  margin: number;
  matchedTerms: string[];
}

const STOP = new Set(
  "a an the and or but if then so to of in on at for with from by is are was were be been am i im i'm you u ur your he she it its we they them this that these those me my our us do does did doing not no yes yeah lol lmao lmfao omg wtf what why how who when where just like really very too can cant can't dont don't will would should could get got go going gonna wanna oh ok okay pls please here there now again same one all any some more most much his her their than as also into out up down off over still even".split(
    " ",
  ),
);

/** Lowercase, strip punctuation, drop stopwords and very short tokens, light stemming. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/'/g, ""))
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Keyword side of a clip: what it says, not which game it's in. */
export function clipTokens(c: { title: string; context?: string }): string[] {
  return tokenize(`${c.title} ${c.context ?? ""}`);
}

export function clipText(c: { title: string; game: string; context?: string; creator?: string }): string {
  return [c.title, c.game ? `Game: ${c.game}.` : "", c.context ?? ""].filter(Boolean).join(" ");
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalize(v: number[]): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/** Embeds passages in batches of 50. Vectors come back unit-normalised. */
export async function embedPassages(env: Env, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const res = (await env.AI.run(EMBED_MODEL, { text: batch })) as { data: number[][] };
    out.push(...res.data.map(normalize));
  }
  return out;
}

/** Embeds a search query, cached by content hash so replayed demo windows cost nothing. */
export async function embedQuery(env: Env, text: string): Promise<Float32Array> {
  const key = new Request(`https://cache.callback/embed/${await sha(text)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return new Float32Array(await hit.arrayBuffer());
  const res = (await env.AI.run(EMBED_MODEL, { text: [QUERY_PREFIX + text] })) as { data: number[][] };
  const vec = normalize(res.data[0]);
  await cache.put(key, new Response(vec.buffer as ArrayBuffer, { headers: { "cache-control": "max-age=604800" } }));
  return vec;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Hybrid scoring. A callback fires on stream, so precision matters more than recall:
 * a clip needs semantic similarity AND corroboration (shared distinctive terms, same game)
 * AND a clear lead over the runner-up before its confidence gets high.
 */
export function rank(clips: IndexedClip[], qvec: Float32Array, q: MatchQuery, k = 5): Candidate[] {
  if (!clips.length) return [];
  const df = new Map<string, number>();
  for (const c of clips) for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + clips.length / (1 + (df.get(t) ?? 0)));

  // The game is scored on its own, so keep its name out of the keyword overlap.
  const gameTokens = new Set(tokenize(q.game ?? ""));
  const qTokens = [...new Set(tokenize(`${q.phrases.join(" ")} ${q.text}`))].filter((t) => !gameTokens.has(t));
  const phraseTokens = new Set(tokenize(q.phrases.join(" ")));

  const scored = clips.map((c) => {
    const semantic = dot(qvec, c.vec);
    const clipTokens = new Set(c.tokens);
    const matched = qTokens.filter((t) => clipTokens.has(t));
    let weight = 0;
    for (const t of matched) weight += idf(t) * (phraseTokens.has(t) ? 1.5 : 1);
    const lexical = weight / (weight + 3);
    const gameMatch = Boolean(q.game && c.game && q.game.toLowerCase() === c.game.toLowerCase());
    return { c, semantic, lexical, gameMatch, matched };
  });
  scored.sort((a, b) => b.semantic + b.lexical * 0.2 - (a.semantic + a.lexical * 0.2));

  return scored.slice(0, k).map((s) => {
    // Lead over the best *other* clip. A real callback stands clearly apart from the pack;
    // a vague window scores everything about the same.
    let rival = -1;
    for (const o of scored) if (o !== s && o.semantic > rival) rival = o.semantic;
    const margin = s.semantic - rival;
    const marginN = Math.min(1, Math.max(0, margin / 0.08));
    // bge-base cosine between unrelated short texts sits around 0.6; close paraphrase passes 0.8.
    const semN = Math.min(1, Math.max(0, (s.semantic - 0.6) / 0.2));
    let confidence = 0.5 * semN + 0.25 * s.lexical + 0.25 * marginN + (s.gameMatch ? 0.05 : 0);
    if (s.lexical === 0) confidence *= 0.75;
    const { vec: _v, tokens: _t, ...clip } = s.c;
    return {
      clip,
      confidence: Math.round(Math.min(0.99, confidence) * 1000) / 1000,
      semantic: Math.round(s.semantic * 1000) / 1000,
      lexical: Math.round(s.lexical * 1000) / 1000,
      gameMatch: s.gameMatch,
      margin: Math.round(margin * 1000) / 1000,
      matchedTerms: s.matched.slice(0, 6),
    };
  });
}

function ago(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 45) return `${days} days ago`;
  if (days < 700) return `${Math.round(days / 30.4)} months ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function templateReason(c: Candidate, q: MatchQuery): string {
  const when = ago(c.clip.created_at);
  const phrase = q.phrases[0];
  if (q.trigger === "raid") return `A raid just landed. ${when}, this happened.`;
  if (q.trigger === "category") return `Back on ${c.clip.game}. Last time, ${when}, it went like this.`;
  if (phrase) return `Chat is saying "${phrase}" again. The last time was ${when}.`;
  if (c.matchedTerms.length) return `Chat keeps saying "${c.matchedTerms[0]}". It happened before, ${when}.`;
  return `This has happened before, ${when}.`;
}

/** Models sometimes wrap the line in quotes, add a label, or trail off; anything odd falls back to the template. */
export function cleanReason(raw?: string): string | null {
  if (!raw) return null;
  let line = raw.trim().split("\n")[0].trim();
  line = line.replace(/^(caption|line|overlay)\s*:\s*/i, "");
  line = line.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if ((line.match(/["“”]/g) ?? []).length % 2 === 1) return null;
  if (/#|\p{Extended_Pictographic}|end of line/iu.test(line)) return null;
  if (line.length < 12 || line.length > 110 || line.split(/\s+/).length > 18) return null;
  if (!/[.!?…]$/.test(line)) line += ".";
  return line;
}

/** One witty line connecting now to then. Falls back to a template if the model is slow or odd. */
export async function writeReason(env: Env, c: Candidate, q: MatchQuery): Promise<string> {
  const fallback = templateReason(c, q);
  try {
    const messages = [
      {
        role: "system",
        content:
          "You write a single caption line for a Twitch stream overlay. It connects what chat is saying right now to an old clip from the same channel. One sentence, at most 14 words, playful and warm, never mean. Plain text only: no quotes, hashtags, emojis or labels. Reply with the caption and nothing else.",
      },
      {
        role: "user",
        content: `Chat right now: ${q.phrases.slice(0, 3).join(" | ") || q.text.slice(0, 160)}\nOld clip: ${c.clip.title}\nWhen: ${ago(c.clip.created_at)}`,
      },
    ];
    const race = await Promise.race([
      env.AI.run(REASON_MODEL, { messages, max_tokens: 40, temperature: 0.6 }) as Promise<{ response?: string }>,
      new Promise<null>((r) => setTimeout(() => r(null), 2500)),
    ]);
    return cleanReason(race?.response) ?? fallback;
  } catch {
    return fallback;
  }
}

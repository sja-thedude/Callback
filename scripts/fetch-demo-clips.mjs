// Replaces the demo library with a real channel's public clips via Helix.
//   TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=... node scripts/fetch-demo-clips.mjs <login> [maxClips]
// Writes public/demo/clips.json. The demo chat log (public/demo/chat.json) is written against
// the library, so re-author its scenes in scripts/build-sample.mjs to rhyme with the new clips.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [login, max = "300"] = process.argv.slice(2);
const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
if (!login || !id || !secret) {
  console.error("Usage: TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… node scripts/fetch-demo-clips.mjs <login> [maxClips]");
  process.exit(1);
}

const tok = await fetch("https://id.twitch.tv/oauth2/token", {
  method: "POST",
  body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
}).then((r) => r.json());

async function helix(path) {
  for (;;) {
    const res = await fetch(`https://api.twitch.tv/helix${path}`, {
      headers: { "client-id": id, authorization: `Bearer ${tok.access_token}` },
    });
    if (res.status === 429) {
      const reset = Number(res.headers.get("ratelimit-reset")) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(reset - Date.now(), 1000)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
}

const user = (await helix(`/users?login=${encodeURIComponent(login)}`)).data[0];
if (!user) throw new Error(`No Twitch user called ${login}`);

const clips = [];
let end = new Date();
for (let w = 0; w < 12 && clips.length < Number(max); w++) {
  const start = new Date(end);
  start.setMonth(start.getMonth() - 6);
  const page = await helix(`/clips?broadcaster_id=${user.id}&first=50&started_at=${start.toISOString()}&ended_at=${end.toISOString()}`);
  clips.push(...page.data);
  end = start;
}

const gameIds = [...new Set(clips.map((c) => c.game_id).filter(Boolean))];
const games = new Map();
for (let i = 0; i < gameIds.length; i += 100) {
  const g = await helix(`/games?${gameIds.slice(i, i + 100).map((x) => `id=${x}`).join("&")}`);
  for (const row of g.data) games.set(row.id, row.name);
}

const out = {
  channel: { login: user.login, display_name: user.display_name, fictional: false },
  clips: [...new Map(clips.map((c) => [c.id, c])).values()].slice(0, Number(max)).map((c) => ({
    id: c.id,
    title: c.title,
    game: games.get(c.game_id) ?? "",
    created_at: c.created_at,
    view_count: c.view_count,
    duration: c.duration,
    url: c.url,
    thumbnail: c.thumbnail_url,
    creator: c.creator_name,
    context: "",
    embeddable: true,
  })),
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo", "clips.json");
writeFileSync(target, JSON.stringify(out, null, 1));
console.log(`Wrote ${out.clips.length} clips from ${user.display_name} to ${target}`);

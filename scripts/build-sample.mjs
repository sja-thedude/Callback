// Builds the fictional sample channel used by demo mode:
//   public/demo/clips.json   the clip library (Helix-shaped)
//   public/demo/chat.json    a replayable chat log with channel events
//   public/img/clips/*.svg   self-made thumbnails
// Deterministic: the same seed always produces the same files.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => join(root, "public", p);
mkdirSync(out("demo"), { recursive: true });
mkdirSync(out("img/clips"), { recursive: true });

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261102);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);

// ---------- clip library ----------

const CLIPS = [
  // the ones the demo chat will rhyme with
  ["warden-nine", "The Lantern Warden ends the run AGAIN (death #9)", "Deepwell", "2025-03-14", 48210, "Dies to the floor three miniboss for the ninth time in a row, chat counts every death."],
  ["biscuit-pause", "Biscuit the cat walks across the keyboard and pauses the final boss", "Deepwell", "2024-08-02", 91544, "The cat steps on the keyboard mid fight and pauses the game."],
  ["first-raid", "First ever 100-viewer raid and Juno immediately cries", "Just Chatting", "2023-11-19", 30877, "A huge raid arrives, emotional welcome to the raiders."],
  ["built-different", "\"I'm built different\" (falls off the map two seconds later)", "Sky Couriers", "2023-06-07", 120332, "Brags about being built different then flies straight off the edge of the world."],
  ["spike-shell", "Spike shell on the final straight steals first place", "Kart Panic", "2024-02-10", 64019, "Leading the whole race until a spike shell hits right before the finish line."],
  ["sleep-stream", "Fell asleep on the 12-hour charity stream", "Just Chatting", "2024-12-21", 77102, "Dozes off on camera during the long charity marathon, chat keeps the stream going."],
  // the rest of the library
  ["warden-first", "Meeting the Lantern Warden for the first time (it did not go well)", "Deepwell", "2024-05-30", 22014, ""],
  ["deepwell-perfect", "Flawless floor five, no hits taken", "Deepwell", "2025-01-08", 18820, ""],
  ["deepwell-shop", "Spending 900 gold on a hat. Worth it.", "Deepwell", "2024-07-11", 9930, ""],
  ["deepwell-mimic", "The treasure chest had teeth", "Deepwell", "2024-06-22", 15440, ""],
  ["deepwell-win", "First full clear of Deepwell after 41 hours", "Deepwell", "2025-05-03", 58312, ""],
  ["deepwell-lag", "Lag spike sends us into the lava pit", "Deepwell", "2024-09-15", 7120, ""],
  ["sky-storm", "Delivering a cake through a thunderstorm", "Sky Couriers", "2023-07-01", 11903, ""],
  ["sky-bridge", "Flying under every bridge in the city in one route", "Sky Couriers", "2023-08-19", 8450, ""],
  ["sky-goose", "A goose steals the package mid-air", "Sky Couriers", "2023-09-02", 40115, ""],
  ["sky-speedrun", "Sky Couriers any% personal best", "Sky Couriers", "2023-10-12", 6702, ""],
  ["kart-lastfirst", "Last place to first in one lap", "Kart Panic", "2024-03-03", 31220, ""],
  ["kart-chat", "Racing against chat for the first time", "Kart Panic", "2024-01-27", 14402, ""],
  ["kart-wall", "Drives backwards for an entire lap without noticing", "Kart Panic", "2024-02-24", 26651, ""],
  ["harbor-legend", "Catching the legendary golden carp at 3am", "Hollow Harbor", "2025-06-14", 19870, ""],
  ["harbor-boot", "Fourteen boots in a row", "Hollow Harbor", "2025-06-20", 12300, ""],
  ["harbor-storm", "The boat capsizes and we lose the whole catch", "Hollow Harbor", "2025-07-02", 9050, ""],
  ["harbor-cozy", "Most peaceful stream ever, rain and fishing", "Hollow Harbor", "2025-07-19", 5120, ""],
  ["chat-anniversary", "Two year stream anniversary, thank you all", "Just Chatting", "2025-04-09", 21450, ""],
  ["chat-cooking", "Cooking stream: the smoke alarm goes off", "Just Chatting", "2024-04-14", 33780, ""],
  ["chat-chair", "The chair breaks live on stream", "Just Chatting", "2023-12-30", 52110, ""],
  ["chat-singing", "Juno sings the theme song badly on purpose", "Just Chatting", "2024-10-05", 17660, ""],
  ["chat-qna", "Q&A: why the cat is called Biscuit", "Just Chatting", "2024-08-20", 8890, ""],
  ["chat-mic", "Talking for ten minutes with the mic muted", "Just Chatting", "2024-11-02", 44107, ""],
  ["chat-pizza", "Pizza arrives at the worst possible moment", "Just Chatting", "2025-02-02", 11540, ""],
  ["chat-reaction", "Reacting to our own first ever stream", "Just Chatting", "2025-09-13", 15990, ""],
  ["kart-tourney", "Community kart tournament grand final", "Kart Panic", "2025-08-23", 23330, ""],
  ["deepwell-boss2", "The Drowned King goes down first try", "Deepwell", "2025-02-20", 13330, ""],
  ["deepwell-curse", "Picking up every cursed item on purpose", "Deepwell", "2025-04-18", 10220, ""],
  ["sky-crash", "Crashing into the clocktower at full speed", "Sky Couriers", "2023-06-29", 20400, ""],
  ["harbor-cat", "Biscuit watches the fishing minigame very seriously", "Hollow Harbor", "2025-06-28", 27090, ""],
];

const GAME_ART = {
  Deepwell: { sky: ["#140f1f", "#2c1d3a"], glow: "#ffb347", ground: "#1d1626" },
  "Sky Couriers": { sky: ["#7cc6f2", "#f8d9a8"], glow: "#ffffff", ground: "#5c8f6a" },
  "Kart Panic": { sky: ["#ff9a62", "#ffd36e"], glow: "#fff3c4", ground: "#3b3a42" },
  "Hollow Harbor": { sky: ["#1c3a57", "#e48f6a"], glow: "#ffd9a3", ground: "#123049" },
  "Just Chatting": { sky: ["#3a2a2a", "#6b4a3d"], glow: "#ffcf8a", ground: "#2a1e1c" },
};

function thumbnail(id, game) {
  const r = rng([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const art = GAME_ART[game];
  const W = 480, H = 270;
  const shapes = [];
  if (game === "Deepwell") {
    for (let i = 0; i < 7; i++) {
      const x = r() * W, w = 30 + r() * 70;
      shapes.push(`<path d="M${x - w} 0 L${x} ${60 + r() * 90} L${x + w} 0Z" fill="#0c0913" opacity="${0.5 + r() * 0.4}"/>`);
    }
    const lx = 140 + r() * 200, ly = 140 + r() * 40;
    shapes.push(`<circle cx="${lx}" cy="${ly}" r="120" fill="url(#glow)"/>`);
    shapes.push(`<rect x="${lx - 7}" y="${ly - 12}" width="14" height="22" rx="3" fill="${art.glow}"/>`);
    shapes.push(`<path d="M0 ${H - 40} Q${W / 2} ${H - 70 - r() * 20} ${W} ${H - 40} V${H} H0Z" fill="${art.ground}"/>`);
    shapes.push(`<circle cx="${lx - 40}" cy="${H - 70}" r="13" fill="#0c0913"/><rect x="${lx - 52}" y="${H - 60}" width="24" height="30" rx="8" fill="#0c0913"/>`);
  } else if (game === "Sky Couriers") {
    for (let i = 0; i < 6; i++) {
      const x = r() * W, y = 30 + r() * 140, s = 0.6 + r();
      shapes.push(`<g transform="translate(${x} ${y}) scale(${s})" fill="#fff" opacity="0.85"><ellipse cx="0" cy="0" rx="40" ry="14"/><ellipse cx="18" cy="-10" rx="22" ry="14"/><ellipse cx="-16" cy="-6" rx="18" ry="11"/></g>`);
    }
    const px = 120 + r() * 240, py = 80 + r() * 80;
    shapes.push(`<g transform="translate(${px} ${py}) rotate(${-12 + r() * 24})"><rect x="-26" y="-8" width="52" height="16" rx="8" fill="#ef6f4a"/><rect x="-6" y="-26" width="12" height="52" rx="4" fill="#d9573a"/><rect x="18" y="-14" width="18" height="14" rx="2" fill="#c98b4a"/></g>`);
    shapes.push(`<path d="M0 ${H - 30} L60 ${H - 90} L110 ${H - 50} L170 ${H - 110} L240 ${H - 40} L300 ${H - 95} L380 ${H - 45} L430 ${H - 80} L${W} ${H - 40} V${H} H0Z" fill="${art.ground}"/>`);
  } else if (game === "Kart Panic") {
    shapes.push(`<path d="M0 ${H} L${W * 0.38} 120 L${W * 0.62} 120 L${W} ${H}Z" fill="${art.ground}"/>`);
    for (let i = 0; i < 6; i++) {
      const y = 130 + i * 25;
      shapes.push(`<rect x="${W / 2 - 3 - i}" y="${y}" width="${6 + i * 2}" height="${10 + i * 2}" fill="#fff3c4" opacity="0.8"/>`);
    }
    for (let i = 0; i < 12; i++) {
      shapes.push(`<rect x="${(i % 2 ? W * 0.62 : W * 0.38) - 10 + (i % 2 ? i * 9 : -i * 9)}" y="${120 + i * 13}" width="20" height="13" fill="${i % 4 < 2 ? "#e2483a" : "#fff"}"/>`);
    }
    const kx = W / 2 + (r() - 0.5) * 120;
    shapes.push(`<g transform="translate(${kx} ${H - 50})"><rect x="-34" y="-18" width="68" height="28" rx="10" fill="#2f7de1"/><circle cx="-22" cy="12" r="10" fill="#111"/><circle cx="22" cy="12" r="10" fill="#111"/><circle cx="0" cy="-26" r="12" fill="#f6c453"/></g>`);
    if (r() > 0.4) shapes.push(`<g transform="translate(${kx + 60} ${H - 120})"><circle r="16" fill="#7c4ddb"/><path d="M-16 0 L-26 -6 L-16 -8Z M16 0 L26 -6 L16 -8Z M0 -16 L-4 -28 L4 -28Z" fill="#7c4ddb"/></g>`);
  } else if (game === "Hollow Harbor") {
    shapes.push(`<circle cx="${100 + r() * 280}" cy="${110 + r() * 20}" r="36" fill="${art.glow}" opacity="0.9"/>`);
    shapes.push(`<rect x="0" y="150" width="${W}" height="${H - 150}" fill="${art.ground}"/>`);
    for (let i = 0; i < 9; i++) shapes.push(`<rect x="${r() * W}" y="${160 + r() * 100}" width="${30 + r() * 60}" height="2" fill="${art.glow}" opacity="0.4"/>`);
    const bx = 120 + r() * 220;
    shapes.push(`<g transform="translate(${bx} 150)"><path d="M-50 -4 L50 -4 L36 14 L-36 14Z" fill="#6b3f2a"/><rect x="-2" y="-60" width="4" height="56" fill="#3d2418"/><path d="M2 -58 L40 -14 L2 -14Z" fill="#f1e4cf"/><line x1="-30" y1="-6" x2="-80" y2="40" stroke="#f1e4cf" stroke-width="1.5"/></g>`);
  } else {
    shapes.push(`<rect x="0" y="${H - 70}" width="${W}" height="70" fill="${art.ground}"/>`);
    shapes.push(`<rect x="${60 + r() * 40}" y="40" width="120" height="80" rx="6" fill="#241917" stroke="#8a6550" stroke-width="4"/>`);
    shapes.push(`<circle cx="${380 - r() * 40}" cy="70" r="80" fill="url(#glow)"/><path d="M${360 - r() * 20} 60 l20 -30 l20 30Z" fill="${art.glow}"/>`);
    shapes.push(`<g transform="translate(${230 + r() * 40} ${H - 70})"><circle cx="0" cy="-62" r="22" fill="#e9b48f"/><path d="M-22 -70 Q0 -100 22 -70 Q14 -86 -22 -70Z" fill="#3c2318"/><rect x="-32" y="-40" width="64" height="44" rx="18" fill="#c4553f"/></g>`);
    if (id.includes("raid") || r() > 0.6) for (let i = 0; i < 14; i++) shapes.push(`<circle cx="${r() * W}" cy="${r() * 150}" r="${2 + r() * 4}" fill="${pick(["#ffcf8a", "#ff7a55", "#9fd8c4", "#fff"])}"/>`);
  }
  if (id.includes("biscuit") || id.includes("cat")) {
    shapes.push(`<g transform="translate(${W - 110} ${H - 64})" fill="#e8a55b"><ellipse cx="0" cy="18" rx="40" ry="22"/><circle cx="30" cy="-6" r="20"/><path d="M16 -20 L20 -40 L30 -24Z M38 -24 L46 -40 L48 -18Z"/><path d="M-38 16 Q-70 0 -60 -20" stroke="#e8a55b" stroke-width="9" fill="none" stroke-linecap="round"/></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${art.sky[0]}"/><stop offset="1" stop-color="${art.sky[1]}"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="${art.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${art.glow}" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#sky)"/>${shapes.join("")}</svg>`;
}

const clips = CLIPS.map(([id, title, game, date, views, context]) => {
  writeFileSync(out(`img/clips/${id}.svg`), thumbnail(id, game));
  return {
    id,
    title,
    game,
    created_at: `${date}T${String(14 + Math.floor(rand() * 8)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00Z`,
    view_count: views,
    duration: Math.round(between(14, 58)),
    url: "",
    thumbnail: `/img/clips/${id}.svg`,
    creator: pick(["mothlamp", "quietkettle", "orbit_pear", "fernwick", "tidalbyte", "softserve_404"]),
    context,
    embeddable: false,
  };
});

writeFileSync(
  out("demo/clips.json"),
  JSON.stringify({ channel: { login: "juno_sample", display_name: "Juno", fictional: true }, clips }, null, 1),
);

// ---------- chat log ----------

const USERS = [
  ["mothlamp", "#e2734a"], ["quietkettle", "#5aa9a1"], ["orbit_pear", "#c58ad6"], ["fernwick", "#7bb86f"],
  ["tidalbyte", "#5d8fe0"], ["softserve_404", "#e59bb5"], ["lowtide", "#d6a74a"], ["papercrane", "#9a8be8"],
  ["gravelpit", "#c96b6b"], ["nightjar", "#6fb4d9"], ["kettlecorn", "#e8b35a"], ["mossbox", "#79b394"],
  ["violet_hour", "#b68fe0"], ["cinderblock", "#d97a5a"], ["sundial", "#c9b650"], ["halfmoon", "#8fa3e8"],
  ["rookie_rae", "#e07aa5"], ["staticwave", "#58b8b0"], ["pebbledash", "#b49a7a"], ["wrenfield", "#91c26c"],
  ["lumen_ox", "#e3a04f"], ["bramble", "#a879c9"], ["driftwood", "#7fa6c4"], ["mintleaf", "#69c28f"],
];

const FILLER = [
  "this run looks good", "chat how is everyone", "just got here what did I miss", "the music is so cozy tonight",
  "hydrate check", "that dodge was clean", "W streamer", "we are so back", "I'm eating dinner with you guys",
  "first time here, loving it", "nice", "how long have you been playing this", "the vibes are immaculate",
  "go left go left", "that was close", "lets gooo", "my cat is also watching", "gg", "big brain play",
  "what build is this", "good evening everyone", "the art style in this game is gorgeous", "clean",
  "I believe in you", "ok that was actually smooth", "chat be nice", "this is my comfort stream", "lurking but here",
];

const SCENES = [
  { at: 34, len: 16, rate: 3.6, lines: [
    "NOT THE WARDEN AGAIN", "the lantern warden 💀", "warden ends the run again", "floor three curse is real",
    "death number ten incoming", "WARDEN", "he's back", "not the lantern guy", "the warden owns this channel",
    "every single time on floor three", "the warden again lmao", "she died to the warden again" ] },
  { at: 82, len: 14, rate: 1.4, lines: [
    "the soundtrack in this game though", "who did the soundtrack", "the soundtrack slaps", "need the soundtrack on spotify",
    "soundtrack is a 10/10" ] },
  { at: 128, len: 14, rate: 3.8, lines: [
    "CAT", "BISCUIT", "biscuit on the keyboard", "the cat paused the game", "BISCUIT NOOO", "cat walked on the keys",
    "biscuit strikes again", "cat on keyboard", "the cat is the final boss", "biscuit paused it lmao", "protect the keyboard" ] },
  { at: 206, len: 16, rate: 3.6, lines: [
    "RAID HYPE", "welcome raiders", "raiders welcome in", "so many raiders", "hi from the raid", "raid raid raid",
    "huge raid", "welcome raid", "here from pixelmoth", "is she gonna cry", "dont cry" ] },
  { at: 272, len: 14, rate: 3.5, lines: [
    "built different", "BUILT DIFFERENT", "she said built different", "built different 💀", "oh no she said it",
    "she's built different", "famous last words", "built different then falls off", "not built different" ] },
  { at: 342, len: 15, rate: 3.4, lines: [
    "SPIKE SHELL", "the spike shell", "spike shell on the final straight", "dont get spiked", "spike shell trauma",
    "not the spike shell", "first place curse", "she got spiked", "spike shell again 😭", "final straight again" ] },
  { at: 410, len: 14, rate: 3.2, lines: [
    "remember the 12 hour stream", "12 hour charity stream when", "she fell asleep last time", "sleep stream",
    "the charity stream where she fell asleep", "dont fall asleep this time", "12 hours again?", "asleep on stream lol" ] },
];

const EVENTS = [
  { t: 0, type: "category", game: "Deepwell" },
  { t: 112, type: "sub", user: "lowtide", months: 14 },
  { t: 204, type: "raid", user: "pixelmoth", viewers: 112 },
  { t: 334, type: "category", game: "Kart Panic" },
  { t: 395, type: "sub", user: "mintleaf", months: 3 },
];

const DURATION = 460;
const messages = [];
for (let t = 1.5; t < DURATION; t += between(0.9, 2.6)) {
  const [user, color] = pick(USERS);
  messages.push({ t: Math.round(t * 1000), user, color, text: pick(FILLER) });
}
for (const s of SCENES) {
  for (let t = s.at; t < s.at + s.len; t += between(0.6, 2) / s.rate) {
    const [user, color] = pick(USERS);
    messages.push({ t: Math.round(t * 1000), user, color, text: pick(s.lines) });
  }
}
messages.sort((a, b) => a.t - b.t);

writeFileSync(
  out("demo/chat.json"),
  JSON.stringify({ durationMs: DURATION * 1000, events: EVENTS.map((e) => ({ ...e, t: e.t * 1000 })), messages }),
);

console.log(`clips: ${clips.length}, messages: ${messages.length}, events: ${EVENTS.length}`);

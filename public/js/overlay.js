// OBS browser source. Invisible until a callback arrives, then plays the rewind sequence.
// Sources: live WebSocket (?c=&k=), demo BroadcastChannel (?demo=1), parent postMessage (?embed=1),
// or a self-running showcase loop (?showcase=1).

const params = new URLSearchParams(location.search);
const stage = document.querySelector(".stage");
const statusEl = document.querySelector(".status");
const queue = [];
let playing = false;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const stamp = (d) => `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

function ago(iso) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 45) return `${days} days ago`;
  if (days < 700) return `${Math.round(days / 30.4)} months ago`;
  const y = Math.round(days / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

function setStatus(text, isError = false, autoHide = true) {
  if (params.has("embed") || params.has("showcase")) return;
  statusEl.textContent = text;
  statusEl.hidden = false;
  statusEl.classList.toggle("is-error", isError);
  clearTimeout(setStatus.t);
  if (autoHide) setStatus.t = setTimeout(() => (statusEl.hidden = true), 4000);
}

export function enqueue(cb) {
  queue.push(cb);
  if (!playing) next();
}

async function next() {
  const cb = queue.shift();
  if (!cb) {
    playing = false;
    return;
  }
  playing = true;
  await play(cb);
  setTimeout(next, 600);
}

function play({ clip, reason, confidence }) {
  return new Promise((resolve) => {
    const real = clip.embeddable && clip.id && !params.has("embed-muted-still");
    const hold = real ? Math.min(Math.max(clip.duration || 15, 8), 22) : 9;
    stage.style.setProperty("--hold", `${hold}s`);

    const card = stage.querySelector(".cb-card");
    const media = card.querySelector(".media");
    media.querySelector("img, iframe")?.remove();
    if (real) {
      const f = document.createElement("iframe");
      const muted = params.has("embed") ? "true" : "false";
      f.src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.id)}&parent=${location.hostname}&autoplay=true&muted=${muted}`;
      f.allow = "autoplay; fullscreen";
      f.title = clip.title;
      media.prepend(f);
    } else {
      const img = new Image();
      img.src = clip.thumbnail;
      img.alt = clip.title;
      media.prepend(img);
    }

    const created = new Date(clip.created_at);
    card.querySelector(".meta").textContent = [clip.game, `${compact(clip.view_count)} views`, ago(clip.created_at)].filter(Boolean).join("  ·  ");
    card.querySelector(".title").textContent = clip.title;
    card.querySelector(".reason").textContent = reason || "This has happened before.";
    card.querySelector(".duration").textContent = `0:${String(Math.round(clip.duration || 0)).padStart(2, "0")}`;
    stage.querySelector(".tally-conf").textContent = `${Math.round((confidence || 0) * 100)}% MATCH`;
    stage.querySelector(".chat-hint").innerHTML = `Full clip linked in chat <b>●</b>`;

    // date counter rewinds from today to the clip's day
    const rewind = card.querySelector(".rewind");
    const to = rewind.querySelector(".to");
    rewind.classList.remove("is-settled");
    const start = Date.now();
    const span = start - created.getTime();
    const t0 = performance.now();
    const dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1300;
    const spin = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      to.textContent = stamp(new Date(start - span * eased));
      if (p < 1) requestAnimationFrame(spin);
      else rewind.classList.add("is-settled");
    };
    to.textContent = stamp(new Date(start));
    requestAnimationFrame(spin);

    stage.classList.remove("is-on", "is-leaving");
    void stage.offsetWidth; // restart CSS animations
    stage.classList.add("is-on");

    setTimeout(() => {
      stage.classList.add("is-leaving");
      setTimeout(() => {
        stage.classList.remove("is-on", "is-leaving");
        media.querySelector("iframe")?.remove();
        resolve();
      }, 460);
    }, hold * 1000 + 900);
  });
}

function compact(n) {
  n = Number(n || 0);
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
}

// ---------- sources ----------

function listenParent() {
  addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    if (e.data?.type === "callback") enqueue(e.data);
  });
}

function listenLive() {
  const c = params.get("c");
  const k = params.get("k");
  let delay = 1000;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/overlay/ws?c=${encodeURIComponent(c)}&k=${encodeURIComponent(k)}`);
    let ping;
    ws.onopen = () => {
      delay = 1000;
      setStatus("Callback overlay connected");
      ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const msg = JSON.parse(e.data);
      if (msg.type === "callback") enqueue(msg);
      if (msg.type === "test") enqueue(TEST_CALLBACK);
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      if (e.code === 1006 && delay > 8000) setStatus("Overlay link isn't valid. Copy it again from the control panel.", true, false);
      else setStatus("Reconnecting to Callback…", false, false);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 30_000);
    };
  };
  open();
}

const TEST_CALLBACK = {
  clip: {
    id: "",
    title: "This is a test callback. If you can see me, the overlay works.",
    game: "Setup check",
    created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    view_count: 1234,
    duration: 9,
    thumbnail: "/img/clips/chat-anniversary.svg",
    embeddable: false,
  },
  reason: "Everything is wired up. Real callbacks will look exactly like this.",
  confidence: 0.99,
};

async function listenDemo() {
  const bc = new BroadcastChannel("callback-demo");
  let panelSeen = false;
  bc.onmessage = (e) => {
    if (e.data?.type === "heartbeat") panelSeen = true;
    if (e.data?.type === "callback") enqueue(e.data);
  };
  bc.postMessage({ type: "overlay-hello" });
  setStatus("Demo overlay: waiting for the control panel…", false, false);
  await new Promise((r) => setTimeout(r, 2500));
  if (panelSeen) {
    setStatus("Demo overlay linked to the control panel");
    return;
  }
  // No panel open: run the whole engine here so the overlay works on its own in OBS.
  setStatus("Demo overlay running on its own");
  const [{ CallbackEngine }, { Replay, loadDemo, demoMatch }] = await Promise.all([import("./engine.js"), import("./replay.js")]);
  const { log } = await loadDemo();
  const replay = new Replay(log);
  const engine = new CallbackEngine({ match: demoMatch, now: () => replay.now(), settings: { cooldownSec: 60, armSec: 0 } });
  let lastTick = 0;
  replay.addEventListener("message", (e) => engine.push(e.detail));
  replay.addEventListener("event", (e) => engine.event(e.detail));
  replay.addEventListener("loop", () => engine.firedClips.clear());
  replay.addEventListener("tick", () => {
    if (replay.now() - lastTick >= 1000) {
      lastTick = replay.now();
      engine.tick();
    }
  });
  engine.addEventListener("fire", (e) => {
    if (!panelSeen) enqueue(e.detail);
  });
  bc.onmessage = (e) => {
    if (e.data?.type === "heartbeat" && !panelSeen) {
      panelSeen = true;
      replay.pause();
      setStatus("Demo overlay linked to the control panel");
    }
    if (e.data?.type === "callback" && panelSeen) enqueue(e.data);
  };
  replay.play();
}

async function showcase() {
  const lib = await fetch("/demo/clips.json").then((r) => r.json());
  const picks = [
    ["biscuit-pause", "Biscuit has paused a boss fight before. Biscuit will do it again.", 0.94],
    ["warden-nine", "The Warden sends his regards. Again. Death number ten loading.", 0.91],
    ["built-different", "Last time someone said built different, gravity disagreed.", 0.86],
  ];
  let i = 0;
  const loop = () => {
    const [id, reason, confidence] = picks[i++ % picks.length];
    const clip = lib.clips.find((c) => c.id === id);
    enqueue({ clip, reason, confidence });
  };
  setTimeout(loop, 900);
  setInterval(loop, 14_000);
}

if (params.has("showcase")) showcase();
else if (params.has("embed")) listenParent();
else if (params.has("demo")) listenDemo();
else if (params.get("c") && params.get("k")) listenLive();
else setStatus("This overlay link is incomplete. Copy it from the Callback control panel.", true, false);

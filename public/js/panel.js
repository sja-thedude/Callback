import { initTheme, toast, syncRange, initSegmented, countUp, esc, fmtDate, ago, compact, store } from "./ui.js";
import { CallbackEngine } from "./engine.js";
import { Replay, loadDemo, demoMatch } from "./replay.js";
import { TwitchChat } from "./irc.js";

initTheme();

const params = new URLSearchParams(location.search);
const isDemo = params.has("demo");
const $ = (id) => document.getElementById(id);
const preview = $("preview");

const ICONS = {
  velocity: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12 5 7l3 3 4-7 3 4"/></svg>',
  phrase: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 4h12M2 8h8M2 12h10"/></svg>',
  raid: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 13 8 2l6 11H2Z"/></svg>',
  category: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  manual: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 13 13 3M9 3h4v4"/></svg>',
};
const KIND_LABEL = { velocity: "Velocity spike", phrase: "Recurring phrase", raid: "Raid", category: "Category change", manual: "Typed probe" };
const DECISION_LABEL = {
  fire: "Fired",
  armed: "Arming",
  below: "Held · below line",
  cooldown: "Held · cooldown",
  repeat: "Held · just played",
  vetoed: "Vetoed",
  would: "Would fire",
  pending: "Matching",
};

const state = {
  clips: new Map(),
  chatCount: 0,
  firedMarks: [],
  statuses: new Map(),
};

// ---------- status pills ----------

function setStatus(key, label, kind = "live") {
  state.statuses.set(key, { label, kind });
  $("status-row").innerHTML = [...state.statuses.values()]
    .map((s) => `<span class="pill ${s.kind === "live" ? "is-live" : s.kind === "accent" ? "is-accent" : ""}"><span class="dot"></span>${esc(s.label)}</span>`)
    .join("");
}

function banner(title, body, isError = false) {
  const el = $("banner");
  el.hidden = false;
  el.classList.toggle("is-error", isError);
  el.innerHTML = `<b>${esc(title)}</b>${body}`;
}

// ---------- chat ----------

const chatList = $("chat-list");
function addChat(m) {
  const li = document.createElement("li");
  li.innerHTML = `<b style="color:${esc(m.color || "var(--ink-2)")}">${esc(m.user)}</b> ${esc(m.text)}`;
  pushChat(li);
  state.chatCount++;
  if (state.chatCount % 5 === 0 || state.chatCount < 5) $("chat-count").innerHTML = `<span class="dot"></span>${state.chatCount.toLocaleString()} messages`;
  $("chat-count").classList.add("is-live");
}
function addSystem(html) {
  const li = document.createElement("li");
  li.className = "sys";
  li.innerHTML = html;
  pushChat(li);
}
function pushChat(li) {
  chatList.append(li);
  while (chatList.children.length > 40) chatList.firstElementChild.remove();
}

// ---------- pulse chart ----------

class PulseChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.samples = [];
    this.marks = [];
    this.max = 120;
    new ResizeObserver(() => this.draw()).observe(canvas);
    document.addEventListener("themechange", () => this.draw());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.draw());
  }
  push(s) {
    this.samples.push(s);
    if (this.samples.length > this.max) this.samples.shift();
    this.marks = this.marks.filter((m) => m.t >= this.samples[0].t);
    this.draw();
  }
  mark(t, fired) {
    this.marks.push({ t, fired });
  }
  reset() {
    this.samples = [];
    this.marks = [];
    this.draw();
  }
  draw() {
    const c = this.canvas;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w) return;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    const pad = { t: 10, b: 18, l: 28, r: 6 };
    const s = this.samples;
    const top = Math.max(20, ...s.map((x) => x.rate)) * 1.15;
    const X = (i) => pad.l + (i / (this.max - 1)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v / top) * (h - pad.t - pad.b);

    g.font = `500 10px ${col("--font-mono")}`;
    g.fillStyle = col("--faint");
    g.strokeStyle = col("--line");
    g.lineWidth = 1;
    for (const v of [0, Math.round(top / 2), Math.round(top)]) {
      g.beginPath();
      g.moveTo(pad.l, Y(v) + 0.5);
      g.lineTo(w - pad.r, Y(v) + 0.5);
      g.stroke();
      g.fillText(String(v), 2, Y(v) + 3);
    }
    g.fillText("2 min ago", pad.l, h - 4);
    g.textAlign = "right";
    g.fillText("now", w - pad.r, h - 4);
    g.textAlign = "left";
    if (!s.length) return;
    const off = this.max - s.length;

    g.fillStyle = col("--accent-soft");
    s.forEach((x, i) => {
      if (x.spiking) g.fillRect(X(i + off) - 2, pad.t, (w - pad.l) / this.max + 2, h - pad.t - pad.b);
    });

    g.setLineDash([4, 4]);
    g.strokeStyle = col("--faint");
    g.lineWidth = 1.5;
    g.beginPath();
    s.forEach((x, i) => (i ? g.lineTo(X(i + off), Y(x.base)) : g.moveTo(X(i + off), Y(x.base))));
    g.stroke();
    g.setLineDash([]);

    const grad = g.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, col("--accent-soft"));
    grad.addColorStop(1, "transparent");
    g.beginPath();
    s.forEach((x, i) => (i ? g.lineTo(X(i + off), Y(x.rate)) : g.moveTo(X(i + off), Y(x.rate))));
    g.lineTo(X(s.length - 1 + off), h - pad.b);
    g.lineTo(X(off), h - pad.b);
    g.closePath();
    g.fillStyle = grad;
    g.fill();

    g.strokeStyle = col("--ink");
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.beginPath();
    s.forEach((x, i) => (i ? g.lineTo(X(i + off), Y(x.rate)) : g.moveTo(X(i + off), Y(x.rate))));
    g.stroke();

    for (const m of this.marks) {
      const i = s.findIndex((x) => x.t >= m.t);
      if (i < 0) continue;
      const x = X(i + off);
      const y = Y(s[i].rate);
      g.beginPath();
      g.arc(x, y, m.fired ? 6 : 4, 0, Math.PI * 2);
      g.fillStyle = m.fired ? col("--accent") : col("--surface");
      g.strokeStyle = col("--accent");
      g.lineWidth = 2;
      g.fill();
      g.stroke();
    }
  }
}
const chart = new PulseChart($("chart"));

// ---------- feed ----------

const feed = $("feed-list");
function clipThumb(clip) {
  return clip.thumbnail?.replace("{width}", "320").replace("{height}", "180") || "/img/clips/chat-anniversary.svg";
}
function pct(v) {
  return `${Math.round(v * 100)}%`;
}

function showPending(t) {
  $("feed-empty").hidden = true;
  const li = document.createElement("li");
  li.className = "cand is-pending";
  li.dataset.id = t.id;
  li.innerHTML = `<div class="cand-top"><span class="tag">${ICONS[t.kind] || ""}${esc(KIND_LABEL[t.kind] || t.kind)}</span><span class="decision pending">${DECISION_LABEL.pending}</span></div>
    <p class="why">${esc(t.label)}</p>
    <div class="cand-skel" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  feed.prepend(li);
  while (feed.children.length > 30) feed.lastElementChild.remove();
}

function renderCandidate(r) {
  const top = r.candidates[0];
  let li = feed.querySelector(`[data-id="${r.id}"]`);
  if (!li) {
    showPending({ id: r.id, ...r.trigger });
    li = feed.querySelector(`[data-id="${r.id}"]`);
  }
  li.className = `cand ${r.decision === "fire" ? "is-fire" : ""}`;
  if (!top) {
    li.querySelector(".cand-skel").outerHTML = `<p class="muted">No clips indexed yet, so there was nothing to compare against.</p>`;
    return;
  }
  const c = top.clip;
  const cooldownNote = r.decision === "cooldown" ? ` · ${Math.ceil(r.cooldownLeft / 1000)}s left` : "";
  const runners = r.candidates.slice(1, 4);
  li.innerHTML = `
    <div class="cand-top">
      <span class="tag">${ICONS[r.trigger.kind] || ""}${esc(KIND_LABEL[r.trigger.kind] || r.trigger.kind)}</span>
      <span class="decision ${r.decision}" data-decision>${esc(DECISION_LABEL[r.decision] || r.decision)}${cooldownNote}</span>
    </div>
    <p class="why">${esc(r.trigger.label)}${r.trigger.phrases?.length ? ` · ${r.trigger.phrases.map((p) => `“${esc(p)}”`).join(", ")}` : ""}</p>
    <div class="cand-main">
      <img src="${esc(clipThumb(c))}" alt="" width="96" height="54" loading="lazy" />
      <div>
        <p class="cand-title">${esc(c.title)}</p>
        <p class="cand-meta">${esc([c.game, fmtDate(c.created_at), `${compact(c.view_count)} views`].filter(Boolean).join(" · "))}</p>
      </div>
      <div class="conf">${pct(top.confidence)}<small>CONFIDENCE</small></div>
    </div>
    <div class="meter" title="Threshold ${pct(r.threshold)}"><i style="--v:${top.confidence}"></i><b style="left:${r.threshold * 100}%"></b></div>
    <div class="breakdown">
      <div><span>Meaning ${top.semantic.toFixed(2)}</span><div class="mini"><i style="--v:${Math.max(0, Math.min(1, (top.semantic - 0.6) / 0.2))}"></i></div></div>
      <div><span>Keywords</span><div class="mini"><i style="--v:${top.lexical}"></i></div></div>
      <div><span>Lead +${top.margin.toFixed(2)}</span><div class="mini"><i style="--v:${Math.max(0, Math.min(1, top.margin / 0.08))}"></i></div></div>
      <div><span>Game ${top.gameMatch ? "✓" : "–"}</span><div class="mini"><i style="--v:${top.gameMatch ? 1 : 0}"></i></div></div>
    </div>
    ${top.matchedTerms.length ? `<div class="terms">${top.matchedTerms.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    ${r.reason ? `<p class="reason-line">${esc(r.reason)}</p>` : ""}
    ${runners.length ? `<details class="runners"><summary>${runners.length} other candidates</summary><ol>${runners.map((x) => `<li><span>${esc(x.clip.title)}</span><span>${pct(x.confidence)}</span></li>`).join("")}</ol></details>` : ""}
    <div class="cand-actions"><button class="btn btn-sm" type="button" data-fire>Fire this now</button></div>`;
  li.querySelector("[data-fire]").addEventListener("click", () => {
    engine.fireManual(top, r.reason || `This has happened before, ${ago(c.created_at)}.`);
  });
}

function setDecision(id, decision) {
  const el = feed.querySelector(`[data-id="${id}"] [data-decision]`);
  if (!el) return;
  el.className = `decision ${decision}`;
  el.textContent = DECISION_LABEL[decision];
}

// ---------- armed (veto window) ----------

const armedEl = $("armed");
function showArmed(p) {
  armedEl.hidden = false;
  armedEl.classList.remove("is-leaving");
  armedEl.style.setProperty("--ms", `${p.ms}ms`);
  armedEl.innerHTML = `
    <header class="card-head"><div><p class="eyebrow">Arming · ${pct(p.confidence)} confidence</p><h2 class="card-title">Callback in <span id="arm-count">${Math.ceil(p.ms / 1000)}</span>…</h2></div></header>
    <div class="armed-body"><img src="${esc(clipThumb(p.clip))}" alt="" width="110" height="62" /><div><p class="armed-title">${esc(p.clip.title)}</p><p class="cand-meta">${esc(p.reason || "")}</p></div></div>
    <div class="armed-actions"><button class="btn" type="button" id="veto-btn">Veto</button><button class="btn btn-primary" type="button" id="fire-btn">Fire now</button></div>
    <span class="armed-bar" aria-hidden="true"></span>`;
  setDecision(p.candidateId, "armed");
  const started = Date.now();
  const tick = setInterval(() => {
    const left = Math.max(0, Math.ceil((p.ms - (Date.now() - started)) / 1000));
    const el = $("arm-count");
    if (el) el.textContent = String(left);
    if (left <= 0) clearInterval(tick);
  }, 200);
  $("veto-btn").onclick = () => engine.veto();
  $("fire-btn").onclick = () => {
    clearTimeout(engine.armed?.timer);
    engine.commit({ ...p, manual: false });
  };
  $("veto-btn").focus({ preventScroll: true });
}
function hideArmed() {
  if (armedEl.hidden) return;
  armedEl.classList.add("is-leaving");
  setTimeout(() => (armedEl.hidden = true), 260);
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && engine?.armed) engine.veto();
});

// ---------- history ----------

function addHistory(h) {
  $("history-empty").hidden = true;
  const li = document.createElement("li");
  li.innerHTML = `<img src="${esc(clipThumb(h.clip))}" alt="" width="72" height="40" /><div><p>${esc(h.clip.title)}</p><span>${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${pct(h.confidence)}${h.manual ? " · manual" : ""}</span></div>`;
  $("history-list").prepend(li);
}

// ---------- library ----------

function renderLibrary(clips, hit) {
  state.clips = new Map(clips.map((c) => [c.id, c]));
  countUp($("lib-count"), clips.length);
  const body = $("library-body");
  let grid = body.querySelector(".lib-grid");
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "lib-grid";
    body.append(grid);
  }
  grid.innerHTML = clips
    .map(
      (c, i) => `<figure class="clip" data-clip="${esc(c.id)}" style="--i:${Math.min(i, 20)}"><img src="${esc(clipThumb(c))}" alt="Thumbnail: ${esc(c.title)}" width="160" height="90" loading="lazy" /><div><p>${esc(c.title)}</p><span>${esc(c.game || "")} · ${fmtDate(c.created_at)}</span></div></figure>`,
    )
    .join("");
  if (hit) highlightClip(hit);
}
function highlightClip(id) {
  document.querySelectorAll(".clip.is-hit").forEach((el) => el.classList.remove("is-hit"));
  const el = document.querySelector(`.clip[data-clip="${CSS.escape(id)}"]`);
  el?.classList.add("is-hit");
}

function librarySkeleton() {
  $("library-body").innerHTML = `<div class="lib-grid">${Array.from({ length: 6 }, () => `<div class="clip"><div class="skeleton" style="aspect-ratio:16/9;border-radius:0"></div><div><div class="skeleton" style="height:12px;margin-bottom:6px"></div><div class="skeleton" style="height:10px;width:60%"></div></div></div>`).join("")}</div>`;
}

// ---------- controls ----------

let engine;
const controls = { threshold: $("threshold"), cooldown: $("cooldown"), arm: $("arm") };
const fmtCooldown = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);

function applyControls(settings) {
  controls.threshold.value = settings.threshold;
  controls.cooldown.value = settings.cooldownSec;
  controls.arm.value = settings.armSec ?? 3;
  for (const el of document.querySelectorAll("[data-trigger]")) el.checked = settings.triggers?.[el.dataset.trigger] ?? true;
  if (settings.chatBot !== undefined) $("chatbot").checked = settings.chatBot;
  refreshOutputs();
}
function refreshOutputs() {
  Object.values(controls).forEach(syncRange);
  $("threshold-out").textContent = pct(Number(controls.threshold.value));
  $("cooldown-out").textContent = fmtCooldown(Number(controls.cooldown.value));
  $("arm-out").textContent = Number(controls.arm.value) ? `${controls.arm.value} s` : "Off";
}
function readControls() {
  const triggers = {};
  for (const el of document.querySelectorAll("[data-trigger]")) triggers[el.dataset.trigger] = el.checked;
  return {
    threshold: Number(controls.threshold.value),
    cooldownSec: Number(controls.cooldown.value),
    armSec: Number(controls.arm.value),
    triggers,
    chatBot: $("chatbot").checked,
  };
}
function bindControls(onSave) {
  let t;
  const changed = () => {
    refreshOutputs();
    const s = readControls();
    engine?.configure(s);
    clearTimeout(t);
    t = setTimeout(() => onSave?.(s), 500);
  };
  for (const el of [...Object.values(controls), ...document.querySelectorAll(".controls input[type=checkbox]")]) {
    el.addEventListener("input", changed);
  }
}

// ---------- engine wiring ----------

function wireEngine(e, { onFire, clock }) {
  e.addEventListener("pulse", (ev) => {
    const d = ev.detail;
    $("rate-now").textContent = d.rate10;
    $("rate-base").textContent = `baseline ${d.baseline.toFixed(1)}`;
    chart.push({ t: clock(), rate: d.rate10, base: d.baseline, spiking: d.spiking });
    const left = Math.ceil(d.cooldownLeft / 1000);
    const pill = $("cooldown-pill");
    pill.className = `pill ${left ? "" : "is-live"}`;
    pill.innerHTML = `<span class="dot"></span>${left ? `Cooldown ${left}s` : "Ready to fire"}`;
    const ph = $("phrases");
    const html = d.phrases.length
      ? d.phrases.map((p) => `<span class="phrase">${esc(p.text)} <b>×${p.users}</b></span>`).join("")
      : `<span class="phrases-empty">No phrase is repeating right now.</span>`;
    if (ph.dataset.last !== html) {
      ph.innerHTML = html;
      ph.dataset.last = html;
    }
  });
  e.addEventListener("trigger", (ev) => {
    chart.mark(clock(), false);
    showPending(ev.detail);
  });
  e.addEventListener("candidate", (ev) => {
    renderCandidate(ev.detail);
    if (ev.detail.candidates[0]) highlightClip(ev.detail.candidates[0].clip.id);
  });
  e.addEventListener("error", (ev) => {
    const li = feed.querySelector(`[data-id="${ev.detail.id}"]`);
    if (li) li.querySelector(".cand-skel").outerHTML = `<p class="muted">${esc(ev.detail.message)}</p>`;
    setStatus("matcher", "Matcher retrying", "idle");
  });
  e.addEventListener("armed", (ev) => showArmed(ev.detail));
  e.addEventListener("vetoed", (ev) => {
    hideArmed();
    setDecision(ev.detail.candidateId, "vetoed");
    toast("Vetoed", "Nothing went to the stream. The cooldown didn't start.", "warn");
  });
  e.addEventListener("fire", async (ev) => {
    hideArmed();
    const p = ev.detail;
    if (p.candidateId) setDecision(p.candidateId, "fire");
    chart.mark(clock(), true);
    const ok = await onFire(p);
    if (!ok) return;
    preview.contentWindow?.postMessage({ type: "callback", ...p }, location.origin);
    addHistory({ at: Date.now(), ...p });
    highlightClip(p.clip.id);
  });
}

// ---------- probe ----------

$("probe").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("probe-input");
  const text = input.value.trim();
  if (!text || !engine) return;
  input.value = "";
  await engine.query({ kind: "manual", label: `You typed “${text}”`, phrases: [text], probe: true });
});

// ---------- demo mode ----------

async function startDemo() {
  $("mode-chip").textContent = "Demo";
  $("account").innerHTML = `<a class="btn btn-sm" href="/panel">Use my channel</a>`;
  $("chatbot-row").querySelector("input").checked = true;
  setStatus("chat", "Replaying recorded chat");
  setStatus("matcher", "Warming matcher", "idle");
  librarySkeleton();
  fetch("/api/demo/warm").catch(() => {});

  const { log, lib } = await loadDemo();
  renderLibrary(lib.clips);
  document.querySelector("[data-chat-title]").textContent = `#${lib.channel.login}`;

  const replay = new Replay(log);
  const settings = { threshold: 0.72, cooldownSec: 60, armSec: 3, triggers: { velocity: true, phrase: true, events: true }, chatBot: true };
  applyControls(settings);
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("callback-demo") : null;

  engine = new CallbackEngine({
    match: async (body) => {
      const res = await demoMatch(body);
      setStatus("matcher", "Matcher ready");
      return res;
    },
    now: () => replay.now(),
    settings,
  });
  bindControls();
  wireEngine(engine, {
    clock: () => replay.now(),
    onFire: async (p) => {
      bc?.postMessage({ type: "callback", ...p });
      addSystem(`<b>CallbackBot</b> ⏪ ${esc(p.reason || "")} “${esc(p.clip.title)}” (${esc(fmtDate(p.clip.created_at))})`);
      state.firedMarks.push(replay.pos);
      renderMarks(log);
      return true;
    },
  });

  // stage controls: transport + timeline
  $("stage-controls").innerHTML = `
    <div class="transport">
      <div class="transport-row">
        <button class="btn btn-sm btn-ink" type="button" id="play">Pause</button>
        <button class="btn btn-sm" type="button" id="restart">Restart</button>
        <div class="segmented" id="speed" role="group" aria-label="Playback speed">
          <button type="button" data-value="1" aria-pressed="true">1×</button>
          <button type="button" data-value="2" aria-pressed="false">2×</button>
          <button type="button" data-value="4" aria-pressed="false">4×</button>
        </div>
        <span class="transport-time mono" id="time">0:00 / 0:00</span>
      </div>
      <div class="timeline">
        <div class="marks" id="marks"></div>
        <label class="sr-only" for="scrub">Replay position</label>
        <input id="scrub" type="range" min="0" max="${log.durationMs}" step="1000" value="0" />
      </div>
      <p class="demo-note">A recorded chat from a fictional sample channel, replayed at real speed against its indexed clip library. Demo cooldown is 60 s so you see more than one callback. The live default is 4 minutes.</p>
    </div>`;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, "0")}`;
  const scrub = $("scrub");
  initSegmented($("speed"), (v) => replay.setSpeed(Number(v)));
  $("play").onclick = () => (replay.playing ? replay.pause() : replay.play());
  replay.addEventListener("state", () => ($("play").textContent = replay.playing ? "Pause" : "Play"));
  $("restart").onclick = () => replay.seek(0);
  scrub.addEventListener("input", () => replay.seek(Number(scrub.value)));
  renderMarks(log);

  let lastTick = -Infinity;
  replay.addEventListener("message", (e) => {
    engine.push(e.detail);
    addChat(e.detail);
  });
  replay.addEventListener("event", (e) => {
    const ev = e.detail;
    engine.event(ev);
    if (ev.type === "category") $("screen-game").textContent = ev.game.toUpperCase();
    if (ev.type === "raid") addSystem(`<b>${esc(ev.user)}</b> is raiding with ${ev.viewers} viewers`);
    if (ev.type === "sub") addSystem(`<b>${esc(ev.user)}</b> subscribed for ${ev.months} months`);
    if (ev.type === "category") addSystem(`Category is now <b>${esc(ev.game)}</b>`);
  });
  replay.addEventListener("tick", () => {
    scrub.value = String(Math.floor(replay.pos));
    syncRange(scrub);
    $("time").textContent = `${fmt(replay.pos)} / ${fmt(log.durationMs)}`;
    if (replay.now() - lastTick >= 1000) {
      lastTick = replay.now();
      engine.tick();
    }
  });
  replay.addEventListener("seek", (e) => {
    engine.reset();
    chart.reset();
    lastTick = -Infinity;
    state.firedMarks = state.firedMarks.filter((t) => t < e.detail.pos);
    renderMarks(log);
    if (e.detail.category) {
      engine.game = e.detail.category.game;
      $("screen-game").textContent = e.detail.category.game.toUpperCase();
    }
    addSystem(`Replay jumped to ${fmt(e.detail.pos)}`);
  });
  replay.addEventListener("loop", () => {
    engine.firedClips.clear();
    state.firedMarks = [];
    renderMarks(log);
    addSystem("Replay looped back to the start");
  });

  if (bc) setInterval(() => bc.postMessage({ type: "heartbeat" }), 1000);
  replay.play();
}

function renderMarks(log) {
  const el = $("marks");
  if (!el) return;
  const events = log.events.filter((e) => e.type !== "category" || e.t > 0);
  el.innerHTML =
    events.map((e) => `<i style="left:${(e.t / log.durationMs) * 100}%" title="${esc(e.type)}"></i>`).join("") +
    state.firedMarks.map((t) => `<i class="fired" style="left:${(t / log.durationMs) * 100}%" title="Callback fired"></i>`).join("");
}

// ---------- live mode ----------

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

const ERRORS = {
  not_configured: ["Twitch sign-in isn't set up on this deployment", "The owner needs to add the Twitch app credentials. The demo works without them."],
  denied: ["Twitch connection was cancelled", "Nothing was shared. Connect again whenever you're ready."],
  state: ["That sign-in link expired", "Start the connection again from this page."],
};

async function startLive() {
  $("mode-chip").textContent = "Live";
  $("mode-chip").classList.add("is-live");
  const err = params.get("error");
  if (err && ERRORS[err]) {
    banner(ERRORS[err][0], `<span>${esc(ERRORS[err][1])} <a href="/panel?demo=1">Open the demo</a>.</span>`, err !== "denied");
    history.replaceState(null, "", "/panel");
  }
  librarySkeleton();

  const config = await api("/api/config").catch(() => ({ twitchConfigured: false }));
  let me;
  try {
    me = await api("/api/me");
  } catch (e) {
    if (e.status !== 401) banner("Couldn't reach Callback", `<span>${esc(e.message)}</span>`, true);
    return showConnect(config.twitchConfigured);
  }
  runLive(me);
}

function showConnect(configured) {
  setStatus("account", "Not connected", "idle");
  $("account").innerHTML = `<a class="btn btn-sm" href="/panel?demo=1">Try the demo</a>`;
  $("library-body").innerHTML = `
    <div class="connect">
      <svg class="art" viewBox="0 0 140 90" aria-hidden="true"><rect x="6" y="10" width="80" height="56" rx="10" class="e-box"/><path d="M40 28 28 38l12 10V28Zm16 0L44 38l12 10V28Z" class="e-dot"/><path d="M92 38h18M104 30l8 8-8 8" class="e-line"/><circle cx="124" cy="38" r="10" class="e-box"/></svg>
      <p><b>Connect your Twitch account</b> to index your own clips. Callback only ever plays clips from the channel that connected.</p>
      ${
        configured
          ? `<a class="btn btn-primary" href="/auth/login">Connect Twitch</a>`
          : `<p class="muted">Twitch sign-in isn't configured on this deployment yet. The demo shows everything working on a sample channel.</p><a class="btn btn-primary" href="/panel?demo=1">Open the demo</a>`
      }
    </div>`;
  $("feed-empty").querySelector("p").innerHTML = `<b>Nothing to match yet.</b> Connect Twitch and index your clips, or open the demo to watch candidates arrive.`;
  $("history-empty").querySelector("p").textContent = "Callbacks you play on stream are logged here.";
  $("stage-controls").innerHTML = "";
}

function runLive(me) {
  const p = me.profile;
  setStatus("account", `@${p.login}`);
  $("account").innerHTML = `<img class="avatar" src="${esc(p.profile_image_url)}" alt="${esc(p.display_name)}" width="36" height="36" /><button class="btn btn-sm btn-ghost" type="button" id="signout">Sign out</button>`;
  $("signout").onclick = async () => {
    await api("/auth/logout", {}).catch(() => {});
    location.reload();
  };
  $("mode-chip").textContent = `Live · ${p.display_name}`;
  document.querySelector("[data-chat-title]").textContent = `#${p.login}`;
  $("open-overlay").href = overlayUrl(me);
  applyControls({ ...me.settings, armSec: Number(store.get("cb-arm") ?? 3) });
  for (const h of [...me.history].reverse()) addHistory(h);

  engine = new CallbackEngine({ match: (b) => api("/api/match", b), settings: { ...me.settings, armSec: Number(controls.arm.value) } });
  bindControls(async (s) => {
    store.set("cb-arm", String(s.armSec));
    try {
      await api("/api/settings", s);
    } catch (e) {
      toast("Settings weren't saved", e.message, "error");
    }
  });
  wireEngine(engine, {
    clock: () => Date.now(),
    onFire: async (payload) => {
      try {
        const r = await api("/api/fire", { clipId: payload.clip.id, reason: payload.reason, confidence: payload.confidence, manual: payload.manual });
        if (!r.ok) {
          toast("Held back", r.error, "warn");
          return false;
        }
        toast("Callback is on stream", r.chat || "Overlay notified.");
        return true;
      } catch (e) {
        toast("Callback didn't fire", e.message, "error");
        return false;
      }
    },
  });

  // overlay link
  const url = overlayUrl(me);
  $("stage-controls").innerHTML = `
    <div class="overlay-link">
      <div class="field-head"><span class="label">Overlay link for OBS</span><span class="mono muted small" id="ov-count">${me.overlays} connected</span></div>
      <div class="copy-row"><label class="sr-only" for="ov-url">Overlay URL</label><input id="ov-url" readonly value="${esc(url)}" /><button class="btn btn-sm" type="button" id="copy">Copy</button><button class="btn btn-sm" type="button" id="test">Send test</button></div>
      <p class="hint">Keep it private: anyone with this link can see your callbacks. Add it as a 1920 × 1080 Browser source.</p>
    </div>`;
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Overlay link copied", "Paste it into an OBS Browser source.");
    } catch {
      $("ov-url").closest(".copy-row").classList.add("is-shown");
      $("ov-url").select();
    }
  };
  $("test").onclick = async () => {
    const r = await api("/api/test-overlay", {}).catch((e) => toast("Test didn't send", e.message, "error"));
    if (r) toast(r.overlays ? "Test sent" : "No overlay is connected", r.overlays ? `Showing on ${r.overlays} overlay${r.overlays === 1 ? "" : "s"}.` : "Add the overlay link to OBS first, then try again.", r.overlays ? "ok" : "warn");
  };
  setInterval(async () => {
    const s = await api("/api/me").catch(() => null);
    if (!s) return;
    $("ov-count").textContent = `${s.overlays} connected`;
    setStatus("overlay", s.overlays ? `Overlay ×${s.overlays}` : "No overlay yet", s.overlays ? "live" : "idle");
  }, 15_000);
  setStatus("overlay", me.overlays ? `Overlay ×${me.overlays}` : "No overlay yet", me.overlays ? "live" : "idle");

  renderLiveLibrary(me);

  // chat
  const chat = new TwitchChat(p.login);
  setStatus("chat", "Connecting to chat", "idle");
  chat.addEventListener("status", (e) => setStatus("chat", e.detail === "joined" ? "Chat connected" : "Chat reconnecting", e.detail === "joined" ? "live" : "idle"));
  chat.addEventListener("message", (e) => {
    engine.push(e.detail);
    addChat(e.detail);
  });
  chat.addEventListener("event", (e) => {
    engine.event(e.detail);
    if (e.detail.type === "raid") addSystem(`<b>${esc(e.detail.user)}</b> is raiding with ${e.detail.viewers} viewers`);
  });
  chat.connect();

  const pollChannel = async () => {
    const ch = await api("/api/channel").catch(() => null);
    if (ch?.game) {
      if (engine.game && engine.game !== ch.game) addSystem(`Category is now <b>${esc(ch.game)}</b>`);
      engine.event({ type: "category", game: ch.game });
      $("screen-game").textContent = ch.game.toUpperCase();
    }
  };
  pollChannel();
  setInterval(pollChannel, 60_000);
  setInterval(() => state.clips.size && engine.tick(), 1000);
}

function overlayUrl(me) {
  return `${location.origin}/overlay?c=${encodeURIComponent(me.profile.id)}&k=${encodeURIComponent(me.overlayKey)}`;
}

async function renderLiveLibrary(me) {
  const body = $("library-body");
  const idx = me.index;
  if (idx.state === "running") return pollIndex();
  if (!me.clipCount) {
    body.innerHTML = `
      <div class="connect">
        <svg class="art" viewBox="0 0 140 90" aria-hidden="true"><rect x="10" y="14" width="56" height="34" rx="6" class="e-box"/><rect x="74" y="14" width="56" height="34" rx="6" class="e-box"/><rect x="42" y="52" width="56" height="34" rx="6" class="e-box"/><circle cx="70" cy="69" r="6" class="e-dot"/></svg>
        <p><b>Index your clips to begin.</b> Callback fetches your clip library from Twitch and builds a searchable memory. Usually under a minute.</p>
        <button class="btn btn-primary" type="button" id="index-btn">Index my clips</button>
      </div>`;
    $("index-btn").onclick = startIndex;
    return;
  }
  const clips = await api("/api/clips").catch(() => []);
  body.innerHTML = `<div class="progress-block is-done"><div class="progress-text"><span>${esc(idx.phase || `${me.clipCount} clips indexed`)}</span><button class="btn btn-sm btn-ghost" type="button" id="reindex">Re-index</button></div></div>`;
  $("reindex").onclick = startIndex;
  renderLibrary(clips);
}

async function startIndex() {
  try {
    await api("/api/index", {});
    pollIndex();
  } catch (e) {
    toast("Indexing didn't start", e.message, "error");
  }
}

async function pollIndex() {
  const body = $("library-body");
  body.innerHTML = `<div class="progress-block"><div class="progress-text"><span id="idx-phase">Starting…</span><span id="idx-num">0 clips</span></div><div class="progress-track"><i id="idx-bar"></i></div></div>`;
  librarySkeletonAppend(body);
  const loop = async () => {
    const me = await api("/api/me").catch(() => null);
    if (!me) return setTimeout(loop, 3000);
    const i = me.index;
    $("idx-phase").textContent = i.phase;
    $("idx-num").textContent = `${me.clipCount.toLocaleString()} clips`;
    $("idx-bar").style.setProperty("--v", String(i.windowCount ? Math.max(0.04, i.windowIndex / i.windowCount) : 0.04));
    if (i.state === "running") return setTimeout(loop, 1200);
    if (i.state === "error") {
      banner("Indexing stopped", `<span>${esc(i.error || "Twitch didn't answer.")} Press Re-index to pick it up again.</span>`, true);
    } else {
      toast("Library indexed", `${me.clipCount.toLocaleString()} clips are ready to be called back.`);
    }
    renderLiveLibrary(me);
  };
  loop();
}

function librarySkeletonAppend(body) {
  body.insertAdjacentHTML("beforeend", `<div class="lib-grid">${Array.from({ length: 6 }, () => `<div class="clip"><div class="skeleton" style="aspect-ratio:16/9;border-radius:0"></div><div><div class="skeleton" style="height:12px;margin-bottom:6px"></div><div class="skeleton" style="height:10px;width:60%"></div></div></div>`).join("")}</div>`);
}

(isDemo ? startDemo() : startLive()).catch((e) => {
  console.error(e);
  banner("Something broke while loading", `<span>${esc(e.message)}. Reload the page to try again.</span>`, true);
});

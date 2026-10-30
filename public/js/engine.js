// The callback engine: rolling chat window -> triggers -> retrieval -> decision.
// Runs in the browser for both live chat and the demo replay.

const STOP = new Set(
  "a an the and or but if so to of in on at for with from by is are was were be been am i im you u your he she it its we they this that me my our do does did not no yes yeah lol lmao omg what why how who when where just like really very too can dont will would should could get got go going gonna oh ok okay pls here there now again same one all any some more his her their than as also into out up off over still even chat nice clean lets gooo gg hype everyone guys".split(" "),
);

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/'/g, ""))
    .filter(Boolean);

/** n-grams that start and end on a content word, so "the warden" reduces to "warden". */
function ngrams(text) {
  const w = words(text);
  const out = new Set();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.join("").length < 4) continue;
      out.add(g.join(" "));
    }
  }
  return out;
}

export const DEFAULTS = {
  threshold: 0.72,
  cooldownSec: 240,
  armSec: 3,
  triggers: { velocity: true, phrase: true, events: true },
};

export class CallbackEngine extends EventTarget {
  constructor({ match, settings = {}, now = () => Date.now() }) {
    super();
    this.match = match;
    this.now = now;
    this.settings = { ...DEFAULTS, ...settings, triggers: { ...DEFAULTS.triggers, ...(settings.triggers || {}) } };
    this.reset();
  }

  reset() {
    this.messages = [];
    this.baseline = null;
    this.game = "";
    this.lastQueryAt = 0;
    this.lastQueryKey = "";
    this.lastFiredAt = -Infinity;
    this.firedClips = new Map();
    this.longTerm = new Map();
    this.pendingEvent = null;
    this.armed = null;
    this.busy = false;
  }

  configure(patch) {
    this.settings = { ...this.settings, ...patch, triggers: { ...this.settings.triggers, ...(patch.triggers || {}) } };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  push(msg) {
    const m = { ...msg, at: this.now(), grams: ngrams(msg.text) };
    this.messages.push(m);
    for (const g of m.grams) this.longTerm.set(g, (this.longTerm.get(g) || 0) + 1);
    const cutoff = m.at - 60_000;
    while (this.messages.length && this.messages[0].at < cutoff) this.messages.shift();
  }

  event(ev) {
    if (ev.type === "category") {
      const changed = this.game && this.game !== ev.game;
      this.game = ev.game;
      if (changed && this.settings.triggers.events) this.pendingEvent = { kind: "category", at: this.now() + 8000, ev };
    } else if (ev.type === "raid" && this.settings.triggers.events) {
      this.pendingEvent = { kind: "raid", at: this.now() + 4000, ev };
    }
  }

  cooldownLeft() {
    return Math.max(0, this.settings.cooldownSec * 1000 - (this.now() - this.lastFiredAt));
  }

  /** Call about once a second. */
  async tick() {
    const now = this.now();
    const rate10 = this.messages.filter((m) => m.at > now - 10_000).length;
    if (this.baseline === null) this.baseline = Math.max(rate10, 4);
    const spiking = rate10 >= Math.max(this.baseline * 2.2, 12);
    if (!spiking) this.baseline = this.baseline * 0.94 + rate10 * 0.06;
    const phrases = this.recurringPhrases(now);
    this.emit("pulse", { rate10, baseline: this.baseline, spiking, phrases, cooldownLeft: this.cooldownLeft() });

    if (this.busy || this.armed) return;
    if (now - this.lastQueryAt < 6000) return;

    let trigger = null;
    if (this.pendingEvent && now >= this.pendingEvent.at) {
      const { kind, ev } = this.pendingEvent;
      this.pendingEvent = null;
      trigger = {
        kind,
        label: kind === "raid" ? `Raid from ${ev.user} (${ev.viewers} viewers)` : `Category changed to ${ev.game}`,
        phrases: kind === "raid" ? ["big raid", ...phrases.slice(0, 2).map((p) => p.text)] : phrases.slice(0, 3).map((p) => p.text),
        seed: kind === "raid" ? "A huge raid arrives. Welcome raiders." : `Back to playing ${ev.game}.`,
      };
    } else if (spiking && this.settings.triggers.velocity && phrases.length) {
      trigger = { kind: "velocity", label: `Chat velocity ${rate10}/10s vs ${this.baseline.toFixed(1)} baseline`, phrases: phrases.slice(0, 3).map((p) => p.text) };
    } else if (this.settings.triggers.phrase && phrases[0] && phrases[0].users >= 4) {
      trigger = { kind: "phrase", label: `"${phrases[0].text}" from ${phrases[0].users} different chatters`, phrases: phrases.slice(0, 3).map((p) => p.text) };
    }
    if (!trigger) return;

    const key = `${trigger.kind}:${trigger.phrases[0] || ""}`;
    if (key === this.lastQueryKey && now - this.lastQueryAt < 30_000) return;
    this.lastQueryKey = key;
    this.lastQueryAt = now;
    await this.query(trigger);
  }

  /** Phrases repeated by several distinct chatters in the last 20s, discounted if they're always said. */
  recurringPhrases(now) {
    const recent = this.messages.filter((m) => m.at > now - 20_000);
    const users = new Map();
    for (const m of recent) {
      for (const g of m.grams) {
        if (!users.has(g)) users.set(g, new Set());
        users.get(g).add(m.user);
      }
    }
    const out = [];
    for (const [text, set] of users) {
      if (set.size < 3) continue;
      const everyday = (this.longTerm.get(text) || 0) - set.size;
      const score = set.size * (1 + text.split(" ").length * 0.35) - Math.max(0, everyday) * 0.25;
      if (score > 2.5) out.push({ text, users: set.size, score });
    }
    out.sort((a, b) => b.score - a.score);
    // drop phrases that are fragments of a stronger phrase already listed
    return out.filter((p, i) => !out.slice(0, i).some((q) => q.text.includes(p.text) && q.users >= p.users)).slice(0, 5);
  }

  async query(trigger) {
    this.busy = true;
    const now = this.now();
    const relevant = this.messages
      .filter((m) => m.at > now - 25_000 && trigger.phrases.some((p) => m.text.toLowerCase().includes(p.split(" ")[0])))
      .slice(-10)
      .map((m) => m.text);
    const text = [trigger.seed, trigger.phrases.join(". "), ...relevant, this.game && `Game: ${this.game}`].filter(Boolean).join(". ");

    const id = `${now}-${Math.random().toString(36).slice(2, 7)}`;
    this.emit("trigger", { id, ...trigger, text, game: this.game });
    try {
      const res = await this.match({ text, phrases: trigger.phrases, game: this.game, trigger: trigger.kind, threshold: this.settings.threshold });
      const top = res.candidates[0];
      let decision = "below";
      if (top && top.confidence >= this.settings.threshold && trigger.probe) {
        decision = "would";
      } else if (top && top.confidence >= this.settings.threshold) {
        const reuse = this.firedClips.get(top.clip.id);
        if (reuse && now - reuse < 30 * 60_000) {
          decision = "repeat";
          // chat is still on the moment we just played; give it room
          this.lastQueryAt = now + 15_000;
        } else if (this.cooldownLeft() > 0) decision = "cooldown";
        else decision = "fire";
      }
      const result = { id, trigger, candidates: res.candidates, reason: res.reason, decision, threshold: this.settings.threshold, cooldownLeft: this.cooldownLeft() };
      this.emit("candidate", result);
      if (decision === "fire") this.arm(result);
    } catch (err) {
      this.emit("error", { id, message: err.message || "Matching failed." });
    } finally {
      this.busy = false;
    }
  }

  /** Short arming window so the streamer can veto before anything hits the stream. */
  arm(result) {
    const ms = (this.settings.armSec || 0) * 1000;
    const top = result.candidates[0];
    const payload = { clip: top.clip, reason: result.reason, confidence: top.confidence, manual: false, candidateId: result.id };
    if (ms <= 0) return this.commit(payload);
    this.armed = { ...payload, until: this.now() + ms, timer: setTimeout(() => this.commit(payload), ms) };
    this.emit("armed", { ...payload, ms });
  }

  veto() {
    if (!this.armed) return;
    clearTimeout(this.armed.timer);
    const { candidateId, clip } = this.armed;
    this.armed = null;
    this.emit("vetoed", { candidateId, clip });
  }

  fireManual(candidate, reason) {
    if (this.armed) this.veto();
    this.commit({ clip: candidate.clip, reason, confidence: candidate.confidence, manual: true });
  }

  commit(payload) {
    this.armed = null;
    this.lastFiredAt = this.now();
    this.firedClips.set(payload.clip.id, this.now());
    this.emit("fire", payload);
  }
}

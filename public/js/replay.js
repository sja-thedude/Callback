// Replays a recorded chat log on a virtual clock that can pause, change speed, seek and loop.
// The engine reads replay.now(), so cooldowns stay correct at any playback speed.

export async function loadDemo() {
  const [log, lib] = await Promise.all([
    fetch("/demo/chat.json").then((r) => r.json()),
    fetch("/demo/clips.json").then((r) => r.json()),
  ]);
  return { log, lib };
}

export class Replay extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.speed = 1;
    this.playing = false;
    this.pos = 0; // ms into the log
    this.loops = 0;
    this.mi = 0;
    this.ei = 0;
    this.last = 0;
    this.timer = null;
  }

  /** Virtual time that never goes backwards, even across loops. */
  now() {
    return this.loops * this.log.durationMs + this.pos;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    this.timer = setInterval(() => this.step(), 100);
    this.dispatchEvent(new Event("state"));
  }

  pause() {
    this.playing = false;
    clearInterval(this.timer);
    this.dispatchEvent(new Event("state"));
  }

  setSpeed(s) {
    this.speed = s;
    this.dispatchEvent(new Event("state"));
  }

  seek(ms) {
    this.pos = Math.max(0, Math.min(ms, this.log.durationMs - 1));
    this.mi = this.log.messages.findIndex((m) => m.t > this.pos);
    if (this.mi < 0) this.mi = this.log.messages.length;
    this.ei = 0;
    // re-apply the latest category so the engine knows what game is on
    const cat = [...this.log.events].reverse().find((e) => e.type === "category" && e.t <= this.pos);
    while (this.ei < this.log.events.length && this.log.events[this.ei].t <= this.pos) this.ei++;
    this.dispatchEvent(new CustomEvent("seek", { detail: { pos: this.pos, category: cat } }));
  }

  step() {
    const t = performance.now();
    const dt = (t - this.last) * this.speed;
    this.last = t;
    this.pos += dt;
    const { messages, events, durationMs } = this.log;
    while (this.ei < events.length && events[this.ei].t <= this.pos) {
      this.dispatchEvent(new CustomEvent("event", { detail: events[this.ei++] }));
    }
    while (this.mi < messages.length && messages[this.mi].t <= this.pos) {
      this.dispatchEvent(new CustomEvent("message", { detail: messages[this.mi++] }));
    }
    if (this.pos >= durationMs) {
      this.loops++;
      this.pos = 0;
      this.mi = 0;
      this.ei = 0;
      this.dispatchEvent(new Event("loop"));
    }
    this.dispatchEvent(new Event("tick"));
  }
}

export async function demoMatch(body) {
  const res = await fetch("/api/demo/match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "The matcher didn't answer. Retrying on the next trigger.");
  }
  return res.json();
}

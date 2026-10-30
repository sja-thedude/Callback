import { initTheme, initReveals, countUp, esc, ago, fmtDate } from "./ui.js";

initTheme();

const nav = document.querySelector(".nav");
addEventListener("scroll", () => nav.classList.toggle("is-scrolled", scrollY > 8), { passive: true });

const RHYMES = [
  { id: "warden-nine", chat: ["NOT THE WARDEN AGAIN", "floor three curse is real"] },
  { id: "built-different", chat: ["she said built different", "famous last words"] },
  { id: "sleep-stream", chat: ["remember the 12 hour stream", "dont fall asleep this time"] },
];

const lib = await fetch("/demo/clips.json").then((r) => r.json());
const byId = new Map(lib.clips.map((c) => [c.id, c]));

document.getElementById("rhyme-grid").innerHTML = RHYMES.map(({ id, chat }, i) => {
  const c = byId.get(id);
  return `<article class="rhyme card reveal" style="--i:${i}">
    <div class="rhyme-now">
      <span class="eyebrow">Live chat, now</span>
      ${chat.map((t) => `<span class="bubble">${esc(t)}</span>`).join("")}
    </div>
    <div class="rhyme-then">
      <img src="${c.thumbnail}" alt="Illustrated still from the clip: ${esc(c.title)}" width="480" height="270" loading="lazy" />
      <span class="then-tag">⏪ ${esc(fmtDate(c.created_at).toUpperCase())}</span>
    </div>
    <div class="rhyme-cap">
      <span class="eyebrow">${esc(c.game)} · ${esc(ago(c.created_at))}</span>
      <h3>${esc(c.title)}</h3>
    </div>
  </article>`;
}).join("");

for (const v of document.querySelectorAll("[data-bars]")) {
  v.addEventListener("revealed", () => {
    const score = v.querySelector("[data-count]");
    countUp(score, Number(score.dataset.count), { format: (n) => `${Math.round(n)}%` });
  });
}
initReveals();

// hero chat: the demo log, one message at a time, looping
const log = await fetch("/demo/chat.json").then((r) => r.json());
const list = document.getElementById("hero-chat");
let i = 0;
function addMessage() {
  const m = log.messages[i++ % log.messages.length];
  const li = document.createElement("li");
  li.innerHTML = `<b style="color:${m.color}">${esc(m.user)}</b> ${esc(m.text)}`;
  list.append(li);
  while (list.children.length > 22) list.firstElementChild.remove();
}
for (let n = 0; n < 14; n++) addMessage();
(function pump() {
  addMessage();
  setTimeout(pump, 600 + Math.random() * 1000);
})();

// Small shared UI helpers: theme toggle, toasts, scroll reveals, range fills, count-ups.

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // storage unavailable (private window, blocked); the setting just won't persist
    }
  },
};
export { store };

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initTheme() {
  for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
    const sync = () => {
      const t = currentTheme();
      btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
      document.documentElement.dataset.theme = t;
    };
    sync();
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("cb-theme", next);
      sync();
      document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
    });
  }
}

export function toast(title, body = "", kind = "ok", ms = 4200) {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind === "error" ? "is-error" : kind === "warn" ? "is-warn" : ""}`;
  el.innerHTML = `<div><strong></strong><span></span></div>`;
  el.querySelector("strong").textContent = title;
  el.querySelector("span").textContent = body;
  host.append(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, ms);
}

export function initReveals(root = document) {
  const els = root.querySelectorAll(".reveal:not(.is-in)");
  if (!("IntersectionObserver" in window) || reducedMotion()) {
    els.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        e.target.dispatchEvent(new CustomEvent("revealed"));
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  els.forEach((el) => io.observe(el));
}

export function syncRange(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  input.style.setProperty("--fill", `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

export function initSegmented(el, onChange) {
  const buttons = [...el.querySelectorAll("button")];
  let thumb = el.querySelector(".thumb");
  if (!thumb) {
    thumb = document.createElement("span");
    thumb.className = "thumb";
    thumb.setAttribute("aria-hidden", "true");
    el.prepend(thumb);
  }
  const place = () => {
    const i = Math.max(0, buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true"));
    const b = buttons[i];
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft - 4}px)`;
  };
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      place();
      onChange?.(b.dataset.value);
    }),
  );
  requestAnimationFrame(place);
  addEventListener("resize", place);
  return { place };
}

export function countUp(el, to, { ms = 900, format = (n) => Math.round(n).toLocaleString() } = {}) {
  if (reducedMotion()) {
    el.textContent = format(to);
    return;
  }
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ago(iso) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 45) return `${days} days ago`;
  if (days < 700) return `${Math.round(days / 30.4)} months ago`;
  const y = Math.round(days / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function compact(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

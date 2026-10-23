// The sign-in window, and the account menu that replaces "Log in" / "Start free" once somebody is signed in.
// Every page has the menu (Nav.astro), so this is started from there.
import { cachedUser, getMe, renderGoogleButton, signOut } from "./auth";
import type { AuthUser } from "./auth";
import { levelFraction, levelRing } from "./levelRing";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// ---- the sign-in window ----------------------------------------------------------------------------------------------

let dialog: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;

export function closeSignIn() {
  dialog?.remove();
  dialog = null;
  document.body.style.overflow = "";
  returnFocus?.focus();
}

export async function openSignIn() {
  if (dialog) return;
  returnFocus = document.activeElement as HTMLElement | null;
  const backdrop = el("div", "au-backdrop");
  const box = el("div", "au-dialog");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "au-title");

  const close = el("button", "au-close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  close.addEventListener("click", closeSignIn);

  const mark = el("div", "au-mark");
  mark.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M5 11v4M9.5 7v12M14 4v18M18.5 8v10M23 11v4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const title = el("h2", "au-title", "Welcome to Chord Suno");
  title.id = "au-title";
  const sub = el("p", "au-sub", "Sign in, or create your account, with Google. There is no password to remember.");
  const slot = el("div", "au-button");
  const status = el("p", "au-status");
  status.setAttribute("role", "status");
  const fine = el("p", "au-fine", "We only receive your name, email address and profile picture from Google. By continuing you agree to the ");
  for (const [text, href, after] of [["Terms of Service", "/terms/", " and "], ["Privacy Policy", "/privacy/", "."]] as const) {
    const link = el("a", "", text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    fine.append(link, after);
  }
  box.append(close, mark, title, sub, slot, status, fine);
  backdrop.append(box);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeSignIn();
  });
  document.addEventListener(
    "keydown",
    function onKey(event) {
      if (!dialog) return document.removeEventListener("keydown", onKey);
      if (event.key === "Escape") closeSignIn();
    },
  );
  document.body.append(backdrop);
  document.body.style.overflow = "hidden";
  dialog = backdrop;
  close.focus();

  const on = await renderGoogleButton(
    slot,
    () => closeSignIn(),
    (message) => {
      status.textContent = message;
      status.classList.add("bad");
    },
  );
  if (!on) {
    slot.hidden = true;
    status.textContent = "Sign-in is not switched on yet. Please check back soon.";
    status.classList.add("bad");
  }
}

// ---- the menu ---------------------------------------------------------------------------------------------------------

const numberText = (n: number) => n.toLocaleString();

/** A game-style card: the person's ring, level and title, an XP bar made of ten steps, and their streak. */
function hud(user: AuthUser) {
  const root = el("div", "au-hud");
  const top = el("div", "au-hud-top");
  const ring = levelRing(user, 64);
  const who = el("div", "au-hud-who");
  const name = el("strong", "", user.name || user.email);
  const email = el("span", "", user.email);
  who.append(name, email);
  top.append(ring.el, who);

  const rank = el("div", "au-hud-rank");
  const level = el("span", "au-hud-level");
  const title = el("span", "au-hud-title");
  rank.append(level, title);

  const bar = el("div", "au-xp");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Progress to the next level");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("i");
  bar.append(fill);
  const nums = el("div", "au-xp-nums");
  const have = el("b");
  const need = el("span");
  nums.append(have, need);

  const streak = el("div", "au-streak");
  const plan = el("div", "au-plan");
  const planName = el("span");
  const upgrade = el("a", "au-upgrade", "Upgrade →");
  upgrade.href = "/pricing/";
  plan.append(planName, upgrade);
  root.append(top, rank, bar, nums, streak, plan);

  const update = (next: AuthUser) => {
    ring.update(next);
    const stars = next.stars ? " " + "★".repeat(Math.min(next.stars, 5)) : "";
    level.textContent = next.level ? `LEVEL ${next.level}` : "";
    title.textContent = next.level ? `${next.title ?? ""}${stars}` : "";
    const percent = Math.round(levelFraction(next) * 100);
    fill.style.width = `${percent}%`;
    bar.setAttribute("aria-valuenow", String(percent));
    have.textContent = next.levelSpan ? `${numberText(next.intoLevel ?? 0)} / ${numberText(next.levelSpan)} XP` : "";
    need.textContent = next.levelSpan ? `${numberText(Math.max(0, (next.nextLevelXp ?? 0) - (next.xp ?? 0)))} to level ${(next.level ?? 1) + 1}` : "";
    streak.textContent = next.streak ? `🔥 ${next.streak}-day streak` : "";
    streak.hidden = !next.streak;
    planName.textContent = next.planName ? `${next.planName} plan` : "";
    upgrade.hidden = next.plan !== "free";
    plan.hidden = !next.planName;
    rank.hidden = bar.hidden = nums.hidden = !next.level;
  };
  update(user);
  return { el: root, update };
}

function userMenu(user: AuthUser) {
  const wrap = el("div", "au-menu");
  const trigger = el("button", "au-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Account menu for ${user.name || user.email}${user.level ? `, level ${user.level}` : ""}`);
  const ring = levelRing(user, 44);
  trigger.append(ring.el);

  const panel = el("div", "au-panel");
  panel.setAttribute("role", "menu");
  panel.hidden = true;
  const card = hud(user);
  panel.append(card.el);
  const library = el("a", "au-item", "My library");
  library.href = "/library/";
  library.setAttribute("role", "menuitem");
  const billing = el("a", "au-item", "Plans & billing");
  billing.href = "/pricing/";
  billing.setAttribute("role", "menuitem");
  panel.append(library, billing);
  if (user.isAdmin) {
    const admin = el("a", "au-item", "Admin");
    admin.href = "/admin/";
    admin.setAttribute("role", "menuitem");
    panel.append(admin);
  }
  const out = el("button", "au-item", "Sign out");
  out.type = "button";
  out.setAttribute("role", "menuitem");
  out.addEventListener("click", async () => {
    out.textContent = "Signing out…";
    await signOut();
    if (location.pathname.startsWith("/admin")) location.reload();
  });
  panel.append(out);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  wrap.append(trigger, panel);
  return {
    el: wrap,
    update: (next: AuthUser) => {
      ring.update(next);
      card.update(next);
      trigger.setAttribute("aria-label", `Account menu for ${next.name || next.email}${next.level ? `, level ${next.level}` : ""}`);
    },
  };
}

// What is drawn in each place, so a change in XP moves the ring that is there instead of building it again.
const drawn = new WeakMap<HTMLElement, { id: string; update: (user: AuthUser) => void }>();

function render(user: AuthUser | null) {
  document.querySelectorAll<HTMLElement>("[data-auth-guest]").forEach((node) => (node.hidden = !!user));
  document.querySelectorAll<HTMLElement>("[data-auth-slot]").forEach((slot) => {
    if (!user) {
      slot.replaceChildren();
      drawn.delete(slot);
      return;
    }
    const mine = drawn.get(slot);
    if (mine && mine.id === user.id) return mine.update(user);
    const menu = userMenu(user);
    slot.replaceChildren(menu.el);
    drawn.set(slot, { id: user.id, update: menu.update });
  });
  document.querySelectorAll<HTMLElement>("[data-auth-mobile]").forEach((node) => {
    if (!user) {
      node.replaceChildren();
      drawn.delete(node);
      return;
    }
    const mine = drawn.get(node);
    if (mine && mine.id === user.id) return mine.update(user);
    const card = hud(user);
    card.el.classList.add("au-hud-mobile");
    const library = el("a", "au-mobile-link", "My library");
    library.href = "/library/";
    node.replaceChildren(card.el, library);
    if (user.isAdmin) {
      const admin = el("a", "au-mobile-link", "Admin");
      admin.href = "/admin/";
      node.append(admin);
    }
    const out = el("button", "au-mobile-link", "Sign out");
    out.type = "button";
    out.addEventListener("click", () => signOut());
    node.append(out);
    drawn.set(node, { id: user.id, update: card.update });
  });
}

export function initAuthUi() {
  document.querySelectorAll<HTMLElement>('[data-auth="open"]').forEach((button) =>
    button.addEventListener("click", (event) => {
      event.preventDefault();
      // The phone menu covers the page: close it first so the window is not hidden behind it.
      document.getElementById("mobile-menu")?.classList.remove("open");
      document.body.style.overflow = "";
      openSignIn();
    }),
  );
  window.addEventListener("auth-change", (event) => render((event as CustomEvent<AuthUser | null>).detail));
  render(cachedUser()); // straight away, from what was remembered
  getMe().then(render); // then what the server says
}

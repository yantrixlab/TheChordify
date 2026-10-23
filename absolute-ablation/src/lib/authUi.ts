// The sign-in window, and the account menu that replaces "Log in" / "Start free" once somebody is signed in.
// Every page has the menu (Nav.astro), so this is started from there.
import { cachedUser, getMe, renderGoogleButton, signOut } from "./auth";
import type { AuthUser } from "./auth";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const initials = (user: AuthUser) =>
  (user.name || user.email)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function avatar(user: AuthUser, size: number): HTMLElement {
  const box = el("span", "au-avatar");
  box.style.width = box.style.height = `${size}px`;
  box.style.fontSize = `${Math.round(size * 0.4)}px`;
  if (user.picture) {
    const img = el("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = user.picture;
    img.addEventListener("error", () => img.replaceWith(document.createTextNode(initials(user))));
    box.append(img);
  } else {
    box.textContent = initials(user);
  }
  return box;
}

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
  const fine = el("p", "au-fine", "We only receive your name, email address and profile picture from Google.");
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

function userMenu(user: AuthUser): HTMLElement {
  const wrap = el("div", "au-menu");
  const trigger = el("button", "au-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Account menu for ${user.name || user.email}`);
  trigger.append(avatar(user, 34));

  const panel = el("div", "au-panel");
  panel.setAttribute("role", "menu");
  panel.hidden = true;
  const head = el("div", "au-who");
  head.append(avatar(user, 40));
  const names = el("div", "au-names");
  names.append(el("strong", "", user.name || user.email), el("span", "", user.email));
  head.append(names);
  panel.append(head);
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
  return wrap;
}

function render(user: AuthUser | null) {
  document.querySelectorAll<HTMLElement>("[data-auth-guest]").forEach((node) => (node.hidden = !!user));
  document.querySelectorAll<HTMLElement>("[data-auth-slot]").forEach((slot) => {
    slot.replaceChildren();
    if (user) slot.append(userMenu(user));
  });
  document.querySelectorAll<HTMLElement>("[data-auth-mobile]").forEach((node) => {
    node.replaceChildren();
    if (!user) return;
    const row = el("div", "au-mobile");
    row.append(avatar(user, 40));
    const names = el("div", "au-names");
    names.append(el("strong", "", user.name || user.email), el("span", "", user.email));
    row.append(names);
    node.append(row);
    if (user.isAdmin) {
      const admin = el("a", "au-mobile-link", "Admin");
      admin.href = "/admin/";
      node.append(admin);
    }
    const out = el("button", "au-mobile-link", "Sign out");
    out.type = "button";
    out.addEventListener("click", () => signOut());
    node.append(out);
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

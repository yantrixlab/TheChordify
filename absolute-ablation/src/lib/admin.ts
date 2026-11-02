// Shared bits of the admin pages: asking the server as staff, getting past the sign-in gate, and small helpers for drawing rows.
// Staff are people whose role has some permissions: signed in with Google or with an email and password (an administrator is also
// anybody in ADMIN_EMAILS). The admin token (ADMIN_TOKEN) still works as a way in that does not depend on either. The server
// decides what each person may do; the pages only hide what the person's role cannot use.
import { API_BASE } from "./api";
import { getAuthConfig, renderGoogleButton } from "./auth";
import type { AuthUser } from "./auth";

export interface AdminInfo {
  admin: true;
  via: "session" | "token";
  user: AuthUser | null;
  role: string;
  roleName: string;
  isSuper: boolean; // an administrator: every permission, always
  permissions: string[];
  hasPassword: boolean;
}

let me: AdminInfo | null = null;

/** Whether the signed-in person's role allows `permission` ("x.manage" covers "x.view"). Administrators can do everything. */
export function can(permission: string): boolean {
  if (!me) return false;
  if (me.isSuper) return true;
  return me.permissions.includes(permission) || (permission.endsWith(".view") && me.permissions.includes(permission.slice(0, -5) + ".manage"));
}

export const adminInfo = (): AdminInfo | null => me;

export class AdminError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "cs-admin";
let token = "";
try {
  token = sessionStorage.getItem(TOKEN_KEY) ?? "";
} catch {
  // no storage: the token is just asked for again
}

/** Calls an /api/admin route with the cookie, and the admin token if one was entered. Returns the JSON answer. */
export async function adminFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-Admin-Token"] = token;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new AdminError("Could not reach the server.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(typeof body.detail === "string" ? body.detail : `Request failed (${res.status})`, res.status);
  return body as T;
}

// ---- the gate ---------------------------------------------------------------------------------------------------------

let ready: Promise<AdminInfo> | null = null;
let resolveReady: (info: AdminInfo) => void = () => {};

/** Resolves once the person has been let in. Pages wait on this before they draw anything or call the server. */
export function adminReady(): Promise<AdminInfo> {
  ready ??= new Promise((resolve) => (resolveReady = resolve));
  return ready;
}

function enter(info: AdminInfo) {
  me = info;
  document.getElementById("adm-gate")!.hidden = true;
  const who = document.getElementById("adm-who");
  if (who) {
    who.textContent = info.user ? `${info.user.name || info.user.email} · ${info.roleName}` : "Admin token";
    who.title = info.user ? info.user.email : "Signed in with the admin token";
  }

  // The menu and any link that carries data-perm show only what this role can use.
  document.querySelectorAll<HTMLElement>("[data-perm]").forEach((node) => {
    const needed = (node.dataset.perm ?? "").split("|").filter(Boolean);
    node.hidden = needed.length > 0 && !needed.some(can);
  });
  const changePassword = document.getElementById("adm-password-open");
  if (changePassword) changePassword.hidden = !info.hasPassword;

  // A page needs a permission: without it nothing on it runs (the server would refuse anyway), and the person is shown where they can go.
  const page = document.getElementById("adm-app")!;
  const needed = (page.dataset.perm ?? "").split("|").filter(Boolean);
  if (needed.length > 0 && !needed.some(can)) {
    const first = document.querySelector<HTMLAnchorElement>(".adm-nav a:not([hidden])");
    if (page.dataset.home === "1" && first && first.getAttribute("href") !== location.pathname) {
      location.replace(first.href); // the front page is not for this role: go to the first page that is
      return;
    }
    document.getElementById("adm-denied")!.hidden = false;
    return;
  }
  const manage = (page.dataset.manage ?? "").split("|").filter(Boolean);
  const readonly = document.getElementById("adm-readonly");
  if (readonly) readonly.hidden = manage.length === 0 || manage.some(can);
  page.hidden = false;
  resolveReady(info);
}

/** Started once by the admin layout: asks the server who this is, and shows the gate if they are not an admin. */
export async function startAdmin() {
  adminReady(); // make sure the promise exists before any page waits on it
  const gate = document.getElementById("adm-gate")!;
  const message = document.getElementById("adm-gate-msg")!;
  const say = (text: string, bad = true) => {
    message.textContent = text;
    message.className = `adm-msg ${bad ? "bad" : ""}`.trim();
  };

  const check = async (): Promise<boolean> => {
    try {
      enter(await adminFetch<AdminInfo>("/api/admin/me"));
      return true;
    } catch (err) {
      if (err instanceof AdminError && err.status === 404) {
        say("The admin is switched off. Set ADMIN_EMAILS (and GOOGLE_CLIENT_ID) in the server's environment to turn it on.");
      } else if (err instanceof AdminError && err.status === 0) {
        say(err.message);
      } else if (err instanceof AdminError && err.status === 401 && token) {
        say("That admin token was not accepted.");
      }
      return false;
    }
  };

  if (await check()) return;
  gate.hidden = false;

  // Email and password (staff accounts an administrator made)
  const passwordForm = document.getElementById("adm-login-form") as HTMLFormElement;
  const loginEmail = document.getElementById("adm-login-email") as HTMLInputElement;
  const loginPassword = document.getElementById("adm-login-password") as HTMLInputElement;
  const loginButton = document.getElementById("adm-login-go") as HTMLButtonElement;
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    say("Signing in…", false);
    try {
      await adminFetch("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value }) });
      loginPassword.value = "";
      if (!(await check())) say("That account has no access to the admin.");
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      loginButton.disabled = false;
    }
  });

  // Google sign-in, if the server has it
  const slot = document.getElementById("adm-google")!;
  const config = await getAuthConfig();
  if (config.enabled) {
    slot.hidden = false;
    await renderGoogleButton(
      slot,
      async () => {
        if (!(await check())) say("That Google account is not an admin of this site.");
      },
      (text) => say(text),
    );
  }

  // The admin token, as the other way in
  const form = document.getElementById("adm-token-form") as HTMLFormElement;
  const input = document.getElementById("adm-token") as HTMLInputElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    token = input.value.trim();
    if (await check()) {
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        // fine
      }
    }
  });
}

// ---- small helpers ----------------------------------------------------------------------------------------------------

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function say(id: string, text: string, kind: "ok" | "bad" | "" = "") {
  const node = $(id);
  node.textContent = text;
  node.className = `adm-msg ${kind}`.trim();
}

/** A line with a coloured dot: green for fine, red for wrong, amber for "look at this". */
export function statusLine(ok: boolean | "warn", text: string): HTMLLIElement {
  const li = el("li");
  li.append(el("span", `adm-dot ${ok === "warn" ? "warn" : ok ? "ok" : "bad"}`), el("span", "", text));
  return li;
}

export const when = (seconds: number | null | undefined): string =>
  seconds ? new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

export const day = (seconds: number | null | undefined): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString([], { dateStyle: "medium" }) : "—";

export const number = (n: number): string => n.toLocaleString();

/** An amount held in the smallest unit (paise, cents) as money: 49900 INR -> ₹499.00. */
export function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

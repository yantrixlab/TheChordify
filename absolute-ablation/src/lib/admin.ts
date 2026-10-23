// Shared bits of the admin pages: asking the server as an admin, getting past the sign-in gate, and small helpers for
// drawing rows. An admin is somebody signed in with a Google account the server lists in ADMIN_EMAILS; the admin token
// (ADMIN_TOKEN) still works as a way in that does not depend on Google.
import { API_BASE } from "./api";
import { getAuthConfig, renderGoogleButton } from "./auth";
import type { AuthUser } from "./auth";

export interface AdminInfo {
  admin: true;
  via: "google" | "token";
  user: AuthUser | null;
}

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
  document.getElementById("adm-gate")!.hidden = true;
  document.getElementById("adm-app")!.hidden = false;
  const who = document.getElementById("adm-who");
  if (who) {
    who.textContent = info.user ? `${info.user.name || info.user.email}` : "Admin token";
    who.title = info.user ? info.user.email : "Signed in with the admin token";
  }
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

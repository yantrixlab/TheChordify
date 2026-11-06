// A page opened with ?ref=<name> (an influencer's link to a particular page) tells the server who sent the visitor, once per visit; the
// server counts the click and remembers the influencer in a cookie. The address is then tidied, so the ?ref= is not shared on.
// (The short links, chordsuno.com/r/<name>, are handled by the server itself and never reach this code.)
import { API_BASE } from "./api";

const KEY = "chordsuno-ref-sent";

export function noteReferral() {
  let slug = "";
  try {
    const url = new URL(location.href);
    slug = (url.searchParams.get("ref") ?? "").trim().toLowerCase();
    if (!slug) return;
    url.searchParams.delete("ref");
    history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  } catch {
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) return;
  try {
    if (sessionStorage.getItem(KEY) === slug) return; // a refresh is not another click
    sessionStorage.setItem(KEY, slug);
  } catch {
    // no storage: it may be counted again on a refresh, which is fine
  }
  void fetch(`${API_BASE}/api/ref/click`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, landing: location.pathname }),
    keepalive: true,
  }).catch(() => {});
}

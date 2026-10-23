// Sends what people do to Google Analytics as events (the page views themselves are counted by the tag in the page head).
// Nothing personal goes in: no names, emails or ids of people, only what was done. Does nothing when analytics is off or blocked.
type Params = Record<string, string | number | boolean>;

export function track(event: string, params: Params = {}): void {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag === "function") gtag("event", event, params);
  } catch {
    // analytics must never get in the way of the page
  }
}

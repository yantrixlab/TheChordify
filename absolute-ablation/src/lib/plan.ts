// What the visitor's plan includes (Free unless they have paid), so the app can switch features on or off to match what the
// admin set. A feature the plan has no rule for is allowed, and until the answer arrives nothing is locked.
import { API_BASE } from "./api";
import { toast } from "./toast";

export interface Rule {
  enabled: boolean;
  value: number | null; // a limit: null is unlimited
}

export interface Subscription {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentEnd: number | null;
  priceId: string;
  period: string;
  intervalCount: number;
  amountMinor: number;
  currency: string;
}

export interface MyPlan {
  signedIn: boolean;
  plan: { id: string; code: string; name: string; isFree: boolean };
  entitlements: Record<string, Rule>;
  subscription: Subscription | null;
}

let current: MyPlan | null = null;
let pending: Promise<MyPlan | null> | null = null;

/** Fetches the plan (once, unless `force`), and tells the page with a "plan-change" event. */
export function loadPlan(force = false): Promise<MyPlan | null> {
  if (pending && !force) return pending;
  pending = fetch(`${API_BASE}/api/me/plan`, { credentials: "include" })
    .then((res) => (res.ok ? (res.json() as Promise<MyPlan>) : null))
    .catch(() => null)
    .then((plan) => {
      if (plan) {
        current = plan;
        window.dispatchEvent(new CustomEvent("plan-change", { detail: plan }));
      }
      return plan;
    });
  return pending;
}

export const myPlan = (): MyPlan | null => current;

/** Whether the plan includes a feature (true when it has no rule for it, or the answer has not come yet). */
export function can(key: string): boolean {
  const rule = current?.entitlements[key];
  return rule === undefined ? true : rule.enabled;
}

/** The most the plan allows: null for no limit, 0 for not included. */
export function limitOf(key: string): number | null {
  const rule = current?.entitlements[key];
  if (rule === undefined) return null;
  return rule.enabled ? rule.value : 0;
}

/** Tells somebody a feature needs a better plan, with a way to see the plans. */
export function nudge(feature: string) {
  toast({ icon: "🔒", title: `${feature} is on a paid plan`, text: "See what each plan includes.", href: "/pricing/", ms: 6000 });
}

// A different person (signing in or out) has a different plan. The same person earning XP does not.
let planFor: string | null | undefined;
window.addEventListener("auth-change", (event) => {
  const id = (event as CustomEvent<{ id: string } | null>).detail?.id ?? null;
  if (id === planFor) return;
  planFor = id;
  void loadPlan(true);
});

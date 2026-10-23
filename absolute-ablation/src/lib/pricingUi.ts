// Draws the plans: cards with a monthly/yearly switch, a "your plan" banner, and a table that compares every feature.
// It is used by the pricing page and, in a compact form, by the home page. All of it comes from /api/pricing, which reads what the
// admin set on each load, so a change in the admin shows here at once with nothing to rebuild.
import { API_BASE } from "./api";
import { cachedUser } from "./auth";
import { openSignIn } from "./authUi";
import { cancelSubscription, startCheckout } from "./billing";
import { loadPlan, myPlan } from "./plan";
import type { MyPlan, Rule } from "./plan";

export interface PricingPrice {
  id: string;
  period: string;
  intervalCount: number;
  amountMinor: number;
  currency: string;
  ready: boolean;
}

export interface PricingPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  badge: string;
  cta: string;
  featured: boolean;
  isFree: boolean;
  prices: PricingPrice[];
  entitlements: Record<string, Rule>;
}

export interface PricingFeature {
  key: string;
  label: string;
  description: string;
  kind: "flag" | "limit";
  unit: string;
  group: string;
  status: "live" | "soon";
}

export interface PricingData {
  plans: PricingPlan[];
  features: PricingFeature[];
  checkout: { enabled: boolean; mode: string };
}

export async function fetchPricing(): Promise<PricingData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pricing`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PricingData) : null;
  } catch {
    return null;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const CHECK = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor" fill-opacity="0.14"/><path d="m5.8 10.4 2.7 2.7 5.7-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DASH = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 10h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const MONTHS: Record<string, number> = { daily: 1 / 30, weekly: 12 / 52, monthly: 1, quarterly: 3, yearly: 12 };
const PERIOD_WORD: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" };

export function money(minor: number, currency: string): string {
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

const months = (price: PricingPrice) => (MONTHS[price.period] ?? 1) * price.intervalCount;

/** The text of a feature for a plan: its name, or for a limit the number in front of it ("25 favourite songs", "Unlimited ..."). */
export function featureText(feature: PricingFeature, rule: Rule | undefined): string {
  if (feature.kind === "flag" || !rule) return feature.label;
  const label = feature.label.charAt(0).toLowerCase() + feature.label.slice(1);
  return `${rule.value === null ? "Unlimited" : rule.value.toLocaleString()} ${label}`;
}

const included = (plan: PricingPlan, key: string) => plan.entitlements[key]?.enabled === true;

interface Options {
  compact?: boolean; // the home page: no comparison table, fewer features on a card
}

export function renderPricing(root: HTMLElement, initial: PricingData, options: Options = {}) {
  let data = initial;
  const periods = () => (["monthly", "yearly"] as const).filter((p) => data.plans.some((plan) => plan.prices.some((x) => x.period === p && x.intervalCount === 1)));
  let period: string = periods().includes("yearly") ? "yearly" : (periods()[0] ?? "monthly");

  const priceFor = (plan: PricingPlan): PricingPrice | undefined =>
    plan.prices.find((p) => p.period === period && p.intervalCount === 1) ?? plan.prices.find((p) => p.intervalCount === 1) ?? plan.prices[0];

  /** The biggest saving a yearly price gives over twelve monthly ones, for the label on the switch. */
  const bestSaving = () => {
    let best = 0;
    for (const plan of data.plans) {
      const monthly = plan.prices.find((p) => p.period === "monthly" && p.intervalCount === 1);
      const yearly = plan.prices.find((p) => p.period === "yearly" && p.intervalCount === 1);
      if (monthly && yearly && monthly.currency === yearly.currency) best = Math.max(best, Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100));
    }
    return best;
  };

  const saving = (plan: PricingPlan) => {
    const monthly = plan.prices.find((p) => p.period === "monthly" && p.intervalCount === 1);
    const yearly = plan.prices.find((p) => p.period === "yearly" && p.intervalCount === 1);
    return monthly && yearly && monthly.currency === yearly.currency ? Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100) : 0;
  };

  // ---- the switch ---------------------------------------------------------------------------------------------------

  function switcher(): HTMLElement | null {
    const available = periods();
    if (available.length < 2) return null;
    const wrap = el("div", "pr-switch");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Billing period");
    available.forEach((p) => {
      const button = el("button", p === period ? "is-on" : "");
      button.type = "button";
      button.setAttribute("aria-pressed", String(p === period));
      button.append(p === "monthly" ? "Monthly" : "Yearly");
      if (p === "yearly" && bestSaving() > 0) button.append(el("span", "pr-save", `Save ${bestSaving()}%`));
      button.addEventListener("click", () => {
        period = p;
        draw();
      });
      wrap.append(button);
    });
    return wrap;
  }

  // ---- a plan card --------------------------------------------------------------------------------------------------

  function card(plan: PricingPlan): HTMLElement {
    const mine: MyPlan | null = myPlan();
    const onThis = !!mine && mine.plan.code === plan.code;
    const box = el("article", `pr-card${plan.featured ? " is-featured" : ""}${onThis ? " is-current" : ""}`);
    if (plan.badge) box.append(el("span", "pr-ribbon", plan.badge));
    box.append(el("h3", "pr-name", plan.name));
    if (plan.description) box.append(el("p", "pr-desc", plan.description));

    const price = priceFor(plan);
    const amount = el("div", "pr-amount");
    if (plan.isFree || !price) {
      amount.append(el("strong", "", "Free"), el("span", "pr-per", "forever"));
      box.append(amount);
      box.append(el("p", "pr-bill", "No card needed"));
    } else {
      const perMonth = price.amountMinor / months(price);
      amount.append(el("strong", "", money(Math.round(perMonth / 100) * 100, price.currency)), el("span", "pr-per", "/ month"));
      box.append(amount);
      const bill = el("p", "pr-bill");
      if (price.period === "monthly" && price.intervalCount === 1) bill.textContent = "Billed monthly";
      else {
        const every = price.intervalCount > 1 ? `every ${price.intervalCount} ${PERIOD_WORD[price.period]}s` : PERIOD_WORD[price.period] === "year" ? "yearly" : `per ${PERIOD_WORD[price.period]}`;
        bill.append(`Billed ${money(price.amountMinor, price.currency)} ${every}`);
        const off = saving(plan);
        if (price.period === "yearly" && off > 0) bill.append(el("em", "", ` · ${off}% off`));
      }
      box.append(bill);
    }

    // the button
    const button = el("button", "pr-cta");
    button.type = "button";
    if (onThis) {
      button.textContent = "Your current plan";
      button.disabled = true;
    } else if (plan.isFree) {
      if (mine && !mine.plan.isFree) {
        button.textContent = "Free plan";
        button.disabled = true;
      } else {
        button.textContent = plan.cta || "Get started free";
        button.addEventListener("click", () => (cachedUser() ? (window.location.href = "/library/") : openSignIn()));
      }
    } else if (!data.checkout.enabled || !price || !price.ready) {
      button.textContent = "Coming soon";
      button.disabled = true;
      button.title = "Payments are not switched on yet.";
    } else {
      button.textContent = plan.cta || `Get ${plan.name}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        await startCheckout(price.id, plan.name);
        button.disabled = false;
        draw();
      });
    }
    box.append(button);
    if (!plan.isFree && price && price.ready && data.checkout.enabled && !onThis) box.append(el("p", "pr-fine", "Cancel anytime"));
    else box.append(el("p", "pr-fine", " "));

    // what it includes
    // what works today first, then what is on the way
    const features = data.features.filter((f) => included(plan, f.key)).sort((a, b) => Number(a.status === "soon") - Number(b.status === "soon"));
    const shown = options.compact ? 6 : 9;
    box.append(el("p", "pr-includes", features.length ? "Includes" : "Includes the basics"));
    const list = el("ul", "pr-list");
    features.slice(0, shown).forEach((f) => {
      const li = el("li");
      const icon = el("span", "pr-tick");
      icon.innerHTML = CHECK;
      const text = el("span", "", featureText(f, plan.entitlements[f.key]));
      li.append(icon, text);
      if (f.status === "soon") li.append(el("em", "pr-soon", "Soon"));
      if (f.description) li.title = f.description;
      list.append(li);
    });
    box.append(list);
    if (features.length > shown) {
      const more = el("a", "pr-more", `+ ${features.length - shown} more`);
      more.href = options.compact ? "/pricing/#compare" : "#compare";
      box.append(more);
    }
    return box;
  }

  // ---- the banner for somebody who has a paid plan ------------------------------------------------------------------

  function banner(): HTMLElement | null {
    const mine = myPlan();
    if (!mine || mine.plan.isFree || !mine.subscription) return null;
    const sub = mine.subscription;
    const box = el("div", "pr-banner");
    const text = el("div");
    text.append(el("strong", "", `You are on ${mine.plan.name}`));
    const date = sub.currentEnd ? new Date(sub.currentEnd * 1000).toLocaleDateString([], { dateStyle: "long" }) : "";
    text.append(el("span", "", sub.cancelAtPeriodEnd ? `Renewal is off. Your plan ends on ${date}, then you are back on Free.` : sub.status === "pending" ? "Your last payment did not go through; Razorpay is trying again." : date ? `Renews on ${date}.` : "Your plan is active."));
    box.append(text);
    if (!sub.cancelAtPeriodEnd) {
      const cancel = el("button", "pr-cancel", "Cancel subscription");
      cancel.type = "button";
      cancel.addEventListener("click", async () => {
        if (!confirm(`Cancel ${mine.plan.name}? You keep it until ${date || "the end of the period you paid for"}, and nothing more is charged.`)) return;
        cancel.disabled = true;
        await cancelSubscription();
        draw();
      });
      box.append(cancel);
    }
    return box;
  }

  // ---- the comparison table -----------------------------------------------------------------------------------------

  function compare(): HTMLElement {
    const section = el("section", "pr-compare");
    section.id = "compare";
    section.append(el("h2", "", "Compare every feature"));
    const wrap = el("div", "pr-table-wrap");
    const table = el("table", "pr-table");
    const head = el("tr");
    head.append(el("th", "pr-corner", ""));
    data.plans.forEach((plan) => head.append(el("th", plan.featured ? "is-featured" : "", plan.name)));
    const thead = el("thead");
    thead.append(head);
    table.append(thead);
    const body = el("tbody");
    let group = "";
    data.features.forEach((feature) => {
      if (feature.group !== group) {
        group = feature.group;
        const row = el("tr", "pr-group");
        const cell = el("th", "", group);
        cell.colSpan = data.plans.length + 1;
        row.append(cell);
        body.append(row);
      }
      const row = el("tr");
      const label = el("th", "pr-label", feature.label);
      label.scope = "row";
      if (feature.status === "soon") label.append(el("em", "pr-soon", "Soon"));
      if (feature.description) label.title = feature.description;
      row.append(label);
      data.plans.forEach((plan) => {
        const rule = plan.entitlements[feature.key];
        const cell = el("td", plan.featured ? "is-featured" : "");
        if (!rule || !rule.enabled) {
          cell.innerHTML = DASH;
          cell.classList.add("is-no");
          cell.setAttribute("aria-label", "Not included");
        } else if (feature.kind === "limit") {
          cell.textContent = rule.value === null ? "Unlimited" : rule.value.toLocaleString();
          cell.classList.add("is-value");
        } else {
          cell.innerHTML = CHECK;
          cell.classList.add("is-yes");
          cell.setAttribute("aria-label", "Included");
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    wrap.append(table);
    section.append(wrap);
    return section;
  }

  // ---- everything ---------------------------------------------------------------------------------------------------

  function draw() {
    const parts: HTMLElement[] = [];
    const bar = banner();
    if (bar) parts.push(bar);
    const toggle = switcher();
    if (toggle) {
      const row = el("div", "pr-switch-row");
      row.append(toggle);
      parts.push(row);
    }
    if (data.plans.length === 0) {
      parts.push(el("p", "pr-empty", "Plans are being set up. Please check back soon."));
    } else {
      const grid = el("div", "pr-grid");
      grid.dataset.count = String(Math.min(data.plans.length, 4));
      data.plans.forEach((plan) => grid.append(card(plan)));
      parts.push(grid);
      if (!data.checkout.enabled) parts.push(el("p", "pr-note", "Paid plans open soon. Everyone starts on Free."));
      if (!options.compact) parts.push(compare());
    }
    root.replaceChildren(...parts);
  }

  window.addEventListener("plan-change", () => draw());
  window.addEventListener("auth-change", () => void loadPlan());
  // Come back to the tab after the admin changed something: show it without a reload.
  if (!options.compact) {
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      const fresh = await fetchPricing();
      if (fresh) {
        data = fresh;
        draw();
      }
    });
  }
  draw();
  void loadPlan();
}

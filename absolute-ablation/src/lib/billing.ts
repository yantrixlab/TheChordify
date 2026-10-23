// Paying for a plan with Razorpay: the server makes a subscription, Razorpay's checkout window takes the payment, and the
// server confirms it. Card details only ever go to Razorpay.
import { API_BASE } from "./api";
import { cachedUser, getMe } from "./auth";
import { openSignIn } from "./authUi";
import { loadPlan } from "./plan";
import { toast } from "./toast";

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let scriptReady: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  scriptReady ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptReady = null;
      reject(new Error("Could not load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return scriptReady;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

/** Opens the payment window for a price. Signed-out visitors are asked to sign in first, and press the button again after. */
export async function startCheckout(priceId: string, planName: string): Promise<void> {
  if (!cachedUser()) {
    openSignIn();
    return;
  }
  try {
    const order = await post<{ subscriptionId: string; keyId: string; name: string; description: string; prefill: { name: string; email: string } }>("/api/billing/subscribe", { priceId });
    await loadCheckout();
    await new Promise<void>((resolve) => {
      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        subscription_id: order.subscriptionId,
        name: order.name,
        description: order.description,
        prefill: order.prefill,
        theme: { color: "#7c3aed" },
        modal: { ondismiss: () => resolve() },
        handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
          try {
            await post("/api/billing/verify", {
              paymentId: response.razorpay_payment_id,
              subscriptionId: response.razorpay_subscription_id,
              signature: response.razorpay_signature,
            });
            toast({ icon: "🎉", title: `You are on ${planName}`, text: "Thank you! Your plan is active.", tone: "level", sparks: true, ms: 7000 });
            await Promise.all([loadPlan(true), getMe()]);
          } catch (err) {
            toast({ icon: "⚠️", title: "We could not confirm the payment yet", text: err instanceof Error ? err.message : "It will show up shortly if it went through.", ms: 8000 });
          }
          resolve();
        },
      });
      rzp.on("payment.failed", (failure: { error?: { description?: string } }) =>
        toast({ icon: "⚠️", title: "The payment did not go through", text: failure.error?.description ?? "Please try again.", ms: 7000 }),
      );
      rzp.open();
    });
  } catch (err) {
    toast({ icon: "⚠️", title: "Could not start the payment", text: err instanceof Error ? err.message : "Please try again.", ms: 7000 });
  }
}

/** Stops renewals; the plan stays until the end of what was paid for. */
export async function cancelSubscription(): Promise<void> {
  try {
    await post("/api/billing/cancel");
    toast({ icon: "✅", title: "Renewal cancelled", text: "Your plan stays until the end of the period you paid for.", ms: 6000 });
    await loadPlan(true);
  } catch (err) {
    toast({ icon: "⚠️", title: "Could not cancel", text: err instanceof Error ? err.message : "Please try again.", ms: 7000 });
  }
}

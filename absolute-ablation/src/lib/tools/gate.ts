// Keeps a tool for the plans that include it. The admin's Features & limits list decides: a tool the visitor's plan leaves out
// shows a "not in your plan" card in place of itself. (The tools run in the browser, so this is the page's own check, like the
// locks on the play page; the songs, library and payments are checked on the server.)
import { can, loadPlan, myPlan } from "../plan";
import { track } from "../analytics";

export interface Gate {
  /** True when the plan includes the tool. Check it before starting the microphone or any sound. */
  allowed(): boolean;
  /** Resolves when the plan is known. */
  ready: Promise<boolean>;
}

export function initGate(feature: string, tool: string): Gate {
  const body = document.getElementById("tool-body");
  const card = document.getElementById("tool-gate");
  const apply = () => {
    const allowed = can(feature);
    body?.classList.toggle("is-gated", !allowed);
    body?.toggleAttribute("inert", !allowed);
    if (card) {
      card.hidden = allowed;
      const signedIn = myPlan()?.signedIn ?? false;
      const note = card.querySelector<HTMLElement>("[data-gate-note]");
      if (note) note.textContent = signedIn ? `This tool is not part of your ${myPlan()?.plan.name ?? "current"} plan.` : "This tool is not part of the Free plan. Sign in if you already have a paid plan.";
      card.querySelector<HTMLElement>("[data-gate-signin]")?.toggleAttribute("hidden", signedIn);
    }
    return allowed;
  };
  const ready = loadPlan().then(() => {
    const allowed = apply();
    if (allowed) track("tool_open", { tool });
    return allowed;
  });
  window.addEventListener("plan-change", apply);
  return { allowed: () => can(feature), ready };
}

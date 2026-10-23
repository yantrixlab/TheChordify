// Small pop-ups for what a person just earned: XP, a new level, a new badge. They stack in a corner, and go by themselves.
// The styles are added here the first time one is shown, so any page can use them without its own stylesheet.

export interface Earned {
  counted?: boolean;
  xpGained: number;
  levelUp: boolean;
  level: number;
  title: string;
  intoLevel: number;
  levelSpan: number;
  newBadges: { code: string; name: string; icon: string; description: string; bonusXp: number }[];
}

const STYLE = `
.xt-wrap { position: fixed; z-index: 120; right: 16px; bottom: 16px; display: grid; gap: 10px; width: min(340px, calc(100vw - 32px)); pointer-events: none; }
.xt { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 16px 12px 12px; border-radius: 18px; background: #1a0533; color: #fff; box-shadow: 0 24px 48px -16px #000a, 0 0 0 1px #ffffff1a; pointer-events: auto; animation: xt-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; overflow: hidden; }
.xt.out { animation: xt-out 0.3s ease-in both; }
.xt-icon { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 14px; background: #ffffff1a; font-size: 22px; }
.xt-body { min-width: 0; flex: 1; }
.xt-title { margin: 0; font: 800 15px/1.3 var(--font-sans, system-ui); letter-spacing: -0.01em; }
.xt-text { margin: 2px 0 0; font: 500 13px/1.4 var(--font-sans, system-ui); color: #d8c8f5; }
.xt-bar { height: 6px; margin-top: 8px; border-radius: 999px; background: #ffffff22; overflow: hidden; }
.xt-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #a78bfa, #f59e0b); transition: width 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) 0.3s; }
.xt.level { background: linear-gradient(135deg, #5b21b6, #1a0533 70%); box-shadow: 0 24px 56px -12px #7c3aedcc, 0 0 0 1px #f59e0b88; }
.xt.level .xt-icon { background: linear-gradient(135deg, #fcd34d, #f59e0b); color: #1a0533; font: 800 20px var(--font-sans, system-ui); animation: xt-pop 0.7s cubic-bezier(0.3, 1.6, 0.5, 1) 0.2s both; }
.xt.badge .xt-icon { background: #fef3c7; animation: xt-pop 0.7s cubic-bezier(0.3, 1.6, 0.5, 1) 0.2s both; }
.xt-spark { position: absolute; left: 34px; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: #fcd34d; opacity: 0; animation: xt-spark 1s ease-out 0.25s both; }
.xt-close { position: absolute; top: 6px; right: 8px; width: 22px; height: 22px; border: 0; border-radius: 50%; background: none; color: #b9a6e0; cursor: pointer; font-size: 16px; line-height: 1; }
.xt-close:hover { background: #ffffff1a; color: #fff; }
@keyframes xt-in { from { opacity: 0; transform: translateY(24px) scale(0.96); } }
@keyframes xt-out { to { opacity: 0; transform: translateY(12px) scale(0.97); } }
@keyframes xt-pop { from { transform: scale(0.3) rotate(-20deg); } }
@keyframes xt-spark { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.2); } }
@media (max-width: 640px) { .xt-wrap { right: 16px; left: 16px; bottom: 76px; width: auto; } }
@media (prefers-reduced-motion: reduce) { .xt, .xt.out, .xt-icon, .xt-spark { animation: none !important; } .xt-bar i { transition: none; } .xt-spark { display: none; } }
`;

let wrap: HTMLElement | null = null;

function container(): HTMLElement {
  if (!wrap) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);
    wrap = document.createElement("div");
    wrap.className = "xt-wrap";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    document.body.append(wrap);
  }
  return wrap;
}

interface ToastOptions {
  icon: string;
  title: string;
  text?: string;
  tone?: "level" | "badge";
  progress?: number; // 0-1, draws a bar
  sparks?: boolean;
  ms?: number;
}

export function toast(options: ToastOptions) {
  const box = document.createElement("div");
  box.className = `xt ${options.tone ?? ""}`.trim();
  const icon = document.createElement("div");
  icon.className = "xt-icon";
  icon.textContent = options.icon;
  const body = document.createElement("div");
  body.className = "xt-body";
  const title = document.createElement("p");
  title.className = "xt-title";
  title.textContent = options.title;
  body.append(title);
  if (options.text) {
    const text = document.createElement("p");
    text.className = "xt-text";
    text.textContent = options.text;
    body.append(text);
  }
  if (options.progress !== undefined) {
    const bar = document.createElement("div");
    bar.className = "xt-bar";
    const fill = document.createElement("i");
    fill.style.width = "0%";
    bar.append(fill);
    body.append(bar);
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${Math.round(Math.min(1, Math.max(0, options.progress!)) * 100)}%`)));
  }
  const close = document.createElement("button");
  close.className = "xt-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  box.append(icon, body, close);
  if (options.sparks) {
    for (let i = 0; i < 14; i++) {
      const spark = document.createElement("span");
      spark.className = "xt-spark";
      const angle = (i / 14) * Math.PI * 2;
      const distance = 40 + Math.random() * 36;
      spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      spark.style.background = i % 2 ? "#fcd34d" : "#c4b5fd";
      box.append(spark);
    }
  }
  const dismiss = () => {
    box.classList.add("out");
    window.setTimeout(() => box.remove(), 320);
  };
  close.addEventListener("click", dismiss);
  container().append(box);
  window.setTimeout(dismiss, options.ms ?? 5200);
}

/** The toasts for one play or favourite: the XP, then a level-up and each badge, a moment apart. */
export function celebrate(earned: Earned) {
  if (earned.counted === false) return;
  const steps: (() => void)[] = [];
  if (earned.xpGained > 0) {
    steps.push(() =>
      toast({
        icon: "✨",
        title: `+${earned.xpGained} XP`,
        text: `Level ${earned.level} · ${earned.title}`,
        progress: earned.levelSpan > 0 ? earned.intoLevel / earned.levelSpan : 0,
        ms: 4200,
      }),
    );
  }
  if (earned.levelUp) {
    steps.push(() =>
      toast({ icon: String(earned.level), title: "Level up!", text: `You are now level ${earned.level}, ${earned.title}.`, tone: "level", sparks: true, ms: 7000 }),
    );
  }
  earned.newBadges.forEach((badge) =>
    steps.push(() =>
      toast({
        icon: badge.icon,
        title: `Badge unlocked: ${badge.name}`,
        text: badge.bonusXp > 0 ? `${badge.description} · +${badge.bonusXp} XP` : badge.description,
        tone: "badge",
        sparks: true,
        ms: 6500,
      }),
    ),
  );
  steps.forEach((step, index) => window.setTimeout(step, index * 600));
}

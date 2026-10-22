/** "3:07" for 187 seconds; an empty string when the length is unknown. */
export const clock = (seconds: number): string =>
  seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "";

/** "12 jam sessions", "35K jam sessions", "1 jam session". */
export const jamLabel = (n: number): string => {
  const text =
    n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K` : String(n);
  return `${text} jam session${n === 1 ? "" : "s"}`;
};

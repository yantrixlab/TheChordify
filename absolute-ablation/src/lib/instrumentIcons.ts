// Small line drawings of the four instruments, for the cards on the chord pages (the inside of a 24px stroke <svg>).
import type { InstrumentKey } from "./chordCatalog";

export const INSTRUMENT_ICONS: Record<InstrumentKey, string> = {
  guitar: '<g transform="rotate(40 12 12)"><path d="M12 1.8v5M10.6 1.8h2.8"/><path d="M9.2 9.6C9.2 8.2 10.4 7 12 7s2.8 1.2 2.8 2.6c0 1.2-.6 1.7-.9 2.5-.2.7 1.8 1 1.8 3.4 0 2.8-2 5-4.7 5s-4.7-2.2-4.7-5c0-2.4 2-2.7 1.8-3.4-.3-.8-.9-1.3-.9-2.5z"/><circle cx="12" cy="15" r="1.3"/></g>',
  piano: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M9 13.5V19M15 13.5V19M7.5 5v8.5h3V5M13.5 5v8.5h3V5"/>',
  ukulele: '<g transform="rotate(40 12 12)"><path d="M12 2.5v6.5M10.7 2.5h2.6"/><circle cx="12" cy="14.8" r="5"/><circle cx="12" cy="14.8" r="1.5"/><path d="M10 18.9h4"/></g>',
  mandolin: '<g transform="rotate(40 12 12)"><path d="M12 1.6v6M10.4 1.6h3.2"/><path d="M12 7.2c3.2 0 5.4 3.3 5.4 7 0 3.3-2.3 6.2-5.4 6.2s-5.4-2.9-5.4-6.2c0-3.7 2.2-7 5.4-7z"/><path d="M9.6 14.2c0-1 .6-1.8 1.4-1.8M14.4 14.2c0-1-.6-1.8-1.4-1.8M9.4 17.6h5.2"/></g>',
};

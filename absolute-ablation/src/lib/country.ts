// Which country a visitor is in, as a two-letter code, worked out in the browser without asking anybody: the time zone says it best (a phone
// set to English (US) in Kolkata is still in India), then the region in the browser's language ("en-IN"). The server prefers what its own
// network says when it can see it. Returns "" when nothing says.

const ZONES: Record<string, string> = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dhaka": "BD", "Asia/Karachi": "PK", "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Katmandu": "NP",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Muscat": "OM", "Asia/Tehran": "IR", "Asia/Baghdad": "IQ",
  "Asia/Jerusalem": "IL", "Asia/Tel_Aviv": "IL", "Asia/Amman": "JO", "Asia/Beirut": "LB", "Europe/Istanbul": "TR", "Asia/Istanbul": "TR",
  "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN",
  "Asia/Manila": "PH", "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Seoul": "KR", "Asia/Tokyo": "JP", "Asia/Shanghai": "CN",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU", "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Pacific/Auckland": "NZ",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE", "Europe/Vienna": "AT", "Europe/Zurich": "CH", "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Athens": "GR",
  "Europe/Lisbon": "PT", "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Moscow": "RU", "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Nairobi": "KE",
  "Africa/Johannesburg": "ZA", "Africa/Casablanca": "MA", "Africa/Algiers": "DZ", "Africa/Tunis": "TN", "Africa/Accra": "GH",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Halifax": "CA",
  "America/Mexico_City": "MX", "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL", "America/Argentina/Buenos_Aires": "AR", "America/Buenos_Aires": "AR",
  "America/Sao_Paulo": "BR", "America/Caracas": "VE", "America/Guayaquil": "EC", "America/Montevideo": "UY", "America/Panama": "PA", "America/Costa_Rica": "CR",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
};

export function guessCountry(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && ZONES[zone]) return ZONES[zone];
  } catch {
    // no time zone to read
  }
  const tags = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const tag of tags) {
    const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag)?.[1];
    if (region) return region.toUpperCase();
  }
  return "";
}

/** "India" for "IN", in English (or the code itself where the browser cannot say). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

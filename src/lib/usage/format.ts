/** "$0.0127", "$3.43", "$1,204.50": small amounts keep 4 decimals (plan 26). */
export function usd(value: number): string {
  const digits = Math.abs(value) < 1 && value !== 0 ? 4 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
/** "870 MB", "1.2 GB". */
export function bytes(value: number): string {
  let v = value;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${UNITS[i]}`;
}

export const RANGE_PRESETS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangePreset = keyof typeof RANGE_PRESETS;

/** The last N days up to the start of tomorrow (UTC): today counts, and the key is stable all day. */
export function rangeFor(preset: RangePreset, now: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - RANGE_PRESETS[preset] * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const NOT_METERED_LABELS: Record<string, string> = {
  fmcsa_lookups: "FMCSA lookups",
  account_emails: "sign-up and invitation emails",
};
export const notMeteredLabel = (key: string) => NOT_METERED_LABELS[key] ?? key.replace(/_/g, " ");

import type { CarrierAuthorityEntry } from "@/types/carrier-authority";

const YEAR_DAYS = 365;
const MONTH_DAYS = YEAR_DAYS / 12;
const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "6 years 7 months", "10 days"; "Age unknown" when FMCSA gave no start (plan 25). */
export function authorityAgeText(days: number | null): string {
  if (days === null) return "Age unknown";
  const years = Math.floor(days / YEAR_DAYS);
  const months = Math.floor((days - years * YEAR_DAYS) / MONTH_DAYS);
  if (years === 0 && months === 0) return unit(Math.max(0, days), "day");
  return [years ? unit(years, "year") : "", months ? unit(months, "month") : ""].filter(Boolean).join(" ");
}

const AUTHORITY_STATUS: Record<string, string> = { A: "Active", I: "Inactive" };
const title = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** "MC123456 · Common · Active" per docket, as FMCSA reports them. */
export function authorityList(entries: readonly CarrierAuthorityEntry[]): string {
  if (!entries.length) return "None on record";
  return entries
    .map((e) => [e.docketNumber, title(e.type), AUTHORITY_STATUS[e.status] ?? e.status].filter(Boolean).join(" · "))
    .join("; ");
}

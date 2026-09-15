import { EXPIRING_SOON_DAYS as SOON_DAYS } from "@/lib/documents/status";
import type { DocumentStatus, EngagementType, RelationshipStatus } from "@/types";

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export const ENGAGEMENT_LABEL: Record<EngagementType, string> = {
  company_driver: "Company Driver",
  owner_operator: "Owner-Operator",
};

export const ENGAGEMENT_DESCRIPTION: Record<EngagementType, string> = {
  company_driver: "Drives the carrier's truck, on the carrier's authority and insurance.",
  owner_operator: "Runs their own truck and business under the carrier's authority.",
};

export const RELATIONSHIP_LABEL: Record<RelationshipStatus, string> = {
  invited: "Invited",
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
};

/**
 * The driver's words for the shared statuses.
 *
 * The states are the carrier's states — one vocabulary across the whole
 * product — but a driver reads "Ready to submit", not "Selected, not
 * uploaded", so the labels differ where the driver's job differs.
 */
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  missing: "Not started",
  selected_local: "Ready to submit",
  pending_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  expiring_soon: "Expiring soon",
  superseded: "Replaced",
};

/* -------------------------------------------------------------------------- */
/* CDL                                                                         */
/* -------------------------------------------------------------------------- */

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
] as const;

export const CDL_MIN_LENGTH = 4;
export const CDL_MAX_LENGTH = 20;

/**
 * Licence numbers have no national format — states use different lengths and
 * mixes of letters and digits — so this checks only that it could be one.
 */
export function validateCdlNumber(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the number printed on your licence.";
  if (!/^[A-Za-z0-9-]+$/.test(value)) return "Use letters, numbers and hyphens only.";
  const bare = value.replace(/-/g, "");
  if (bare.length < CDL_MIN_LENGTH) return "That looks too short for a licence number.";
  if (bare.length > CDL_MAX_LENGTH) return "That looks too long for a licence number.";
  return null;
}

export function validateState(raw: string): string | null {
  if (!raw) return "Choose the state that issued your licence.";
  return (US_STATES as readonly string[]).includes(raw) ? null : "Choose a state from the list.";
}

/** Today, as yyyy-mm-dd in the viewer's own timezone, for date inputs. */
export function todayIsoDate(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function validateExpiryDate(raw: string, label = "expiration date"): string | null {
  if (!raw) return `Enter the ${label} shown on the document.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Use the date picker, or type it as YYYY-MM-DD.";
  const value = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(value.getTime())) return "That is not a real date.";
  if (raw <= todayIsoDate()) return "That date has already passed. Renew it before adding it here.";
  const maxYear = new Date().getFullYear() + 30;
  if (value.getFullYear() > maxYear) return "That date is too far in the future to be right.";
  return null;
}

/**
 * `K4471182993` -> `•••••••2993`
 *
 * A licence number identifies a person to anyone who can read it, so the
 * profile shows just enough for the driver to recognise their own, and reveals
 * the rest only when they ask.
 */
export function maskCdl(cdlNumber: string): string {
  const value = cdlNumber.trim();
  if (value.length <= 4) return "•".repeat(Math.max(1, value.length));
  return `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Expiry helpers                                                              */
/* -------------------------------------------------------------------------- */

/** One window for the whole product. Defined once, in the document domain. */
export { EXPIRING_SOON_DAYS } from "@/lib/documents/status";

export function daysUntil(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((then - today.getTime()) / 86_400_000);
}

export type ExpiryState = "ok" | "expiring_soon" | "expired";

export function expiryState(isoDate: string | undefined): ExpiryState | null {
  if (!isoDate) return null;
  const days = daysUntil(isoDate);
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "expiring_soon";
  return "ok";
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

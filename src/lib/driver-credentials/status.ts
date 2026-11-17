import type { CredentialStatus, CredentialType, DriverCredential } from "@/types/driver-credential";

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  CDL: "CDL",
  TWIC: "TWIC",
  HAZMAT: "Hazmat",
  MEDICAL_CARD: "Medical card",
  TANKER: "Tanker",
  DOUBLES_TRIPLES: "Doubles / triples",
  ACCESS: "Site access",
  OTHER: "Other",
};

export const CREDENTIAL_STATUS_LABELS: Record<CredentialStatus, string> = {
  NOT_HELD: "Not held",
  PENDING: "Pending",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
};

export type CredentialTone = "success" | "info" | "warning" | "danger" | "neutral";

export function credentialTone(status: CredentialStatus): CredentialTone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PENDING":
      return "info";
    case "EXPIRED":
      return "warning";
    case "SUSPENDED":
    case "REVOKED":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * The status changes the backend state machine allows (backend plan 40,
 * driver-credentials-api-contract.md "Allowed status changes"). The menu offers
 * only these; the backend still decides.
 */
const NEXT: Record<CredentialStatus, CredentialStatus[]> = {
  NOT_HELD: ["PENDING", "ACTIVE"],
  PENDING: ["ACTIVE", "NOT_HELD"],
  ACTIVE: ["SUSPENDED", "REVOKED", "EXPIRED"],
  SUSPENDED: ["ACTIVE", "REVOKED"],
  EXPIRED: ["PENDING", "ACTIVE"],
  REVOKED: ["PENDING"],
};

export function nextStatuses(credential: Pick<DriverCredential, "status" | "expiresAt">, now = new Date()): CredentialStatus[] {
  return NEXT[credential.status].filter(
    // ACTIVE is refused while expiresAt has passed: the date must be fixed first.
    (to) => to !== "ACTIVE" || !isPast(credential.expiresAt, now),
  );
}

export function needsReason(to: CredentialStatus): boolean {
  return to === "SUSPENDED" || to === "REVOKED";
}

export const EXPIRY_WARNING_DAYS = 30;

/** ACTIVE and expiring within 30 days (the backend's reminder window). */
export function expiresSoon(credential: Pick<DriverCredential, "status" | "expiresAt">, now = new Date()): boolean {
  if (credential.status !== "ACTIVE" || !credential.expiresAt) return false;
  const left = new Date(credential.expiresAt).getTime() - now.getTime();
  return left > 0 && left <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
}

function isPast(iso: string | null, now: Date): boolean {
  return Boolean(iso) && new Date(iso as string).getTime() <= now.getTime();
}

export function credentialTitle(credential: Pick<DriverCredential, "type" | "label">): string {
  const type = CREDENTIAL_TYPE_LABELS[credential.type];
  return credential.label ? `${type} · ${credential.label}` : type;
}

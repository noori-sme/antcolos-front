/** Backend plan 40 (driver-credentials-api-contract.md). */
export const CREDENTIAL_TYPES = [
  "CDL", "TWIC", "HAZMAT", "MEDICAL_CARD", "TANKER", "DOUBLES_TRIPLES", "ACCESS", "OTHER",
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_STATUSES = [
  "NOT_HELD", "PENDING", "ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED",
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/** Statuses a credential may be recorded in; the rest are reached by a status change. */
export const INITIAL_CREDENTIAL_STATUSES = ["NOT_HELD", "PENDING", "ACTIVE"] as const;

export interface DriverCredential {
  id: string;
  userId: string;
  type: CredentialType;
  /** "" when none. */
  label: string;
  status: CredentialStatus;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  source: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialHistoryEntry {
  id: string;
  type: string;
  occurredAt: string;
  source: string;
  actorId: string | null;
  details: Record<string, unknown>;
}

export interface CreateCredentialInput {
  userId: string;
  type: CredentialType;
  label?: string;
  status?: (typeof INITIAL_CREDENTIAL_STATUSES)[number];
  issuedAt?: string;
  effectiveAt?: string;
  expiresAt?: string;
}

export interface UpdateCredentialInput {
  label?: string;
  issuedAt?: string | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
}

export interface CredentialListQuery {
  userId?: string;
  type?: CredentialType;
  status?: CredentialStatus;
  expiresBefore?: string;
  page?: number;
  pageSize?: number;
}

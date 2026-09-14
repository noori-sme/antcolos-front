import type {
  ExternalRef, IntegrationModule, Provenance,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Shared plumbing for every adapter in this folder. Kept in one file so that
 * "which of these is fake" has a single, checkable answer: everything whose
 * provenance comes from here.
 */

/** Marks a value as produced by a placeholder rather than a real system. */
export const MOCK_LABEL = "███ MOCK ONLY — NOT A BACKEND ███";

let sequence = 0;

/** Stable-enough ids for a browser session. Never parsed by anything. */
export function mockId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence.toString(36).padStart(4, "0")}${Date.now().toString(36).slice(-4)}`;
}

export function resetMockSequence() {
  sequence = 0;
}

export const nowIso = () => new Date().toISOString();
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
export const hoursFromNow = (h: number) => minutesFromNow(h * 60);
export const daysFromNow = (d: number) => hoursFromNow(d * 24);

/**
 * Every record this boundary produces carries one of these. `mock: true` is not
 * decorative — screens read it and say so, and a test asserts that nothing from
 * a mock adapter is ever presented as confirmed fact.
 */
export function mockProvenance(
  module: IntegrationModule,
  input: { observedAt?: string; confidence?: number; externalId?: string } = {},
): Provenance {
  const at = input.observedAt ?? nowIso();
  return {
    module,
    adapter: `mock:${module.replace(/_/g, "-")}`,
    mock: true,
    observedAt: at,
    receivedAt: nowIso(),
    confidence: input.confidence,
    externalId: input.externalId,
  };
}

/**
 * An identifier belonging to another module, kept exactly as given. Ids are
 * shaped like the owning module's own so that reconciliation after the merge is
 * a lookup rather than a guess.
 */
export function externalRef(
  module: IntegrationModule,
  externalId: string,
  extra: { entityId?: string; entityKind?: string } = {},
): ExternalRef {
  return { module, externalId, ...extra };
}

/**
 * Deterministic idempotency key for an action that may be retried from several
 * channels. Two taps of the same button, from the phone and from Telegram,
 * produce the same key and therefore one event.
 */
export function idempotencyKey(...parts: (string | number | undefined)[]): string {
  return parts.filter((p) => p !== undefined && p !== "").join(":");
}

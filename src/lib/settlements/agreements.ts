import type { CompensationAgreementSnapshot, IsoDateTime } from "@/types";

/**
 * Choosing the compensation agreement that applies to a load.
 *
 * The rule is one sentence and the whole module depends on it: a load is paid
 * under the agreement that was in effect WHEN THE WORK WAS PERFORMED, not the
 * one in effect when the settlement is built, approved or paid.
 *
 * A driver who moves from 26% to 30% on the first of the month is paid 26% for
 * the loads they ran in the old month, even if that settlement is not built
 * until the fifteenth. Reading the *current* agreement at settlement time is
 * the single easiest way to quietly overpay or underpay somebody, so the
 * lookup is here, once, and takes the performance date as an argument it
 * cannot default.
 */

/** Half-open: effective from `effectiveFrom` inclusive, to `effectiveTo` exclusive. */
export function isEffectiveAt(
  agreement: CompensationAgreementSnapshot,
  at: IsoDateTime,
): boolean {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  if (t < new Date(agreement.effectiveFrom).getTime()) return false;
  if (agreement.effectiveTo && t >= new Date(agreement.effectiveTo).getTime()) return false;
  return true;
}

/**
 * The agreement in force at `performedAt`, or null when the payee had no terms
 * covering that date.
 *
 * Null is a real answer, not a failure to handle: a load run before the payee's
 * agreement started cannot be paid, and the settlement says so as a blocking
 * gap rather than falling back to whatever agreement happens to be newest.
 */
export function agreementEffectiveAt(
  agreements: readonly CompensationAgreementSnapshot[],
  performedAt: IsoDateTime,
): CompensationAgreementSnapshot | null {
  const matches = agreements.filter((a) => isEffectiveAt(a, performedAt));
  if (matches.length === 0) return null;
  // Overlapping terms are a data error upstream. Taking the latest start is the
  // least surprising resolution, and is deterministic.
  return matches.reduce((latest, a) =>
    new Date(a.effectiveFrom).getTime() > new Date(latest.effectiveFrom).getTime() ? a : latest,
  );
}

/** True when two settlements' lines were paid under different agreement versions. */
export function agreementVersionsUsed(
  agreements: readonly CompensationAgreementSnapshot[],
): string[] {
  return Array.from(new Set(agreements.map((a) => `${a.agreementId}@v${a.agreementVersion}`)));
}

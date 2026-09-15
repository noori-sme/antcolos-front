import type {
  CompensationRule, ContractTerms, IsoDateTime, RenewalTerms, TerminationGround,
  TerminationTerms,
} from "@/types";
import { daysBetween } from "./status";

/**
 * Effective dates, renewal, notice periods and compensation validation.
 *
 * All pure. Nothing here reads a store, and nothing computes pay: compensation
 * RULES are terms, and the arithmetic belongs to Settlements, which prices work
 * under the agreement in force when the work was performed and freezes its
 * numbers on approval. A function here that returned a dollar figure would be a
 * second place pay is worked out, and the two would eventually disagree.
 */

export class ContractTermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractTermsError";
  }
}

/* -------------------------------------------------------------------------- */
/* Effective dates                                                             */
/* -------------------------------------------------------------------------- */

/** True while `now` falls inside the agreement's dates. */
export function isWithinEffectiveDates(
  terms: Pick<ContractTerms, "effective">,
  now: IsoDateTime,
): boolean {
  const t = new Date(now).getTime();
  if (t < new Date(terms.effective.from).getTime()) return false;
  if (!terms.effective.to) return true;
  return t <= new Date(terms.effective.to).getTime();
}

/** Days until the agreement ends. Absent when it is open-ended. */
export function daysUntilEnd(
  terms: Pick<ContractTerms, "effective">,
  now: IsoDateTime,
): number | undefined {
  if (!terms.effective.to) return undefined;
  return daysBetween(now, terms.effective.to);
}

/**
 * True when the agreement is inside the window it asked to be reminded in.
 *
 * The window is a TERM, not a constant: a 30-day notice period needs more
 * warning than a 7-day one, so the contract says how much warning it wants and
 * the module honours it.
 */
export function isInsideReminderWindow(
  terms: Pick<ContractTerms, "effective" | "renewal">,
  now: IsoDateTime,
): boolean {
  const left = daysUntilEnd(terms, now);
  if (left == null) return false;
  return left >= 0 && terms.renewal.reminderDays > 0 && left <= terms.renewal.reminderDays;
}

/**
 * The last day notice can be given to stop an automatic renewal.
 *
 * Absent when there is nothing to stop — no end date, or a renewal kind that
 * does not roll over by itself.
 */
export function renewalNoticeDeadline(
  terms: Pick<ContractTerms, "effective" | "renewal">,
): IsoDateTime | undefined {
  if (terms.renewal.kind !== "automatic") return undefined;
  if (!terms.effective.to || !terms.renewal.noticeDays) return undefined;
  const end = new Date(terms.effective.to).getTime();
  return new Date(end - terms.renewal.noticeDays * 86_400_000).toISOString();
}

/**
 * The dates a renewal would produce.
 *
 * Returns the NEXT term's dates and nothing else — it does not renew anything.
 * Renewing creates a new version through the service layer, because a renewal
 * changes the terms in force and every change of terms is a version.
 */
export function nextTermDates(
  terms: Pick<ContractTerms, "effective" | "renewal">,
): { from: IsoDateTime; to?: IsoDateTime } | undefined {
  if (terms.renewal.kind === "none") return undefined;
  if (!terms.effective.to) return undefined;
  const from = new Date(new Date(terms.effective.to).getTime() + 86_400_000).toISOString();
  if (!terms.renewal.termDays) return { from };
  const to = new Date(
    new Date(from).getTime() + terms.renewal.termDays * 86_400_000,
  ).toISOString();
  return { from, to };
}

/* -------------------------------------------------------------------------- */
/* Termination notice                                                          */
/* -------------------------------------------------------------------------- */

/**
 * When a termination noticed today would take effect.
 *
 * `for_cause` uses its own, usually shorter, period; `mutual` and
 * `operation_of_law` take effect at once, because in both cases there is no
 * notice to give — the parties agreed, or something outside the agreement
 * decided.
 */
export function terminationEffectiveDate(
  terms: Pick<ContractTerms, "termination">,
  ground: TerminationGround,
  noticeGivenAt: IsoDateTime,
): IsoDateTime {
  const days = noticeDaysFor(terms.termination, ground);
  return new Date(new Date(noticeGivenAt).getTime() + days * 86_400_000).toISOString();
}

export function noticeDaysFor(
  termination: Pick<TerminationTerms, "noticeDays" | "forCauseNoticeDays">,
  ground: TerminationGround,
): number {
  switch (ground) {
    case "for_convenience": return termination.noticeDays;
    case "for_cause": return termination.forCauseNoticeDays;
    case "mutual":
    case "operation_of_law": return 0;
  }
}

/** Refuses a ground the agreement does not allow. */
export function assertGroundAllowed(
  terms: Pick<ContractTerms, "termination">,
  ground: TerminationGround,
): void {
  if (!terms.termination.grounds.includes(ground)) {
    throw new ContractTermsError(
      `This agreement does not allow termination on that ground. It allows: ${terms.termination.grounds.join(", ")}.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Compensation rules                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Which compensation rules applied on a given date.
 *
 * The one function Settlements would call if it wanted the terms in force when
 * work was performed. A rule with no window applies for the whole version, and a
 * rule with one applies only inside it — which is how a percentage that changed
 * in June leaves May's rules intact.
 */
export function compensationRulesAt(
  terms: Pick<ContractTerms, "compensation" | "effective">,
  at: IsoDateTime,
): CompensationRule[] {
  const t = new Date(at).getTime();
  return terms.compensation.filter((rule) => {
    const from = new Date(rule.appliesFrom ?? terms.effective.from).getTime();
    if (t < from) return false;
    if (!rule.appliesTo) return true;
    return t <= new Date(rule.appliesTo).getTime();
  });
}

/**
 * Validation for one compensation rule.
 *
 * Every money field is an integer count of cents, and every percentage is basis
 * points, because a float in the money path is how somebody ends up owed
 * $1,249.9999999. The checks refuse rather than round.
 */
export function validateCompensationRule(rule: CompensationRule): string[] {
  const problems: string[] = [];
  const whole = (n: number | undefined, what: string) => {
    if (n == null) return;
    if (!Number.isInteger(n)) problems.push(`${what} must be a whole number.`);
    if (n < 0) problems.push(`${what} cannot be negative.`);
  };

  whole(rule.amountCents, "Amount");
  whole(rule.rateCents, "Rate");
  whole(rule.percentageBasisPoints, "Percentage");

  switch (rule.kind) {
    case "percentage_of_revenue":
      if (rule.percentageBasisPoints == null) {
        problems.push("A percentage rule needs a percentage.");
      } else if (rule.percentageBasisPoints > 10_000) {
        problems.push("A percentage cannot be more than 100%.");
      }
      break;
    case "rate_per_loaded_mile":
    case "rate_per_all_mile":
    case "hourly":
      if (rule.rateCents == null) problems.push("A rate rule needs a rate in cents.");
      break;
    case "flat_per_period":
      if (rule.amountCents == null) problems.push("A flat rule needs an amount.");
      if (!rule.per?.trim()) problems.push("A flat-per-period rule needs to say what it is per.");
      break;
    case "flat_per_load":
    case "deduction":
    case "accessorial":
      if (rule.amountCents == null) problems.push("This rule needs an amount in cents.");
      break;
    case "other":
      if (!rule.detail.trim()) problems.push("An 'other' rule has to be described.");
      break;
  }

  if (rule.appliesFrom && rule.appliesTo
    && new Date(rule.appliesTo).getTime() < new Date(rule.appliesFrom).getTime()) {
    problems.push("A rule cannot stop applying before it starts.");
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Whole-terms validation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything that must be true before a version may be issued for signature.
 *
 * Checked at issue rather than at every keystroke: a draft is allowed to be
 * incomplete, and a half-written agreement that cannot be saved is a worse
 * product than one that cannot be issued.
 */
export function validateTermsForIssue(terms: ContractTerms): string[] {
  const problems: string[] = [];

  if (!terms.summary.trim()) problems.push("The agreement needs a plain-language summary.");
  if (!terms.effective.from) problems.push("The agreement needs a start date.");
  if (terms.effective.to
    && new Date(terms.effective.to).getTime() <= new Date(terms.effective.from).getTime()) {
    problems.push("The end date has to be after the start date.");
  }
  if (terms.effective.probationEndsAt && terms.effective.to
    && new Date(terms.effective.probationEndsAt).getTime() > new Date(terms.effective.to).getTime()) {
    problems.push("A trial period cannot end after the agreement does.");
  }
  problems.push(...validateRenewal(terms.renewal, terms));
  if (terms.termination.grounds.length === 0) {
    problems.push("The agreement has to say on what grounds it can be ended.");
  }
  if (terms.termination.noticeDays < 0 || terms.termination.forCauseNoticeDays < 0) {
    problems.push("A notice period cannot be negative.");
  }
  for (const rule of terms.compensation) {
    problems.push(...validateCompensationRule(rule).map((p) => `${rule.label}: ${p}`));
  }
  return problems;
}

function validateRenewal(renewal: RenewalTerms, terms: ContractTerms): string[] {
  const problems: string[] = [];
  if (renewal.reminderDays < 0) problems.push("A reminder window cannot be negative.");
  if (renewal.kind === "none") return problems;
  if (!terms.effective.to) {
    problems.push("An agreement with no end date cannot renew — there is nothing to renew from.");
  }
  if (!renewal.termDays) problems.push("A renewing agreement needs to say how long each term is.");
  if (renewal.kind === "automatic" && !renewal.noticeDays) {
    problems.push("An automatic renewal needs to say how much notice stops it.");
  }
  return problems;
}

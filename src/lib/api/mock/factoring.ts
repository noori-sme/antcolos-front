import type {
  BrokerFactorabilityCheck, FactoringBookingGate, FactoringConnection,
  FactoringFallbackPrefill, FactoringOverride, FactoringStatusView,
} from "@/types";
import {
  FACTORING_SOURCE_IS_LIVE, FACTORING_SOURCE_LABEL, isFactoringApproved,
} from "@/types";
import type {
  FactoringOverrideInput, FactoringService, FactoringSubjectInput,
} from "../contracts/factoring";
import {
  FactoringOverrideNotPermittedError, FactoringReasonRequiredError,
} from "../contracts/factoring";
import { NotFoundError } from "../contracts/context";
import type { ServiceContext } from "../contracts/context";
import { appendAuditEvent } from "./audit";
import { adapterFor } from "./factoring-adapters";
import {
  appendCheck, checkForIdempotencyKey, checkHistorySync, connectFactoringSync,
  connectionForSync, disconnectFactoringSync, effectiveConnectionStatus,
  factoringStatusSync, factoringInternals, overrideFor, appendOverride,
  policyForSync, readConnectionSync, readPolicySync, relativeAge,
  rememberIdempotencyKey, resolveBrokerSubject, setPolicySync,
} from "./factoring-registry";
import {
  commitFactoringImportSync, importBatchesSync, importRowsSync,
  previewFactoringImportSync,
} from "./factoring-import";
import { carrierProfile } from "./carrier-registry";
import { organizationNameFor } from "./truck-registry";
import { nowIso } from "./time";
// The shared simulated round trip. A seeder can suppress it; a person never does.
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOT A FACTORING COMPANY ███
 *
 * The one door the factoring screens come through.
 *
 * The store, the adapters and the importer are three modules with one direction
 * of dependency between them. This file is where a caller's permissions, the
 * carrier boundary, the audit ledger and the provider adapter meet — and it is
 * the only place that writes anything.
 *
 * ★ EVERY WRITE PROJECTS INTO THE ONE AUDIT LEDGER ★
 * There is no second factoring history. Connecting, policy, results, imports
 * and overrides all append through `audit.record`, so an owner reading the
 * organization's audit log sees the factoring decisions in the same feed as
 * everything else, in order, with the same immutability.
 */

const LATENCY_MS = 260;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

function subjectOf(input: FactoringSubjectInput) {
  return resolveBrokerSubject(input.carrierOrganizationId, {
    brokerNameObserved: input.brokerNameObserved,
    brokerMcNumber: input.brokerMcNumber,
    brokerPartyId: input.brokerPartyId,
  });
}

function statusOf(ctx: ServiceContext, input: FactoringSubjectInput): FactoringStatusView {
  return factoringStatusSync(ctx, {
    carrierOrganizationId: input.carrierOrganizationId,
    brokerNameObserved: input.brokerNameObserved,
    brokerMcNumber: input.brokerMcNumber,
    brokerPartyId: input.brokerPartyId,
    proposedAmountCents: input.proposedAmountCents,
    dispatchCycleId: input.dispatchCycleId,
    listingId: input.listingId,
  });
}

/**
 * An MC as a person writes it, from whatever the record happens to hold.
 *
 * Organization records carry "MC-1142908"; the directory normalizes brokers to
 * digits. Printing either verbatim beside the word "MC" gives "MC MC-1142908"
 * on a message somebody is about to send to a credit desk.
 */
function mcDigits(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits ? digits : undefined;
}

function carrierLabel(carrierOrganizationId: string): string {
  return carrierProfile(carrierOrganizationId)?.displayName
    ?? organizationNameFor(carrierOrganizationId)
    ?? carrierOrganizationId;
}

/**
 * Run the carrier's adapter, if it has one.
 *
 * ★ NO ADAPTER MEANS NO ATTEMPT ★
 * In import, email and manual modes this writes nothing and returns false.
 * Recording an `unknown` "attempt" would put a row in the history saying
 * Antcolos asked, when nobody asked anybody — and the search screen would stop
 * offering the fallback because it would look like a check had run.
 */
function runAdapter(
  ctx: ServiceContext,
  connection: FactoringConnection,
  input: FactoringSubjectInput,
): Promise<BrokerFactorabilityCheck | undefined> {
  const adapter = adapterFor(connection.mode, connection.providerKind, connection.providerName);
  if (!adapter?.canCheck) return Promise.resolve(undefined);

  const subject = subjectOf(input);
  return adapter
    .check({
      carrierOrganizationId: input.carrierOrganizationId,
      connectionId: connection.connectionId,
      brokerNameObserved: input.brokerNameObserved,
      brokerMcNumber: subject.mcNumber,
      brokerPartyId: subject.brokerPartyId,
      proposedAmountCents: input.proposedAmountCents,
      dispatchCycleId: input.dispatchCycleId,
      listingId: input.listingId,
      loadId: input.loadId,
    })
    .then((outcome) => {
      /*
       * Two outcomes are NOT recorded as answers.
       *
       * `provider_unavailable` is the provider not answering, and `unknown` is
       * the adapter declining to guess without an MC. Writing either down would
       * supersede a perfectly good answer from yesterday with a non-answer from
       * today, which is how a working approval disappears because a provider
       * had a bad minute.
       */
      if (outcome.decision === "provider_unavailable" || outcome.decision === "unknown") {
        return undefined;
      }
      return appendCheck({
        carrierOrganizationId: input.carrierOrganizationId,
        connection,
        subject,
        decision: outcome.decision,
        source: outcome.source,
        reason: outcome.reason,
        conditions: outcome.conditions,
        creditLimitCents: outcome.creditLimitCents,
        availableAmountCents: outcome.availableAmountCents,
        proposedAmountCents: input.proposedAmountCents,
        providerReference: outcome.providerReference,
        dispatchCycleId: input.dispatchCycleId,
        listingId: input.listingId,
        loadId: input.loadId,
        checkedAt: outcome.checkedAt,
        expiresAt: outcome.expiresAt,
        // No actor: no person produced this. Attributing an adapter's answer to
        // whoever happened to have the screen open would put their name on a
        // decision they did not make.
        recordedByOrganizationId: ctx.organizationId,
      });
    });
}

/* -------------------------------------------------------------------------- */
/* The booking gate                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate the carrier's policy against the answer that is in force.
 *
 * ★ WHAT "RECHECK AT BOOKING" HONESTLY MEANS ★
 * Where an adapter exists it runs first, and `recheckedLive` says whether the
 * adapter that ran was an authorized provider API. In mock, import, email and
 * manual modes nothing was re-asked, and `recheckNote` says so in a sentence
 * the confirmation screen prints rather than implying freshness nobody has.
 */
export async function evaluateFactoringBooking(
  ctx: ServiceContext,
  input: FactoringSubjectInput,
): Promise<FactoringBookingGate> {
  const stored = connectionForSync(input.carrierOrganizationId);

  let rechecked: BrokerFactorabilityCheck | undefined;
  if (stored && effectiveConnectionStatus(stored) === "connected") {
    const current = statusOf(ctx, input);
    // Only where it would change something: a fresh answer is not re-bought on
    // every render of a confirmation screen, because with most factors a credit
    // check costs the carrier money.
    if (current.recheckRequired || !current.everChecked) {
      rechecked = await runAdapter(ctx, stored, input);
    }
  }

  return factoringGateSync(ctx, input, rechecked);
}

/**
 * The gate itself, with no recheck. Sync, so the booking confirmation can call
 * it while it renders and `canBook` can call it while it decides — a rule only
 * the UI ran would be a decoration, and a rule only the async path ran would
 * let a disabled button and the command behind it disagree.
 */
export function factoringGateSync(
  ctx: ServiceContext,
  input: FactoringSubjectInput,
  rechecked?: BrokerFactorabilityCheck,
): FactoringBookingGate {
  const policy = readPolicySync(ctx, input.carrierOrganizationId);
  const status = statusOf(ctx, input);
  const override = overrideFor(
    input.carrierOrganizationId, input.dispatchCycleId, input.listingId,
  );

  const recheckedLive = Boolean(rechecked && FACTORING_SOURCE_IS_LIVE[rechecked.source]);
  const recheckNote = buildRecheckNote(status, rechecked, recheckedLive);

  const gate = (
    block: FactoringBookingGate["block"],
  ): FactoringBookingGate => ({
    status,
    subject: {
      carrierOrganizationId: input.carrierOrganizationId,
      brokerNameObserved: input.brokerNameObserved,
      brokerMcNumber: input.brokerMcNumber,
      brokerPartyId: input.brokerPartyId,
      proposedAmountCents: input.proposedAmountCents,
      dispatchCycleId: input.dispatchCycleId,
      listingId: input.listingId,
    },
    allowed: !block,
    block,
    conditions: status.conditions,
    overrideAvailable: Boolean(block) && policy.allowOverride
      && ctx.permissions.has("factoring:override"),
    override,
    recheckedLive,
    recheckNote,
    policyRequiresApproval: policy.requireApprovalToBook,
  });

  /* A carrier that does not require factoring is not blocked by it. The
     status is still shown — a dispatcher wants to know — but it stops nothing. */
  if (!policy.requireApprovalToBook) return gate(undefined);

  /* An override already recorded for this cycle stands. It was authorized, it
     carries a reason, and it wrote an audit entry; re-asking would undo it. */
  if (override) return gate(undefined);

  if (status.decision === "rejected") {
    return gate({
      kind: "rejected",
      detail: status.check?.reason
        ? `${status.providerName} refused this broker: ${status.check.reason}`
        : `${status.providerName} refused this broker and gave no reason.`,
    });
  }

  if (status.decision === "conditional") {
    if (!policy.conditionalMayBook) {
      return gate({
        kind: "conditions_unmet",
        detail: `${status.providerName} will only fund this broker with conditions, and ${carrierLabel(input.carrierOrganizationId)} does not book on a conditional approval.`,
      });
    }
    return gate(undefined);
  }

  if (status.decision === "not_connected") {
    return gate({
      kind: "not_connected",
      detail: "This carrier has no factoring connection, and its policy requires an approval before booking.",
    });
  }

  if (!isFactoringApproved(status.decision)) {
    /*
     * ★ THE FOUR NON-ANSWERS, AND WHY THEY ARE ONE BLOCK AND NOT A REFUSAL ★
     * `unknown`, `stale`, `pending` and `provider_unavailable` all land here.
     * The block's KIND says "there is no current result" and the detail says
     * which of them it is, so a dispatcher reads "nobody has asked yet" rather
     * than "your factor said no".
     */
    return gate({
      kind: "no_current_result",
      detail: status.detail,
    });
  }

  /*
   * Approved — but for how much?
   *
   * Only asked when the provider actually supplied an available amount. This is
   * a comparison of two numbers somebody else gave us, not an invented limit:
   * with no figure on the record there is nothing to compare and the approval
   * stands as given.
   */
  if (
    input.proposedAmountCents !== undefined
    && status.availableAmountCents !== undefined
    && input.proposedAmountCents > status.availableAmountCents
  ) {
    return gate({
      kind: "conditions_unmet",
      detail: `${status.providerName} has $${(status.availableAmountCents / 100).toLocaleString("en-US")} available on this broker, and this load is $${(input.proposedAmountCents / 100).toLocaleString("en-US")}.`,
    });
  }

  return gate(undefined);
}

function buildRecheckNote(
  status: FactoringStatusView,
  rechecked: BrokerFactorabilityCheck | undefined,
  recheckedLive: boolean,
): string {
  if (recheckedLive) return "Rechecked with the provider just now.";
  if (rechecked) {
    return `Rechecked through the ${FACTORING_SOURCE_LABEL[rechecked.source].toLowerCase()}. `
      + "This is not a live factoring API — no factoring company was contacted.";
  }
  if (!status.everChecked) {
    return "No live recheck happened: Antcolos has no authorized API with this provider, "
      + "and nobody has asked about this broker yet.";
  }
  return `No live recheck happened. This is the answer recorded ${relativeAge(status.checkedAt ?? nowIso())} `
    + `(${FACTORING_SOURCE_LABEL[status.source ?? "manual_portal_check"].toLowerCase()}).`;
}

/* -------------------------------------------------------------------------- */
/* Fallback prefill                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything Antcolos already knows, so nobody retypes it.
 *
 * A dispatcher doing a fallback check is about to send an email or ring a
 * credit desk. They need the carrier's MC, the factor's account number, the
 * broker's MC and the amount — and every one of those is already on a record
 * here. Making them go and find it is how a check gets done with the wrong MC.
 */
export function factoringFallbackPrefillSync(
  ctx: ServiceContext,
  input: FactoringSubjectInput,
): FactoringFallbackPrefill {
  const stored = readConnectionSync(ctx, input.carrierOrganizationId);
  if (!stored) throw new NotFoundError("Factoring connection");

  const subject = subjectOf(input);
  const previous = statusOf(ctx, input);
  const carrier = carrierProfile(input.carrierOrganizationId);
  const carrierName = carrierLabel(input.carrierOrganizationId);

  const amountLine = input.proposedAmountCents !== undefined
    ? `Proposed invoice amount: $${(input.proposedAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    // Absent rather than "$0.00" or "TBD": a credit desk reading a zero would
    // answer a question nobody asked.
    : "Proposed invoice amount: not yet agreed";

  const body = [
    `Account: ${stored.accountLabel}${stored.accountReference ? ` (${stored.accountReference})` : ""}`,
    `Carrier: ${carrier?.legalName ?? carrierName}${mcDigits(carrier?.mcNumber) ? ` — MC ${mcDigits(carrier?.mcNumber)}` : ""}`,
    "",
    "Please confirm credit approval for the following debtor:",
    `Debtor: ${input.brokerNameObserved}`,
    subject.mcNumber
      ? `Debtor MC: ${subject.mcNumber}`
      : "Debtor MC: NOT AVAILABLE — please confirm which company this is before answering.",
    amountLine,
    "",
    previous.everChecked
      ? `Your last answer to us on this debtor was "${previous.recordedDecision ?? previous.decision}", ${relativeAge(previous.checkedAt ?? nowIso())}.`
      : "We have no previous answer from you on this debtor.",
    "",
    `Requested by ${ctx.actor.displayNameSnapshot}, ${ctx.organizationName}.`,
  ].join("\n");

  return {
    carrierOrganizationId: input.carrierOrganizationId,
    carrierName,
    carrierMcNumber: mcDigits(carrier?.mcNumber),
    providerName: stored.providerName,
    accountLabel: stored.accountLabel,
    accountReference: stored.accountReference,
    mode: stored.mode,
    fallback: stored.fallback,
    brokerName: input.brokerNameObserved,
    brokerMcNumber: subject.mcNumber,
    brokerPartyId: subject.brokerPartyId,
    brokerMcVerified: subject.resolvedFromDirectory,
    proposedAmountCents: input.proposedAmountCents,
    dispatchCycleId: input.dispatchCycleId,
    listingId: input.listingId,
    dispatcherName: ctx.actor.displayNameSnapshot,
    dispatcherMembershipId: ctx.membershipId,
    previous: previous.everChecked ? previous : undefined,
    emailDraft: {
      to: stored.fallback.creditCheckEmail,
      subject: subject.mcNumber
        ? `Credit check — MC ${subject.mcNumber} (${input.brokerNameObserved})`
        : `Credit check — ${input.brokerNameObserved}`,
      body,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockFactoringService: FactoringService = {
  async connection(ctx, carrierOrganizationId) {
    await sleep(LATENCY_MS);
    return readConnectionSync(ctx, carrierOrganizationId);
  },

  async connect(ctx, input) {
    await sleep(LATENCY_MS);
    const { connection, replaced, previousProviderName } = connectFactoringSync(ctx, input);
    appendAuditEvent(ctx, {
      module: "factoring",
      action: "factoring.connection_changed",
      entity: {
        kind: "factoring_connection",
        id: connection.connectionId,
        label: `${connection.providerName} — ${connection.accountLabel}`,
        href: "/settings/factoring",
      },
      summary: replaced
        ? `Factoring account changed from ${previousProviderName} to ${connection.providerName}.`
        : `Connected ${connection.providerName} (${connection.accountLabel}).`,
      changes: [
        { field: "providerName", before: previousProviderName ?? null, after: connection.providerName },
        { field: "mode", before: null, after: connection.mode },
      ],
    });
    return { ...connection, status: effectiveConnectionStatus(connection) };
  },

  async disconnect(ctx, carrierOrganizationId) {
    await sleep(LATENCY_MS);
    const removed = disconnectFactoringSync(ctx, carrierOrganizationId);
    if (!removed) return;
    appendAuditEvent(ctx, {
      module: "factoring",
      action: "factoring.connection_changed",
      entity: {
        kind: "factoring_connection",
        id: removed.connectionId,
        label: `${removed.providerName} — ${removed.accountLabel}`,
      },
      summary: `Disconnected ${removed.providerName}. Every answer it gave is kept.`,
    });
  },

  async policy(ctx, carrierOrganizationId) {
    await sleep(LATENCY_MS);
    return readPolicySync(ctx, carrierOrganizationId);
  },

  async setPolicy(ctx, carrierOrganizationId, patch) {
    await sleep(LATENCY_MS);
    const { policy, before } = setPolicySync(ctx, carrierOrganizationId, patch);
    appendAuditEvent(ctx, {
      module: "factoring",
      action: "factoring.policy_changed",
      entity: {
        kind: "organization",
        id: carrierOrganizationId,
        label: carrierLabel(carrierOrganizationId),
        href: "/settings/factoring",
      },
      summary: "Factoring policy changed.",
      changes: [
        { field: "requireApprovalToBook", before: before.requireApprovalToBook, after: policy.requireApprovalToBook },
        { field: "conditionalMayBook", before: before.conditionalMayBook, after: policy.conditionalMayBook },
        { field: "allowOverride", before: before.allowOverride, after: policy.allowOverride },
        { field: "freshnessHours", before: before.freshnessHours, after: policy.freshnessHours },
        { field: "rejected", before: before.rejected, after: policy.rejected },
        { field: "unknown", before: before.unknown, after: policy.unknown },
        { field: "stale", before: before.stale, after: policy.stale },
        { field: "allowDriverReviewBeforeApproval", before: before.allowDriverReviewBeforeApproval, after: policy.allowDriverReviewBeforeApproval },
      ],
    });
    return policy;
  },

  async status(ctx, input) {
    await sleep(LATENCY_MS);
    return statusOf(ctx, input);
  },

  async statuses(ctx, inputs) {
    await sleep(LATENCY_MS);
    return inputs.map((input) => statusOf(ctx, input));
  },

  async history(ctx, input) {
    await sleep(LATENCY_MS);
    factoringInternals.requireReach(ctx, input.carrierOrganizationId);
    factoringInternals.requirePermissions(ctx, "factoring:view");
    return checkHistorySync(input.carrierOrganizationId, subjectOf(input));
  },

  async check(ctx, input) {
    await sleep(LATENCY_MS);
    factoringInternals.requireReach(ctx, input.carrierOrganizationId);
    factoringInternals.requirePermissions(ctx, "factoring:view", "factoring:check");

    const stored = connectionForSync(input.carrierOrganizationId);
    if (!stored) return statusOf(ctx, input);

    const written = await runAdapter(ctx, stored, input);
    if (written) {
      appendAuditEvent(ctx, {
        module: "factoring",
        action: "factoring.check_recorded",
        entity: {
          kind: "factoring_check",
          id: written.checkId,
          label: `${written.brokerNameObserved}${written.brokerMcNumber ? ` (MC ${written.brokerMcNumber})` : ""}`,
        },
        source: "integration",
        summary: `${written.providerName} answered "${written.decision}" through the ${FACTORING_SOURCE_LABEL[written.source].toLowerCase()}.`,
      });
    }
    return statusOf(ctx, input);
  },

  async fallbackPrefill(ctx, input) {
    await sleep(LATENCY_MS);
    return factoringFallbackPrefillSync(ctx, input);
  },

  async recordResult(ctx, input) {
    await sleep(LATENCY_MS);
    factoringInternals.requireReach(ctx, input.carrierOrganizationId);
    factoringInternals.requirePermissions(ctx, "factoring:view", "factoring:check");

    if (input.idempotencyKey) {
      const already = checkForIdempotencyKey(input.idempotencyKey);
      if (already) return already;
    }

    const stored = connectionForSync(input.carrierOrganizationId);
    if (!stored) throw new NotFoundError("Factoring connection");

    const subject = resolveBrokerSubject(input.carrierOrganizationId, {
      brokerNameObserved: input.brokerNameObserved,
      brokerMcNumber: input.brokerMcNumber,
      brokerPartyId: input.brokerPartyId,
    });

    const check = appendCheck({
      carrierOrganizationId: input.carrierOrganizationId,
      connection: stored,
      subject,
      decision: input.decision,
      source: input.source,
      // Everything below is the PROVIDER's, as the person heard it. Nothing on
      // this path is composed by Antcolos, and an empty field stays empty.
      reason: input.reason?.trim() || undefined,
      conditions: input.conditions?.filter((c) => c.trim().length > 0),
      creditLimitCents: input.creditLimitCents,
      availableAmountCents: input.availableAmountCents,
      proposedAmountCents: input.proposedAmountCents,
      providerReference: input.providerReference?.trim() || undefined,
      evidence: input.evidence,
      dispatchCycleId: input.dispatchCycleId,
      listingId: input.listingId,
      loadId: input.loadId,
      checkedAt: input.checkedAt,
      expiresAt: input.expiresAt,
      recordedBy: ctx.actor,
      recordedByOrganizationId: ctx.organizationId,
    });

    if (input.idempotencyKey) rememberIdempotencyKey(input.idempotencyKey, check.checkId);

    appendAuditEvent(ctx, {
      module: "factoring",
      action: "factoring.check_recorded",
      entity: {
        kind: "factoring_check",
        id: check.checkId,
        label: `${check.brokerNameObserved}${check.brokerMcNumber ? ` (MC ${check.brokerMcNumber})` : ""}`,
      },
      summary: `Recorded ${check.providerName}'s answer "${check.decision}" for ${check.brokerNameObserved}, as a ${FACTORING_SOURCE_LABEL[check.source].toLowerCase()}.`,
      changes: [
        { field: "decision", before: null, after: check.decision },
        { field: "source", before: null, after: check.source },
        { field: "providerReference", before: null, after: check.providerReference ?? null },
      ],
    });

    return check;
  },

  async evaluateBooking(ctx, input) {
    await sleep(LATENCY_MS);
    return evaluateFactoringBooking(ctx, input);
  },

  async override(ctx, input) {
    await sleep(LATENCY_MS);
    factoringInternals.requireReach(ctx, input.carrierOrganizationId);
    factoringInternals.requirePermissions(ctx, "factoring:view", "factoring:override");

    const reason = input.reason?.trim() ?? "";
    /*
     * ★ THE REASON IS CHECKED BEFORE ANYTHING IS WRITTEN ★
     * Not after, and not "recorded as empty". An override with no reason is the
     * one record that would be worse than no record: it says somebody decided
     * and takes away the only account of why.
     */
    if (!reason) throw new FactoringReasonRequiredError();

    const policy = policyForSync(input.carrierOrganizationId);
    if (!policy.allowOverride) {
      throw new FactoringOverrideNotPermittedError(
        `${carrierLabel(input.carrierOrganizationId)} does not permit booking past a factoring block.`,
      );
    }

    const status = statusOf(ctx, {
      carrierOrganizationId: input.carrierOrganizationId,
      brokerNameObserved: input.brokerNameObserved,
      brokerMcNumber: input.brokerMcNumber,
      brokerPartyId: input.brokerPartyId,
      proposedAmountCents: input.proposedAmountCents,
      dispatchCycleId: input.dispatchCycleId,
      listingId: input.listingId,
    });

    /*
     * The audit event FIRST, so the override can carry its id.
     *
     * One override, one event, and the event id on the record joins them
     * permanently. Nothing in the audit seam can edit or remove it afterwards —
     * `AuditService` has no update, no delete and no purge, and a correction is
     * a new event pointing at this one.
     */
    const event = appendAuditEvent(ctx, {
      module: "factoring",
      action: "factoring.override_recorded",
      entity: {
        kind: "factoring_check",
        id: status.check?.checkId ?? `override:${input.dispatchCycleId ?? input.listingId ?? "load"}`,
        label: `${input.brokerNameObserved}${input.brokerMcNumber ? ` (MC ${input.brokerMcNumber})` : ""}`,
      },
      summary:
        `Booked past factoring status "${status.decision}" for ${input.brokerNameObserved}. Reason: ${reason}`,
      changes: [
        { field: "overriddenDecision", before: status.decision, after: "overridden" },
        { field: "reason", before: null, after: reason },
      ],
    });

    return appendOverride({
      overrideId: factoringInternals.rowId("fov"),
      carrierOrganizationId: input.carrierOrganizationId,
      dispatchCycleId: input.dispatchCycleId,
      listingId: input.listingId,
      checkId: status.check?.checkId,
      overriddenDecision: status.decision,
      reason,
      actor: ctx.actor,
      actingOrganizationId: ctx.organizationId,
      auditEventId: event.id,
      at: nowIso(),
    });
  },

  async previewImport(ctx, input) {
    await sleep(LATENCY_MS);
    return previewFactoringImportSync(ctx, input);
  },

  async commitImport(ctx, batchId) {
    await sleep(LATENCY_MS);
    const result = commitFactoringImportSync(ctx, batchId);
    if (result.committed > 0) {
      appendAuditEvent(ctx, {
        module: "factoring",
        action: "factoring.import_committed",
        entity: {
          kind: "factoring_connection",
          id: result.batch.connectionId,
          label: `${result.batch.providerName} — ${result.batch.label}`,
          href: "/settings/factoring",
        },
        source: "imported",
        summary:
          `Imported ${result.committed} factoring result${result.committed === 1 ? "" : "s"} from ${result.batch.label}`
          + `${result.skipped > 0 ? `, ${result.skipped} row${result.skipped === 1 ? "" : "s"} left for review` : ""}.`,
        changes: [
          { field: "batchId", before: null, after: result.batch.batchId },
          { field: "committedRowCount", before: null, after: result.batch.committedRowCount },
        ],
      });
    }
    return result;
  },

  async importBatches(ctx, carrierOrganizationId) {
    await sleep(LATENCY_MS);
    return importBatchesSync(ctx, carrierOrganizationId);
  },

  async importRows(ctx, batchId) {
    await sleep(LATENCY_MS);
    return importRowsSync(ctx, batchId);
  },
};

/** Re-exported so screens and sibling modules read one status function. */
export { factoringStatusSync, relativeAge } from "./factoring-registry";
export type { FactoringOverrideInput, FactoringSubjectInput };
export type { FactoringOverride, FactoringStatusView, FactoringBookingGate };

import type {
  DomainEvent, ProjectionOutcome, ProjectionSubscriber, RateConfirmationExtraction,
} from "@/types";
import type { LoadFinalizedPayload } from "@/lib/propagation";
import { LOAD_FINALIZED_VERSION } from "@/lib/propagation";
import { externalRef } from "@/lib/integrations/mock/support";
import { mockStore } from "../store";
import { finalizeLoad, finalizationBlockers } from "../driver-workflow-finalize";
import { integrations } from "@/lib/integrations";
import { enqueueExtraction } from "../rate-con-extractions";
import { recordFinalizationOnLoop } from "../mt-loop";
import { rateConfirmationForLoad } from "../rate-confirmation-record";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The authorized projections of one `load.finalized` event.
 *
 * Every one of them obeys the same three rules, and the rules are the reason
 * this file exists rather than a single `distribute()` function:
 *
 *  1. **A projection writes only what its own module owns**, through that
 *     module's own entry point. None of them touches the canonical Load: that
 *     was written by `loads.applyRateConfirmation` before this event existed.
 *  2. **A projection may fail, and failing is not lying.** It reports
 *     `processed`, `pending`, `failed` or `needs_review` with a reason a
 *     dispatcher can act on. The bus isolates each one, so a failure here cannot
 *     stop the next.
 *  3. **`pending` is honest, not lazy.** Where a module genuinely has no store on
 *     this branch, the projection says exactly what that module will be given and
 *     names why nothing was written. It never claims a write it did not make.
 *
 * And one rule that only applies to the directory: **it may not create a party
 * profile.** Matching belongs to the Directory, which requires a person to
 * confirm every proposal, because a rate confirmation that mints a broker is how
 * a carrier ends up with four profiles for one broker.
 */

type Event = DomainEvent<LoadFinalizedPayload>;

/** Shared boilerplate. Every subscriber handles this one kind, at this version. */
function subscriber(
  spec: Omit<ProjectionSubscriber<LoadFinalizedPayload>, "handles" | "versions">,
): ProjectionSubscriber<LoadFinalizedPayload> {
  return { ...spec, handles: ["load.finalized"], versions: [LOAD_FINALIZED_VERSION] };
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* -------------------------------------------------------------------------- */
/* 1. Driver Load Post and Trip Workflow                                       */
/* -------------------------------------------------------------------------- */

/**
 * The headline projection: the load becomes something a driver can run.
 *
 * `finalizeLoad` is the driver-workflow module's own gate and it is unchanged. It
 * reads the rate confirmation state through the integration boundary, which now
 * resolves to the canonical committed record — so signing in Dispatch is what
 * unlocks the post, which is the behaviour that was missing.
 *
 * It is idempotent on its own: finalizing a load that already has a post returns
 * that post. Two locks, again, on purpose.
 */
export const driverWorkflowProjection = subscriber({
  id: "driver_workflow",
  label: "Driver Load Post and Trip Workflow",
  targetModule: "dispatch",
  mock: false,
  async project(event: Event): Promise<ProjectionOutcome> {
    const { loadId, loadReference, assignment } = event.payload;
    const organizationId = event.scope.organizationId;

    if (!assignment?.driverId) {
      return {
        state: "needs_review",
        detail: `No driver is assigned to ${loadReference}, so there is no post to publish.`,
        reason: "A Driver Load Post is a load handed to one named driver. Assign the load and this will run again.",
        retryable: true,
      };
    }

    // Asked rather than assumed, so a blocked finalization explains itself in
    // the words Dispatch would use instead of throwing.
    const rc = await integrations.loadSource.getRateConfirmation(organizationId, loadId);
    const blockers = finalizationBlockers(rc);
    if (blockers.length > 0) {
      return {
        state: "failed",
        detail: `No post was created for ${loadReference}.`,
        reason: `The driver workflow's own gate refused it: ${blockers.join("; ")}.`,
        retryable: true,
      };
    }

    const result = await finalizeLoad({
      organizationId,
      loadId,
      actor: event.actor,
      idempotencyKey: `load-finalized:${event.eventId}`,
    });

    const superseded = result.supersededProposalIds.length;
    return {
      state: "processed",
      detail: `${loadReference} is a Driver Load Post for ${assignment.driverName ?? "the assigned driver"} with an active trip workflow.${superseded > 0 ? ` ${superseded} overlapping proposal${superseded === 1 ? "" : "s"} became unavailable.` : ""}`,
      producedRefs: [
        externalRef("dispatch", result.post.id, { entityId: result.post.id, entityKind: "driver_load_post" }),
        externalRef("dispatch", result.workflow.id, { entityId: result.workflow.id, entityKind: "driver_workflow" }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 2. Accounting and expected revenue                                          */
/* -------------------------------------------------------------------------- */

/**
 * What accounting is owed, and when.
 *
 * Expected revenue has no store on this branch — there is no accounts-receivable
 * ledger to write a figure into — so this is a `pending` handoff that names the
 * exact numbers the accounting module will be given. It is NOT silent, and it is
 * not a claim.
 *
 * What DID become real is the thing beneath it: the agreed linehaul is now frozen
 * on the committed confirmation, so the invoice's "linehaul matches the rate
 * confirmation" check compares against what the broker agreed instead of against
 * the load's own current figure. See `invoice-sources.rateConfirmationInput`.
 */
export const accountingProjection = subscriber({
  id: "accounting_expected_revenue",
  label: "Accounting — expected revenue",
  targetModule: "accounting",
  mock: true,
  async project(event: Event): Promise<ProjectionOutcome> {
    const f = event.payload.financials;
    const handoff = await integrations.downstream.emit({
      organizationId: event.scope.organizationId,
      target: "accounting",
      operation: "load.finalized",
      idempotencyKey: `${event.eventId}:accounting`,
      refs: [
        externalRef("load", event.payload.loadId, { entityId: event.payload.loadId, entityKind: "load" }),
        externalRef("rate_confirmation", event.payload.rateConfirmationId, {
          entityId: event.payload.rateConfirmationId, entityKind: "rate_confirmation",
        }),
      ],
      payload: {
        expectedRevenueCents: f.totalRateCents,
        linehaulCents: f.linehaulCents,
        paymentTerms: f.paymentTermsText,
        loadedMiles: f.loadedMiles,
        ratePerMileCents: f.ratePerMileCents,
      },
    });

    return {
      state: "pending",
      detail: `${money(f.totalRateCents)} expected on ${event.payload.loadReference}, ${f.paymentTermsText ?? "terms as written on the confirmation"}. Queued for accounting; nothing was posted to any ledger.`,
      reason: "There is no accounts-receivable store on this branch. The figures above are what the accounting module will be handed, with an idempotency key, when it lands.",
      retryable: true,
      producedRefs: [
        externalRef("accounting", handoff.id, { entityId: handoff.id, entityKind: "pending_integration_event" }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 3. Invoice and Settlement preparation                                       */
/* -------------------------------------------------------------------------- */

/**
 * The load becomes billable-in-principle.
 *
 * Invoices reads loads live, so there is nothing to push: what this projection
 * confirms is that the two things the invoice module actually needs are now true
 * — the signed confirmation satisfies the load's rate confirmation requirement,
 * and a committed record with a frozen agreed linehaul exists for the readiness
 * check to compare against.
 *
 * It does NOT create an invoice. Billing before delivery is how a carrier loses a
 * customer, and `evaluateReadiness` says so in its first check.
 */
export const invoicePreparationProjection = subscriber({
  id: "invoice_settlement_preparation",
  label: "Invoice and Settlement preparation",
  targetModule: "accounting",
  mock: false,
  project(event: Event): ProjectionOutcome {
    const organizationId = event.scope.organizationId;
    const committed = rateConfirmationForLoad(organizationId, event.payload.loadId);
    const load = mockStore.org(organizationId).loads.find((l) => l.id === event.payload.loadId);
    const stillMissing = (load?.documentRequirements ?? [])
      .filter((r) => r.required && !r.satisfiedByDocumentId)
      .map((r) => r.kind);

    if (!committed) {
      return {
        state: "failed",
        detail: `Nothing was prepared for ${event.payload.loadReference}.`,
        reason: "No committed rate confirmation could be read back, so the invoice would have nothing to point at.",
        retryable: true,
      };
    }

    return {
      state: "processed",
      detail: `${event.payload.loadReference} can be invoiced once it delivers: the signed confirmation satisfies its rate confirmation requirement and ${money(event.payload.financials.linehaulCents)} is frozen as the agreed linehaul for the readiness check.${stillMissing.length > 0 ? ` Still needed before billing: ${stillMissing.join(", ")}.` : ""} No invoice was created — billing before delivery is refused by design.`,
      producedRefs: [
        externalRef("rate_confirmation", committed.rateConfirmationId, {
          entityId: committed.rateConfirmationId, entityKind: "rate_confirmation",
        }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 4. Broker, Shipper, Receiver, Facility and Contact relationships            */
/* -------------------------------------------------------------------------- */

/**
 * The parties on the confirmation, handed to the Directory for resolution.
 *
 * This is the projection that must NOT be clever. The Directory's matching rules
 * have four confidence tiers and deliberately no tier meaning "sure enough to
 * merge without asking" — every tier above `none` produces a proposal a
 * dispatcher confirms. So this projection plans nothing and creates nothing: it
 * queues the reviewed extraction for the existing confirmation screen and reports
 * `needs_review`.
 *
 * That is the correct outcome, not a limitation. A rate confirmation that created
 * a broker profile on its own is precisely how a carrier ends up with four
 * profiles for one broker, and this is the one place in the whole flow where
 * stopping to ask is worth more than finishing.
 */
export const directoryProjection = subscriber({
  id: "directory_parties",
  label: "Broker, Shipper, Receiver, Facility and Contact links",
  targetModule: "load",
  mock: false,
  project(event: Event): ProjectionOutcome {
    const { parties, loadId, loadReference, originalDocumentId } = event.payload;

    const extraction: RateConfirmationExtraction = {
      documentId: originalDocumentId,
      customerReference: event.payload.customerReference,
      loadId,
      blocks: parties.map((p) => ({
        role: p.role,
        party: {
          name: p.name,
          mcNumber: p.mcNumber,
          address: p.city && p.state
            ? { line1: p.addressLine, city: p.city, state: p.state, country: "US" }
            : undefined,
          phone: p.contactPhone,
          email: p.contactEmail,
        },
        // A broker has an office, not a dock. Only the physical stops get one.
        facility: p.role === "broker" || !p.city || !p.state
          ? undefined
          : {
            name: p.facilityName,
            address: { line1: p.addressLine, city: p.city, state: p.state, country: "US" },
          },
        contacts: p.contactName
          ? [{ fullName: p.contactName, phone: p.contactPhone, email: p.contactEmail }]
          : [],
      })),
      reviewedBy: event.actor,
      reviewedAt: event.payload.signature.signedAt,
    };

    const queued = enqueueExtraction(event.scope.organizationId, extraction, {
      loadReference,
      rateConfirmationId: event.payload.rateConfirmationId,
    });

    return {
      state: "needs_review",
      detail: `The broker, shipper and receiver on ${loadReference} are queued for resolution in Directory → Review.`,
      reason: "The Directory matches against every canonical record and refuses to create or merge a profile without a person confirming it. Nothing was created or linked here — confirm the proposals and the permanent links are made then.",
      retryable: false,
      producedRefs: [
        externalRef("load", queued.id, { entityId: queued.id, entityKind: "resolution_queue_entry" }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 5. MT Loop                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The truck's empty-to-empty cycle learns that its load is confirmed.
 *
 * The loop went `covered` when the load was booked. Booked and confirmed are not
 * the same thing — a booked load whose rate confirmation never came back is
 * exactly the kind of cycle a dispatcher needs to see is not finished — so the
 * loop records the confirmation as its own dated event and carries it as evidence.
 */
export const mtLoopProjection = subscriber({
  id: "mt_loop",
  label: "MT Loop",
  targetModule: "dispatch",
  mock: false,
  project(event: Event): ProjectionOutcome {
    const { mtLoopId, loadId, loadReference } = event.payload;
    if (!mtLoopId) {
      return {
        state: "pending",
        detail: `${loadReference} is not attached to an MT Loop, so no cycle was advanced.`,
        reason: "A load booked outside the empty-to-empty cycle has no loop to advance. Nothing is wrong with it; there is simply nothing here to do.",
        retryable: false,
      };
    }

    const recorded = recordFinalizationOnLoop(mtLoopId, {
      loadId,
      loadReference,
      actorName: event.actor.displayNameSnapshot,
      actorMembershipId: event.payload.signature.authorisedByMembershipId,
      rateConfirmationId: event.payload.rateConfirmationId,
      signedAt: event.payload.signature.signedAt,
    });

    if (!recorded) {
      return {
        state: "failed",
        detail: `MT Loop ${mtLoopId} could not be advanced.`,
        reason: "The loop could not be read. It may have been closed since the load was booked.",
        retryable: true,
      };
    }

    return {
      state: "processed",
      detail: `Unit ${recorded.truckUnit}'s cycle now carries the signed confirmation as evidence: ${loadReference} is covered and confirmed, not merely booked.`,
      producedRefs: [
        externalRef("dispatch", recorded.loopId, { entityId: recorded.loopId, entityKind: "mt_loop" }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 6. GPS and Broker Tracking                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A tracking session becomes available to open — and is not opened.
 *
 * Deliberate, and the one place this file refuses to do what it could. Opening a
 * broker tracking session mints a link that discloses a truck's position outside
 * the organization. The tracking module treats every recipient and every link as
 * a permission-sensitive act with its own audit line, and a projection reacting
 * to a signature is not a person deciding to share a truck's location.
 *
 * So the projection reports what is now possible and leaves the decision where it
 * belongs. Changing that is a product policy call, not a refactor.
 */
export const trackingProjection = subscriber({
  id: "tracking_session",
  label: "GPS and Broker Tracking session",
  targetModule: "geofencing",
  mock: true,
  async project(event: Event): Promise<ProjectionOutcome> {
    const { loadId, loadReference, assignment } = event.payload;
    const handoff = await integrations.downstream.emit({
      organizationId: event.scope.organizationId,
      target: "geofencing",
      operation: "load.finalized",
      idempotencyKey: `${event.eventId}:tracking`,
      refs: [externalRef("load", loadId, { entityId: loadId, entityKind: "load" })],
      payload: {
        truckId: assignment?.truckId,
        stops: event.payload.stops.map((s) => ({
          stopId: s.stopId, kind: s.kind, city: s.city, state: s.state,
          appointmentAt: s.appointmentAt,
        })),
        brokerName: event.payload.parties.find((p) => p.role === "broker")?.name,
      },
    });

    return {
      state: "pending",
      detail: `${loadReference} is ready for a tracking session: ${assignment?.truckUnit ? `unit ${assignment.truckUnit}` : "the assigned truck"}, both stops and their appointments are set.`,
      reason: "No session was opened and no link was minted. A broker tracking link discloses a truck's position outside the organization, so a person opens it from Dispatch → Tracking with their name on it.",
      retryable: false,
      producedRefs: [
        externalRef("geofencing", handoff.id, { entityId: handoff.id, entityKind: "pending_integration_event" }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 7. Load documents and requirements                                          */
/* -------------------------------------------------------------------------- */

/**
 * What paperwork this load now has, and what it still owes.
 *
 * The signed confirmation already satisfies the load's rate confirmation
 * requirement — `loads.applyRateConfirmation` did that, because the requirement
 * is a field the Load owns. What this projection does is report the resulting
 * checklist, and be honest that the signed document is a drawn mock rather than a
 * file in the Document Center: the documents service refuses to create a
 * load-subject document today, and inventing one here would be a second document
 * system.
 */
export const documentsProjection = subscriber({
  id: "load_documents",
  label: "Load documents and requirements",
  targetModule: "document_center",
  mock: true,
  project(event: Event): ProjectionOutcome {
    const reqs = event.payload.documentRequirements;
    const satisfied = reqs.filter((r) => r.satisfiedByDocumentId);
    const outstanding = reqs.filter((r) => r.required && !r.satisfiedByDocumentId);

    return {
      state: "pending",
      detail: `${satisfied.length} of ${reqs.length} requirements satisfied on ${event.payload.loadReference}. Outstanding: ${outstanding.length > 0 ? outstanding.map((r) => r.kind).join(", ") : "none"}.`,
      reason: "The rate confirmation requirement points at the signed document's id, but that document is drawn by the rate confirmation mock and is not a record in the Document Center — that module refuses to create a load-subject document on this branch, and a second document system is worse than an honest gap.",
      retryable: false,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 8. Reports                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reports need nothing pushed to them, and this says so out loud.
 *
 * The report dataset is built from the canonical loads and documents on every
 * run — see `lib/reports/sources/dataset.ts`. The finalization already changed
 * those records, so the next run of every revenue, lane and document report
 * includes it. A projection that "wrote to reports" would be writing a cache.
 */
export const reportsProjection = subscriber({
  id: "reports",
  label: "Reports",
  targetModule: "accounting",
  mock: false,
  project(event: Event): ProjectionOutcome {
    return {
      state: "processed",
      detail: `${event.payload.loadReference} is in scope for the next run of every report built on loads, rates and document completeness. Reports derive from the canonical records on each run; nothing is cached and nothing needed pushing.`,
    };
  },
});

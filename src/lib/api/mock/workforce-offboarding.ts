import {
  OFFBOARDING_STEP_LABEL, isRestrictedQualificationCategory,
  type OffboardingImpact, type OffboardingPlan, type OffboardingResultStep,
  type OffboardingStepKey, type WorkforceEngagement,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import { carrierRelationshipUnscoped, endCarrierRelationship } from "./driver-registry";
import { endRelationshipDocuments } from "./document-store";
import { memberIn, setMembershipStatus } from "./membership-directory";
import { recordsForDriver } from "./qualification-store";
import { applyRelationshipEndToQualificationFile } from "./qualification";
import { nowIso } from "./time";

/**
 * ███ MOCK-LAYER BRIDGE ███
 *
 * What ending a working relationship ACTUALLY does, module by module.
 *
 * Two halves, and the split is the point. `offboardingPlan` computes what would
 * happen and changes nothing; `runOffboardingSteps` performs only the steps the
 * person confirmed after reading that plan. Nothing outside the confirmed list
 * runs, because an offboarding that ended an access seat nobody asked it to end
 * would be the silent cross-domain write this whole module exists not to do.
 *
 * ★ EVERY STEP IS ANOTHER MODULE'S OWN COMMAND ★
 *   access            `setMembershipStatus` — the membership directory's
 *   driver relationship `endCarrierRelationship` — the driver module's,
 *                     idempotent, and it preserves the relationship as ended
 *   documents         `endRelationshipDocuments` — the document store's, which
 *                     closes links and revokes shares and deletes nothing
 *   qualification     `applyRelationshipEndToQualificationFile` — starts the
 *                     retention clock, deletes nothing
 * Not one of them is a write into somebody else's state from here.
 *
 * ★ TWO STEPS DELIBERATELY NEED A PERSON ★
 * Re-homing responsibility and unassigning equipment are NOT performed
 * automatically. Picking a new owner for somebody's work is a decision — and
 * the one candidate a naive implementation would reach for is the manager named
 * on the engagement, which is exactly the "a manager becomes responsible for
 * everything" rule this milestone refuses. So both are surfaced, counted, and
 * left to a person, and the unfinished step reaches them through Needs You.
 *
 * ★ A FAILURE IS NEVER HIDDEN ★
 * A step that fails does not roll the engagement back and does not disappear:
 * the engagement ends, the failure is recorded on it, and Needs You keeps
 * asking until somebody finishes it. A former worker who still holds something
 * is the most dangerous thing this module can produce, so it is the loudest.
 */

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

export function buildOffboardingPlan(
  ctx: ServiceContext,
  engagement: WorkforceEngagement,
): OffboardingPlan {
  const impacts: OffboardingImpact[] = [];

  const member = engagement.membershipId
    ? memberIn(engagement.organizationId, engagement.membershipId)
    : undefined;

  impacts.push({
    key: "end_membership_access",
    label: OFFBOARDING_STEP_LABEL.end_membership_access,
    domain: "access",
    effect: member && member.status === "active" ? "will_end" : "will_be_preserved",
    description: member
      ? member.status === "active"
        ? `${member.displayName}'s seat is marked as left through the access system. The user account, and everything they did, are untouched.`
        : `Their seat is already ${member.status}. Nothing to end.`
      : "This person holds no Antcolos access, so there is none to end.",
    ownerService: "Access service (memberships)",
    selectable: Boolean(member && member.status === "active"),
    defaultSelected: Boolean(member && member.status === "active"),
  });

  impacts.push({
    key: "end_delegations",
    label: OFFBOARDING_STEP_LABEL.end_delegations,
    domain: "access",
    effect: member && member.status === "active" ? "will_end" : "will_be_preserved",
    description:
      "Delegations follow the seat: the routing engine stops considering a "
      + "membership that is not active, so ending access ends them. Nothing is "
      + "deleted and every timeline entry naming them stays readable.",
    ownerService: "Responsibility engine (via the access system)",
    selectable: false,
    defaultSelected: Boolean(member && member.status === "active"),
  });

  impacts.push({
    key: "rehome_responsibility",
    label: OFFBOARDING_STEP_LABEL.rehome_responsibility,
    domain: "access",
    effect: "needs_a_person",
    description:
      "Work they are responsible for is NOT reassigned automatically. Choosing "
      + "who takes it is a decision, and handing it to the manager named on this "
      + "engagement would make a job title into an assignment. It is raised "
      + "through Needs You until somebody moves it.",
    ownerService: "Responsibility engine",
    selectable: false,
    defaultSelected: false,
  });

  const relationship = engagement.driverProfileId
    ? carrierRelationshipUnscoped(engagement.driverProfileId, engagement.organizationId)
    : undefined;

  impacts.push({
    key: "unassign_equipment",
    label: OFFBOARDING_STEP_LABEL.unassign_equipment,
    domain: "driver_relationship",
    effect: relationship?.assignedTruckId ? "needs_a_person" : "will_be_preserved",
    description: relationship?.assignedTruckId
      ? "They are on a truck. Ending the driver relationship takes the assignment with it; moving live loads or a running trip is a dispatch decision and is left to a person."
      : "They are not assigned to a truck.",
    ownerService: "Truck registry and Dispatch",
    selectable: false,
    defaultSelected: false,
    affectedCount: relationship?.assignedTruckId ? 1 : 0,
  });

  impacts.push({
    key: "end_carrier_relationship",
    label: OFFBOARDING_STEP_LABEL.end_carrier_relationship,
    domain: "driver_relationship",
    effect: relationship && relationship.status !== "ended" ? "will_end" : "will_be_preserved",
    description: relationship
      ? relationship.status === "ended"
        ? "The operational relationship has already ended. It is kept exactly as it is."
        : "The driver module ends its own relationship record. The relationship and its history are KEPT as ended — the DriverProfile, the person's documents, their other carriers, load history and settlements are untouched."
      : "There is no operational driver relationship to end.",
    ownerService: "Driver relationship module",
    selectable: Boolean(relationship && relationship.status !== "ended"),
    defaultSelected: Boolean(relationship && relationship.status !== "ended"),
  });

  impacts.push({
    key: "end_document_access",
    label: OFFBOARDING_STEP_LABEL.end_document_access,
    domain: "documents",
    effect: engagement.driverProfileId ? "will_end" : "will_be_preserved",
    description: engagement.driverProfileId
      ? "This organization's links on their documents are closed and its shares revoked. The documents themselves, every version and the whole lineage belong to the person and are untouched."
      : "There is no driver document context to end.",
    ownerService: "Document Center",
    selectable: Boolean(engagement.driverProfileId),
    defaultSelected: Boolean(engagement.driverProfileId),
  });

  // Counted for the preview only among records somebody in this workspace
  // could actually open. A restricted record is still moved into retention by
  // the step below — it is just not advertised here.
  const retained = engagement.driverProfileId
    ? recordsForDriver(engagement.driverProfileId)
      .filter((r) => r.organizationId === engagement.organizationId
        && r.retention.state !== "disposed"
        && !isRestrictedQualificationCategory(r.category))
    : [];

  impacts.push({
    key: "start_qualification_retention",
    label: OFFBOARDING_STEP_LABEL.start_qualification_retention,
    domain: "qualification",
    effect: "will_be_preserved",
    description: retained.length > 0
      ? `${retained.length} qualification record${retained.length === 1 ? "" : "s"} this carrier relied on are KEPT and move into retention. Ending the relationship does not erase what this carrier received and reviewed, and nobody here can choose otherwise.`
      : "This carrier has adopted no qualification records for this person.",
    ownerService: "Qualification file",
    // Not selectable, and not because of a permission: preserving a record the
    // carrier is obliged to keep is not a choice an offboarding screen offers.
    selectable: false,
    defaultSelected: true,
    affectedCount: retained.length,
  });

  impacts.push({
    key: "preserve_history",
    label: OFFBOARDING_STEP_LABEL.preserve_history,
    domain: "compliance",
    effect: "will_be_preserved",
    description:
      "Loads, settlements, Safety history, contracts, documents and every audit "
      + "event are kept in full. Nothing in this flow deletes history, and no "
      + "checklist is made to look complete by removing evidence.",
    ownerService: "Every module that owns its own history",
    selectable: false,
    defaultSelected: true,
  });

  void ctx;
  return {
    engagementId: engagement.id,
    warning:
      "Ending this engagement ends the working relationship only. Access, the "
      + "driver relationship and document access are separate, explicit steps and "
      + "each is performed by the module that owns it. Records this carrier is "
      + "obliged to keep are kept, and any step that fails stays visible in Needs "
      + "You until somebody finishes it.",
    impacts,
  };
}

/* -------------------------------------------------------------------------- */
/* Running it                                                                  */
/* -------------------------------------------------------------------------- */

const step = (
  key: OffboardingStepKey,
  outcome: OffboardingResultStep["outcome"],
  detail: string,
  extra: Partial<OffboardingResultStep> = {},
): OffboardingResultStep => ({
  key,
  label: OFFBOARDING_STEP_LABEL[key],
  outcome,
  detail,
  retryable: outcome === "failed",
  ...extra,
});

/**
 * Performs the confirmed steps, one module at a time, and reports every result.
 *
 * Each step is wrapped: one module throwing must not stop the others, because a
 * failure to revoke a document share is not a reason to leave an access seat
 * open. The same rule the propagation bus keeps about subscribers.
 */
export function runOffboardingSteps(
  ctx: ServiceContext,
  engagement: WorkforceEngagement,
  confirmed: readonly OffboardingStepKey[],
  reason: string,
): OffboardingResultStep[] {
  const at = nowIso();
  const results: OffboardingResultStep[] = [];
  const wants = (key: OffboardingStepKey) => confirmed.includes(key);

  /* -- Access ----------------------------------------------------------- */
  if (wants("end_membership_access")) {
    results.push(attempt("end_membership_access", () => {
      if (!engagement.membershipId) {
        return step("end_membership_access", "not_applicable", "This person holds no Antcolos access.");
      }
      const member = memberIn(engagement.organizationId, engagement.membershipId);
      if (!member) {
        return step("end_membership_access", "failed",
          "The linked membership is not in this organization's directory.",
          { reason: "The access system does not know this membership here." });
      }
      if (member.status !== "active") {
        // Idempotent: a re-run after another step failed does not re-end a seat
        // that is already closed, and does not report that as a failure.
        return step("end_membership_access", "completed", `Their seat was already ${member.status}.`);
      }
      setMembershipStatus(engagement.membershipId, "left");
      return step("end_membership_access", "completed",
        `${member.displayName}'s seat was ended through the access system. Their user account is untouched.`);
    }));
    // Delegations are a consequence of the seat, not a separate command.
    results.push(step("end_delegations", "completed",
      "The routing engine stops considering a membership that is not active. Every timeline entry naming them stays readable."));
  }

  /* -- Responsibility and equipment: a person, not a rule ---------------- */
  if (wants("rehome_responsibility")) {
    results.push(step("rehome_responsibility", "failed",
      "Work they hold has not been reassigned.",
      {
        reason:
          "Antcolos will not pick a new owner for somebody's work. Choosing who "
          + "takes it is a decision, and it is waiting for a person in Needs You.",
        retryable: true,
      }));
  }

  /* -- Driver relationship ---------------------------------------------- */
  if (wants("end_carrier_relationship")) {
    results.push(attempt("end_carrier_relationship", () => {
      if (!engagement.driverProfileId) {
        return step("end_carrier_relationship", "not_applicable", "This person is not a driver.");
      }
      const outcome = endCarrierRelationship(
        engagement.driverProfileId, engagement.organizationId, reason, at,
      );
      switch (outcome.outcome) {
        case "ended":
          return step("end_carrier_relationship", "completed",
            "The driver module ended its relationship record. It is kept as ended, with its history, its start date and its reason.");
        case "already_ended":
          // A success. The command is idempotent and saying otherwise would
          // raise a Needs You item about work that is already done.
          return step("end_carrier_relationship", "completed",
            "The operational relationship had already ended. Nothing was changed and nothing was duplicated.");
        case "no_relationship":
          return step("end_carrier_relationship", "not_applicable",
            "This person has no operational relationship with this carrier.");
        default:
          return step("end_carrier_relationship", "failed",
            "The driver module does not know this person.",
            { reason: "No driver profile with that id exists in the driver registry." });
      }
    }));
  }

  /* -- Documents --------------------------------------------------------- */
  if (wants("end_document_access")) {
    results.push(attempt("end_document_access", () => {
      if (!engagement.driverProfileId) {
        return step("end_document_access", "not_applicable", "There is no driver document context to end.");
      }
      const { linksEnded, sharesRevoked } = endRelationshipDocuments({
        subjectKind: "driver",
        subjectId: engagement.driverProfileId,
        organizationId: engagement.organizationId,
        reason,
        actorName: ctx.actor.displayNameSnapshot,
      });
      return step("end_document_access", "completed",
        `${linksEnded} document link${linksEnded === 1 ? "" : "s"} closed and ${sharesRevoked} share${sharesRevoked === 1 ? "" : "s"} revoked. Every document, version and lineage is untouched and still belongs to the person.`);
    }));
  }

  /* -- Qualification retention: always, never optional ------------------- */
  results.push(attempt("start_qualification_retention", () => {
    if (!engagement.driverProfileId) {
      return step("start_qualification_retention", "not_applicable",
        "This carrier holds no qualification records for this person.");
    }
    const moved = applyRelationshipEndToQualificationFile(ctx, engagement.driverProfileId, at);
    return step("start_qualification_retention", "completed",
      moved === 0
        ? "No qualification records needed moving; anything already in retention was left alone."
        : `${moved} qualification record${moved === 1 ? "" : "s"} kept and moved into retention. Nothing was deleted.`);
  }));

  results.push(step("preserve_history", "completed",
    "Loads, settlements, Safety history, contracts, documents and audit are kept in full."));

  return results;
}

/** One step's own failure never stops the rest. */
function attempt(
  key: OffboardingStepKey,
  run: () => OffboardingResultStep,
): OffboardingResultStep {
  try {
    return run();
  } catch (error) {
    return step(key, "failed", "This step did not finish.", {
      reason: error instanceof Error ? error.message : "The module that owns this step refused.",
      retryable: true,
    });
  }
}

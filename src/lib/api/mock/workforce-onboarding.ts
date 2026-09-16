import {
  CONTRACT_IN_FORCE_STATUSES, CONTRACT_TERMINAL_STATUSES, MOCK_ACTIVATION_LIMITATION,
  type OnboardingChecklist, type OnboardingStep, type OnboardingStepStatus,
  type WorkforceEngagement,
} from "@/types";
import { driverRequirements } from "@/lib/documents/requirements";
import { effectiveStatus } from "@/lib/documents/status";
import { documentInSlot, documentsForSubject } from "./document-store";
import { contractVersion, contractsForOrganization } from "./agreement-registry";
import { memberIn } from "./membership-directory";
import { organizationRequirements, syncOrganization } from "./compliance-registry";
import { carrierRelationshipUnscoped } from "./driver-registry";
import { recordsForDriver } from "./qualification-store";
import { waiversFor } from "./workforce-store";

/**
 * ███ MOCK-LAYER BRIDGE — DERIVATION, NOT STORAGE ███
 *
 * The onboarding checklist, READ from the modules that own each line.
 *
 * Nothing here is stored and nothing here is copied. Every row asks the
 * canonical module its question at the moment somebody looks: Safety for
 * qualification, the Document Center for paperwork, Contracts for signatures,
 * the access system for whether a seat exists, the driver registry for the
 * operational relationship, the qualification file for adopted evidence.
 *
 * That is the whole design. A stored HR checklist would be a second opinion
 * about facts five other modules already own, and a second opinion is a thing
 * that can be wrong while looking authoritative. Resolve the compliance
 * requirement and this checklist changes on the next read, with nobody ticking
 * anything — which is also why activation cannot claim something Safety
 * disagrees with.
 *
 * The five statuses are load-bearing and deliberately not three:
 *
 *   completed              the owning module says so.
 *   awaiting_other_domain  the owning module has it and has not finished.
 *   blocked                the owning module says it cannot proceed.
 *   waived                 somebody authorised set it aside, with a reason and
 *                          their name on it. Never the same as "completed".
 *   not_applicable         the rule does not reach this person, and says why.
 */

type Resolved = Pick<OnboardingStep, "status" | "detail" | "sourceRef">;

interface StepSeed {
  key: string;
  label: string;
  domain: OnboardingStep["domain"];
  requiredForActivation: boolean;
  resolve: () => Resolved;
}

const ok = (detail: string, sourceRef?: OnboardingStep["sourceRef"]): Resolved =>
  ({ status: "completed", detail, sourceRef });
const waiting = (detail: string, sourceRef?: OnboardingStep["sourceRef"]): Resolved =>
  ({ status: "awaiting_other_domain", detail, sourceRef });
const blocked = (detail: string, sourceRef?: OnboardingStep["sourceRef"]): Resolved =>
  ({ status: "blocked", detail, sourceRef });
const na = (detail: string): Resolved => ({ status: "not_applicable", detail });

/**
 * The sentence every non-driver engagement's driver-shaped step carries.
 *
 * Product decision 7: non-driver engagements ARE supported, and the
 * driver-specific document and compliance requirements resolve to
 * `not_applicable` rather than being invented. Antcolos has no employee
 * document requirement catalogue, and this milestone does not create one — so
 * the honest answer is that nothing applies, not that everything passes.
 */
const NOT_A_DRIVER =
  "This person is not a driver, and Antcolos has no employee document or "
  + "compliance requirement set in this build. Nothing applies here — which is "
  + "not the same as everything being satisfied.";

/* -------------------------------------------------------------------------- */
/* One step per owning module                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Safety & Compliance: is this person qualified to operate?
 *
 * Read from the compliance registry's own requirements for this driver. HR does
 * not re-decide any of them and does not copy their statuses — an outstanding
 * critical requirement here is the SAME record the Safety screen shows, and
 * resolving it there clears it here.
 */
function complianceStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "compliance.driver_qualification",
    label: "Safety qualification decisions",
    domain: "compliance",
    requiredForActivation: true,
    resolve: () => {
      if (!engagement.driverProfileId) return na(NOT_A_DRIVER);
      syncOrganization(engagement.organizationId);
      const mine = organizationRequirements(engagement.organizationId)
        .filter((r) => r.subject.kind === "driver" && r.subject.id === engagement.driverProfileId);
      if (mine.length === 0) {
        return waiting("Safety & Compliance has not built this driver's requirements yet.");
      }
      const href = `/compliance?subjectId=${engagement.driverProfileId}`;
      const open = mine.filter((r) => r.status === "action_required" || r.status === "expired");
      if (open.length > 0) {
        return blocked(
          `Safety & Compliance reports ${open.length} requirement${open.length === 1 ? "" : "s"} outstanding: ${open.map((r) => r.label).join(", ")}.`,
          { kind: "compliance_requirement", id: open[0].id, label: open[0].label, href },
        );
      }
      const expiring = mine.filter((r) => r.status === "expiring");
      if (expiring.length > 0) {
        return ok(
          `Every requirement is satisfied. ${expiring.length} is inside its warning window and Safety is watching it.`,
          { kind: "compliance_requirement", id: expiring[0].id, label: expiring[0].label, href },
        );
      }
      return ok(`Safety & Compliance reports all ${mine.length} requirements satisfied.`,
        { kind: "compliance_requirement", id: mine[0].id, label: "Driver compliance", href });
    },
  };
}

/**
 * The Document Center: is the paperwork on file?
 *
 * A join over the one document store against the driver requirement set,
 * computed per read exactly as `ChecklistView` is. HR stores no document and
 * keeps no second checklist.
 */
function documentsStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "documents.required_paperwork",
    label: "Required documents on file",
    domain: "documents",
    requiredForActivation: true,
    resolve: () => {
      if (!engagement.driverProfileId) return na(NOT_A_DRIVER);
      const engagementType = engagement.classification === "owner_operator"
        ? "owner_operator" as const
        : "company_driver" as const;
      const required = driverRequirements(engagementType)
        .filter((r) => r.applicability === "required");
      const missing: string[] = [];
      const rejected: string[] = [];
      for (const requirement of required) {
        const document = documentInSlot("driver", engagement.driverProfileId, requirement.key);
        if (!document) { missing.push(requirement.label); continue; }
        const status = effectiveStatus(document);
        if (status === "rejected") rejected.push(requirement.label);
        else if (status === "expired" || status === "missing") missing.push(requirement.label);
      }
      const href = "/documents";
      const ref = {
        kind: "document", id: engagement.driverProfileId,
        label: "Driver documents", href,
      };
      if (rejected.length > 0) {
        return blocked(`The Document Center has rejected: ${rejected.join(", ")}.`, ref);
      }
      if (missing.length > 0) {
        return waiting(`The Document Center is still waiting for: ${missing.join(", ")}.`, ref);
      }
      const held = documentsForSubject("driver", engagement.driverProfileId).length;
      return ok(`Every required document is on file. ${held} held in the Document Center.`, ref);
    },
  };
}

/**
 * Contracts: is there a signed agreement, and is it in force?
 *
 * The linked contract's OWN status, read from the agreement registry. HR never
 * copies a term, a signature, an effective date or a compensation rule — it
 * knows an id and follows it. The link is one-directional: nothing here writes
 * anything back onto the contract.
 */
function contractStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "contracts.signed_agreement",
    label: "Signed agreement in force",
    domain: "contracts",
    requiredForActivation: true,
    resolve: () => {
      if (!engagement.contractId) {
        return waiting(
          "No agreement is linked to this engagement yet. Contracts owns the terms; "
          + "this engagement only needs to know which one governs it.",
          { kind: "contract", id: "none", label: "Contracts", href: "/contracts" },
        );
      }
      const contract = contractsForOrganization(engagement.organizationId)
        .find((c) => c.contractId === engagement.contractId);
      if (!contract) {
        return blocked("The linked agreement is not readable from this organization.",
          { kind: "contract", id: engagement.contractId, label: "Contract", href: "/contracts" });
      }
      const ref = {
        kind: "contract", id: contract.contractId, label: contract.title,
        href: `/contracts/${contract.contractId}`,
      };
      // Contracts' OWN vocabulary, read through its own exported sets rather
      // than restated here. A status added to that union next year is handled
      // by whichever set Contracts puts it in, not by a list in this file that
      // nobody remembers to update.
      const said = contract.status.replace(/_/g, " ");
      if (CONTRACT_IN_FORCE_STATUSES.includes(contract.status)) {
        return ok(
          `Contracts reports "${contract.title}" in force at version ${contractVersion(contract).versionNumber}.`,
          ref,
        );
      }
      if (CONTRACT_TERMINAL_STATUSES.includes(contract.status)) {
        return blocked(`Contracts reports "${contract.title}" is ${said}.`, ref);
      }
      // Draft, pending review, awaiting signature: somebody in Contracts still
      // has it, and that is waiting rather than blocked.
      return waiting(`Contracts reports "${contract.title}" is ${said}.`, ref);
    },
  };
}

/**
 * Access: does this person hold a seat in this workspace?
 *
 * NOT required for activation, and that is the point. An active worker may have
 * no Antcolos account at all, and a membership is not proof of employment. HR
 * reads the access system; it does not own it and cannot change it.
 */
function accessStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "access.membership",
    label: "Antcolos access, if they need it",
    domain: "access",
    requiredForActivation: false,
    resolve: () => {
      if (!engagement.membershipId) {
        return na(
          "No Antcolos access has been asked for. Somebody can work here without "
          + "an account, and access is granted only through the access system.",
        );
      }
      const member = memberIn(engagement.organizationId, engagement.membershipId);
      if (!member) {
        return blocked("The linked membership is not in this organization's directory.", {
          kind: "membership", id: engagement.membershipId,
          label: "Membership", href: "/settings/users",
        });
      }
      const ref = {
        kind: "membership", id: member.membershipId,
        label: member.displayName, href: "/settings/users",
      };
      if (member.status === "active") return ok(`Access is active for ${member.displayName}.`, ref);
      if (member.status === "invited") return waiting("The invitation has not been accepted yet.", ref);
      return blocked(`The seat is ${member.status}. Access is the access system's to change.`, ref);
    },
  };
}

/** The driver's operational relationship with the carrier. Never merged in. */
function driverRelationshipStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "driver_relationship.carrier",
    label: "Driver–carrier relationship",
    domain: "driver_relationship",
    requiredForActivation: false,
    resolve: () => {
      if (!engagement.driverProfileId) return na(NOT_A_DRIVER);
      const relationship = carrierRelationshipUnscoped(
        engagement.driverProfileId, engagement.organizationId,
      );
      const href = `/people/drivers/${engagement.driverProfileId}`;
      if (!relationship) {
        return waiting(
          "No operational driver relationship exists yet. It is a separate record "
          + "from this engagement, and the driver relationship module starts it.",
          { kind: "driver", id: engagement.driverProfileId, label: "Driver", href },
        );
      }
      const ref = {
        kind: "driver_carrier_relationship",
        id: relationship.id,
        label: `${relationship.engagementType.replace(/_/g, " ")} with ${relationship.carrierName}`,
        href,
      };
      if (relationship.status === "active") return ok("The operational relationship is active.", ref);
      if (relationship.status === "ended") {
        return blocked("The operational driver relationship has ended.", ref);
      }
      return waiting(`The operational relationship is ${relationship.status}.`, ref);
    },
  };
}

/** Qualification file: has the carrier adopted the evidence it relies on? */
function qualificationStep(engagement: WorkforceEngagement): StepSeed {
  return {
    key: "qualification.adopted_evidence",
    label: "Qualification evidence adopted",
    domain: "qualification",
    requiredForActivation: false,
    resolve: () => {
      if (!engagement.driverProfileId) return na(NOT_A_DRIVER);
      // Narrowed to this engagement's organization immediately, as the store's
      // cross-organization read requires.
      const mine = recordsForDriver(engagement.driverProfileId).filter(
        (r) => r.organizationId === engagement.organizationId
          && r.retention.state !== "disposed" && !r.supersededByRecordId,
      );
      const href = `/workforce/${engagement.id}`;
      if (mine.length === 0) {
        return waiting(
          "This carrier has not adopted any document version into its qualification "
          + "file. Adopting is explicit: a shared document is not adopted by being opened.",
          { kind: "qualification_record", id: engagement.id, label: "Qualification file", href },
        );
      }
      return ok(
        `${mine.length} document version${mine.length === 1 ? "" : "s"} pinned into this carrier's qualification file.`,
        { kind: "qualification_record", id: mine[0].id, label: "Qualification file", href },
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The checklist                                                               */
/* -------------------------------------------------------------------------- */

export function buildOnboardingChecklist(engagement: WorkforceEngagement): OnboardingChecklist {
  const waivers = waiversFor(engagement.id);
  const seeds = [
    complianceStep(engagement),
    documentsStep(engagement),
    contractStep(engagement),
    qualificationStep(engagement),
    driverRelationshipStep(engagement),
    accessStep(engagement),
  ];

  const steps: OnboardingStep[] = seeds.map((seed) => {
    const resolved = seed.resolve();
    const waiver = waivers[seed.key];
    // A waiver is its OWN status, never "completed". Whoever reads this a year
    // from now has to be able to tell "Safety cleared it" from "somebody
    // decided we would go ahead anyway", and a green tick for both is exactly
    // how that distinction gets lost.
    const waived = waiver !== undefined && resolved.status !== "completed"
      && resolved.status !== "not_applicable";
    const status: OnboardingStepStatus = waived ? "waived" : resolved.status;
    return {
      key: seed.key,
      label: seed.label,
      domain: seed.domain,
      requiredForActivation: seed.requiredForActivation,
      status,
      detail: waived && waiver
        ? `Waived by ${waiver.authorizedByName}: ${waiver.reason} — the module that owns it still reports: ${resolved.detail}`
        : resolved.detail,
      sourceRef: resolved.sourceRef,
      waiver,
    };
  });

  const outstanding = steps.filter(
    (s) => s.requiredForActivation
      && s.status !== "completed" && s.status !== "waived" && s.status !== "not_applicable",
  );

  return {
    engagementId: engagement.id,
    steps,
    outstanding,
    readyToActivate: outstanding.length === 0,
    limitation: MOCK_ACTIVATION_LIMITATION,
  };
}

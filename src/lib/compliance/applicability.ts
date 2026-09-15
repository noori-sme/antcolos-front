import type {
  ComplianceApplicability, ComplianceRequirementDefinition,
  ComplianceSubjectContext,
} from "@/types";
import { definitionsForSubjectKind } from "./catalog";

/**
 * Which requirements reach this subject, and why the rest do not.
 *
 * Showing an owner-operator's lease agreement on a company driver, or a reefer
 * service record on a flatbed, is not a cosmetic mistake: it teaches the
 * operator that the compliance list is noise and they stop reading it. So the
 * rule is that a requirement is either applicable or it is absent — and when a
 * requirement is *deliberately* not applicable to a subject its peers do have,
 * the record says so in words rather than silently disappearing.
 */

/** A single explained reason a definition did not apply. */
export interface NotApplicableReason {
  /** Which condition failed. Stable enough to test against. */
  condition: keyof ComplianceApplicability;
  /** Written for the operator, not the developer. */
  explanation: string;
}

export type ApplicabilityVerdict =
  | { applies: true }
  | { applies: false; reason: NotApplicableReason };

const ORG_TYPE_LABEL = {
  CARRIER: "a carrier",
  DISPATCH_AGENCY: "a dispatch organization",
} as const;

/**
 * Every condition present on the rule must match the subject's context.
 * An empty `applicability` means the requirement reaches every subject of its
 * kind — which is the right default for things like a driving licence.
 */
export function evaluateApplicability(
  definition: ComplianceRequirementDefinition,
  context: ComplianceSubjectContext,
): ApplicabilityVerdict {
  const rule = definition.applicability;

  if (definition.subjectKind !== context.kind) {
    return {
      applies: false,
      reason: {
        condition: "organizationTypes",
        explanation: `This requirement is about a ${definition.subjectKind}, not a ${context.kind}.`,
      },
    };
  }

  if (rule.organizationTypes && !rule.organizationTypes.includes(context.organizationType)) {
    return {
      applies: false,
      reason: {
        condition: "organizationTypes",
        explanation: `Only applies to ${rule.organizationTypes
          .map((t) => ORG_TYPE_LABEL[t])
          .join(" or ")}.`,
      },
    };
  }

  if (rule.requiresOwnOperatingAuthority && !context.operatingAuthority.hasOwnAuthority) {
    return {
      applies: false,
      reason: {
        condition: "requiresOwnOperatingAuthority",
        explanation:
          "This organization does not run under its own operating authority, so the filing is not its to make.",
      },
    };
  }

  if (rule.interstateOnly && !context.interstate) {
    return {
      applies: false,
      reason: {
        condition: "interstateOnly",
        explanation: "Recorded as intrastate only, so the interstate requirement does not apply.",
      },
    };
  }

  if (rule.engagementTypes && (!context.engagementType || !rule.engagementTypes.includes(context.engagementType))) {
    return {
      applies: false,
      reason: {
        condition: "engagementTypes",
        explanation:
          rule.engagementTypes.includes("owner_operator")
            ? "Asked of owner-operators only. This driver is engaged as a company driver."
            : "Asked of company drivers only. This driver is engaged as an owner-operator.",
      },
    };
  }

  if (
    rule.carrierRelationshipTypes &&
    (!context.carrierRelationshipType ||
      !rule.carrierRelationshipTypes.includes(context.carrierRelationshipType))
  ) {
    return {
      applies: false,
      reason: {
        condition: "carrierRelationshipTypes",
        explanation:
          "This organization owns the equipment outright, so there is no lease to hold.",
      },
    };
  }

  if (
    rule.truckEquipmentTypes &&
    (!context.truckEquipmentType || !rule.truckEquipmentTypes.includes(context.truckEquipmentType))
  ) {
    return {
      applies: false,
      reason: {
        condition: "truckEquipmentTypes",
        explanation: "Does not apply to this class of power unit.",
      },
    };
  }

  if (rule.trailerTypes && (!context.trailerType || !rule.trailerTypes.includes(context.trailerType))) {
    return {
      applies: false,
      reason: {
        condition: "trailerTypes",
        explanation: "Does not apply to this type of trailer.",
      },
    };
  }

  if (rule.requiresReeferUnit && !context.hasReeferUnit) {
    return {
      applies: false,
      reason: {
        condition: "requiresReeferUnit",
        explanation: "This trailer carries no refrigeration unit.",
      },
    };
  }

  if (rule.requiresHazmat && !context.hazmat) {
    return {
      applies: false,
      reason: {
        condition: "requiresHazmat",
        explanation: "No placarded hazardous materials are recorded for this subject.",
      },
    };
  }

  if (
    rule.minGrossWeightPounds != null &&
    (context.grossWeightPounds == null || context.grossWeightPounds < rule.minGrossWeightPounds)
  ) {
    return {
      applies: false,
      reason: {
        condition: "minGrossWeightPounds",
        explanation: `Applies at ${rule.minGrossWeightPounds.toLocaleString("en-US")} lb gross weight and above.`,
      },
    };
  }

  return { applies: true };
}

export function applies(
  definition: ComplianceRequirementDefinition,
  context: ComplianceSubjectContext,
): boolean {
  return evaluateApplicability(definition, context).applies;
}

/** The requirements that genuinely reach this subject. */
export function applicableDefinitions(
  context: ComplianceSubjectContext,
): ComplianceRequirementDefinition[] {
  return definitionsForSubjectKind(context.kind).filter((d) => applies(d, context));
}

/**
 * Requirements deliberately NOT asked of this subject, with the reason.
 *
 * These become `not_applicable` records rather than nothing at all, so a safety
 * manager comparing two drivers can see that the missing rows are a decision
 * and not an oversight. They are hidden from the default view.
 */
export function inapplicableDefinitions(
  context: ComplianceSubjectContext,
): Array<{ definition: ComplianceRequirementDefinition; reason: NotApplicableReason }> {
  return definitionsForSubjectKind(context.kind)
    .map((definition) => ({ definition, verdict: evaluateApplicability(definition, context) }))
    .filter(
      (r): r is { definition: ComplianceRequirementDefinition; verdict: { applies: false; reason: NotApplicableReason } } =>
        !r.verdict.applies,
    )
    .map(({ definition, verdict }) => ({ definition, reason: verdict.reason }));
}

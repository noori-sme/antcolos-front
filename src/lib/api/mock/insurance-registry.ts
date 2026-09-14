import type {
  ActorRef, CertificateOfInsurance, CertificateView, ClaimCostEntry,
  ClaimEvent, ClaimEventKind, ClaimSummaryRow, ClaimView, CoverageEvaluation,
  CoverageGap, CoverageView, InsuranceDashboard, InsuranceDisclosureLevel,
  InsurancePolicyStatus, NeedsYouItem, PolicyStatusCounts, PolicyView,
  ClaimEvidence, ClaimNote, ClaimShare, ClaimStatus, ClaimThirdParty, ClaimType,
  CoverageAttribution, CoverageType, InsuranceClaim, InsuranceCoverage,
  InsurancePolicy, PermissionKey, PolicyEvent, PolicyEventKind,
  PolicyReplacementReason, PolicyShare, PolicySubject, PolicySubjectKind,
} from "@/types";
import type { CoverageEvaluationInput } from "@/types";
import {
  addFinancials, claimFinancials, CLAIM_STATUS_LABEL, isOpenClaim,
  REQUIRED_EVIDENCE, transitionRefusal, ZERO_FINANCIALS,
} from "@/lib/insurance/claim-states";
import {
  coverageStateAt, daysUntil, evaluateCoverage, EXPIRING_WINDOW_DAYS, policyStateAt,
  type CoverageEvaluationData,
} from "@/lib/insurance/coverage";
import { mockStore } from "./store";
import { requirementsFor } from "@/lib/insurance/requirements";
import {
  CLAIM_COST_LABEL, COVERAGE_TYPE_LABEL, expiryLabel, insuranceDate,
  REPLACEMENT_REASON_LABEL, RESPONSIBILITY_LABEL, THIRD_PARTY_ROLE_LABEL,
} from "@/lib/insurance/labels";
import {
  TRAILER_IDS, trailerAccessReason, trailerFleetSync,
} from "./trailer-registry";
import {
  TRUCK_IDS, accessReason, fleetSync, organizationNameFor,
} from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE insurance and claims registry.
 *
 * Like the truck and trailer registries it is NOT partitioned by organization.
 * A policy belongs to the carrier that holds it, and every other organization's
 * view of it is derived from an explicit share — so a dispatch organization
 * cannot reach a policy by guessing an id, and a carrier that stops sharing
 * stops being seen.
 *
 * Two invariants are enforced here and nowhere else, because a screen is the
 * wrong place to enforce anything:
 *
 *   1. COVERAGE IS READ AT THE TIME OF THE EVENT. Every answer this file gives
 *      about a past event is computed from the dated policy, coverage and
 *      schedule rows as they stood then. Renewing, cancelling, re-scheduling or
 *      moving operating authority cannot change it.
 *   2. HISTORY IS APPEND-ONLY. Renewal writes a new policy version and marks
 *      the old one superseded. Claim events, notes and cost lines are only ever
 *      added; a mistake is corrected by appending a correcting row.
 *
 * Nothing here talks to an insurer, files a claim, moves money, reads a
 * document or reports anything to a government body. See
 * `src/lib/insurance/extension-points.ts`.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 320;

const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const daysAgo = (n: number) => daysFromNow(-n);
const hoursAgo = (n: number) => iso(new Date(Date.now() - n * 3_600_000));
const nowIso = () => new Date().toISOString();

const usd = (amount: number) => ({ amount, currency: "USD" as const });

/** Permanent ids are UUIDs and nothing else — never a policy or claim number. */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Fixture identity                                                            */
/* -------------------------------------------------------------------------- */

/** Stable ids so loads, trucks, tests and reviewers can address a known record. */
export const POLICY_IDS = {
  /** Northline's primary auto liability + cargo policy, current term. */
  nlPrimaryV2: "c0a10000-1111-4a00-9001-0000000000a2",
  /** The term before it. Superseded, kept whole, still answers for its dates. */
  nlPrimaryV1: "c0a10000-1111-4a00-9001-0000000000a1",
  nlGeneralLiability: "c0a10000-1111-4a00-9001-0000000000b1",
  nlTrailerPhysical: "c0a10000-1111-4a00-9001-0000000000c1",
  nlReeferExpired: "c0a10000-1111-4a00-9001-0000000000d1",
  baxterPrimary: "c0a10000-2222-4a00-9002-0000000000a1",
  cascadePrimary: "c0a10000-3333-4a00-9003-0000000000a1",
} as const;

export const POLICY_CHAIN_IDS = {
  nlPrimary: "c0a1c4a1-1111-4a00-9001-00000000c001",
  nlGeneralLiability: "c0a1c4a1-1111-4a00-9001-00000000c002",
  nlTrailerPhysical: "c0a1c4a1-1111-4a00-9001-00000000c003",
  nlReefer: "c0a1c4a1-1111-4a00-9001-00000000c004",
  baxterPrimary: "c0a1c4a1-2222-4a00-9002-00000000c001",
  cascadePrimary: "c0a1c4a1-3333-4a00-9003-00000000c001",
} as const;

export const CLAIM_IDS = {
  /** Live accident, mid-investigation, one piece of evidence still missing. */
  nlAccident: "d1b20000-1111-4c00-9001-0000000000a1",
  /** Fourteen months old, settled and closed, attributed to the OLD policy. */
  nlHistoricCargo: "d1b20000-1111-4c00-9001-0000000000a2",
  /** Three days old, just reported, nothing gathered yet. */
  nlFreshCargo: "d1b20000-1111-4c00-9001-0000000000a3",
  /** On a trailer nobody scheduled. Coverage genuinely did not answer. */
  nlUncoveredProperty: "d1b20000-1111-4c00-9001-0000000000a4",
  nlDeniedTheft: "d1b20000-1111-4c00-9001-0000000000a5",
  /** Baxter's, shared with the dispatch organization that booked the load. */
  baxterCargo: "d1b20000-2222-4c00-9002-0000000000a1",
} as const;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The operational state of a DERIVED Needs You item.
 *
 * Insurance Needs You items are computed from live policy and claim state
 * rather than seeded, so there is no row to mutate when somebody snoozes one.
 * This overlay is that row, and only that row: snoozing an item never touches
 * the policy or the claim it is about, and the item disappears on its own when
 * the underlying problem is actually fixed.
 */
export interface NeedsYouOverlay {
  status?: "open" | "snoozed" | "resolved" | "escalated";
  assigneeMembershipId?: string;
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: import("@/types").NeedsYouHistoryEntry[];
}

interface RegistryState {
  policies: InsurancePolicy[];
  coverages: InsuranceCoverage[];
  subjects: PolicySubject[];
  certificates: CertificateOfInsurance[];
  policyShares: PolicyShare[];
  policyEvents: PolicyEvent[];
  claims: InsuranceClaim[];
  claimCosts: ClaimCostEntry[];
  claimEvidence: ClaimEvidence[];
  claimThirdParties: ClaimThirdParty[];
  claimNotes: ClaimNote[];
  claimEvents: ClaimEvent[];
  claimShares: ClaimShare[];
  needsYouOverlay: Record<string, NeedsYouOverlay>;
}

let registry: RegistryState | null = null;

/** Built on first use, so importing the module has no side effects. */
function db(): RegistryState {
  registry ??= buildFixtures();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetInsuranceRegistry() {
  registry = null;
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

function insurer(
  id: string, name: string, naicCode: string, claimsPhone: string,
) {
  return {
    id, name, naicCode, claimsPhone,
    // The only state this build can honestly produce. No adapter is connected.
    verification: { state: "unverified" as const },
  };
}

const GREAT_PLAINS = insurer("ins_gpm", "Great Plains Mutual", "24198", "+1 (800) 555-0190");
const HARBOR = insurer("ins_harbor", "Harbor Indemnity Company", "31915", "+1 (800) 555-0144");
const CANTERBURY = insurer("ins_canterbury", "Canterbury Transport Underwriters", "40177", "+1 (800) 555-0177");

const AGENT_PIERCE = {
  id: "agt_pierce", name: "Dana Pierce", agencyName: "Pierce Commercial Risk",
  phone: "+1 (312) 555-0192", email: "dana@piercerisk.example",
};
const AGENT_OKONKWO = {
  id: "agt_okonkwo", name: "Ada Okonkwo", agencyName: "Keel & Okonkwo Brokers",
  phone: "+1 (215) 555-0130", email: "ada@keelokonkwo.example",
};

function policy(p: {
  policyId: string;
  chainId: string;
  version: number;
  orgId: string;
  orgName: string;
  number: string;
  insurer: InsurancePolicy["insurer"];
  agent?: InsurancePolicy["agent"];
  recordedStatus: InsurancePolicy["recordedStatus"];
  from: string;
  to: string;
  premiumCents?: number;
  notes?: string;
  supersedes?: string;
  supersededBy?: string;
  supersededAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  reason?: PolicyReplacementReason;
}): InsurancePolicy {
  return {
    policyId: p.policyId,
    policyChainId: p.chainId,
    versionNumber: p.version,
    supersedesPolicyId: p.supersedes,
    supersededByPolicyId: p.supersededBy,
    carrierOrganizationId: p.orgId,
    carrierName: p.orgName,
    policyNumber: p.number,
    insurer: p.insurer,
    agent: p.agent,
    recordedStatus: p.recordedStatus,
    effectiveFrom: p.from,
    expiresAt: p.to,
    supersededAt: p.supersededAt,
    cancelledAt: p.cancelledAt,
    cancellationReason: p.cancellationReason,
    replacementReason: p.reason,
    premium: p.premiumCents === undefined ? undefined : usd(p.premiumCents),
    premiumInterval: p.premiumCents === undefined ? undefined : "annual",
    notes: p.notes,
    createdAt: p.from,
    createdByMembershipId: "seed",
    createdByName: "Antcolos",
  };
}

function coverage(c: {
  id: string;
  policyId: string;
  type: CoverageType;
  limitCents: number;
  aggregateCents?: number;
  deductibleCents: number;
  from: string;
  to: string;
  status?: InsuranceCoverage["recordedStatus"];
  supersededAt?: string;
  appliesTo?: PolicySubjectKind[];
  endorsement?: string;
}): InsuranceCoverage {
  return {
    coverageId: c.id,
    policyId: c.policyId,
    coverageType: c.type,
    limitPerOccurrence: usd(c.limitCents),
    aggregateLimit: c.aggregateCents === undefined ? undefined : usd(c.aggregateCents),
    deductible: usd(c.deductibleCents),
    effectiveFrom: c.from,
    expiresAt: c.to,
    recordedStatus: c.status ?? "active",
    supersededAt: c.supersededAt,
    appliesToSubjectKinds: c.appliesTo,
    endorsement: c.endorsement,
  };
}

function subject(
  policyId: string,
  subjectKind: PolicySubjectKind,
  subjectId: string,
  subjectLabel: string,
  addedAt: string,
  removedAt?: string,
  removalReason?: string,
): PolicySubject {
  return {
    id: rowId("sub"), policyId, subjectKind, subjectId, subjectLabel,
    addedAt, removedAt, removalReason,
  };
}

function policyEvent(
  policyId: string, kind: PolicyEventKind, at: string, summary: string,
  detail?: string, organizationId?: string, financial?: boolean,
): PolicyEvent {
  return {
    id: rowId("pev"), policyId, at, kind, summary, detail, organizationId,
    actorName: "Antcolos", financial,
  };
}

function claimEvent(
  claimId: string, kind: ClaimEventKind, at: string, summary: string,
  detail?: string, financial?: boolean, actor: ActorRef = SYSTEM_ACTOR,
): ClaimEvent {
  return { id: rowId("cev"), claimId, at, kind, summary, detail, financial, actor };
}

/**
 * The evidence a claim of this type needs, as unmet rows.
 *
 * Built from the same `REQUIRED_EVIDENCE` table the Needs You queue reads, so
 * a fixture can never disagree with the rule about what is missing.
 */
function evidenceFor(
  claimId: string, claimType: ClaimType, received: Record<string, string>,
): ClaimEvidence[] {
  return REQUIRED_EVIDENCE[claimType].map((req) => {
    const fileName = received[req.kind];
    return {
      id: rowId("evd"),
      claimId,
      kind: req.kind,
      label: req.label,
      required: true,
      status: fileName ? ("selected_local" as const) : ("missing" as const),
      file: fileName
        ? { fileName, fileType: "application/pdf", capturedAt: daysAgo(4), status: "selected_local" as const }
        : undefined,
      requestedAt: daysAgo(6),
      receivedAt: fileName ? daysAgo(4) : undefined,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The fixture set is chosen to make the hard cases visible rather than to look
 * tidy. In it you can see, without clicking anything twice:
 *
 *   - a policy that has been renewed, with last year's version kept whole;
 *   - a claim from last year still attributed to that older version;
 *   - a truck taken off a schedule on a date, so claims either side of that
 *     date get different — and both correct — answers;
 *   - a trailer nobody scheduled, and a real claim on it that coverage did not
 *     answer for;
 *   - a policy 24 days from expiry and one that lapsed 12 days ago;
 *   - a carrier's claim shared with the dispatch organization that booked the
 *     load, with the money withheld.
 */
function buildFixtures(): RegistryState {
  const P = POLICY_IDS;
  const C = POLICY_CHAIN_IDS;
  const T = TRUCK_IDS;
  const TR = TRAILER_IDS;

  const NL = "org_northline";
  const NL_NAME = "Northline Freight";
  const BX = "org_baxter";
  const BX_NAME = "Baxter Transit LLC";
  const CS = "org_cascade";

  /* ---- Policies -------------------------------------------------------- */

  const policies: InsurancePolicy[] = [
    // Last year's term. Superseded by the renewal, kept intact, and still the
    // policy that answers for anything that happened while it ran.
    policy({
      policyId: P.nlPrimaryV1, chainId: C.nlPrimary, version: 1,
      orgId: NL, orgName: NL_NAME, number: "GPM-AL-889120",
      insurer: GREAT_PLAINS, agent: AGENT_PIERCE,
      recordedStatus: "superseded",
      from: daysAgo(730), to: daysAgo(365),
      supersededBy: P.nlPrimaryV2, supersededAt: daysAgo(365),
      premiumCents: 4_120_000,
      notes: "First term with Great Plains after moving off Canterbury.",
    }),
    policy({
      policyId: P.nlPrimaryV2, chainId: C.nlPrimary, version: 2,
      orgId: NL, orgName: NL_NAME, number: "GPM-AL-889120-R2",
      insurer: GREAT_PLAINS, agent: AGENT_PIERCE,
      recordedStatus: "active",
      from: daysAgo(365), to: daysFromNow(200),
      supersedes: P.nlPrimaryV1, reason: "renewal",
      premiumCents: 4_480_000,
      notes: "Renewal came in 8.7% up on last term. Dana is re-marketing cargo before the next renewal.",
    }),
    // 24 days out. This is what the Needs You queue is watching.
    policy({
      policyId: P.nlGeneralLiability, chainId: C.nlGeneralLiability, version: 1,
      orgId: NL, orgName: NL_NAME, number: "HI-GL-44120",
      insurer: HARBOR, agent: AGENT_OKONKWO,
      recordedStatus: "active",
      from: daysAgo(341), to: daysFromNow(24),
      premiumCents: 610_000,
      notes: "Required by Apex and Glenmark before they will tender.",
    }),
    policy({
      policyId: P.nlTrailerPhysical, chainId: C.nlTrailerPhysical, version: 1,
      orgId: NL, orgName: NL_NAME, number: "GPM-PD-771002",
      insurer: GREAT_PLAINS, agent: AGENT_PIERCE,
      recordedStatus: "active",
      from: daysAgo(260), to: daysFromNow(105),
      premiumCents: 1_240_000,
    }),
    // Lapsed and not renewed. Nobody decided to drop it; it simply ran out.
    policy({
      policyId: P.nlReeferExpired, chainId: C.nlReefer, version: 1,
      orgId: NL, orgName: NL_NAME, number: "GPM-RB-5510",
      insurer: GREAT_PLAINS, agent: AGENT_PIERCE,
      recordedStatus: "active",
      from: daysAgo(377), to: daysAgo(12),
      premiumCents: 190_000,
    }),
    policy({
      policyId: P.baxterPrimary, chainId: C.baxterPrimary, version: 1,
      orgId: BX, orgName: BX_NAME, number: "CTU-AL-20114",
      insurer: CANTERBURY, agent: AGENT_OKONKWO,
      recordedStatus: "active",
      from: daysAgo(190), to: daysFromNow(175),
      premiumCents: 2_980_000,
      notes: "Baxter's own placement. Northline has never seen this policy.",
    }),
    policy({
      policyId: P.cascadePrimary, chainId: C.cascadePrimary, version: 1,
      orgId: CS, orgName: "Cascade Haul Co.", number: "HI-AL-90871",
      insurer: HARBOR,
      recordedStatus: "active",
      from: daysAgo(120), to: daysFromNow(245),
      premiumCents: 890_000,
    }),
  ];

  /* ---- Coverage -------------------------------------------------------- */

  const FLEET: PolicySubjectKind[] = ["carrier", "truck", "trailer"];

  const coverages: InsuranceCoverage[] = [
    coverage({ id: "cov_nl_v1_al", policyId: P.nlPrimaryV1, type: "auto_liability", limitCents: 100_000_000, deductibleCents: 250_000, from: daysAgo(730), to: daysAgo(365), status: "superseded", supersededAt: daysAgo(365), appliesTo: FLEET }),
    coverage({ id: "cov_nl_v1_cargo", policyId: P.nlPrimaryV1, type: "cargo", limitCents: 10_000_000, deductibleCents: 100_000, from: daysAgo(730), to: daysAgo(365), status: "superseded", supersededAt: daysAgo(365), appliesTo: FLEET }),

    coverage({ id: "cov_nl_v2_al", policyId: P.nlPrimaryV2, type: "auto_liability", limitCents: 100_000_000, aggregateCents: 200_000_000, deductibleCents: 250_000, from: daysAgo(365), to: daysFromNow(200), appliesTo: FLEET, endorsement: "CA-2001" }),
    coverage({ id: "cov_nl_v2_cargo", policyId: P.nlPrimaryV2, type: "cargo", limitCents: 10_000_000, deductibleCents: 100_000, from: daysAgo(365), to: daysFromNow(200), appliesTo: FLEET, endorsement: "MC-3110" }),
    // Added mid-term. Its own dates are what matter, not the policy's.
    coverage({ id: "cov_nl_v2_physical", policyId: P.nlPrimaryV2, type: "physical_damage", limitCents: 15_000_000, deductibleCents: 500_000, from: daysAgo(150), to: daysFromNow(200), appliesTo: ["truck"] }),

    coverage({ id: "cov_nl_gl", policyId: P.nlGeneralLiability, type: "general_liability", limitCents: 100_000_000, aggregateCents: 200_000_000, deductibleCents: 0, from: daysAgo(341), to: daysFromNow(24), appliesTo: ["carrier"] }),

    coverage({ id: "cov_nl_trailer_pd", policyId: P.nlTrailerPhysical, type: "physical_damage", limitCents: 6_500_000, deductibleCents: 250_000, from: daysAgo(260), to: daysFromNow(105), appliesTo: ["trailer"] }),
    coverage({ id: "cov_nl_interchange", policyId: P.nlTrailerPhysical, type: "trailer_interchange", limitCents: 4_000_000, deductibleCents: 100_000, from: daysAgo(260), to: daysFromNow(105), appliesTo: ["trailer"] }),

    coverage({ id: "cov_nl_reefer", policyId: P.nlReeferExpired, type: "reefer_breakdown", limitCents: 5_000_000, deductibleCents: 250_000, from: daysAgo(377), to: daysAgo(12), appliesTo: ["trailer"] }),

    coverage({ id: "cov_bx_al", policyId: P.baxterPrimary, type: "auto_liability", limitCents: 100_000_000, deductibleCents: 500_000, from: daysAgo(190), to: daysFromNow(175), appliesTo: FLEET }),
    coverage({ id: "cov_bx_cargo", policyId: P.baxterPrimary, type: "cargo", limitCents: 10_000_000, deductibleCents: 250_000, from: daysAgo(190), to: daysFromNow(175), appliesTo: FLEET }),

    coverage({ id: "cov_cs_al", policyId: P.cascadePrimary, type: "auto_liability", limitCents: 75_000_000, deductibleCents: 250_000, from: daysAgo(120), to: daysFromNow(245), appliesTo: FLEET }),
    coverage({ id: "cov_cs_cargo", policyId: P.cascadePrimary, type: "cargo", limitCents: 5_000_000, deductibleCents: 100_000, from: daysAgo(120), to: daysFromNow(245), appliesTo: FLEET }),
  ];

  /* ---- Schedules ------------------------------------------------------- */

  const subjects: PolicySubject[] = [
    // Last year's schedule, closed when the term ended. Never deleted: a claim
    // from that period still has to resolve against it.
    subject(P.nlPrimaryV1, "truck", T.nl104, "Unit 104", daysAgo(730), daysAgo(365), "Term ended."),
    subject(P.nlPrimaryV1, "truck", T.nl107, "Unit 107", daysAgo(730), daysAgo(365), "Term ended."),
    subject(P.nlPrimaryV1, "truck", T.nl115, "Unit 115", daysAgo(730), daysAgo(365), "Term ended."),

    subject(P.nlPrimaryV2, "truck", T.nl104, "Unit 104", daysAgo(365)),
    subject(P.nlPrimaryV2, "truck", T.nl107, "Unit 107", daysAgo(365)),
    subject(P.nlPrimaryV2, "truck", T.nl111, "Unit 111", daysAgo(365)),
    subject(P.nlPrimaryV2, "truck", T.nl115, "Unit 115", daysAgo(365)),
    subject(P.nlPrimaryV2, "truck", T.nl131, "Unit 131", daysAgo(150)),
    subject(P.nlPrimaryV2, "truck", T.claimed, "Unit 127", daysAgo(260)),
    // Taken off on a date, not erased. Anything before that date is still
    // covered; anything after it is a live gap the dashboard shows.
    subject(P.nlPrimaryV2, "truck", T.nl118, "Unit 118", daysAgo(200), daysAgo(30),
      "Marcus Hale moved the hotshot onto his own policy. His certificate has not arrived."),

    subject(P.nlGeneralLiability, "carrier", NL, NL_NAME, daysAgo(341)),

    subject(P.nlTrailerPhysical, "trailer", TR.dv220, "Trailer V-220", daysAgo(260)),
    subject(P.nlTrailerPhysical, "trailer", TR.rf114, "Trailer R-114", daysAgo(260)),
    subject(P.nlTrailerPhysical, "trailer", TR.gn330, "Trailer G-330", daysAgo(200)),
    subject(P.nlTrailerPhysical, "trailer", TR.mt501, "Trailer S-501", daysAgo(260)),
    subject(P.nlTrailerPhysical, "trailer", TR.oos602, "Trailer V-602", daysAgo(260)),
    subject(P.nlTrailerPhysical, "trailer", TR.mc701, "Trailer V-701", daysAgo(120)),
    subject(P.nlTrailerPhysical, "trailer", TR.lk702, "Trailer R-702", daysAgo(140)),
    subject(P.nlTrailerPhysical, "trailer", TR.cl901, "Trailer F-901", daysAgo(260)),
    // F-410 is deliberately absent. Northline runs it; nobody scheduled it.

    subject(P.nlReeferExpired, "trailer", TR.rf114, "Trailer R-114", daysAgo(377), daysAgo(12), "Policy lapsed."),

    subject(P.baxterPrimary, "truck", T.mdA12, "Unit A-12", daysAgo(190)),
    subject(P.baxterPrimary, "truck", T.mdA18, "Unit A-18", daysAgo(190)),
    subject(P.baxterPrimary, "trailer", TR.bx810, "Trailer BX-810", daysAgo(190)),
    subject(P.baxterPrimary, "trailer", TR.ch950, "Trailer BX-950", daysAgo(190)),

    // Cascade's is written blanket rather than scheduled: one row for the
    // whole operation, and the coverage lines say which kinds of unit it
    // reaches. Both shapes are real, so both are in the fixtures.
    subject(P.cascadePrimary, "carrier", CS, "Cascade Haul Co.", daysAgo(120)),
  ];

  /* ---- Certificates ---------------------------------------------------- */

  const certificates: CertificateOfInsurance[] = [
    {
      certificateId: "coi_nl_apex", policyId: P.nlPrimaryV2,
      policyNumberSnapshot: "GPM-AL-889120-R2", certificateNumber: "COI-2026-0417",
      holderName: "Apex Logistics", holderKind: "broker",
      coverageIds: ["cov_nl_v2_al", "cov_nl_v2_cargo"],
      issuedAt: daysAgo(210), effectiveFrom: daysAgo(210), expiresAt: daysFromNow(150),
      status: "issued", additionalInsured: true,
      file: { fileName: "coi-apex-2026.pdf", fileType: "application/pdf", sizeBytes: 148_221, capturedAt: daysAgo(210), status: "approved" },
      requestedByOrganizationId: NL, requestedByName: "Sam Murtaza",
      issuedByAgentName: "Dana Pierce",
    },
    {
      certificateId: "coi_nl_glenmark", policyId: P.nlGeneralLiability,
      policyNumberSnapshot: "HI-GL-44120", certificateNumber: "COI-2026-0418",
      holderName: "Glenmark Distribution", holderKind: "shipper",
      coverageIds: ["cov_nl_gl"],
      issuedAt: daysAgo(180), effectiveFrom: daysAgo(180), expiresAt: daysFromNow(9),
      status: "issued", additionalInsured: false,
      file: { fileName: "coi-glenmark.pdf", fileType: "application/pdf", sizeBytes: 132_004, capturedAt: daysAgo(180), status: "approved" },
      issuedByAgentName: "Ada Okonkwo",
    },
    {
      certificateId: "coi_nl_rivet", policyId: P.nlPrimaryV2,
      policyNumberSnapshot: "GPM-AL-889120-R2", certificateNumber: "COI-2025-0390",
      holderName: "Rivet Supply Co.", holderKind: "shipper",
      coverageIds: ["cov_nl_v2_cargo"],
      issuedAt: daysAgo(370), effectiveFrom: daysAgo(370), expiresAt: daysAgo(5),
      status: "expired", additionalInsured: false,
      issuedByAgentName: "Dana Pierce",
    },
    // Issued against last year's policy. Kept, and still pointing at the
    // version it was actually issued under — never re-pointed at the renewal.
    {
      certificateId: "coi_nl_tandem_old", policyId: P.nlPrimaryV1,
      policyNumberSnapshot: "GPM-AL-889120", certificateNumber: "COI-2025-0201",
      holderName: "Tandem Freight Partners", holderKind: "broker",
      coverageIds: ["cov_nl_v1_al", "cov_nl_v1_cargo"],
      issuedAt: daysAgo(700), effectiveFrom: daysAgo(700), expiresAt: daysAgo(365),
      status: "superseded", additionalInsured: true,
      supersededByCertificateId: "coi_nl_apex",
      issuedByAgentName: "Dana Pierce",
    },
    {
      certificateId: "coi_bx_keystone", policyId: P.baxterPrimary,
      policyNumberSnapshot: "CTU-AL-20114", certificateNumber: "COI-BX-2026-0044",
      holderName: "Keystone Brokerage", holderKind: "broker",
      coverageIds: ["cov_bx_al", "cov_bx_cargo"],
      issuedAt: daysAgo(150), effectiveFrom: daysAgo(150), expiresAt: daysFromNow(210),
      status: "issued", additionalInsured: true,
      issuedByAgentName: "Ada Okonkwo",
    },
  ];

  /* ---- Shares ---------------------------------------------------------- */

  // Baxter lets the dispatch organization that books its freight evidence its
  // cover to brokers. A summary, for a written reason, and revocable.
  const policyShares: PolicyShare[] = [
    {
      id: "shr_bx_meridian", policyId: P.baxterPrimary,
      sharedWithOrganizationId: "org_meridian", sharedWithName: "Meridian Dispatch",
      scope: "coverage_summary",
      purpose: "Meridian books our freight and is asked for evidence of cover by brokers at tender.",
      sharedAt: daysAgo(115),
      sharedByMembershipId: "seed", sharedByName: "Antcolos",
    },
  ];

  return finishFixtures({
    policies, coverages, subjects, certificates, policyShares,
  });
}

/**
 * Freezes what a claim is attributed to, at the instant it is recorded.
 *
 * The fixtures call the SAME evaluator the product calls, rather than writing
 * attributions by hand. A fixture therefore cannot claim cover that the rules
 * would not actually grant — which is the only way seed data stays honest as
 * the rules change.
 */
function freezeAttribution(
  input: CoverageEvaluationInput,
  carrierName: string,
  data: CoverageEvaluationData,
  attributedAt: string,
  subjectLabel?: string,
): CoverageAttribution {
  const result = evaluateCoverage(input, data);
  const policy = result.policyId
    ? data.policies.find((p) => p.policyId === result.policyId)
    : undefined;
  return {
    eventAt: input.at,
    attributedAt,
    policyId: result.policyId,
    policyNumber: result.policyNumber,
    policyVersionNumber: policy?.versionNumber,
    insurerName: result.insurerName,
    coverageId: result.coverageId,
    coverageType: result.covered ? input.coverageType : undefined,
    limitPerOccurrence: result.limitPerOccurrence,
    deductible: result.deductible,
    carrierOrganizationId: input.carrierOrganizationId,
    carrierName,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLabel: result.subjectLabel ?? subjectLabel,
    reason: result.reason,
    outcome: result.outcome,
  };
}

/** Assembles the claim side of the fixtures on top of the policy side. */
function finishFixtures(base: {
  policies: InsurancePolicy[];
  coverages: InsuranceCoverage[];
  subjects: PolicySubject[];
  certificates: CertificateOfInsurance[];
  policyShares: PolicyShare[];
}): RegistryState {
  const P = POLICY_IDS;
  const K = CLAIM_IDS;
  const T = TRUCK_IDS;
  const TR = TRAILER_IDS;
  const NL = "org_northline";
  const NL_NAME = "Northline Freight";
  const BX = "org_baxter";
  const BX_NAME = "Baxter Transit LLC";

  const data: CoverageEvaluationData = {
    policies: base.policies,
    coverages: base.coverages,
    subjects: base.subjects,
  };

  const SAM: ActorRef = {
    userId: "usr_sam", membershipId: "mem_northline_owner",
    displayNameSnapshot: "Sam Murtaza", source: "web",
  };
  const BAXTER_ACTOR: ActorRef = {
    userId: "usr_sam", membershipId: "mem_baxter_owner",
    displayNameSnapshot: "Sam Murtaza", source: "web",
  };

  const claims: InsuranceClaim[] = [
    {
      claimId: K.nlAccident, carrierOrganizationId: NL, carrierName: NL_NAME,
      claimReference: "CLM-2026-0114", insurerClaimNumber: "GPM-CL-778211",
      claimType: "accident", status: "investigating", severity: "major",
      title: "Rear-end collision on I-55 near Bloomington",
      description:
        "Unit 115 was struck from behind while slowing for stopped traffic. No injuries reported at the scene. The tractor is drivable; the bumper, lighting harness and rear frame rail are damaged.",
      eventAt: daysAgo(20), reportedAt: daysAgo(20), reportedBy: SAM,
      eventLocation: { city: "Bloomington", state: "IL", description: "I-55 southbound, mile marker 163" },
      attribution: freezeAttribution(
        { at: daysAgo(20), carrierOrganizationId: NL, subjectKind: "truck", subjectId: T.nl115, coverageType: "auto_liability" },
        NL_NAME, data, daysAgo(20), "Unit 115",
      ),
      links: {
        loadReference: "NL-24812", driverProfileId: "dp_amir", driverName: "Amir Haddad",
        truckId: T.nl115, truckLabel: "Unit 115",
      },
      responsibleParty: {
        kind: "third_party", name: "Colton Reeve",
        note: "The other driver admitted at the scene that he was following too closely. Not a legal finding.",
        determinedAt: daysAgo(18), determinedBy: SAM,
      },
      createdAt: daysAgo(20),
    },
    // Fourteen months old. Still attributed to the policy that was in force
    // then, which has since been renewed and superseded.
    {
      claimId: K.nlHistoricCargo, carrierOrganizationId: NL, carrierName: NL_NAME,
      claimReference: "CLM-2025-0088", insurerClaimNumber: "GPM-CL-551903",
      claimType: "cargo_damage", status: "closed", severity: "moderate",
      title: "Pallets crushed in transit to Kansas City",
      description:
        "Four pallets of packaged food shifted and were crushed against the bulkhead. The consignee refused two of them.",
      eventAt: daysAgo(400), reportedAt: daysAgo(399), reportedBy: SAM,
      eventLocation: { city: "Kansas City", state: "MO", description: "Consignee dock" },
      attribution: freezeAttribution(
        { at: daysAgo(400), carrierOrganizationId: NL, subjectKind: "truck", subjectId: T.nl107, coverageType: "cargo" },
        NL_NAME, data, daysAgo(399), "Unit 107",
      ),
      links: { truckId: T.nl107, truckLabel: "Unit 107", driverProfileId: "dp_marisol", driverName: "Marisol Ortiz" },
      responsibleParty: {
        kind: "our_driver", driverProfileId: "dp_marisol", name: "Marisol Ortiz",
        note: "Load was not strapped to the bulkhead. Retraining completed.",
        determinedAt: daysAgo(390), determinedBy: SAM,
      },
      closedAt: daysAgo(360), closureReason: "Settled and paid by Great Plains Mutual.",
      createdAt: daysAgo(399),
    },
    {
      claimId: K.nlFreshCargo, carrierOrganizationId: NL, carrierName: NL_NAME,
      claimReference: "CLM-2026-0121",
      claimType: "cargo_damage", status: "reported", severity: "minor",
      title: "Water damage to cartons on NL-24817",
      description:
        "Driver reported standing water in the cargo area at the Columbus delivery. Roughly a dozen cartons are stained; the consignee has noted it on the delivery paperwork.",
      eventAt: daysAgo(3), reportedAt: hoursAgo(20), reportedBy: SAM,
      eventLocation: { city: "Columbus", state: "OH", description: "Rivet DC Columbus" },
      attribution: freezeAttribution(
        { at: daysAgo(3), carrierOrganizationId: NL, subjectKind: "truck", subjectId: T.nl104, coverageType: "cargo" },
        NL_NAME, data, hoursAgo(20), "Unit 104",
      ),
      links: {
        loadReference: "NL-24817", truckId: T.nl104, truckLabel: "Unit 104",
        driverProfileId: "dp_dmitri", driverName: "Dmitri Kovalenko",
      },
      responsibleParty: { kind: "undetermined" },
      createdAt: hoursAgo(20),
    },
    // The dated-removal proof. Unit 118 came off the schedule 30 days ago;
    // this happened 10 days ago, so coverage does not answer — and a claim
    // recorded for a date BEFORE the removal still would.
    {
      claimId: K.nlUncoveredProperty, carrierOrganizationId: NL, carrierName: NL_NAME,
      claimReference: "CLM-2026-0118",
      claimType: "property_damage", status: "under_review", severity: "moderate",
      title: "Gate arm and fencing struck at the Joliet yard",
      description:
        "Unit 118 clipped the entry gate arm and a fence panel while backing out. The yard operator has sent a repair quote.",
      eventAt: daysAgo(10), reportedAt: daysAgo(9), reportedBy: SAM,
      eventLocation: { city: "Joliet", state: "IL", description: "Kestrel Yard, gate 2" },
      attribution: freezeAttribution(
        { at: daysAgo(10), carrierOrganizationId: NL, subjectKind: "truck", subjectId: T.nl118, coverageType: "auto_liability" },
        NL_NAME, data, daysAgo(9), "Unit 118",
      ),
      links: {
        truckId: T.nl118, truckLabel: "Unit 118",
        driverProfileId: "dp_marcus", driverName: "Marcus Hale",
      },
      responsibleParty: {
        kind: "our_driver", driverProfileId: "dp_marcus", name: "Marcus Hale",
        determinedAt: daysAgo(9), determinedBy: SAM,
      },
      createdAt: daysAgo(9),
    },
    {
      claimId: K.nlDeniedTheft, carrierOrganizationId: NL, carrierName: NL_NAME,
      claimReference: "CLM-2026-0071", insurerClaimNumber: "GPM-CL-760114",
      claimType: "theft", status: "denied", severity: "moderate",
      title: "Toolbox and straps taken from trailer S-501",
      description: "Equipment taken overnight from an unsecured lot in Memphis.",
      eventAt: daysAgo(75), reportedAt: daysAgo(74), reportedBy: SAM,
      eventLocation: { city: "Memphis", state: "TN" },
      attribution: freezeAttribution(
        { at: daysAgo(75), carrierOrganizationId: NL, subjectKind: "trailer", subjectId: TR.mt501, coverageType: "physical_damage" },
        NL_NAME, data, daysAgo(74), "Trailer S-501",
      ),
      links: { trailerId: TR.mt501, trailerLabel: "Trailer S-501" },
      responsibleParty: { kind: "third_party", note: "Unknown persons. Police report filed." },
      deniedAt: daysAgo(60),
      denialReason: "Loss falls below the $2,500 physical damage deductible.",
      createdAt: daysAgo(74),
    },
    {
      claimId: K.baxterCargo, carrierOrganizationId: BX, carrierName: BX_NAME,
      claimReference: "CLM-BX-2026-0031",
      claimType: "cargo_damage", status: "submitted", severity: "moderate",
      title: "Cartons damaged on a Keystone tender",
      description: "Two pallets crushed in transit. Keystone has been told and is waiting on an outcome.",
      eventAt: daysAgo(25), reportedAt: daysAgo(24), reportedBy: BAXTER_ACTOR,
      eventLocation: { city: "Allentown", state: "PA" },
      attribution: freezeAttribution(
        { at: daysAgo(25), carrierOrganizationId: BX, subjectKind: "truck", subjectId: T.mdA12, coverageType: "cargo" },
        BX_NAME, data, daysAgo(24), "Unit A-12",
      ),
      links: { truckId: T.mdA12, truckLabel: "Unit A-12", driverProfileId: "dp_serge", driverName: "Serge Petrov" },
      responsibleParty: { kind: "undetermined" },
      createdAt: daysAgo(24),
    },
  ];

  const claimEvidence: ClaimEvidence[] = [
    ...evidenceFor(K.nlAccident, "accident", {
      police_report: "mcpd-report-778211.pdf",
      photo: "unit115-rear-damage.jpg",
    }),
    ...evidenceFor(K.nlHistoricCargo, "cargo_damage", {
      bill_of_lading: "bol-nl-24560.pdf",
      proof_of_delivery: "pod-kc-exception.pdf",
      photo: "crushed-pallets.jpg",
    }),
    ...evidenceFor(K.nlFreshCargo, "cargo_damage", {}),
    ...evidenceFor(K.nlUncoveredProperty, "property_damage", {
      photo: "gate-arm.jpg",
    }),
    ...evidenceFor(K.nlDeniedTheft, "theft", {
      police_report: "mpd-2026-4471.pdf",
      bill_of_lading: "bol-s501.pdf",
    }),
    ...evidenceFor(K.baxterCargo, "cargo_damage", {
      bill_of_lading: "bol-keystone-9921.pdf",
    }),
  ];

  const cost = (
    claimId: string, kind: ClaimCostEntry["kind"], cents: number,
    bearer: ClaimCostEntry["bearer"], description: string,
    incurredDaysAgo: number, paidDaysAgo?: number, actor: ActorRef = SAM,
  ): ClaimCostEntry => ({
    id: rowId("cst"), claimId, kind, amount: usd(cents),
    incurredAt: daysAgo(incurredDaysAgo),
    paidAt: paidDaysAgo === undefined ? undefined : daysAgo(paidDaysAgo),
    bearer, description, recordedAt: daysAgo(incurredDaysAgo), recordedBy: actor,
  });

  const claimCosts: ClaimCostEntry[] = [
    cost(K.nlAccident, "reserve", 2_500_000, "insurer", "Reserve set by the adjuster", 18),
    cost(K.nlAccident, "towing", 185_000, "carrier", "Recovery to the Bloomington yard", 20, 17),
    cost(K.nlAccident, "repair", 1_420_000, "insurer", "Frame rail and lighting harness estimate", 14),
    cost(K.nlAccident, "adjuster", 90_000, "insurer", "Independent adjuster inspection", 16, 12),

    cost(K.nlHistoricCargo, "cargo_loss", 840_000, "insurer", "Two pallets refused and written off", 398, 370),
    cost(K.nlHistoricCargo, "cargo_loss", 100_000, "carrier", "Deductible retained by the carrier", 398, 370),
    cost(K.nlHistoricCargo, "salvage_credit", 60_000, "third_party", "Salvage recovery on the refused pallets", 380, 375),

    cost(K.nlUncoveredProperty, "repair", 670_000, "carrier", "Yard operator's quote for the gate arm and fence panel", 8),

    cost(K.baxterCargo, "reserve", 1_200_000, "insurer", "Reserve pending Canterbury's inspection", 22, undefined, BAXTER_ACTOR),
  ];

  const claimThirdParties: ClaimThirdParty[] = [
    {
      id: rowId("tp"), claimId: K.nlAccident, role: "other_driver", name: "Colton Reeve",
      organization: "Private vehicle", phone: "+1 (309) 555-0177",
      insurerName: "Midstate Casualty", policyNumber: "MC-4471902",
      note: "Details taken at the scene. Not verified with Midstate.",
      recordedAt: daysAgo(20),
    },
    {
      id: rowId("tp"), claimId: K.nlAccident, role: "police", name: "McLean County Sheriff",
      organization: "McLean County", phone: "+1 (309) 555-0100",
      note: "Report 778211.", recordedAt: daysAgo(20),
    },
    {
      id: rowId("tp"), claimId: K.nlAccident, role: "repair_shop", name: "Bloomington Truck Center",
      phone: "+1 (309) 555-0143", recordedAt: daysAgo(15),
    },
    {
      id: rowId("tp"), claimId: K.nlUncoveredProperty, role: "property_owner", name: "Kestrel Yard Services",
      phone: "+1 (815) 555-0128", recordedAt: daysAgo(9),
    },
  ];

  const claimNotes: ClaimNote[] = [
    {
      id: rowId("nte"), claimId: K.nlAccident, at: daysAgo(19), actor: SAM,
      visibility: "internal",
      body: "Dana is chasing Midstate for subrogation. Do not settle the repair until we hear back.",
    },
    {
      id: rowId("nte"), claimId: K.nlAccident, at: daysAgo(12), actor: SAM,
      visibility: "operational",
      body: "Unit 115 is off the road until the frame rail is signed off. Plan around it.",
    },
    {
      id: rowId("nte"), claimId: K.nlUncoveredProperty, at: daysAgo(8), actor: SAM,
      visibility: "internal",
      body: "Unit 118 came off our schedule on the 30th. Marcus still has not sent his certificate — this is the second time it has cost us.",
    },
    {
      id: rowId("nte"), claimId: K.baxterCargo, at: daysAgo(23), actor: BAXTER_ACTOR,
      visibility: "operational",
      body: "Keystone has been told. Meridian can tell them we are waiting on Canterbury's inspection.",
    },
  ];

  const claimShares: ClaimShare[] = [
    {
      id: "cshr_bx_meridian", claimId: K.baxterCargo,
      sharedWithOrganizationId: "org_meridian", sharedWithName: "Meridian Dispatch",
      purpose: "Meridian booked the load and is answering Keystone's questions about it.",
      sharedAt: daysAgo(23),
      sharedByMembershipId: "seed", sharedByName: "Antcolos",
    },
  ];

  const claimEvents: ClaimEvent[] = [
    claimEvent(K.nlAccident, "reported", daysAgo(20), "Claim reported", "Reported from the roadside by Amir Haddad.", false, SAM),
    claimEvent(K.nlAccident, "coverage_attributed", daysAgo(20), "Coverage attributed",
      "Auto liability under Great Plains Mutual GPM-AL-889120-R2, read as at the time of the collision."),
    claimEvent(K.nlAccident, "third_party_added", daysAgo(20), "Other driver recorded", "Colton Reeve, Midstate Casualty.", false, SAM),
    claimEvent(K.nlAccident, "status_changed", daysAgo(19), "Moved to under review", undefined, false, SAM),
    claimEvent(K.nlAccident, "responsibility_determined", daysAgo(18), "Responsibility recorded as a third party", undefined, false, SAM),
    claimEvent(K.nlAccident, "cost_recorded", daysAgo(18), "Reserve recorded", "$25,000.00 reserve set by the adjuster.", true, SAM),
    claimEvent(K.nlAccident, "status_changed", daysAgo(16), "Moved to investigating", undefined, false, SAM),
    claimEvent(K.nlAccident, "evidence_received", daysAgo(15), "Police report received", undefined, false, SAM),

    claimEvent(K.nlHistoricCargo, "reported", daysAgo(399), "Claim reported", undefined, false, SAM),
    claimEvent(K.nlHistoricCargo, "coverage_attributed", daysAgo(399), "Coverage attributed",
      "Cargo under Great Plains Mutual GPM-AL-889120 — the term in force at the time. The policy has since been renewed; this attribution has not changed."),
    claimEvent(K.nlHistoricCargo, "status_changed", daysAgo(380), "Moved to approved", undefined, false, SAM),
    claimEvent(K.nlHistoricCargo, "status_changed", daysAgo(370), "Moved to paid", "$8,400.00 paid by the insurer.", true, SAM),
    claimEvent(K.nlHistoricCargo, "status_changed", daysAgo(360), "Claim closed", undefined, false, SAM),

    claimEvent(K.nlFreshCargo, "reported", hoursAgo(20), "Claim reported", "Reported by the office after the driver called it in.", false, SAM),
    claimEvent(K.nlFreshCargo, "coverage_attributed", hoursAgo(20), "Coverage attributed", "Cargo under GPM-AL-889120-R2."),
    claimEvent(K.nlFreshCargo, "evidence_requested", hoursAgo(19), "Evidence requested", "BOL, signed POD noting the damage, and photos.", false, SAM),

    claimEvent(K.nlUncoveredProperty, "reported", daysAgo(9), "Claim reported", undefined, false, SAM),
    claimEvent(K.nlUncoveredProperty, "coverage_attributed", daysAgo(9), "No coverage answered",
      "Unit 118 was taken off the auto liability schedule 30 days ago. Nothing on file covers it for this date."),
    claimEvent(K.nlUncoveredProperty, "status_changed", daysAgo(9), "Moved to under review", undefined, false, SAM),
    claimEvent(K.nlUncoveredProperty, "cost_recorded", daysAgo(8), "Repair quote recorded", "$6,700.00, borne by the carrier.", true, SAM),

    claimEvent(K.nlDeniedTheft, "reported", daysAgo(74), "Claim reported", undefined, false, SAM),
    claimEvent(K.nlDeniedTheft, "coverage_attributed", daysAgo(74), "Coverage attributed", "Physical damage under GPM-PD-771002."),
    claimEvent(K.nlDeniedTheft, "status_changed", daysAgo(70), "Moved to submitted", undefined, false, SAM),
    claimEvent(K.nlDeniedTheft, "status_changed", daysAgo(60), "Denied by the insurer", "Below the physical damage deductible.", false, SAM),

    claimEvent(K.baxterCargo, "reported", daysAgo(24), "Claim reported", undefined, false, BAXTER_ACTOR),
    claimEvent(K.baxterCargo, "coverage_attributed", daysAgo(24), "Coverage attributed", "Cargo under Canterbury CTU-AL-20114."),
    claimEvent(K.baxterCargo, "shared_with_organization", daysAgo(23), "Shared with Meridian Dispatch",
      "Operational view only. Costs, reserves and deductibles were not shared.", false, BAXTER_ACTOR),
    claimEvent(K.baxterCargo, "status_changed", daysAgo(22), "Moved to submitted", undefined, false, BAXTER_ACTOR),
  ];

  const policyEvents: PolicyEvent[] = [
    policyEvent(P.nlPrimaryV1, "created", daysAgo(730), "Policy recorded in Antcolos", undefined, NL),
    policyEvent(P.nlPrimaryV1, "certificate_issued", daysAgo(700), "Certificate issued to Tandem Freight Partners", undefined, NL),
    policyEvent(P.nlPrimaryV1, "superseded", daysAgo(365), "Superseded by the renewal term",
      "Version 1 was kept whole. Its coverage, certificates and the claims attributed to it are unchanged.", NL),
    policyEvent(P.nlPrimaryV2, "created", daysAgo(365), "Renewal term recorded as version 2", undefined, NL),
    policyEvent(P.nlPrimaryV2, "renewed", daysAgo(365), "Renewed from GPM-AL-889120",
      "Premium up 8.7% on the previous term.", NL, true),
    policyEvent(P.nlPrimaryV2, "coverage_added", daysAgo(150), "Physical damage added mid-term", undefined, NL),
    policyEvent(P.nlPrimaryV2, "subject_added", daysAgo(150), "Unit 131 added to the schedule", undefined, NL),
    policyEvent(P.nlPrimaryV2, "subject_removed", daysAgo(30), "Unit 118 removed from the schedule",
      "Marcus Hale moved the hotshot onto his own policy. His certificate has not arrived.", NL),
    policyEvent(P.nlPrimaryV2, "certificate_issued", daysAgo(210), "Certificate issued to Apex Logistics", undefined, NL),
    policyEvent(P.nlGeneralLiability, "created", daysAgo(341), "Policy recorded in Antcolos", undefined, NL),
    policyEvent(P.nlGeneralLiability, "certificate_issued", daysAgo(180), "Certificate issued to Glenmark Distribution", undefined, NL),
    policyEvent(P.nlTrailerPhysical, "created", daysAgo(260), "Policy recorded in Antcolos", undefined, NL),
    policyEvent(P.nlReeferExpired, "created", daysAgo(377), "Policy recorded in Antcolos", undefined, NL),
    policyEvent(P.baxterPrimary, "created", daysAgo(190), "Policy recorded in Antcolos", undefined, BX),
    policyEvent(P.baxterPrimary, "shared", daysAgo(115), "Shared with Meridian Dispatch",
      "Coverage summary only. Premium and private notes were not shared.", BX),
    policyEvent(P.cascadePrimary, "created", daysAgo(120), "Policy recorded in Antcolos", undefined, "org_cascade"),
  ];

  return {
    policies: base.policies,
    coverages: base.coverages,
    subjects: base.subjects,
    certificates: base.certificates,
    policyShares: base.policyShares,
    policyEvents,
    claims,
    claimCosts,
    claimEvidence,
    claimThirdParties,
    claimNotes,
    claimEvents,
    claimShares,
    needsYouOverlay: {},
  };
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The caller. Mirrors `ServiceContext`: an organization and the permissions of
 * the membership acting inside it. Never a user, and never an organization
 * that came from a route param or a form field.
 */
export interface InsuranceContext {
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actor: ActorRef;
  scope?: { loads: "all" | "assigned" };
  driverProfileId?: string;
}

export function insuranceContextFrom(ctx: {
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actor: ActorRef;
  scope?: { loads: "all" | "assigned" };
  driverProfileId?: string;
}): InsuranceContext {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    permissions: ctx.permissions,
    actor: ctx.actor,
    scope: ctx.scope,
    driverProfileId: ctx.scope?.loads === "assigned" ? ctx.driverProfileId : undefined,
  };
}

export class InsurancePermissionError extends Error {
  constructor(readonly required: PermissionKey[]) {
    super(`Missing permission: ${required.join(", ")}`);
    this.name = "InsurancePermissionError";
  }
}

/**
 * A record the caller may not see and a record that does not exist are the
 * same answer. Anything else turns an id field into a directory of other
 * carriers' policies and losses.
 */
export class InsuranceNotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found`);
    this.name = "InsuranceNotFoundError";
  }
}

/** Refused for a reason the caller can act on, rather than a bare failure. */
export class InsuranceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsuranceRuleError";
  }
}

function requirePermissions(ctx: InsuranceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new InsurancePermissionError(missing);
}

const shareLive = (
  share: { sharedAt: string; expiresAt?: string; revokedAt?: string },
  at: number = Date.now(),
) =>
  new Date(share.sharedAt).getTime() <= at &&
  !share.revokedAt &&
  (!share.expiresAt || new Date(share.expiresAt).getTime() > at);

function activePolicyShare(policyId: string, organizationId: string) {
  return db().policyShares.find(
    (s) => s.policyId === policyId && s.sharedWithOrganizationId === organizationId && shareLive(s),
  );
}

function activeClaimShare(claimId: string, organizationId: string) {
  return db().claimShares.find(
    (s) => s.claimId === claimId && s.sharedWithOrganizationId === organizationId && shareLive(s),
  );
}

/**
 * How much of a policy this organization is entitled to.
 *
 * The carrier that holds it sees it whole. Everybody else sees it only because
 * that carrier deliberately shared it, and then only as a summary. There is no
 * third route in — not dispatching the truck, not hauling under it, not having
 * been on a load that the policy covered.
 */
export function policyDisclosureFor(
  policy: InsurancePolicy,
  ctx: InsuranceContext,
): "full" | "shared_summary" | "none" {
  if (!ctx.permissions.has("insurance:view")) return "none";
  if (policy.carrierOrganizationId === ctx.organizationId) return "full";
  return activePolicyShare(policy.policyId, ctx.organizationId) ? "shared_summary" : "none";
}

/**
 * How much of a claim this organization is entitled to.
 *
 * Same shape, same rule, separate grant: a dispatch organization can be given
 * one claim to follow without being shown the carrier's insurance position,
 * and being shown the policy does not hand over the losses.
 */
export function claimDisclosureFor(
  claim: InsuranceClaim,
  ctx: InsuranceContext,
): "full" | "shared_summary" | "none" {
  if (!ctx.permissions.has("claims:view")) return "none";
  if (claim.carrierOrganizationId === ctx.organizationId) return "full";
  return activeClaimShare(claim.claimId, ctx.organizationId) ? "shared_summary" : "none";
}

/** Money on a claim needs BOTH the owning carrier and the explicit permission. */
function canSeeClaimMoney(
  claim: InsuranceClaim,
  ctx: InsuranceContext,
  disclosure: "full" | "shared_summary" | "none",
): boolean {
  return (
    disclosure === "full" &&
    claim.carrierOrganizationId === ctx.organizationId &&
    ctx.permissions.has("claims:financials:view")
  );
}

/** Premiums and private notes need the owning carrier and the extra key. */
function canSeePolicyPrivates(
  disclosure: "full" | "shared_summary" | "none",
  ctx: InsuranceContext,
): boolean {
  return disclosure === "full" && ctx.permissions.has("insurance:sensitive:view");
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

function coveragesOf(policyId: string) {
  return db().coverages.filter((c) => c.policyId === policyId);
}

function subjectsOf(policyId: string) {
  return db().subjects.filter((s) => s.policyId === policyId);
}

function projectCoverage(
  c: InsuranceCoverage,
  disclosure: InsuranceDisclosureLevel,
  at: number,
): CoverageView {
  return {
    coverageId: c.coverageId,
    coverageType: c.coverageType,
    status: coverageStateAt(c, at),
    limitPerOccurrence: c.limitPerOccurrence,
    aggregateLimit: c.aggregateLimit,
    // What the carrier pays before the insurer does is the carrier's business.
    deductible: disclosure === "full" ? c.deductible : undefined,
    effectiveFrom: c.effectiveFrom,
    expiresAt: c.expiresAt,
    endorsement: c.endorsement,
    appliesToSubjectKinds: c.appliesToSubjectKinds,
  };
}

function projectPolicy(
  policy: InsurancePolicy,
  ctx: InsuranceContext,
  disclosure: "full" | "shared_summary",
  at: number = Date.now(),
): PolicyView {
  const privates = canSeePolicyPrivates(disclosure, ctx);
  const share = disclosure === "shared_summary"
    ? activePolicyShare(policy.policyId, ctx.organizationId)
    : undefined;
  const openClaims = db().claims.filter(
    (c) => c.attribution.policyId === policy.policyId && isOpenClaim(c.status),
  ).length;

  return {
    policyId: policy.policyId,
    policyChainId: policy.policyChainId,
    versionNumber: policy.versionNumber,
    policyNumber: policy.policyNumber,
    insurerName: policy.insurer.name,
    insurerVerification: policy.insurer.verification.state,
    agentName: disclosure === "full" ? policy.agent?.name : undefined,
    carrierOrganizationId: policy.carrierOrganizationId,
    carrierName: policy.carrierName,
    status: policyStateAt(policy, at),
    effectiveFrom: policy.effectiveFrom,
    expiresAt: policy.expiresAt,
    daysUntilExpiry: daysUntil(policy.expiresAt, at),
    // A "certificate only" share evidences that cover exists without handing
    // over the coverage schedule itself.
    coverage: share?.scope === "certificate_only"
      ? []
      : coveragesOf(policy.policyId).map((c) => projectCoverage(c, disclosure, at)),
    subjectCount: subjectsOf(policy.policyId).filter((s) => !s.removedAt).length,
    certificateCount: db().certificates.filter((c) => c.policyId === policy.policyId).length,
    openClaimCount: disclosure === "full" ? openClaims : undefined,
    supersedesPolicyId: policy.supersedesPolicyId,
    supersededByPolicyId: policy.supersededByPolicyId,
    disclosure,
    premium: privates ? policy.premium : undefined,
    premiumInterval: privates ? policy.premiumInterval : undefined,
    notes: privates ? policy.notes : undefined,
    sharePurpose: share?.purpose,
  };
}

function projectCertificate(
  cert: CertificateOfInsurance,
  at: number = Date.now(),
): CertificateView {
  const policy = db().policies.find((p) => p.policyId === cert.policyId);
  return {
    certificateId: cert.certificateId,
    certificateNumber: cert.certificateNumber,
    policyId: cert.policyId,
    policyNumberSnapshot: cert.policyNumberSnapshot,
    insurerName: policy?.insurer.name ?? "—",
    holderName: cert.holderName,
    holderKind: cert.holderKind,
    status: certificateStateAt(cert, at),
    issuedAt: cert.issuedAt,
    effectiveFrom: cert.effectiveFrom,
    expiresAt: cert.expiresAt,
    daysUntilExpiry: daysUntil(cert.expiresAt, at),
    additionalInsured: cert.additionalInsured,
    coverageTypes: cert.coverageIds
      .map((id) => db().coverages.find((c) => c.coverageId === id)?.coverageType)
      .filter((t): t is CoverageType => Boolean(t)),
    file: cert.file,
  };
}

/**
 * A certificate reads as expired once its own date passes, whatever the row
 * says — the same "derive it, never store it" rule the policy state follows.
 * Revoked and superseded are decisions somebody made, so those stand.
 */
function certificateStateAt(cert: CertificateOfInsurance, at: number = Date.now()) {
  if (cert.status === "revoked" || cert.status === "superseded" || cert.status === "draft") {
    return cert.status;
  }
  return new Date(cert.expiresAt).getTime() < at ? "expired" : "issued";
}

function evidenceOf(claimId: string) {
  return db().claimEvidence.filter((e) => e.claimId === claimId);
}

export function missingRequiredEvidence(claimId: string): number {
  return evidenceOf(claimId).filter(
    (e) => e.required && (e.status === "missing" || e.status === "rejected"),
  ).length;
}

function projectClaim(
  claim: InsuranceClaim,
  ctx: InsuranceContext,
  disclosure: "full" | "shared_summary",
): ClaimView {
  const money = canSeeClaimMoney(claim, ctx, disclosure);
  const costs = db().claimCosts.filter((c) => c.claimId === claim.claimId);
  const notes = db().claimNotes
    .filter((n) => n.claimId === claim.claimId)
    .filter((n) => disclosure === "full" || n.visibility === "operational")
    .sort((a, b) => a.at.localeCompare(b.at));
  const history = db().claimEvents
    .filter((e) => e.claimId === claim.claimId)
    // A shared viewer sees that the claim moved, never what it cost.
    .filter((e) => money || !e.financial)
    .sort((a, b) => b.at.localeCompare(a.at));

  const attribution: CoverageAttribution = money
    ? claim.attribution
    : {
      ...claim.attribution,
      // Limits and deductibles are commercial terms, not operational facts.
      limitPerOccurrence: undefined,
      deductible: disclosure === "full" ? claim.attribution.deductible : undefined,
    };

  return {
    claimId: claim.claimId,
    claimReference: claim.claimReference,
    insurerClaimNumber: claim.insurerClaimNumber,
    carrierOrganizationId: claim.carrierOrganizationId,
    carrierName: claim.carrierName,
    claimType: claim.claimType,
    status: claim.status,
    severity: claim.severity,
    title: claim.title,
    description: claim.description,
    eventAt: claim.eventAt,
    reportedAt: claim.reportedAt,
    eventLocation: claim.eventLocation,
    links: {
      ...claim.links,
      loadId: claim.links.loadId
        ?? loadIdForReference(claim.carrierOrganizationId, claim.links.loadReference),
    },
    attribution,
    // Fault stays inside the carrier that has to answer for it.
    responsibleParty: disclosure === "full" ? claim.responsibleParty : undefined,
    evidence: evidenceOf(claim.claimId),
    missingRequiredEvidence: missingRequiredEvidence(claim.claimId),
    thirdParties: db().claimThirdParties.filter((t) => t.claimId === claim.claimId),
    notes,
    history,
    disclosure,
    financials: money
      ? claimFinancials(costs, claim.attribution.deductible ?? { amount: 0, currency: "USD" })
      : undefined,
    costs: money ? costs.slice().sort((a, b) => b.incurredAt.localeCompare(a.incurredAt)) : undefined,
    closedAt: claim.closedAt,
    closureReason: claim.closureReason,
    denialReason: claim.denialReason,
  };
}

/**
 * The existing Load this claim is about.
 *
 * Resolved by reference against the organization's own loads rather than
 * copied onto the claim, so a claim never becomes a second, diverging record
 * of a load that already exists.
 */
function loadIdForReference(organizationId: string, reference?: string): string | undefined {
  if (!reference) return undefined;
  try {
    return mockStore.org(organizationId).loads.find((l) => l.reference === reference)?.id;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface PolicyFilters {
  /** Matches policy number, insurer, agent or a covered unit's label. */
  search?: string;
  status?: InsurancePolicyStatus[];
  coverageType?: CoverageType[];
  /** Superseded versions are hidden unless asked for — renewals pile up fast. */
  includeSuperseded?: boolean;
}

/**
 * Every policy this organization may see.
 *
 * Note the two-step: the disclosure decision comes first and the projection
 * second, so a record the caller is not entitled to never reaches a shape that
 * could be rendered.
 */
export function listPoliciesSync(
  ctx: InsuranceContext,
  filters: PolicyFilters = {},
): PolicyView[] {
  if (!ctx.permissions.has("insurance:view")) return [];
  const at = Date.now();
  const q = filters.search?.trim().toLowerCase();

  return db().policies
    .map((policy) => ({ policy, disclosure: policyDisclosureFor(policy, ctx) }))
    .filter((row): row is { policy: InsurancePolicy; disclosure: "full" | "shared_summary" } =>
      row.disclosure !== "none")
    .map(({ policy, disclosure }) => projectPolicy(policy, ctx, disclosure, at))
    .filter((view) => {
      if (!filters.includeSuperseded && view.status === "superseded") return false;
      if (filters.status?.length && !filters.status.includes(view.status)) return false;
      if (filters.coverageType?.length
        && !view.coverage.some((c) => filters.coverageType!.includes(c.coverageType))) {
        return false;
      }
      if (!q) return true;
      const subjects = subjectsOf(view.policyId).map((s) => s.subjectLabel).join(" ");
      return `${view.policyNumber} ${view.insurerName} ${view.agentName ?? ""} ${subjects}`
        .toLowerCase().includes(q);
    })
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

export async function listPolicies(
  ctx: InsuranceContext,
  filters: PolicyFilters = {},
): Promise<PolicyView[]> {
  await sleep(LATENCY_MS);
  return listPoliciesSync(ctx, filters);
}

export interface PolicyProfileView {
  policy: PolicyView;
  /** Dated schedule rows, including closed ones — history is the point. */
  subjects: PolicySubject[];
  certificates: CertificateView[];
  /** Every version of this line of cover, newest first. */
  versions: Array<Pick<PolicyView, "policyId" | "policyNumber" | "versionNumber" | "status" | "effectiveFrom" | "expiresAt">>;
  /** Full disclosure only. Who this policy has been shared with. */
  shares: PolicyShare[];
  events: PolicyEvent[];
  /** Full disclosure only. Claims attributed to this policy version. */
  claims: ClaimSummaryRow[];
}

export async function getPolicyProfile(
  ctx: InsuranceContext,
  policyId: string,
): Promise<PolicyProfileView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:view");
  const policy = db().policies.find((p) => p.policyId === policyId);
  const disclosure = policy ? policyDisclosureFor(policy, ctx) : "none";
  // Unknown id and forbidden id are deliberately the same answer.
  if (!policy || disclosure === "none") throw new InsuranceNotFoundError("Policy");

  const at = Date.now();
  const full = disclosure === "full";

  return {
    policy: projectPolicy(policy, ctx, disclosure, at),
    subjects: full ? subjectsOf(policyId) : subjectsOf(policyId).filter((s) => !s.removedAt),
    certificates: db().certificates
      .filter((c) => c.policyId === policyId)
      .map((c) => projectCertificate(c, at))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    versions: db().policies
      .filter((p) => p.policyChainId === policy.policyChainId)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((p) => ({
        policyId: p.policyId,
        policyNumber: p.policyNumber,
        versionNumber: p.versionNumber,
        status: policyStateAt(p, at),
        effectiveFrom: p.effectiveFrom,
        expiresAt: p.expiresAt,
      })),
    shares: full ? db().policyShares.filter((s) => s.policyId === policyId) : [],
    events: db().policyEvents
      .filter((e) => e.policyId === policyId)
      // A shared viewer sees the policy's life, never its premium movements.
      .filter((e) => full || !e.financial)
      .sort((a, b) => b.at.localeCompare(a.at)),
    claims: full
      ? db().claims
        .filter((c) => c.attribution.policyId === policyId)
        .map(claimRow)
        .sort((a, b) => b.eventAt.localeCompare(a.eventAt))
      : [],
  };
}

function claimRow(claim: InsuranceClaim): ClaimSummaryRow {
  return {
    claimId: claim.claimId,
    claimReference: claim.claimReference,
    title: claim.title,
    claimType: claim.claimType,
    status: claim.status,
    severity: claim.severity,
    eventAt: claim.eventAt,
    missingRequiredEvidence: missingRequiredEvidence(claim.claimId),
  };
}

export async function listCertificates(ctx: InsuranceContext): Promise<CertificateView[]> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("insurance:view")) return [];
  const at = Date.now();
  const visible = new Set(
    db().policies
      .filter((p) => policyDisclosureFor(p, ctx) !== "none")
      .map((p) => p.policyId),
  );
  return db().certificates
    .filter((c) => visible.has(c.policyId))
    .map((c) => projectCertificate(c, at))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

export interface ClaimFilters {
  search?: string;
  status?: ClaimStatus[];
  claimType?: ClaimType[];
  openOnly?: boolean;
  /** Only claims where coverage did not answer. */
  uncoveredOnly?: boolean;
}

export interface ClaimListRow extends ClaimSummaryRow {
  carrierName: string;
  covered: boolean;
  coverageReason: string;
  insurerName?: string;
  truckLabel?: string;
  trailerLabel?: string;
  driverName?: string;
  loadReference?: string;
  disclosure: InsuranceDisclosureLevel;
}

export function listClaimsSync(
  ctx: InsuranceContext,
  filters: ClaimFilters = {},
): ClaimListRow[] {
  if (!ctx.permissions.has("claims:view")) return [];
  const q = filters.search?.trim().toLowerCase();

  return db().claims
    .map((claim) => ({ claim, disclosure: claimDisclosureFor(claim, ctx) }))
    .filter((row): row is { claim: InsuranceClaim; disclosure: "full" | "shared_summary" } =>
      row.disclosure !== "none")
    .map(({ claim, disclosure }): ClaimListRow => ({
      ...claimRow(claim),
      carrierName: claim.carrierName,
      covered: claim.attribution.outcome === "covered",
      coverageReason: claim.attribution.reason,
      insurerName: claim.attribution.insurerName,
      truckLabel: claim.links.truckLabel,
      trailerLabel: claim.links.trailerLabel,
      driverName: claim.links.driverName,
      loadReference: claim.links.loadReference,
      disclosure,
    }))
    .filter((row) => {
      if (filters.openOnly && !isOpenClaim(row.status)) return false;
      if (filters.uncoveredOnly && row.covered) return false;
      if (filters.status?.length && !filters.status.includes(row.status)) return false;
      if (filters.claimType?.length && !filters.claimType.includes(row.claimType)) return false;
      if (!q) return true;
      return `${row.claimReference} ${row.title} ${row.truckLabel ?? ""} ${row.trailerLabel ?? ""} ${row.driverName ?? ""} ${row.loadReference ?? ""}`
        .toLowerCase().includes(q);
    })
    .sort((a, b) => b.eventAt.localeCompare(a.eventAt));
}

export async function listClaims(
  ctx: InsuranceContext,
  filters: ClaimFilters = {},
): Promise<ClaimListRow[]> {
  await sleep(LATENCY_MS);
  return listClaimsSync(ctx, filters);
}

export function getClaimSync(ctx: InsuranceContext, claimId: string): ClaimView {
  requirePermissions(ctx, "claims:view");
  const claim = db().claims.find((c) => c.claimId === claimId);
  const disclosure = claim ? claimDisclosureFor(claim, ctx) : "none";
  if (!claim || disclosure === "none") throw new InsuranceNotFoundError("Claim");
  return projectClaim(claim, ctx, disclosure);
}

export async function getClaim(ctx: InsuranceContext, claimId: string): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  return getClaimSync(ctx, claimId);
}

/* -------------------------------------------------------------------------- */
/* Coverage evaluation and gaps                                                */
/* -------------------------------------------------------------------------- */

function evaluationData(): CoverageEvaluationData {
  return { policies: db().policies, coverages: db().coverages, subjects: db().subjects };
}

/**
 * Was this unit covered at that moment?
 *
 * The carrier is forced to the caller's own organization. Asking the question
 * on somebody else's behalf would be a way to read their schedule one true or
 * false answer at a time.
 */
export function evaluateCoverageAt(
  ctx: InsuranceContext,
  input: Omit<CoverageEvaluationInput, "carrierOrganizationId">,
): CoverageEvaluation {
  requirePermissions(ctx, "insurance:view");
  return evaluateCoverage(
    { ...input, carrierOrganizationId: ctx.organizationId },
    evaluationData(),
  );
}

/**
 * Units this organization is running right now with no coverage answering.
 *
 * A statement about today only. It reads the live fleet from the truck and
 * trailer registries rather than a list kept here, so a truck that leaves the
 * fleet stops being a gap without anybody remembering to tidy up — and a unit
 * the caller cannot see never appears at all.
 *
 * Only units the organization actually OPERATES or OWNS count. A dispatch
 * organization can see a truck because it books freight on it, but it is not
 * the one who insures it, and telling a dispatcher their client's truck is
 * uncovered would be both useless to them and a disclosure the carrier never
 * made.
 */
export function coverageGapsSync(ctx: InsuranceContext): CoverageGap[] {
  if (!ctx.permissions.has("insurance:view")) return [];
  const at = Date.now();
  const data = evaluationData();
  const gaps: CoverageGap[] = [];

  const check = (
    subjectKind: PolicySubjectKind,
    subjectId: string,
    subjectLabel: string,
    href?: string,
  ) => {
    for (const requirement of requirementsFor(subjectKind)) {
      if (!requirement.required) continue;
      const result = evaluateCoverage(
        {
          at: new Date(at).toISOString(),
          carrierOrganizationId: ctx.organizationId,
          subjectKind,
          subjectId,
          coverageType: requirement.coverageType,
        },
        data,
      );
      if (result.covered) continue;
      gaps.push({
        id: `gap_${subjectKind}_${subjectId}_${requirement.coverageType}`,
        subjectKind, subjectId, subjectLabel,
        coverageType: requirement.coverageType,
        severity: requirement.severity,
        outcome: result.outcome,
        reason: result.reason,
        href,
      });
    }
  };

  const assetCtx = {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    permissions: ctx.permissions,
    driverProfileId: ctx.driverProfileId,
  };

  const insurable = (reason: string | null) =>
    reason === "operating_carrier" || reason === "owner";

  const trucks = fleetSync(assetCtx)
    .filter((t) => insurable(accessReason(t.truckId, assetCtx)));
  const trailers = trailerFleetSync(assetCtx)
    .filter((t) => insurable(trailerAccessReason(t.trailerId, assetCtx)));

  // An organization that neither runs a unit nor holds a policy is not being
  // asked to insure anything, so it is told about nothing.
  const holdsPolicy = db().policies.some((p) => p.carrierOrganizationId === ctx.organizationId);
  if (trucks.length === 0 && trailers.length === 0 && !holdsPolicy) return [];

  // The operation itself, then every unit it actually runs.
  check("carrier", ctx.organizationId, "This organization");
  for (const truck of trucks) {
    check("truck", truck.truckId, `Unit ${truck.unit}`, `/fleet/trucks/${truck.truckId}`);
  }
  for (const trailer of trailers) {
    check("trailer", trailer.trailerId, `Trailer ${trailer.unit}`, `/fleet/trailers/${trailer.trailerId}`);
  }

  const order = { critical: 0, high: 1, medium: 2 };
  return gaps.sort((a, b) => order[a.severity] - order[b.severity]);
}

export async function coverageGaps(ctx: InsuranceContext): Promise<CoverageGap[]> {
  await sleep(LATENCY_MS);
  return coverageGapsSync(ctx);
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

const EMPTY_CLAIM_COUNTS: Record<ClaimStatus, number> = {
  reported: 0, under_review: 0, submitted: 0, investigating: 0,
  approved: 0, denied: 0, paid: 0, closed: 0,
};

/**
 * The organization-scoped Insurance & Claims dashboard.
 *
 * Every number on it is counted from records this caller may already see one
 * at a time, so no tile can hint at a policy or a loss they are not entitled
 * to. A dispatch organization gets a real dashboard too — it is simply made of
 * what has been shared with it, and says so.
 */
export function insuranceDashboardSync(ctx: InsuranceContext): InsuranceDashboard {
  const at = Date.now();
  const policies = listPoliciesSync(ctx, { includeSuperseded: true });
  const owned = policies.filter((p) => p.carrierOrganizationId === ctx.organizationId);
  const disclosure: InsuranceDisclosureLevel =
    policies.length === 0 ? "none" : owned.length > 0 ? "full" : "shared_summary";

  const counts: PolicyStatusCounts = {
    active: 0, pending: 0, expiring: 0, expired: 0, cancelled: 0, superseded: 0,
  };
  for (const p of policies) counts[p.status] += 1;

  const claims = listClaimsSync(ctx);
  const claimsByStatus = { ...EMPTY_CLAIM_COUNTS };
  for (const c of claims) claimsByStatus[c.status] += 1;

  const certificates = db().certificates
    .filter((c) => policies.some((p) => p.policyId === c.policyId))
    .map((c) => projectCertificate(c, at));

  const money = ctx.permissions.has("claims:financials:view");
  const financials = money
    ? db().claims
      .filter((c) => c.carrierOrganizationId === ctx.organizationId)
      .reduce(
        (total, claim) => addFinancials(
          total,
          claimFinancials(
            db().claimCosts.filter((cost) => cost.claimId === claim.claimId),
            claim.attribution.deductible ?? { amount: 0, currency: "USD" },
          ),
        ),
        ZERO_FINANCIALS,
      )
    : undefined;

  return {
    organizationId: ctx.organizationId,
    organizationName: organizationNameFor(ctx.organizationId),
    generatedAt: new Date(at).toISOString(),
    disclosure,
    policies: counts,
    expiringSoon: policies
      .filter((p) => p.status === "expiring" || p.status === "expired")
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .map((p) => ({
        policyId: p.policyId,
        policyNumber: p.policyNumber,
        insurerName: p.insurerName,
        coverageTypes: p.coverage.map((c) => c.coverageType),
        expiresAt: p.expiresAt,
        daysUntilExpiry: p.daysUntilExpiry,
        status: p.status,
      })),
    coverageGaps: coverageGapsSync(ctx),
    claimsByStatus,
    openClaims: claims.filter((c) => isOpenClaim(c.status)),
    claimsMissingEvidence: claims.filter(
      (c) => isOpenClaim(c.status) && c.missingRequiredEvidence > 0,
    ).length,
    certificates: {
      issued: certificates.filter((c) => c.status === "issued").length,
      expiringSoon: certificates.filter(
        (c) => c.status === "issued" && c.daysUntilExpiry <= EXPIRING_WINDOW_DAYS,
      ).length,
      expired: certificates.filter((c) => c.status === "expired").length,
      revoked: certificates.filter((c) => c.status === "revoked").length,
    },
    claimFinancials: financials,
    needsAttention: insuranceNeedsYou(ctx).filter(
      (i) => i.status === "open" || i.status === "escalated",
    ).length,
  };
}

export async function insuranceDashboard(ctx: InsuranceContext): Promise<InsuranceDashboard> {
  await sleep(LATENCY_MS);
  return insuranceDashboardSync(ctx);
}

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

/** How long an open claim may sit untouched before it needs chasing. */
const STALE_CLAIM_DAYS = 14;

/**
 * Insurance items for the Needs You queue.
 *
 * DERIVED, never seeded. Each item is computed from the policy, schedule and
 * claim rows as they stand right now, which is what makes the queue honest in
 * both directions: an item appears the moment a policy slips inside the expiry
 * window, and it disappears the moment somebody actually renews it — not when
 * somebody ticks it off.
 *
 * Because there is no stored row, snoozing, assigning and resolving are kept
 * in a small overlay keyed by the item's derived id. Those actions record what
 * a person did about the problem; they never pretend the problem went away.
 */
export function insuranceNeedsYou(ctx: InsuranceContext): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  const at = Date.now();

  const push = (
    id: string,
    item: Omit<NeedsYouItem, "id" | "organizationId" | "status" | "createdAt" | "history">
      & { createdAt: string },
  ) => {
    const overlay = db().needsYouOverlay[id];
    items.push({
      id,
      organizationId: ctx.organizationId,
      status: overlay?.status ?? "open",
      assigneeMembershipId: overlay?.assigneeMembershipId,
      snoozedUntil: overlay?.snoozedUntil,
      snoozeReason: overlay?.snoozeReason,
      resolvedAt: overlay?.resolvedAt,
      resolutionNote: overlay?.resolutionNote,
      history: overlay?.history ?? [
        {
          id: `${id}_h0`,
          at: item.createdAt,
          actor: SYSTEM_ACTOR,
          action: "created",
          note: item.reason,
        },
      ],
      ...item,
    });
  };

  /* ---- Policies that are about to lapse, or already have ---------------- */

  if (ctx.permissions.has("insurance:view")) {
    for (const policy of listPoliciesSync(ctx, {})) {
      // Only the carrier that holds a policy is asked to do anything about it.
      if (policy.carrierOrganizationId !== ctx.organizationId) continue;
      // A version whose replacement is already on file still runs to its own
      // end date, and still reads as expiring — but there is nothing left for
      // anybody to do about it, so it is not put in the queue.
      if (policy.supersededByPolicyId) continue;
      const types = policy.coverage.map((c) => COVERAGE_TYPE_LABEL[c.coverageType]).join(", ");

      if (policy.status === "expiring") {
        push(`ins_ny_expiring_${policy.policyId}`, {
          category: "expiring_policy",
          severity: policy.daysUntilExpiry <= 7 ? "critical" : "high",
          title: `${policy.insurerName} ${policy.policyNumber} expires ${expiryLabel(policy.daysUntilExpiry)}`,
          reason: `${types} cover lapses on ${insuranceDate(policy.expiresAt)}. Nothing has replaced it yet.`,
          detail: "Renewing writes a new version of the policy. The current one, its certificates and every claim attributed to it are kept exactly as they are.",
          entity: {
            kind: "policy", id: policy.policyId,
            label: `${policy.policyNumber} · ${policy.insurerName}`,
            href: `/insurance/policies/${policy.policyId}`,
          },
          recommendedAction: {
            kind: "renew_policy", label: "Renew this policy", requires: ["insurance:manage"],
          },
          dueAt: policy.expiresAt,
          source: "system",
          requires: ["insurance:view"],
          createdAt: new Date(at).toISOString(),
        });
      }

      if (policy.status === "expired") {
        push(`ins_ny_expired_${policy.policyId}`, {
          category: "expired_policy",
          severity: "critical",
          title: `${policy.insurerName} ${policy.policyNumber} expired ${expiryLabel(policy.daysUntilExpiry)}`,
          reason: `${types} cover ran out on ${insuranceDate(policy.expiresAt)} and no renewal is on file.`,
          detail: "Anything that happened before it expired is still covered by it. Anything since is not.",
          entity: {
            kind: "policy", id: policy.policyId,
            label: `${policy.policyNumber} · ${policy.insurerName}`,
            href: `/insurance/policies/${policy.policyId}`,
          },
          recommendedAction: {
            kind: "renew_policy", label: "Record the replacement policy", requires: ["insurance:manage"],
          },
          dueAt: policy.expiresAt,
          source: "system",
          requires: ["insurance:view"],
          createdAt: policy.expiresAt,
        });
      }
    }

    /* ---- Units running with nothing answering for them ------------------ */

    for (const gap of coverageGapsSync(ctx)) {
      const critical = gap.severity === "critical";
      push(`ins_ny_${gap.id}`, {
        category: critical ? "critical_insurance_gap" : "missing_coverage",
        severity: critical ? "critical" : gap.severity === "high" ? "high" : "medium",
        title: `${gap.subjectLabel} has no ${COVERAGE_TYPE_LABEL[gap.coverageType].toLowerCase()} cover`,
        reason: gap.reason,
        detail: requirementsFor(gap.subjectKind)
          .find((r) => r.coverageType === gap.coverageType)?.why,
        entity: {
          kind: gap.subjectKind === "carrier" ? "carrier" : gap.subjectKind,
          id: gap.subjectId,
          label: gap.subjectLabel,
          href: gap.href,
        },
        recommendedAction: {
          kind: "add_coverage",
          label: "Put this on a policy",
          requires: ["insurance:manage"],
        },
        source: "system",
        requires: ["insurance:view"],
        createdAt: new Date(at).toISOString(),
      });
    }
  }

  /* ---- Claims that have stalled, or are missing their evidence ---------- */

  if (ctx.permissions.has("claims:view")) {
    for (const row of listClaimsSync(ctx, { openOnly: true })) {
      const events = db().claimEvents.filter((e) => e.claimId === row.claimId);
      const lastTouched = events.reduce(
        (latest, e) => (e.at > latest ? e.at : latest),
        row.eventAt,
      );
      const idleDays = Math.floor((at - new Date(lastTouched).getTime()) / 86_400_000);

      if (row.missingRequiredEvidence > 0) {
        push(`ins_ny_evidence_${row.claimId}`, {
          category: "missing_claim_evidence",
          severity: row.severity === "catastrophic" || row.severity === "major" ? "high" : "medium",
          title: `${row.claimReference} is missing ${row.missingRequiredEvidence} required ${row.missingRequiredEvidence === 1 ? "document" : "documents"}`,
          reason: `${row.title}. An insurer will not look at this until the paperwork is complete.`,
          entity: {
            kind: "claim", id: row.claimId,
            label: `${row.claimReference} · ${row.title}`,
            href: `/insurance/claims/${row.claimId}`,
          },
          recommendedAction: {
            kind: "collect_evidence", label: "See what is missing", requires: ["claims:view"],
          },
          source: "system",
          requires: ["claims:view"],
          createdAt: row.eventAt,
        });
      }

      if (idleDays >= STALE_CLAIM_DAYS) {
        push(`ins_ny_stalled_${row.claimId}`, {
          category: "unresolved_claim",
          severity: idleDays >= 30 ? "high" : "medium",
          title: `${row.claimReference} has not moved in ${idleDays} days`,
          reason: `${row.title} is still ${CLAIM_STATUS_LABEL[row.status].toLowerCase()}. Nothing has been recorded against it since ${insuranceDate(lastTouched)}.`,
          entity: {
            kind: "claim", id: row.claimId,
            label: `${row.claimReference} · ${row.title}`,
            href: `/insurance/claims/${row.claimId}`,
          },
          recommendedAction: {
            kind: "advance_claim", label: "Chase the insurer", requires: ["claims:manage"],
          },
          source: "system",
          requires: ["claims:view"],
          createdAt: lastTouched,
        });
      }

      // A claim nobody is covered for is not a claims problem, it is an
      // insurance problem, and it is the most expensive kind there is.
      if (!row.covered && row.disclosure === "full") {
        push(`ins_ny_uncovered_${row.claimId}`, {
          category: "critical_insurance_gap",
          severity: "critical",
          title: `${row.claimReference} has no coverage answering for it`,
          reason: row.coverageReason,
          detail: "Coverage was read as at the date of the event and nothing on file answered. The carrier is exposed for this loss.",
          entity: {
            kind: "claim", id: row.claimId,
            label: `${row.claimReference} · ${row.title}`,
            href: `/insurance/claims/${row.claimId}`,
          },
          recommendedAction: {
            kind: "review", label: "Review the attribution", requires: ["claims:view"],
          },
          source: "system",
          requires: ["claims:view"],
          createdAt: row.eventAt,
        });
      }
    }
  }

  return items;
}

/** True for ids this module owns, so the Needs You service can route writes. */
export function isInsuranceNeedsYouId(id: string): boolean {
  return id.startsWith("ins_ny_");
}

/**
 * Records what somebody did ABOUT an insurance item.
 *
 * Deliberately narrow: it stores queue state and nothing else. There is no
 * path from here into a policy or a claim, so resolving an item can never be
 * mistaken for renewing a policy or settling a loss.
 */
export function replaceInsuranceNeedsYou(item: NeedsYouItem) {
  db().needsYouOverlay[item.id] = {
    status: item.status,
    assigneeMembershipId: item.assigneeMembershipId,
    snoozedUntil: item.snoozedUntil,
    snoozeReason: item.snoozeReason,
    resolvedAt: item.resolvedAt,
    resolutionNote: item.resolutionNote,
    history: item.history,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every mutation below starts the same way, and that is the point: a record is
 * writable only by the carrier that owns it, holding the right key. Sharing a
 * policy or a claim grants reading and nothing else — there is no path in this
 * file by which a dispatch organization writes to a carrier's insurance.
 */
function ownedPolicy(ctx: InsuranceContext, policyId: string): InsurancePolicy {
  const policy = db().policies.find((p) => p.policyId === policyId);
  if (!policy || policy.carrierOrganizationId !== ctx.organizationId) {
    throw new InsuranceNotFoundError("Policy");
  }
  return policy;
}

function ownedClaim(ctx: InsuranceContext, claimId: string): InsuranceClaim {
  const claim = db().claims.find((c) => c.claimId === claimId);
  if (!claim || claim.carrierOrganizationId !== ctx.organizationId) {
    throw new InsuranceNotFoundError("Claim");
  }
  return claim;
}

function recordPolicyEvent(
  ctx: InsuranceContext, policyId: string, kind: PolicyEventKind,
  summary: string, detail?: string, financial?: boolean,
) {
  db().policyEvents.push({
    id: rowId("pev"), policyId, at: nowIso(), kind, summary, detail,
    organizationId: ctx.organizationId, actorName: ctx.actor.displayNameSnapshot,
    financial,
  });
}

function recordClaimEvent(
  ctx: InsuranceContext, claimId: string, kind: ClaimEventKind,
  summary: string, detail?: string, financial?: boolean,
  values?: { previousValue?: string; newValue?: string },
) {
  db().claimEvents.push({
    id: rowId("cev"), claimId, at: nowIso(), kind, summary, detail, financial,
    actor: ctx.actor, ...values,
  });
}

export interface RenewPolicyInput {
  policyNumber: string;
  effectiveFrom: string;
  expiresAt: string;
  reason: PolicyReplacementReason;
  /** Omitted keeps the previous term's figure. */
  premiumCents?: number;
  notes?: string;
}

/**
 * Renew or replace a policy.
 *
 * This is the operation the whole module is shaped around. It NEVER edits the
 * previous policy's terms, coverage, schedule or certificates. It writes a new
 * version, copies the live coverage lines and the open schedule rows forward
 * with new ids, and closes the old ones on the changeover date — so every
 * question about a date before the changeover still resolves against the
 * policy that was actually in force then.
 */
export async function renewPolicy(
  ctx: InsuranceContext,
  policyId: string,
  input: RenewPolicyInput,
): Promise<PolicyView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  const previous = ownedPolicy(ctx, policyId);

  if (previous.supersededByPolicyId) {
    throw new InsuranceRuleError(
      "This version has already been replaced. Renew the current version instead.",
    );
  }
  if (new Date(input.expiresAt).getTime() <= new Date(input.effectiveFrom).getTime()) {
    throw new InsuranceRuleError("The new term has to end after it starts.");
  }

  const changeover = input.effectiveFrom;
  const at = nowIso();
  const nextId = uuid();

  const next: InsurancePolicy = {
    ...previous,
    policyId: nextId,
    versionNumber: previous.versionNumber + 1,
    supersedesPolicyId: previous.policyId,
    supersededByPolicyId: undefined,
    supersededAt: undefined,
    cancelledAt: undefined,
    cancellationReason: undefined,
    recordedStatus: "active",
    policyNumber: input.policyNumber.trim(),
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt,
    replacementReason: input.reason,
    premium: input.premiumCents === undefined ? previous.premium : usd(input.premiumCents),
    notes: input.notes ?? previous.notes,
    createdAt: at,
    createdByMembershipId: ctx.membershipId,
    createdByName: ctx.actor.displayNameSnapshot,
  };

  // Close the outgoing version. Its rows are marked, never rewritten.
  previous.recordedStatus = "superseded";
  previous.supersededAt = changeover;
  previous.supersededByPolicyId = nextId;

  for (const line of coveragesOf(previous.policyId)) {
    if (line.recordedStatus !== "active") continue;
    line.recordedStatus = "superseded";
    line.supersededAt = changeover;
    db().coverages.push({
      ...line,
      coverageId: rowId("cov"),
      policyId: nextId,
      recordedStatus: "active",
      supersededAt: undefined,
      cancelledAt: undefined,
      effectiveFrom: input.effectiveFrom,
      expiresAt: input.expiresAt,
    });
  }

  for (const row of subjectsOf(previous.policyId)) {
    if (row.removedAt) continue;
    row.removedAt = changeover;
    row.removalReason = "Carried forward to the renewal term.";
    db().subjects.push({
      ...row,
      id: rowId("sub"),
      policyId: nextId,
      addedAt: input.effectiveFrom,
      removedAt: undefined,
      removalReason: undefined,
    });
  }

  db().policies.push(next);

  recordPolicyEvent(ctx, previous.policyId, "superseded",
    `Superseded by version ${next.versionNumber}`,
    "This version, its coverage, its certificates and every claim attributed to it are unchanged.");
  recordPolicyEvent(ctx, nextId, "created",
    `Recorded as version ${next.versionNumber}`,
    `${REPLACEMENT_REASON_LABEL[input.reason]} of ${previous.policyNumber}. Coverage and schedule were carried forward.`);
  recordPolicyEvent(ctx, nextId,
    input.reason === "renewal" ? "renewed" : "replaced",
    `${REPLACEMENT_REASON_LABEL[input.reason]} from ${previous.policyNumber}`,
    undefined,
    input.premiumCents !== undefined);

  return projectPolicy(next, ctx, "full");
}

export async function cancelPolicy(
  ctx: InsuranceContext,
  policyId: string,
  reason: string,
): Promise<PolicyView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  const policy = ownedPolicy(ctx, policyId);
  if (!reason.trim()) throw new InsuranceRuleError("A cancellation needs a reason.");
  if (policy.recordedStatus === "superseded") {
    throw new InsuranceRuleError("A superseded version cannot be cancelled.");
  }
  policy.recordedStatus = "cancelled";
  policy.cancelledAt = nowIso();
  policy.cancellationReason = reason.trim();
  recordPolicyEvent(ctx, policyId, "cancelled", "Policy cancelled", reason.trim());
  return projectPolicy(policy, ctx, "full");
}

export async function addPolicySubject(
  ctx: InsuranceContext,
  policyId: string,
  input: { subjectKind: PolicySubjectKind; subjectId: string; subjectLabel: string; scheduleReference?: string },
): Promise<PolicySubject> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  ownedPolicy(ctx, policyId);

  const open = subjectsOf(policyId).find(
    (s) => s.subjectKind === input.subjectKind && s.subjectId === input.subjectId && !s.removedAt,
  );
  if (open) throw new InsuranceRuleError(`${input.subjectLabel} is already on this schedule.`);

  const row: PolicySubject = {
    id: rowId("sub"), policyId, addedAt: nowIso(), ...input,
  };
  db().subjects.push(row);
  recordPolicyEvent(ctx, policyId, "subject_added", `${input.subjectLabel} added to the schedule`);
  return row;
}

/**
 * Take a unit off a schedule.
 *
 * Closes the row with a date. It is never deleted, because a loss from before
 * that date still has to find it.
 */
export async function removePolicySubject(
  ctx: InsuranceContext,
  subjectRowId: string,
  reason: string,
): Promise<PolicySubject> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  const row = db().subjects.find((s) => s.id === subjectRowId);
  if (!row) throw new InsuranceNotFoundError("Schedule row");
  ownedPolicy(ctx, row.policyId);
  if (row.removedAt) throw new InsuranceRuleError("That unit is already off the schedule.");
  if (!reason.trim()) throw new InsuranceRuleError("Say why it is coming off the schedule.");

  row.removedAt = nowIso();
  row.removalReason = reason.trim();
  recordPolicyEvent(ctx, row.policyId, "subject_removed",
    `${row.subjectLabel} removed from the schedule`,
    `${reason.trim()} Cover before today is unaffected.`);
  return row;
}

export async function sharePolicy(
  ctx: InsuranceContext,
  policyId: string,
  input: {
    organizationId: string;
    organizationName: string;
    purpose: string;
    scope: PolicyShare["scope"];
    expiresAt?: string;
  },
): Promise<PolicyShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:share:manage");
  ownedPolicy(ctx, policyId);
  if (input.organizationId === ctx.organizationId) {
    throw new InsuranceRuleError("You already hold this policy.");
  }
  // A share with no stated reason is a leak with paperwork.
  if (!input.purpose.trim()) {
    throw new InsuranceRuleError("Say why this organization needs to see the policy.");
  }
  if (activePolicyShare(policyId, input.organizationId)) {
    throw new InsuranceRuleError(`${input.organizationName} can already see this policy.`);
  }

  const share: PolicyShare = {
    id: rowId("shr"), policyId,
    sharedWithOrganizationId: input.organizationId,
    sharedWithName: input.organizationName,
    scope: input.scope,
    purpose: input.purpose.trim(),
    sharedAt: nowIso(),
    expiresAt: input.expiresAt,
    sharedByMembershipId: ctx.membershipId,
    sharedByName: ctx.actor.displayNameSnapshot,
  };
  db().policyShares.push(share);
  recordPolicyEvent(ctx, policyId, "shared", `Shared with ${input.organizationName}`,
    `${input.scope === "coverage_summary" ? "Coverage summary" : "Certificates only"}. Premium, private notes and claim money were not shared.`);
  return share;
}

export async function revokePolicyShare(
  ctx: InsuranceContext,
  shareId: string,
): Promise<PolicyShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:share:manage");
  const share = db().policyShares.find((s) => s.id === shareId);
  if (!share) throw new InsuranceNotFoundError("Share");
  ownedPolicy(ctx, share.policyId);
  if (share.revokedAt) throw new InsuranceRuleError("That access has already been taken away.");

  share.revokedAt = nowIso();
  recordPolicyEvent(ctx, share.policyId, "share_revoked",
    `Access taken away from ${share.sharedWithName}`);
  return share;
}

export interface IssueCertificateInput {
  certificateNumber: string;
  holderName: string;
  holderKind: CertificateOfInsurance["holderKind"];
  holderOrganizationId?: string;
  coverageIds: string[];
  effectiveFrom: string;
  expiresAt: string;
  additionalInsured: boolean;
  file?: { fileName: string; fileType?: string; sizeBytes?: number };
  notes?: string;
}

/**
 * Record a certificate of insurance.
 *
 * "Record", not "issue": Antcolos does not generate, sign or send a
 * certificate. This is the carrier writing down what its agent put out, so the
 * expiry can be tracked and the holder chased before it lapses.
 */
export async function recordCertificate(
  ctx: InsuranceContext,
  policyId: string,
  input: IssueCertificateInput,
): Promise<CertificateView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  const policy = ownedPolicy(ctx, policyId);
  if (input.coverageIds.length === 0) {
    throw new InsuranceRuleError("A certificate has to evidence at least one coverage line.");
  }
  const known = new Set(coveragesOf(policyId).map((c) => c.coverageId));
  if (input.coverageIds.some((id) => !known.has(id))) {
    throw new InsuranceRuleError("A certificate can only evidence coverage on its own policy.");
  }

  const cert: CertificateOfInsurance = {
    certificateId: uuid(),
    policyId,
    policyNumberSnapshot: policy.policyNumber,
    certificateNumber: input.certificateNumber.trim(),
    holderName: input.holderName.trim(),
    holderKind: input.holderKind,
    holderOrganizationId: input.holderOrganizationId,
    coverageIds: [...input.coverageIds],
    issuedAt: nowIso(),
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt,
    status: "issued",
    additionalInsured: input.additionalInsured,
    file: input.file
      // Honest: the browser gave us a name and a size and nothing else happened.
      ? { ...input.file, capturedAt: nowIso(), status: "selected_local" }
      : undefined,
    requestedByOrganizationId: ctx.organizationId,
    requestedByName: ctx.actor.displayNameSnapshot,
    notes: input.notes,
  };
  db().certificates.push(cert);
  recordPolicyEvent(ctx, policyId, "certificate_issued", `Certificate recorded for ${cert.holderName}`);
  return projectCertificate(cert);
}

export async function revokeCertificate(
  ctx: InsuranceContext,
  certificateId: string,
  reason: string,
): Promise<CertificateView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "insurance:manage");
  const cert = db().certificates.find((c) => c.certificateId === certificateId);
  if (!cert) throw new InsuranceNotFoundError("Certificate");
  ownedPolicy(ctx, cert.policyId);
  if (cert.status === "revoked") throw new InsuranceRuleError("That certificate is already revoked.");
  if (!reason.trim()) throw new InsuranceRuleError("A revocation needs a reason.");

  cert.status = "revoked";
  cert.revokedAt = nowIso();
  cert.revocationReason = reason.trim();
  recordPolicyEvent(ctx, cert.policyId, "certificate_revoked",
    `Certificate to ${cert.holderName} revoked`, reason.trim());
  return projectCertificate(cert);
}

/* ---- Claims -------------------------------------------------------------- */

export interface RecordClaimInput {
  claimType: ClaimType;
  severity: InsuranceClaim["severity"];
  title: string;
  description: string;
  /** When it HAPPENED. Coverage is read at this instant, not at "now". */
  eventAt: string;
  eventLocation?: InsuranceClaim["eventLocation"];
  /** What the loss is against. Decides which coverage line is asked. */
  subjectKind: PolicySubjectKind;
  subjectId: string;
  subjectLabel: string;
  coverageType: CoverageType;
  links?: Omit<InsuranceClaim["links"], "truckId" | "trailerId">;
}

/**
 * Report a loss.
 *
 * The attribution is computed once, here, from the event's own date, and then
 * frozen onto the claim. Nothing afterwards recomputes it: not a renewal, not
 * a unit leaving the fleet, not a change of operating authority. A claim that
 * finds no cover is recorded exactly as truthfully as one that does — the
 * uncovered outcome is a result, not an error.
 */
export async function recordClaim(
  ctx: InsuranceContext,
  input: RecordClaimInput,
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:create");
  if (!input.title.trim()) throw new InsuranceRuleError("Give the claim a title.");
  if (new Date(input.eventAt).getTime() > Date.now()) {
    throw new InsuranceRuleError("A loss cannot be recorded for a date in the future.");
  }

  const claimId = uuid();
  const at = nowIso();
  const attribution = freezeAttribution(
    {
      at: input.eventAt,
      carrierOrganizationId: ctx.organizationId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      coverageType: input.coverageType,
    },
    organizationNameFor(ctx.organizationId),
    evaluationData(),
    at,
    input.subjectLabel,
  );

  const year = new Date(input.eventAt).getUTCFullYear();
  const sequence = db().claims.filter(
    (c) => c.carrierOrganizationId === ctx.organizationId,
  ).length + 1;

  const claim: InsuranceClaim = {
    claimId,
    carrierOrganizationId: ctx.organizationId,
    carrierName: organizationNameFor(ctx.organizationId),
    claimReference: `CLM-${year}-${String(sequence).padStart(4, "0")}`,
    claimType: input.claimType,
    status: "reported",
    severity: input.severity,
    title: input.title.trim(),
    description: input.description.trim(),
    eventAt: input.eventAt,
    reportedAt: at,
    reportedBy: ctx.actor,
    eventLocation: input.eventLocation,
    attribution,
    links: {
      ...input.links,
      truckId: input.subjectKind === "truck" ? input.subjectId : undefined,
      trailerId: input.subjectKind === "trailer" ? input.subjectId : undefined,
      truckLabel: input.subjectKind === "truck" ? input.subjectLabel : input.links?.truckLabel,
      trailerLabel: input.subjectKind === "trailer" ? input.subjectLabel : input.links?.trailerLabel,
    },
    responsibleParty: { kind: "undetermined" },
    createdAt: at,
  };

  db().claims.push(claim);
  // The evidence checklist comes from the shared table, so it can never
  // disagree with what the Needs You queue says is missing.
  for (const requirement of REQUIRED_EVIDENCE[input.claimType]) {
    db().claimEvidence.push({
      id: rowId("evd"), claimId, kind: requirement.kind, label: requirement.label,
      required: true, status: "missing", requestedAt: at,
    });
  }

  recordClaimEvent(ctx, claimId, "reported", "Claim reported", claim.title);
  recordClaimEvent(ctx, claimId, "coverage_attributed",
    attribution.outcome === "covered" ? "Coverage attributed" : "No coverage answered",
    attribution.reason);

  return projectClaim(claim, ctx, "full");
}

export async function advanceClaimStatus(
  ctx: InsuranceContext,
  claimId: string,
  to: ClaimStatus,
  note?: string,
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage");
  const claim = ownedClaim(ctx, claimId);

  const refusal = transitionRefusal(claim.status, to);
  if (refusal) throw new InsuranceRuleError(refusal);

  const from = claim.status;
  claim.status = to;
  if (to === "closed") {
    claim.closedAt = nowIso();
    claim.closureReason = note?.trim() || undefined;
  }
  if (to === "denied") {
    claim.deniedAt = nowIso();
    claim.denialReason = note?.trim() || undefined;
  }

  recordClaimEvent(ctx, claimId, "status_changed",
    `Moved to ${CLAIM_STATUS_LABEL[to].toLowerCase()}`, note?.trim(), false,
    { previousValue: from, newValue: to });

  return projectClaim(claim, ctx, "full");
}

export async function recordClaimCost(
  ctx: InsuranceContext,
  claimId: string,
  input: {
    kind: ClaimCostEntry["kind"];
    amountCents: number;
    bearer: ClaimCostEntry["bearer"];
    description: string;
    incurredAt?: string;
    paid?: boolean;
  },
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage", "claims:financials:view");
  const claim = ownedClaim(ctx, claimId);
  if (input.amountCents <= 0) throw new InsuranceRuleError("A cost line has to be more than zero.");
  if (!input.description.trim()) throw new InsuranceRuleError("Say what this cost is for.");

  const at = nowIso();
  db().claimCosts.push({
    id: rowId("cst"), claimId, kind: input.kind, amount: usd(input.amountCents),
    incurredAt: input.incurredAt ?? at,
    paidAt: input.paid ? at : undefined,
    bearer: input.bearer,
    description: input.description.trim(),
    recordedAt: at, recordedBy: ctx.actor,
  });
  recordClaimEvent(ctx, claimId, "cost_recorded",
    `${CLAIM_COST_LABEL[input.kind]} recorded`, input.description.trim(), true);
  return projectClaim(claim, ctx, "full");
}

/**
 * Reverse a cost line.
 *
 * The original stays exactly where it is. Correcting a figure by editing it
 * would leave no trace that the first number was ever believed, which is the
 * one thing an audit of a claim cannot tolerate.
 */
export async function reverseClaimCost(
  ctx: InsuranceContext,
  claimId: string,
  costId: string,
  reason: string,
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage", "claims:financials:view");
  const claim = ownedClaim(ctx, claimId);
  const original = db().claimCosts.find((c) => c.id === costId && c.claimId === claimId);
  if (!original) throw new InsuranceNotFoundError("Cost line");
  if (db().claimCosts.some((c) => c.reversesCostId === costId)) {
    throw new InsuranceRuleError("That line has already been reversed.");
  }
  if (!reason.trim()) throw new InsuranceRuleError("A reversal needs a reason.");

  const at = nowIso();
  db().claimCosts.push({
    ...original,
    id: rowId("cst"),
    reversesCostId: costId,
    recordedAt: at,
    recordedBy: ctx.actor,
    description: `Reverses “${original.description}” — ${reason.trim()}`,
  });
  recordClaimEvent(ctx, claimId, "cost_reversed", "Cost line reversed", reason.trim(), true);
  return projectClaim(claim, ctx, "full");
}

export async function addClaimNote(
  ctx: InsuranceContext,
  claimId: string,
  input: { body: string; visibility: ClaimNote["visibility"] },
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage");
  const claim = ownedClaim(ctx, claimId);
  if (!input.body.trim()) throw new InsuranceRuleError("An empty note helps nobody.");

  db().claimNotes.push({
    id: rowId("nte"), claimId, at: nowIso(), actor: ctx.actor,
    body: input.body.trim(), visibility: input.visibility,
  });
  recordClaimEvent(ctx, claimId, "note_added",
    input.visibility === "internal" ? "Internal note added" : "Note added, visible to shared viewers");
  return projectClaim(claim, ctx, "full");
}

/**
 * Attach a piece of evidence.
 *
 * `documentId` points at a Document that already exists — a BOL on the load,
 * a driver's photo upload. Antcolos does not keep a second copy of a document
 * because a claim refers to it.
 */
export async function attachClaimEvidence(
  ctx: InsuranceContext,
  evidenceId: string,
  input: { documentId?: string; fileName?: string; fileType?: string; sizeBytes?: number; note?: string },
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage");
  const evidence = db().claimEvidence.find((e) => e.id === evidenceId);
  if (!evidence) throw new InsuranceNotFoundError("Evidence");
  const claim = ownedClaim(ctx, evidence.claimId);
  if (!input.documentId && !input.fileName) {
    throw new InsuranceRuleError("Point at an existing document or choose a file.");
  }

  const at = nowIso();
  evidence.documentId = input.documentId ?? evidence.documentId;
  evidence.file = input.fileName
    ? {
      fileName: input.fileName, fileType: input.fileType, sizeBytes: input.sizeBytes,
      capturedAt: at, status: "selected_local", documentId: input.documentId,
    }
    : evidence.file;
  evidence.status = input.documentId ? "approved" : "selected_local";
  evidence.receivedAt = at;
  evidence.note = input.note?.trim() || evidence.note;

  recordClaimEvent(ctx, evidence.claimId, "evidence_received", `${evidence.label} attached`);
  return projectClaim(claim, ctx, "full");
}

export async function determineResponsibility(
  ctx: InsuranceContext,
  claimId: string,
  input: {
    kind: InsuranceClaim["responsibleParty"]["kind"];
    driverProfileId?: string;
    name?: string;
    note?: string;
  },
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage");
  const claim = ownedClaim(ctx, claimId);
  const previous = claim.responsibleParty.kind;

  claim.responsibleParty = {
    kind: input.kind,
    driverProfileId: input.driverProfileId,
    // Snapshotted, so the attribution survives the person leaving.
    name: input.name?.trim(),
    note: input.note?.trim(),
    determinedAt: nowIso(),
    determinedBy: ctx.actor,
  };
  recordClaimEvent(ctx, claimId, "responsibility_determined",
    `Responsibility recorded as ${RESPONSIBILITY_LABEL[input.kind].toLowerCase()}`,
    input.note?.trim(), false, { previousValue: previous, newValue: input.kind });
  return projectClaim(claim, ctx, "full");
}

export async function addClaimThirdParty(
  ctx: InsuranceContext,
  claimId: string,
  input: Omit<ClaimThirdParty, "id" | "claimId" | "recordedAt">,
): Promise<ClaimView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage");
  const claim = ownedClaim(ctx, claimId);
  if (!input.name.trim()) throw new InsuranceRuleError("A third party needs a name.");

  db().claimThirdParties.push({
    id: rowId("tp"), claimId, recordedAt: nowIso(), ...input, name: input.name.trim(),
  });
  recordClaimEvent(ctx, claimId, "third_party_added",
    `${THIRD_PARTY_ROLE_LABEL[input.role]} recorded: ${input.name.trim()}`);
  return projectClaim(claim, ctx, "full");
}

export async function shareClaim(
  ctx: InsuranceContext,
  claimId: string,
  input: { organizationId: string; organizationName: string; purpose: string; expiresAt?: string },
): Promise<ClaimShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage", "insurance:share:manage");
  ownedClaim(ctx, claimId);
  if (!input.purpose.trim()) {
    throw new InsuranceRuleError("Say why this organization needs to follow the claim.");
  }
  if (activeClaimShare(claimId, input.organizationId)) {
    throw new InsuranceRuleError(`${input.organizationName} can already follow this claim.`);
  }

  const share: ClaimShare = {
    id: rowId("cshr"), claimId,
    sharedWithOrganizationId: input.organizationId,
    sharedWithName: input.organizationName,
    purpose: input.purpose.trim(),
    sharedAt: nowIso(),
    expiresAt: input.expiresAt,
    sharedByMembershipId: ctx.membershipId,
    sharedByName: ctx.actor.displayNameSnapshot,
  };
  db().claimShares.push(share);
  recordClaimEvent(ctx, claimId, "shared_with_organization",
    `Shared with ${input.organizationName}`,
    "Operational view only. Costs, reserves and deductibles were not shared.");
  return share;
}

export async function revokeClaimShare(
  ctx: InsuranceContext,
  shareId: string,
): Promise<ClaimShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "claims:manage", "insurance:share:manage");
  const share = db().claimShares.find((s) => s.id === shareId);
  if (!share) throw new InsuranceNotFoundError("Share");
  ownedClaim(ctx, share.claimId);
  if (share.revokedAt) throw new InsuranceRuleError("That access has already been taken away.");

  share.revokedAt = nowIso();
  recordClaimEvent(ctx, share.claimId, "share_revoked",
    `Access taken away from ${share.sharedWithName}`);
  return share;
}

/** Full disclosure only: who is currently allowed to follow this claim. */
export function claimShares(ctx: InsuranceContext, claimId: string): ClaimShare[] {
  const claim = db().claims.find((c) => c.claimId === claimId);
  if (!claim || claimDisclosureFor(claim, ctx) !== "full") return [];
  return db().claimShares.filter((s) => s.claimId === claimId);
}

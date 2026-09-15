import {
  TERMINATION_STEP_TERM_LABEL,
  type AgreementType, type AuthorizedSigner, type CompensationRule,
  type Contract, type ContractEvent, type ContractLink, type ContractParty,
  type ContractPartyRole, type ContractRequirement, type ContractRequirementKind,
  type ContractSignature, type ContractStatus, type ContractTermination,
  type ContractTerms, type ContractVersion, type DocumentTypeKey,
  type IsoDateTime, type RelationshipRefKind, type RelationshipTransitionRequest,
  type Responsibility, type TerminationStepKey,
} from "@/types";
import { agreementTypeMeta, buildTransitionRequest } from "@/lib/contracts";
import { documentTypeLabel } from "@/lib/documents/catalog";
import { deterministicUuid } from "./document-store";
import { TRUCK_IDS } from "./truck-registry";
import type { AgreementDb } from "./agreement-registry";

/**
 * ███ MOCK FIXTURES — CLEARLY LABELLED, NOT LEGAL DOCUMENTS ███
 *
 * Seed agreements for the Contracts & Relationships dashboard.
 *
 * Deliberately not a tidy set. A dashboard where everything is signed and in
 * force proves nothing, so these cover every state the module claims to have —
 * a draft, one in review, one waiting on the driver's signature, active ones, one
 * inside its renewal window, one that has run out, one terminated and working
 * through its closeout, one cancelled, and one that was amended so the superseded
 * version is there to read.
 *
 * Every reference points at a REAL record from the existing fixtures: the truck
 * UUIDs from the truck registry, the organizations and memberships from the
 * session fixtures, the driver relationship ids from the driver mock. Nothing
 * here invents a second copy of anything.
 *
 * Every title and summary says, in the text itself, that it is a mock agreement
 * with no legal effect — because a fixture that reads like a real contract is a
 * fixture somebody will screenshot.
 */

const BASE = Date.now();
const daysFromNow = (n: number) => new Date(BASE + n * 86_400_000).toISOString();
const daysAgo = (n: number) => daysFromNow(-n);

/** Stable ids, so a refresh does not 404 a page somebody had open. */
const uuid = (seed: string) => deterministicUuid(`agreement:${seed}`);

const MOCK_NOTE = "MOCK AGREEMENT — recorded in Antcolos for demonstration. Not legal wording, not reviewed by anybody, and of no legal effect.";

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

interface PartySpec {
  role: ContractPartyRole;
  name: string;
  organizationRef?: string;
  driverProfileRef?: string;
  membershipRef?: string;
  /** Free text when the party is not in Antcolos at all. */
  externalIdentifier?: string;
  /** The membership that signs for this party, when somebody is authorised. */
  signerMembershipId?: string;
  signerName?: string;
  signerTitle?: string;
  signerAuthority?: AuthorizedSigner["authority"];
}

interface Spec {
  seed: string;
  organizationId: string;
  agreementType: AgreementType;
  reference: string;
  title: string;
  status: ContractStatus;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: IsoDateTime;
  parties: [PartySpec, PartySpec];
  /** Version 1's terms. Later versions are declared in `amendment`. */
  terms: Omit<ContractTerms, "requiredDocuments" | "termination"> & {
    requiredDocuments?: ContractTerms["requiredDocuments"];
    termination?: Partial<ContractTerms["termination"]>;
  };
  /** How far version 1 got. */
  versionStatus: ContractVersion["status"];
  /** Parties that have signed version 1, by role. */
  signedBy?: ContractPartyRole[];
  relationships?: Array<{
    kind: RelationshipRefKind;
    externalId: string;
    label: string;
    href?: string;
  }>;
  links?: ContractLink["ref"][];
  /** An amendment on top of a signed version 1. */
  amendment?: {
    changeReason: string;
    compensation?: CompensationRule[];
    effectiveFrom?: IsoDateTime;
    signedBy?: ContractPartyRole[];
    versionStatus: ContractVersion["status"];
  };
  termination?: {
    ground: ContractTermination["ground"];
    reason: string;
    noticeGivenAt: IsoDateTime;
    effectiveAt: IsoDateTime;
    /** Steps already confirmed, by key. The rest stay outstanding. */
    confirmed?: TerminationStepKey[];
  };
  cancelled?: { at: IsoDateTime; reason: string };
  /** Requirements that should read as waived in the fixtures. */
  waived?: string[];
}

function termsFor(spec: Spec): ContractTerms {
  const meta = agreementTypeMeta(spec.agreementType);
  return {
    summary: spec.terms.summary,
    effective: spec.terms.effective,
    renewal: spec.terms.renewal,
    termination: {
      grounds: ["for_convenience", "for_cause"],
      noticeDays: 30,
      forCauseNoticeDays: 0,
      closeoutSteps: meta.closeoutSteps.map((s) => ({
        key: s.key,
        label: TERMINATION_STEP_TERM_LABEL[s.key],
        owedByRole: s.owedByRole,
      })),
      ...spec.terms.termination,
    },
    compensation: spec.terms.compensation,
    responsibilities: spec.terms.responsibilities,
    requiredDocuments: spec.terms.requiredDocuments
      ?? meta.documentTerms.map((d, i) => ({
        id: `rd_${spec.seed}_${i}`,
        documentTypeKey: d.documentTypeKey,
        owedByRole: d.owedByRole,
        reason: d.reason,
        blocking: d.blocking,
      })),
    additionalTerms: spec.terms.additionalTerms,
  };
}

const rule = (
  id: string,
  partial: Omit<CompensationRule, "id">,
): CompensationRule => ({ id, ...partial });

const duty = (
  id: string,
  area: Responsibility["area"],
  owedByRole: ContractPartyRole,
  detail: string,
  material = false,
): Responsibility => ({ id, area, owedByRole, detail, material });

/* -------------------------------------------------------------------------- */
/* The fixtures                                                                */
/* -------------------------------------------------------------------------- */

const SPECS: Spec[] = [
  /* ---- Northline: a company driver, active ------------------------------ */
  {
    seed: "nl-driver-dmitri",
    organizationId: "org_northline",
    agreementType: "carrier_driver",
    reference: "CD-0001",
    title: "Company driver agreement — Dmitri Kovalenko (mock)",
    status: "active",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(210),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "driver", name: "Dmitri Kovalenko", driverProfileRef: "dp_dmitri",
        signerMembershipId: "mem_nl_dmitri", signerName: "Dmitri Kovalenko",
        signerAuthority: "self",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Northline engages Dmitri as a company driver on unit 104. Northline's truck, Northline's authority, Northline's fuel.`,
      effective: { from: daysAgo(208), to: daysFromNow(520), probationEndsAt: daysAgo(118) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
      compensation: [
        rule("cr_nl_dmitri_cpm", {
          kind: "rate_per_loaded_mile", label: "Loaded mile rate",
          detail: "62 cents per loaded mile, paid on the settlement for the period the work was performed in.",
          rateCents: 62, payeeRole: "driver",
        }),
        rule("cr_nl_dmitri_detention", {
          kind: "accessorial", label: "Detention share",
          detail: "Half of any detention the carrier actually collects.",
          amountCents: 2500, payeeRole: "driver",
        }),
      ],
      responsibilities: [
        duty("rs_nl_dmitri_fuel", "fuel", "carrier", "Northline fuels the truck and holds the fuel card."),
        duty("rs_nl_dmitri_maint", "maintenance", "carrier", "Northline maintains the unit and pays for repairs."),
        duty("rs_nl_dmitri_logs", "compliance", "driver", "The driver keeps their logs, licence and medical card current.", true),
        duty("rs_nl_dmitri_paper", "paperwork", "driver", "The driver turns in BOLs and PODs within 24 hours of delivery."),
      ],
    },
    versionStatus: "signed",
    signedBy: ["carrier", "driver"],
    relationships: [
      {
        kind: "driver_carrier_relationship", externalId: "rel_nl_dmitri",
        label: "Dmitri Kovalenko at Northline Freight", href: "/people/drivers/dp_dmitri",
      },
    ],
    links: [
      { kind: "driver", id: "dp_dmitri", labelSnapshot: "Dmitri Kovalenko", href: "/people/drivers/dp_dmitri" },
      { kind: "truck", id: TRUCK_IDS.nl104, labelSnapshot: "Unit 104", href: `/fleet/trucks/${TRUCK_IDS.nl104}` },
    ],
  },

  /* ---- Northline: an owner-operator, amended ---------------------------- */
  {
    seed: "nl-oo-marcus",
    organizationId: "org_northline",
    agreementType: "carrier_owner_operator",
    reference: "COO-0002",
    title: "Owner-operator agreement — Marcus Hale, unit 118 (mock)",
    status: "active",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(205),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "owner_operator", name: "Marcus Hale", driverProfileRef: "dp_marcus",
        signerMembershipId: "mem_nl_marcus", signerName: "Marcus Hale",
        signerAuthority: "self",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Marcus brings unit 118 and runs it under Northline's authority. He owns the truck; Northline never does.`,
      effective: { from: daysAgo(200), to: daysFromNow(165) },
      renewal: { kind: "mutual_consent", termDays: 365, reminderDays: 60 },
      compensation: [
        rule("cr_nl_marcus_pct_v1", {
          kind: "percentage_of_revenue", label: "Owner-operator share",
          detail: "70% of linehaul revenue on every load he runs.",
          percentageBasisPoints: 7000, payeeRole: "owner_operator",
          appliesFrom: daysAgo(200), appliesTo: daysAgo(46),
        }),
        rule("cr_nl_marcus_escrow", {
          kind: "deduction", label: "Maintenance escrow",
          detail: "$150 a week held back for maintenance, returned on a clean exit.",
          amountCents: 15_000, per: "week", payeeRole: "carrier",
        }),
      ],
      responsibilities: [
        duty("rs_nl_marcus_fuel", "fuel", "owner_operator", "Marcus buys his own fuel."),
        duty("rs_nl_marcus_maint", "maintenance", "owner_operator", "Marcus maintains unit 118 at his own cost.", true),
        duty("rs_nl_marcus_ins", "insurance", "carrier", "Northline carries liability while the unit runs under its authority.", true),
        duty("rs_nl_marcus_phys", "insurance", "owner_operator", "Marcus carries physical damage on his own truck.", true),
        duty("rs_nl_marcus_tolls", "tolls", "owner_operator", "Tolls and scales are his."),
      ],
    },
    versionStatus: "signed",
    signedBy: ["carrier", "owner_operator"],
    amendment: {
      changeReason: "Rate re-agreed at 72% from 1 August after the fuel surcharge change.",
      compensation: [
        rule("cr_nl_marcus_pct_v2", {
          kind: "percentage_of_revenue", label: "Owner-operator share",
          detail: "72% of linehaul revenue on every load he runs.",
          percentageBasisPoints: 7200, payeeRole: "owner_operator",
          appliesFrom: daysAgo(45),
        }),
        rule("cr_nl_marcus_escrow_v2", {
          kind: "deduction", label: "Maintenance escrow",
          detail: "$150 a week held back for maintenance, returned on a clean exit.",
          amountCents: 15_000, per: "week", payeeRole: "carrier",
        }),
      ],
      signedBy: ["carrier", "owner_operator"],
      versionStatus: "signed",
    },
    relationships: [
      {
        kind: "driver_carrier_relationship", externalId: "rel_nl_marcus",
        label: "Marcus Hale at Northline Freight", href: "/people/drivers/dp_marcus",
      },
      {
        kind: "truck_carrier_relationship", externalId: TRUCK_IDS.nl118,
        label: "Unit 118 leased on to Northline", href: `/fleet/trucks/${TRUCK_IDS.nl118}`,
      },
    ],
    links: [
      { kind: "truck", id: TRUCK_IDS.nl118, labelSnapshot: "Unit 118 — Marcus Hale's truck", href: `/fleet/trucks/${TRUCK_IDS.nl118}` },
      { kind: "driver", id: "dp_marcus", labelSnapshot: "Marcus Hale", href: "/people/drivers/dp_marcus" },
    ],
  },

  /* ---- Northline: Summit dispatch, expiring ----------------------------- */
  {
    seed: "nl-dispatch-summit",
    organizationId: "org_northline",
    agreementType: "carrier_dispatch_organization",
    reference: "CDO-0003",
    title: "Dispatch service agreement — Summit Dispatch Partners (mock)",
    status: "active",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(50),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "dispatch_organization", name: "Summit Dispatch Partners LLC",
        organizationRef: "org_summit",
        signerMembershipId: "mem_summit_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
    ],
    terms: {
      // 18 days left against a 30-day reminder window: derives as `expiring`.
      summary: `${MOCK_NOTE} Summit books freight for units 111 and 131 only. It neither owns them nor runs them under its own authority.`,
      effective: { from: daysAgo(45), to: daysFromNow(18) },
      renewal: { kind: "automatic", termDays: 90, noticeDays: 14, reminderDays: 30 },
      compensation: [
        rule("cr_nl_summit_pct", {
          kind: "percentage_of_revenue", label: "Dispatch fee",
          detail: "5% of the gross on every load Summit books.",
          percentageBasisPoints: 500, payeeRole: "dispatch_organization",
        }),
      ],
      responsibilities: [
        duty("rs_nl_summit_book", "dispatch", "dispatch_organization", "Summit sources and negotiates freight for the named units only.", true),
        duty("rs_nl_summit_scope", "dispatch", "carrier", "Northline names which units Summit may work, and may change that at any time."),
        duty("rs_nl_summit_ratecon", "paperwork", "dispatch_organization", "Summit sends every rate confirmation to Northline before the load is dispatched.", true),
      ],
    },
    versionStatus: "signed",
    signedBy: ["carrier", "dispatch_organization"],
    relationships: [
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.nl111,
        label: "Summit dispatch access to unit 111", href: `/fleet/trucks/${TRUCK_IDS.nl111}`,
      },
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.nl131,
        label: "Summit dispatch access to unit 131", href: `/fleet/trucks/${TRUCK_IDS.nl131}`,
      },
    ],
  },

  /* ---- Northline: awaiting the driver's signature ----------------------- */
  {
    seed: "nl-driver-marisol",
    organizationId: "org_northline",
    agreementType: "carrier_driver",
    reference: "CD-0004",
    title: "Company driver agreement — Marisol Ortiz (mock)",
    status: "awaiting_signature",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(8),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "driver", name: "Marisol Ortiz", driverProfileRef: "dp_marisol",
        signerMembershipId: "mem_nl_marisol", signerName: "Marisol Ortiz",
        signerAuthority: "self",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Marisol joins Northline as a company driver on unit 107. Carrier signed; waiting on the driver.`,
      effective: { from: daysAgo(6), to: daysFromNow(359) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
      compensation: [
        rule("cr_nl_marisol_cpm", {
          kind: "rate_per_loaded_mile", label: "Loaded mile rate",
          detail: "58 cents per loaded mile for the first 90 days, then 62.",
          rateCents: 58, payeeRole: "driver",
        }),
      ],
      responsibilities: [
        duty("rs_nl_marisol_fuel", "fuel", "carrier", "Northline fuels the truck."),
        duty("rs_nl_marisol_logs", "compliance", "driver", "The driver keeps their logs, licence and medical card current.", true),
      ],
    },
    versionStatus: "issued",
    // Only the carrier has signed. The driver's signature is what the dashboard
    // and Needs You are both waiting on.
    signedBy: ["carrier"],
    relationships: [
      {
        kind: "invitation", externalId: "inv_nl_marisol",
        label: "Driver invitation to Marisol Ortiz", href: "/settings/invitations",
      },
    ],
  },

  /* ---- Northline: a draft nobody has issued ----------------------------- */
  {
    seed: "nl-lease-baxter",
    organizationId: "org_northline",
    agreementType: "equipment_lease",
    reference: "EL-0005",
    title: "Trailer lease — Baxter Transit, two dry vans (mock)",
    status: "draft",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(4),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "equipment_owner", name: "Baxter Transit LLC", organizationRef: "org_baxter",
        // No signer yet: issuing it is blocked until Baxter authorises one,
        // which is the honest state of a draft nobody has agreed to.
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Draft only. Two of Baxter's dry vans on a monthly lease while Northline's own trailers are in for inspection.`,
      effective: { from: daysFromNow(10), to: daysFromNow(190) },
      renewal: { kind: "none", reminderDays: 21 },
      compensation: [
        rule("cr_nl_lease_flat", {
          kind: "flat_per_period", label: "Monthly lease",
          detail: "$1,450 a month per trailer.",
          amountCents: 145_000, per: "month", payeeRole: "equipment_owner",
        }),
      ],
      responsibilities: [
        duty("rs_nl_lease_maint", "maintenance", "carrier", "Northline maintains the trailers while it holds them."),
        duty("rs_nl_lease_ins", "insurance", "carrier", "Northline names the trailers on its own policy.", true),
      ],
    },
    versionStatus: "draft",
  },

  /* ---- Northline: terminated, closeout unfinished ----------------------- */
  {
    seed: "nl-driver-kelsey",
    organizationId: "org_northline",
    agreementType: "carrier_driver",
    reference: "CD-0006",
    title: "Company driver agreement — Kelsey Nguyen (mock)",
    status: "active",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(182),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "driver", name: "Kelsey Nguyen", driverProfileRef: "dp_kelsey",
        signerMembershipId: "mem_nl_kelsey", signerName: "Kelsey Nguyen",
        signerAuthority: "self",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Kelsey drove unit 121 for Northline. Ended by mutual agreement; the closeout is not finished.`,
      effective: { from: daysAgo(180), to: daysFromNow(185) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
      compensation: [
        rule("cr_nl_kelsey_cpm", {
          kind: "rate_per_loaded_mile", label: "Loaded mile rate",
          detail: "60 cents per loaded mile.", rateCents: 60, payeeRole: "driver",
        }),
      ],
      responsibilities: [
        duty("rs_nl_kelsey_fuel", "fuel", "carrier", "Northline fuels the truck."),
      ],
      termination: { grounds: ["for_convenience", "for_cause", "mutual"] },
    },
    versionStatus: "signed",
    signedBy: ["carrier", "driver"],
    relationships: [
      {
        kind: "driver_carrier_relationship", externalId: "rel_nl_kelsey",
        label: "Kelsey Nguyen at Northline Freight", href: "/people/drivers/dp_kelsey",
      },
    ],
    termination: {
      ground: "mutual",
      reason: "Kelsey moved to another carrier. Both sides agreed to stop.",
      noticeGivenAt: daysAgo(62),
      effectiveAt: daysAgo(60),
      // The final settlement and the access revocation are done; the equipment
      // has not come back and nobody has ended the relationship record. That is
      // an unresolved termination, and Needs You says so.
      confirmed: ["final_settlement", "revoke_access"],
    },
  },

  /* ---- Northline: expired and nobody renewed it ------------------------- */
  {
    seed: "nl-dispatch-meridian",
    organizationId: "org_northline",
    agreementType: "carrier_dispatch_organization",
    reference: "CDO-0007",
    title: "Dispatch service agreement — Meridian Dispatch, trial (mock)",
    status: "active",
    createdByMembershipId: "mem_northline_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(130),
    parties: [
      {
        role: "carrier", name: "Northline Freight LLC", organizationRef: "org_northline",
        signerMembershipId: "mem_northline_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "dispatch_organization", name: "Meridian Dispatch Group Inc.",
        organizationRef: "org_meridian",
        signerMembershipId: "mem_meridian_dispatcher", signerName: "Sam Murtaza",
        signerTitle: "Senior dispatcher", signerAuthority: "delegated",
      },
    ],
    terms: {
      // Ran out 12 days ago and nothing renewed it: derives as `expired`.
      summary: `${MOCK_NOTE} A 90-day trial with Meridian that ran out and was not renewed. Kept, because what was agreed still has to be readable.`,
      effective: { from: daysAgo(120), to: daysAgo(12) },
      renewal: { kind: "mutual_consent", termDays: 90, reminderDays: 21 },
      compensation: [
        rule("cr_nl_meridian_pct", {
          kind: "percentage_of_revenue", label: "Dispatch fee",
          detail: "6% of the gross on loads booked during the trial.",
          percentageBasisPoints: 600, payeeRole: "dispatch_organization",
        }),
      ],
      responsibilities: [
        duty("rs_nl_meridian_book", "dispatch", "dispatch_organization", "Meridian sources freight during the trial period."),
      ],
    },
    versionStatus: "signed",
    signedBy: ["carrier", "dispatch_organization"],
  },

  /* ---- Meridian: the dispatch organization's own side ------------------- */
  {
    seed: "md-carrier-baxter",
    organizationId: "org_meridian",
    agreementType: "carrier_dispatch_organization",
    reference: "CDO-0001",
    title: "Dispatch service agreement — Baxter Transit (mock)",
    status: "active",
    createdByMembershipId: "mem_meridian_dispatcher",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(125),
    parties: [
      {
        role: "dispatch_organization", name: "Meridian Dispatch Group Inc.",
        organizationRef: "org_meridian",
        signerMembershipId: "mem_meridian_dispatcher", signerName: "Sam Murtaza",
        signerTitle: "Senior dispatcher", signerAuthority: "delegated",
      },
      {
        role: "carrier", name: "Baxter Transit LLC", organizationRef: "org_baxter",
        signerMembershipId: "mem_baxter_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Meridian books freight for Baxter's units A-12 and A-18. Meridian's own record of the agreement, in Meridian's workspace.`,
      effective: { from: daysAgo(120), to: daysFromNow(245) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 30 },
      compensation: [
        rule("cr_md_baxter_pct", {
          kind: "percentage_of_revenue", label: "Dispatch fee",
          detail: "5% of the gross on every load Meridian books for Baxter.",
          percentageBasisPoints: 500, payeeRole: "dispatch_organization",
        }),
      ],
      responsibilities: [
        duty("rs_md_baxter_book", "dispatch", "dispatch_organization", "Meridian sources and negotiates freight for the named units.", true),
        duty("rs_md_baxter_eo", "insurance", "dispatch_organization", "Meridian carries errors and omissions coverage.", true),
      ],
    },
    versionStatus: "signed",
    signedBy: ["dispatch_organization", "carrier"],
    relationships: [
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.mdA12,
        label: "Dispatch access to Baxter A-12", href: `/dispatch/trucks/${TRUCK_IDS.mdA12}`,
      },
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.mdA18,
        label: "Dispatch access to Baxter A-18", href: `/dispatch/trucks/${TRUCK_IDS.mdA18}`,
      },
    ],
  },

  /* ---- Meridian: in review --------------------------------------------- */
  {
    seed: "md-carrier-crosswind",
    organizationId: "org_meridian",
    agreementType: "carrier_dispatch_organization",
    reference: "CDO-0002",
    title: "Dispatch service agreement — Crosswind Freight (mock)",
    status: "pending_review",
    createdByMembershipId: "mem_meridian_dispatcher",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(6),
    parties: [
      {
        role: "dispatch_organization", name: "Meridian Dispatch Group Inc.",
        organizationRef: "org_meridian",
        signerMembershipId: "mem_meridian_dispatcher", signerName: "Sam Murtaza",
        signerTitle: "Senior dispatcher", signerAuthority: "delegated",
      },
      { role: "carrier", name: "Crosswind Freight", organizationRef: "org_crosswind" },
    ],
    terms: {
      summary: `${MOCK_NOTE} Being read internally before it goes to Crosswind. "Pending review" means somebody on the team is reading it — no lawyer has seen it.`,
      effective: { from: daysFromNow(7), to: daysFromNow(372) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 30 },
      compensation: [
        rule("cr_md_crosswind_pct", {
          kind: "percentage_of_revenue", label: "Dispatch fee",
          detail: "7% of the gross, higher because Crosswind wants after-hours cover.",
          percentageBasisPoints: 700, payeeRole: "dispatch_organization",
        }),
      ],
      responsibilities: [
        duty("rs_md_crosswind_hours", "dispatch", "dispatch_organization", "Meridian answers the phone until 9pm Eastern."),
      ],
    },
    versionStatus: "draft",
  },

  /* ---- Solo dispatcher: an individual's own agreement ------------------- */
  {
    seed: "solo-carrier-cascade",
    organizationId: "org_solo",
    agreementType: "carrier_individual_dispatcher",
    reference: "CID-0001",
    title: "Dispatch agreement — Cascade Haul (mock)",
    status: "active",
    createdByMembershipId: "mem_solo_dispatcher",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(55),
    parties: [
      {
        role: "individual_dispatcher", name: "Sam Murtaza",
        organizationRef: "org_solo", membershipRef: "mem_solo_dispatcher",
        signerMembershipId: "mem_solo_dispatcher", signerName: "Sam Murtaza",
        signerTitle: "Individual dispatcher", signerAuthority: "self",
      },
      {
        role: "carrier", name: "Cascade Haul Co.", organizationRef: "org_cascade",
        signerMembershipId: "mem_cascade_owner", signerName: "Priya Raman",
        signerTitle: "Owner", signerAuthority: "owner",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} One person booking freight for Cascade's units 47, 52 and 58. No company behind the dispatcher — which is why the paperwork asks for a photo ID rather than a business registration.`,
      effective: { from: daysAgo(50), to: daysFromNow(315) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 21, reminderDays: 30 },
      compensation: [
        rule("cr_solo_cascade_pct", {
          kind: "percentage_of_revenue", label: "Dispatch fee",
          detail: "8% of the gross on every load booked.",
          percentageBasisPoints: 800, payeeRole: "individual_dispatcher",
        }),
        rule("cr_solo_cascade_min", {
          kind: "flat_per_period", label: "Weekly minimum",
          detail: "$400 a week minimum, whatever the percentage comes to.",
          amountCents: 40_000, per: "week", payeeRole: "individual_dispatcher",
        }),
      ],
      responsibilities: [
        duty("rs_solo_cascade_book", "dispatch", "individual_dispatcher", "Sam sources and negotiates freight for the named units.", true),
        duty("rs_solo_cascade_paper", "paperwork", "individual_dispatcher", "Sam sends the rate confirmation to Cascade before dispatch.", true),
        duty("rs_solo_cascade_scope", "dispatch", "carrier", "Cascade names which units are in scope."),
      ],
    },
    versionStatus: "signed",
    signedBy: ["individual_dispatcher", "carrier"],
    relationships: [
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.cs47,
        label: "Dispatch access to Cascade 47", href: `/dispatch/trucks/${TRUCK_IDS.cs47}`,
      },
      {
        kind: "truck_dispatch_access", externalId: TRUCK_IDS.cs52,
        label: "Dispatch access to Cascade 52", href: `/dispatch/trucks/${TRUCK_IDS.cs52}`,
      },
    ],
  },

  /* ---- Stonebridge: the driver's own owner-operator agreement ----------- */
  {
    seed: "sb-oo-sam",
    organizationId: "org_stonebridge",
    agreementType: "carrier_owner_operator",
    reference: "COO-0001",
    title: "Owner-operator agreement — Sam Murtaza (mock)",
    status: "active",
    createdByMembershipId: "mem_sb_owner",
    createdByName: "Rita Alvarez",
    createdAt: daysAgo(88),
    parties: [
      {
        role: "carrier", name: "Stonebridge Carriers LLC", organizationRef: "org_stonebridge",
        signerMembershipId: "mem_sb_owner", signerName: "Rita Alvarez",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      {
        role: "owner_operator", name: "Sam Murtaza",
        driverProfileRef: "drv_sb_0044", membershipRef: "mem_stonebridge_driver",
        signerMembershipId: "mem_stonebridge_driver", signerName: "Sam Murtaza",
        signerAuthority: "self",
      },
    ],
    terms: {
      summary: `${MOCK_NOTE} Sam's own owner-operator agreement with Stonebridge. Visible from the driver seat, which is how the driver side of signing and pay terms can be looked at.`,
      effective: { from: daysAgo(84), to: daysFromNow(281) },
      renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
      compensation: [
        rule("cr_sb_sam_pct", {
          kind: "percentage_of_revenue", label: "Owner-operator share",
          detail: "68% of linehaul revenue.",
          percentageBasisPoints: 6800, payeeRole: "owner_operator",
        }),
        rule("cr_sb_sam_ins", {
          kind: "deduction", label: "Occupational accident",
          detail: "$42 a week for occupational accident coverage.",
          amountCents: 4_200, per: "week", payeeRole: "carrier",
        }),
      ],
      responsibilities: [
        duty("rs_sb_sam_fuel", "fuel", "owner_operator", "Sam buys his own fuel."),
        duty("rs_sb_sam_maint", "maintenance", "owner_operator", "Sam maintains his own truck.", true),
        duty("rs_sb_sam_ins", "insurance", "carrier", "Stonebridge carries liability while the unit runs under its authority.", true),
      ],
    },
    versionStatus: "signed",
    signedBy: ["carrier", "owner_operator"],
    relationships: [
      {
        kind: "driver_carrier_relationship", externalId: "rel_stonebridge",
        label: "Sam Murtaza at Stonebridge Carriers", href: "/driver/profile",
      },
    ],
  },

  /* ---- Baxter: cancelled before it took effect -------------------------- */
  {
    seed: "bx-cancelled",
    organizationId: "org_baxter",
    agreementType: "other_business_relationship",
    reference: "OBR-0001",
    title: "Yard-space agreement — Fairview Logistics (mock)",
    status: "draft",
    createdByMembershipId: "mem_baxter_owner",
    createdByName: "Sam Murtaza",
    createdAt: daysAgo(30),
    parties: [
      {
        role: "carrier", name: "Baxter Transit LLC", organizationRef: "org_baxter",
        signerMembershipId: "mem_baxter_owner", signerName: "Sam Murtaza",
        signerTitle: "Owner", signerAuthority: "owner",
      },
      { role: "other", name: "Fairview Logistics (not in Antcolos)", externalIdentifier: "fairview-logistics" },
    ],
    terms: {
      summary: `${MOCK_NOTE} Yard space in Columbus that Baxter decided not to take. Cancelled, and kept — a cancelled agreement still has to be readable.`,
      effective: { from: daysFromNow(15) },
      renewal: { kind: "none", reminderDays: 14 },
      compensation: [
        rule("cr_bx_yard", {
          kind: "flat_per_period", label: "Monthly yard fee",
          detail: "$900 a month for six trailer spots.",
          amountCents: 90_000, per: "month", payeeRole: "other",
        }),
      ],
      responsibilities: [],
    },
    versionStatus: "draft",
    cancelled: { at: daysAgo(9), reason: "Found closer yard space. Never took effect." },
  },
];

/* -------------------------------------------------------------------------- */
/* Building the database                                                       */
/* -------------------------------------------------------------------------- */

export function seedAgreements(): AgreementDb {
  const dbState: AgreementDb = {
    contracts: [], versions: [], parties: [], signers: [], signatures: [],
    requirements: [], relationships: [], transitionRequests: [], links: [],
    terminations: [], events: [],
  };

  for (const spec of SPECS) build(spec, dbState);
  return dbState;
}

function build(spec: Spec, out: AgreementDb): void {
  const contractId = uuid(`${spec.seed}:contract`);
  const v1Id = uuid(`${spec.seed}:v1`);

  const parties: ContractParty[] = spec.parties.map((p, index) => ({
    partyId: uuid(`${spec.seed}:party:${p.role}:${index}`),
    contractId,
    role: p.role,
    legalNameSnapshot: p.name,
    organizationRef: p.organizationRef,
    driverProfileRef: p.driverProfileRef,
    membershipRef: p.membershipRef,
    externalIdentifier: p.externalIdentifier,
    isOwningParty: p.organizationRef === spec.organizationId,
    addedAt: spec.createdAt,
  }));
  // Every contract has exactly one owning party, even when neither reference
  // matches — a fixture with none would produce a summary with no counterparty.
  if (!parties.some((p) => p.isOwningParty)) parties[0].isOwningParty = true;
  out.parties.push(...parties);

  const partyOf = (role: ContractPartyRole) =>
    parties.find((p) => p.role === role) ?? parties[0];

  for (const [index, p] of spec.parties.entries()) {
    if (!p.signerMembershipId) continue;
    out.signers.push({
      signerId: uuid(`${spec.seed}:signer:${index}`),
      contractId,
      partyId: parties[index].partyId,
      membershipId: p.signerMembershipId,
      nameSnapshot: p.signerName ?? p.name,
      titleSnapshot: p.signerTitle,
      authority: p.signerAuthority ?? "owner",
      grantedByMembershipId: p.signerAuthority === "delegated" ? spec.createdByMembershipId : undefined,
      grantedAt: spec.createdAt,
    });
  }

  const v1Terms = termsFor(spec);
  const v1: ContractVersion = {
    contractVersionId: v1Id,
    contractId,
    versionNumber: 1,
    kind: "original",
    status: spec.versionStatus,
    changedTermGroups: [],
    terms: v1Terms,
    frozen: spec.versionStatus !== "draft",
    issuedAt: spec.versionStatus === "draft" ? undefined : spec.createdAt,
    signedAt: spec.versionStatus === "signed" ? v1Terms.effective.from : undefined,
    createdAt: spec.createdAt,
    createdByMembershipId: spec.createdByMembershipId,
    createdByName: spec.createdByName,
  };
  out.versions.push(v1);

  for (const role of spec.signedBy ?? []) {
    out.signatures.push(signatureFor(spec, contractId, v1, partyOf(role), out));
  }

  let currentVersionId = v1Id;

  if (spec.amendment) {
    const v2Id = uuid(`${spec.seed}:v2`);
    const v2Terms: ContractTerms = {
      ...v1Terms,
      compensation: spec.amendment.compensation ?? v1Terms.compensation,
      effective: {
        ...v1Terms.effective,
        ...(spec.amendment.effectiveFrom ? { from: spec.amendment.effectiveFrom } : {}),
      },
    };
    const v2: ContractVersion = {
      contractVersionId: v2Id,
      contractId,
      versionNumber: 2,
      kind: "amendment",
      status: spec.amendment.versionStatus,
      supersedesVersionId: v1Id,
      changeReason: spec.amendment.changeReason,
      changedTermGroups: ["compensation"],
      terms: v2Terms,
      frozen: spec.amendment.versionStatus !== "draft",
      issuedAt: daysAgo(46),
      signedAt: spec.amendment.versionStatus === "signed" ? daysAgo(45) : undefined,
      createdAt: daysAgo(47),
      createdByMembershipId: spec.createdByMembershipId,
      createdByName: spec.createdByName,
    };
    out.versions.push(v2);
    for (const role of spec.amendment.signedBy ?? []) {
      out.signatures.push(signatureFor(spec, contractId, v2, partyOf(role), out));
    }
    if (spec.amendment.versionStatus === "signed") {
      // Version 1 is SUPERSEDED, not replaced: its terms, its signatures and
      // its dates stay exactly as they were and stay readable forever.
      out.versions = out.versions.map((v) => (
        v.contractVersionId === v1Id
          ? { ...v, status: "superseded" as const, supersededByVersionId: v2Id, frozen: true }
          : v
      ));
      currentVersionId = v2Id;
    }
  }

  const contract: Contract = {
    contractId,
    organizationId: spec.organizationId,
    agreementType: spec.agreementType,
    reference: spec.reference,
    title: spec.title,
    status: spec.cancelled ? "cancelled" : spec.termination ? "terminated" : spec.status,
    currentVersionId,
    createdAt: spec.createdAt,
    createdByMembershipId: spec.createdByMembershipId,
    createdByName: spec.createdByName,
    updatedAt: spec.createdAt,
    cancelledAt: spec.cancelled?.at,
    cancelledReason: spec.cancelled?.reason,
  };

  if (spec.cancelled) {
    out.versions = out.versions.map((v) => (
      v.contractId === contractId ? { ...v, status: "void" as const, frozen: true } : v
    ));
  }

  out.contracts.push(contract);

  for (const relationship of spec.relationships ?? []) {
    out.relationships.push({
      id: uuid(`${spec.seed}:rel:${relationship.kind}:${relationship.externalId}`),
      contractId,
      kind: relationship.kind,
      externalId: relationship.externalId,
      labelSnapshot: relationship.label,
      href: relationship.href,
      linkedAt: spec.createdAt,
    });
  }

  for (const [index, ref] of (spec.links ?? []).entries()) {
    out.links.push({
      id: uuid(`${spec.seed}:link:${index}`),
      contractId,
      ref,
      linkedAt: spec.createdAt,
      linkedByMembershipId: spec.createdByMembershipId,
    });
  }

  out.requirements.push(...requirementsFor(spec, contract, parties, currentVersionId, out));

  if (spec.termination) {
    buildTermination(spec, contract, parties, currentVersionId, out);
  }

  out.events.push(...eventsFor(spec, contract, out));
}

function signatureFor(
  spec: Spec,
  contractId: string,
  version: ContractVersion,
  party: ContractParty,
  out: AgreementDb,
): ContractSignature {
  const signer = out.signers.find(
    (s) => s.contractId === contractId && s.partyId === party.partyId,
  );
  const signedAt = version.signedAt ?? version.issuedAt ?? spec.createdAt;
  return {
    signatureId: uuid(`${spec.seed}:sig:${version.versionNumber}:${party.role}`),
    contractId,
    contractVersionId: version.contractVersionId,
    partyId: party.partyId,
    signerId: signer?.signerId ?? uuid(`${spec.seed}:signer:missing:${party.role}`),
    typedName: signer?.nameSnapshot ?? party.legalNameSnapshot,
    signerNameSnapshot: signer?.nameSnapshot ?? party.legalNameSnapshot,
    signerTitleSnapshot: signer?.titleSnapshot,
    method: "mock_typed_name",
    statement: `MOCK SIGNATURE — no legal effect. ${signer?.nameSnapshot ?? party.legalNameSnapshot} recorded, on behalf of ${party.legalNameSnapshot}, that they read version ${version.versionNumber} of "${spec.title}". Antcolos has not verified anybody's identity, has not used an e-signature service, has not had this reviewed by a lawyer and has not sent it anywhere.`,
    signedAt,
    mock: true,
  };
}

function requirementsFor(
  spec: Spec,
  contract: Contract,
  parties: ContractParty[],
  currentVersionId: string,
  out: AgreementDb,
): ContractRequirement[] {
  const version = out.versions.find((v) => v.contractVersionId === currentVersionId)!;
  const partyOf = (role: ContractPartyRole) =>
    parties.find((p) => p.role === role) ?? parties[0];

  const requirement = (input: {
    kind: ContractRequirementKind;
    label: string;
    reason: string;
    owedByPartyId: string;
    blocking: boolean;
    documentTypeKey?: DocumentTypeKey;
    requiredDocumentTermId?: string;
    dueAt?: IsoDateTime;
  }): ContractRequirement => ({
    requirementId: deterministicUuid(
      `ctr_req:${contract.contractId}:${input.kind}:${input.label}`,
    ),
    contractId: contract.contractId,
    kind: input.kind,
    label: input.label,
    reason: input.reason,
    owedByPartyId: input.owedByPartyId,
    blocking: input.blocking,
    documentTypeKey: input.documentTypeKey,
    requiredDocumentTermId: input.requiredDocumentTermId,
    dueAt: input.dueAt,
    status: "unmet",
    createdAt: contract.createdAt,
    ...(spec.waived?.includes(input.label)
      ? {
        status: "waived" as const,
        waivedAt: contract.createdAt,
        waivedByMembershipId: spec.createdByMembershipId,
        waivedReason: "Waived in the fixtures so a waived requirement can be looked at.",
      }
      : {}),
  });

  const documents = version.terms.requiredDocuments.map((term) => requirement({
    kind: "document",
    label: documentTypeLabel(term.documentTypeKey),
    reason: term.reason,
    owedByPartyId: partyOf(term.owedByRole).partyId,
    blocking: term.blocking,
    documentTypeKey: term.documentTypeKey,
    requiredDocumentTermId: term.id,
  }));

  const signatures = parties.map((party) => requirement({
    kind: "signature",
    label: `Signature from ${party.legalNameSnapshot}`,
    reason: "Every party signs the version that is being agreed.",
    owedByPartyId: party.partyId,
    blocking: true,
  }));

  const carrier = parties.find((p) => p.role === "carrier");
  const authority = carrier
    ? [requirement({
      kind: "operating_authority",
      label: `Active Operating Authority for ${carrier.legalNameSnapshot}`,
      reason: "A carrier without active authority cannot legally haul, whatever the agreement says.",
      owedByPartyId: carrier.partyId,
      blocking: true,
    })]
    : [];

  return [...documents, ...signatures, ...authority];
}



function buildTermination(
  spec: Spec,
  contract: Contract,
  parties: ContractParty[],
  currentVersionId: string,
  out: AgreementDb,
): void {
  const t = spec.termination!;
  const version = out.versions.find((v) => v.contractVersionId === currentVersionId)!;
  const initiating = parties.find((p) => p.isOwningParty)!;
  const confirmed = new Set(t.confirmed ?? []);

  const requests: RelationshipTransitionRequest[] = out.relationships
    .filter((r) => r.contractId === contract.contractId && !r.detachedAt)
    .flatMap((ref) => {
      const kind = ref.kind === "driver_carrier_relationship"
        ? "end_driver_relationship" as const
        : ref.kind === "truck_dispatch_access"
          ? "end_dispatch_access" as const
          : ref.kind === "membership"
            ? "revoke_membership" as const
            : null;
      if (!kind) return [];
      return [buildTransitionRequest({
        contractId: contract.contractId,
        contractVersionId: version.contractVersionId,
        agreementType: contract.agreementType,
        kind,
        target: { kind: ref.kind, externalId: ref.externalId, labelSnapshot: ref.labelSnapshot },
        reason: `${contract.reference} was terminated (${t.ground}).`,
        requestedByMembershipId: spec.createdByMembershipId,
        requestedByName: spec.createdByName,
        now: t.noticeGivenAt,
      })];
    });
  out.transitionRequests.push(...requests);

  const steps = version.terms.termination.closeoutSteps.map((step) => ({
    key: step.key,
    label: step.label,
    owedByRole: step.owedByRole,
    dueAt: undefined,
    ...(confirmed.has(step.key)
      ? {
        confirmedAt: t.effectiveAt,
        confirmedByMembershipId: spec.createdByMembershipId,
        confirmedByName: spec.createdByName,
      }
      : {}),
  }));

  const termination: ContractTermination = {
    terminationId: uuid(`${spec.seed}:termination`),
    contractId: contract.contractId,
    contractVersionId: version.contractVersionId,
    initiatedByPartyId: initiating.partyId,
    initiatedByMembershipId: spec.createdByMembershipId,
    initiatedByName: spec.createdByName,
    ground: t.ground,
    reason: t.reason,
    noticeGivenAt: t.noticeGivenAt,
    effectiveAt: t.effectiveAt,
    status: steps.every((s) => s.confirmedAt) ? "completed" : "in_closeout",
    steps,
    transitionRequestIds: requests.map((r) => r.id),
  };
  out.terminations.push(termination);

  // Outstanding closeout steps are requirements too, so an unfinished
  // termination reaches Needs You rather than only this one screen.
  out.requirements.push(...steps.map((step) => ({
    requirementId: deterministicUuid(
      `ctr_req:${contract.contractId}:closeout:${step.label}`,
    ),
    contractId: contract.contractId,
    kind: "closeout" as const,
    label: step.label,
    reason: "Agreed closeout step for the end of this agreement.",
    owedByPartyId: initiating.partyId,
    blocking: false,
    status: "unmet" as const,
    createdAt: t.noticeGivenAt,
  })));
}

/**
 * The audit timeline, as it would have been written.
 *
 * Built from the same facts the service would have recorded, so a fixture
 * contract reads exactly like one somebody worked through by hand — and so the
 * timeline on screen is never empty on the very records a reviewer opens first.
 */
function eventsFor(spec: Spec, contract: Contract, out: AgreementDb): ContractEvent[] {
  const actor = {
    userId: "usr_sam",
    membershipId: spec.createdByMembershipId,
    displayNameSnapshot: spec.createdByName,
    source: "web" as const,
  };
  const events: ContractEvent[] = [];
  let n = 0;
  const push = (
    kind: ContractEvent["kind"],
    at: IsoDateTime,
    summary: string,
    detail?: string,
    contractVersionId?: string,
  ) => {
    events.push({
      id: uuid(`${spec.seed}:event:${++n}`),
      contractId: contract.contractId,
      contractVersionId,
      at, kind, summary, detail, actor,
      organizationId: spec.organizationId,
    });
  };

  const versions = out.versions
    .filter((v) => v.contractId === contract.contractId)
    .sort((a, b) => a.versionNumber - b.versionNumber);
  const v1 = versions[0];

  push("created", spec.createdAt,
    `${agreementTypeMeta(spec.agreementType).label} created.`,
    "Draft. Nothing signed, sent or agreed.", v1.contractVersionId);

  for (const signer of out.signers.filter((s) => s.contractId === contract.contractId)) {
    push("signer_authorized", spec.createdAt,
      `${signer.nameSnapshot} may sign for this party.`,
      `Authority: ${signer.authority}.`);
  }

  if (spec.status === "pending_review") {
    push("sent_for_review", spec.createdAt,
      "Sent for review.",
      "Somebody on the team is reading it. No lawyer has seen it — Antcolos has no legal review integration.");
  }

  if (v1.status !== "draft") {
    push("issued_for_signature", v1.issuedAt ?? spec.createdAt,
      "Version 1 issued for signature.",
      "Terms locked. Nothing sent to anybody — Antcolos has no e-signature or delivery integration.",
      v1.contractVersionId);
  }

  for (const signature of out.signatures.filter(
    (s) => s.contractId === contract.contractId && s.contractVersionId === v1.contractVersionId,
  )) {
    const party = out.parties.find((p) => p.partyId === signature.partyId);
    push("signed", signature.signedAt,
      `${party?.legalNameSnapshot ?? "A party"} signed version 1.`,
      "Mock signature: a typed name recorded against a version.",
      v1.contractVersionId);
  }

  if (v1.status === "signed") {
    push("fully_signed", v1.signedAt!, "Version 1 is fully signed and can never be edited.",
      "Changing these terms means an amendment, which is a new version.", v1.contractVersionId);
    push("activated", v1.signedAt!, "The agreement is active.",
      "Access is unchanged. Any relationship change this agreement needs was requested of the service that owns it.",
      v1.contractVersionId);
  }

  const v2 = versions[1];
  if (v2) {
    push("amended", v2.createdAt,
      `Version 2 drafted, amending version 1.`,
      `${v2.changeReason} Version 1 and its signatures are unchanged.`, v2.contractVersionId);
    for (const signature of out.signatures.filter(
      (s) => s.contractVersionId === v2.contractVersionId,
    )) {
      const party = out.parties.find((p) => p.partyId === signature.partyId);
      push("signed", signature.signedAt,
        `${party?.legalNameSnapshot ?? "A party"} signed version 2.`,
        "Mock signature.", v2.contractVersionId);
    }
    if (v2.status === "signed") {
      push("fully_signed", v2.signedAt!, "Version 2 is fully signed.",
        "Version 1 is superseded and kept in full — its terms, its signatures and its dates.",
        v2.contractVersionId);
      push("superseded", v2.signedAt!, "Version 1 superseded by version 2.",
        "Nothing was overwritten. The May terms still say what the May terms said.",
        v1.contractVersionId);
    }
  }

  const termination = out.terminations.find((t) => t.contractId === contract.contractId);
  if (termination) {
    push("termination_notice", termination.noticeGivenAt,
      `Termination notice given (${termination.ground}), effective ${termination.effectiveAt.slice(0, 10)}.`,
      `${termination.reason} Access unchanged: the changes were requested of the services that control it. Nothing deleted.`);
    for (const request of out.transitionRequests.filter(
      (r) => termination.transitionRequestIds.includes(r.id),
    )) {
      push("transition_requested", termination.noticeGivenAt,
        `Asked the ${request.ownerService} to ${request.kind.replace(/_/g, " ")}.`,
        `Nothing has changed. ${request.nextStep}`);
    }
    for (const step of termination.steps.filter((s) => s.confirmedAt)) {
      push("termination_step_confirmed", step.confirmedAt!,
        `Closeout step confirmed: ${step.label}.`);
    }
  }

  if (spec.cancelled) {
    push("cancelled", spec.cancelled.at, "Cancelled before it took effect.", spec.cancelled.reason);
  }

  return events;
}

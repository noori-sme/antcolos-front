"use client";

import type {
  CarrierRelationship,
  DocumentLink,
  DocumentRecord,
  DocumentRequirement,
  DriverDocument,
  DriverProfile,
  EngagementType,
  RelationshipStatus,
} from "@/types";
import {
  driverRequirements, requirementByKey, splitByRestriction,
} from "@/lib/documents/requirements";
import { restrictedReason } from "@/lib/documents/catalog";
import { isNewcomerSession } from "@/lib/session/scenarios";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import {
  addSharedDocumentKeys, createOrResumeProfile, createOrResumeRelationship,
  endCarrierRelationship, liveRelationship, profileForUser, relationshipsForProfile,
  resetDriverRegistry, setCarrierRelationshipStatus,
} from "@/lib/api/mock/driver-registry";
import { ordinaryDocumentKeys } from "@/lib/documents/requirements";
import { effectiveStatus } from "@/lib/documents/status";
import {
  addLink, addLinks, clearDocumentsForSubjectKind, createDocument, documentInSlot,
  documentsForSubject,
  endRelationshipDocuments, recordEvent, replaceDocument, slotKey, updateDocument,
  type AddLinkEntry,
} from "@/lib/api/mock/document-store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Driver profiles and carrier relationships live here in memory for the
 * browser session. Their DOCUMENTS do not: those are rows in the shared
 * document store, the same store that holds truck, trailer and organization
 * paperwork, so a driver's medical card is one record with one identity
 * wherever it is looked at.
 *
 * Nothing is uploaded and no file ever leaves the browser. "Uploading" reads a
 * file's name, type and size — the properties the browser gives us for free —
 * and then throws the file away. There is no storage, no transfer, and nothing
 * is verified by anyone. A real adapter replaces this file; the rest of the
 * feature never learns the difference.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 600;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);


/* -------------------------------------------------------------------------- */
/* What each carrier asks a driver for                                         */
/* -------------------------------------------------------------------------- */

/**
 * Per-carrier extras. Kept as data so a carrier can ask for something unusual
 * without any code change — the checklist simply grows a row. The standard sets
 * are not restated here: they live in the document domain, with the carrier,
 * dispatch and equipment checklists.
 */
const CARRIER_EXTRA_DOCUMENTS: Record<string, DocumentRequirement[]> = {
  org_northline: [
    {
      key: "northline_handbook",
      setId: "driver",
      typeKey: "signed_handbook",
      subjectKind: "driver",
      label: "Signed driver handbook",
      description: "Northline asks every driver to sign their handbook before the first load.",
      applicability: "required",
      expires: false,
      reason: "Northline asks every driver to sign their handbook before the first load.",
      addedByOrganizationId: "org_northline",
    },
    /*
     * ★ TWO RESTRICTED ROWS, ON PURPOSE ★
     *
     * Both are ordinary things a carrier genuinely asks a driver for, and both
     * carry something that must never travel as part of a bulk consent: the
     * DOT employment application carries a social security number and prior
     * employers, and an MVR is a driving history pulled from the state.
     *
     * They are on the checklist — the driver still owes them — and accepting an
     * invitation does not hand either over. That is the difference this pair
     * exists to make visible: a rule nothing ever exercises is a rule nobody
     * can tell is working.
     */
    {
      key: "northline_employment_application",
      setId: "driver",
      typeKey: "employment_application",
      subjectKind: "driver",
      label: "DOT employment application",
      description: "The three-year employment history the FMCSA requires a carrier to collect.",
      applicability: "required",
      expires: false,
      reason: "Northline has to hold three years of employment history for every driver.",
      addedByOrganizationId: "org_northline",
    },
    {
      key: "northline_mvr",
      setId: "driver",
      typeKey: "mvr",
      subjectKind: "driver",
      label: "Motor vehicle record",
      description: "Your driving record, pulled from the state that issued your licence.",
      applicability: "required",
      expires: true,
      reason: "Northline reviews a driving record before putting anybody on a truck.",
      addedByOrganizationId: "org_northline",
    },
  ],
  org_cascade: [],
  org_stonebridge: [],
};

/** The full checklist for one engagement with one carrier. */
export function documentRequirements(
  engagementType: EngagementType,
  carrierId: string,
): DocumentRequirement[] {
  const standard = driverRequirements(engagementType);
  const extras = CARRIER_EXTRA_DOCUMENTS[carrierId] ?? [];
  const driverPart = standard.filter((r) => r.setId === "driver");
  const ownerPart = standard.filter((r) => r.setId === "owner_operator");
  return [...driverPart, ...extras, ...ownerPart];
}

/* -------------------------------------------------------------------------- */
/* Seed state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * WHO IS SIGNED IN.
 *
 * Read from the session fixtures, which are the account boundary in a build
 * with no backend — never from a literal in this file. That distinction is the
 * whole point: this module used to hard-code `usr_sam`, so "the signed-in
 * person" and "Sam" were the same statement and there was no code path by which
 * anybody else could have a profile. A real session replaces the two constants
 * below and nothing else here changes.
 */
function currentUser() {
  return isNewcomerSession() ? NEWCOMER_USER : MOCK_USER;
}

/**
 * The signed-in person's permanent profile, from THE registry.
 *
 * There is no local copy any more. `driver-registry.ts` holds one profile per
 * person and this reads it — so the carrier looking at a driver and the driver
 * looking at themselves are looking at one record, and a correction to it is
 * visible to both on the next read rather than to whichever module happened to
 * be edited.
 */
function ownProfile(): DriverProfile | null {
  return profileForUser(currentUser().id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Documents live in the shared store, keyed by the driver's profile            */
/* -------------------------------------------------------------------------- */

export const DRIVER_PROFILE_ID = "dp_sam";

/**
 * A driver's paperwork belongs to the DRIVER, not to a carrier.
 *
 * That is why the owner is a person: the record follows them between carriers,
 * survives a relationship ending, and is shown to a carrier because it was
 * shared rather than because the carrier holds it.
 */
function driverOwner(profile: DriverProfile | null) {
  const user = currentUser();
  return {
    kind: "person" as const,
    // The signed-in account, not a literal. Identical to the old hard-coded
    // value for the demo fixture, and correct rather than wrong for anybody
    // else — a person with no profile yet used to be recorded as Sam.
    id: profile?.userId ?? user.id,
    name: profile?.legalName ?? user.displayName,
  };
}

function driverSubject(profile: DriverProfile | null) {
  return {
    kind: "driver" as const,
    // The document SLOT, deliberately unchanged. Which subject a document hangs
    // off decides its identity in the shared store, and PR-1 does not move a
    // single document. See the note on DRIVER_PROFILE_ID.
    id: profile?.id ?? DRIVER_PROFILE_ID,
    label: profile?.legalName ?? currentUser().displayName,
    href: "/driver/documents",
  };
}

interface DriverSeedRow {
  requirementKey: string;
  status: DriverDocument["status"];
  fileName: string;
  fileType: string;
  sizeBytes: number;
  expiresAt?: string;
  rejectionReason?: string;
  submittedAt: string;
  updatedAt: string;
  contextOrganizationId: string;
  contextOrganizationName: string;
}

const DRIVER_SEED_ROWS: DriverSeedRow[] = [
  { requirementKey: "cdl_front", status: "approved", fileName: "cdl-front.jpg", fileType: "image/jpeg", sizeBytes: 1_842_000, expiresAt: daysFromNow(210), submittedAt: daysAgo(107), updatedAt: daysAgo(105), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  { requirementKey: "cdl_back", status: "approved", fileName: "cdl-back.jpg", fileType: "image/jpeg", sizeBytes: 1_610_000, submittedAt: daysAgo(107), updatedAt: daysAgo(105), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  // Expiring soon is DERIVED from the date, never stored, so it stays true as
  // the clock moves.
  { requirementKey: "medical_front", status: "approved", fileName: "medical-card.pdf", fileType: "application/pdf", sizeBytes: 402_000, expiresAt: daysFromNow(24), submittedAt: daysAgo(107), updatedAt: daysAgo(20), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  { requirementKey: "northline_handbook", status: "rejected", fileName: "handbook-scan.pdf", fileType: "application/pdf", sizeBytes: 980_000, rejectionReason: "Page 4 is missing a signature. Please sign every page marked with an X and upload again.", submittedAt: daysAgo(4), updatedAt: daysAgo(2), contextOrganizationId: "org_northline", contextOrganizationName: "Northline Freight" },
];

/** The carrier's decision on a seeded document, as that carrier's own link. */
function seededCarrierReview(row: DriverSeedRow): DocumentLink["review"] {
  if (row.status === "rejected") {
    return {
      state: "rejected",
      reviewedAt: row.updatedAt,
      reviewedByName: row.contextOrganizationName,
      rejectionReason: row.rejectionReason,
    };
  }
  if (row.status === "approved" || row.status === "expiring_soon" || row.status === "expired") {
    return { state: "approved", reviewedAt: row.updatedAt, reviewedByName: row.contextOrganizationName };
  }
  return { state: "pending" };
}

/**
 * Seeds the driver's paperwork the way the model actually holds it.
 *
 * Every row becomes ONE document owned by the driver, whose primary link names
 * no organization — it is theirs. The carrier that has seen it gets a SECOND
 * link carrying its own review. That is not bookkeeping: it is why ending a
 * carrier relationship takes the carrier's link and leaves the driver holding
 * the document, and why a new carrier reviews the same record instead of asking
 * for the file again.
 */
function seedDocuments(profile: DriverProfile | null) {
  clearDocumentsForSubjectKind("driver");
  if (!profile) return;
  for (const row of DRIVER_SEED_ROWS) {
    const requirement = requirementByKey(row.requirementKey)
      ?? CARRIER_EXTRA_DOCUMENTS.org_northline.find((r) => r.key === row.requirementKey);
    const record = createDocument({
      owner: driverOwner(profile),
      typeKey: requirement?.typeKey ?? "other",
      subject: driverSubject(profile),
      requirementKey: row.requirementKey,
      // No contextOrganization: the driver holds their own licence.
      status: row.status,
      file: {
        fileName: row.fileName, fileType: row.fileType,
        sizeBytes: row.sizeBytes, selectedAt: row.submittedAt,
      },
      expiresAt: row.expiresAt,
      addedByName: profile.legalName,
      createdAt: row.submittedAt,
      idSeed: slotKey("driver", profile.id, row.requirementKey),
    });

    const linked = addLink(record.documentId, {
      subject: driverSubject(profile),
      requirementKey: row.requirementKey,
      contextOrganizationId: row.contextOrganizationId,
      contextOrganizationName: row.contextOrganizationName,
      actorName: profile.legalName,
    });
    const carrierLink = linked.links[linked.links.length - 1];
    updateDocument(record.documentId, {
      links: linked.links.map((l) =>
        l.id === carrierLink.id ? { ...l, review: seededCarrierReview(row) } : l,
      ),
    });
  }
}

/**
 * ★ RELATIONSHIPS DO NOT LIVE HERE ANY MORE ★
 *
 * They used to: this module held a second literal describing the same person's
 * engagements that `driver-registry.ts` already described from the carrier's
 * side. The two disagreed — both claimed Cascade Haul, and they did not agree
 * about what had been shared with it — which is exactly the defect PR-1 removed
 * for `DriverProfile`, one level up.
 *
 * So the record is the registry's, this module reads and writes it through the
 * registry's own commands, and there is no local array to drift. The
 * consequence that matters: a driver who accepts an invitation gets ONE
 * engagement, and their own portal and the carrier's screens are looking at it
 * rather than at two copies that happen to agree today.
 */
let seeded = false;

/**
 * Seeds on first use rather than on import, because WHAT to seed depends on who
 * is looking.
 *
 * The demo account is a driver with two carriers and years of paperwork. A
 * newcomer tab (`?fixture=newcomer`) is a person who has just made an account:
 * no profile, no carrier, no documents. Deciding at import time would answer
 * before the browser has told us which one this is — and would answer on the
 * server, where there is no tab at all.
 */
function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  // A newcomer has no profile because the REGISTRY has none for them, not
  // because this module blanks a local one. `usr_newcomer` simply is not in it.
  // A newcomer has no profile because the REGISTRY has none for them, and
  // therefore no engagements either. Nothing is blanked out locally.
  seedDocuments(isNewcomerSession() ? null : ownProfile());
}

/**
 * Test hook. Never called by the UI.
 *
 * `withProfile: false` now rebuilds the REGISTRY without this person's profile,
 * because that is where a profile lives. There is no local field to null out
 * any more, and a version of this that quietly kept one would be the second
 * store all over again.
 */
export function resetDriverMock(options?: { withProfile?: boolean }) {
  seeded = true;
  const withoutProfile = options?.withProfile === false;
  // Dropping the person drops their engagements with them, because the
  // engagements hang off the person in the one registry that holds both.
  resetDriverRegistry(withoutProfile ? { omitUserIds: [currentUser().id] } : undefined);
  seedDocuments(ownProfile());

}

/**
 * Turns a stored record into the row the driver screens read.
 *
 * The document is read from the driver's own link — that is the one that says
 * whose it is. A carrier's opinion of it is read from that carrier's link, so
 * "Cascade rejected page 4" is a fact about Cascade's review and not about the
 * driver's document, and a driver with no carrier simply has no review to show.
 */
function projectDriverDocument(
  record: DocumentRecord,
  carrierId?: string,
): DriverDocument | undefined {
  const own = record.links.find((l) => l.primary) ?? record.links[0];
  if (!own?.requirementKey) return undefined;
  const review = carrierReviewOf(record, carrierId);
  return {
    requirementKey: own.requirementKey,
    documentId: record.documentId,
    status: effectiveStatus(record),
    fileName: record.file?.fileName,
    fileType: record.file?.fileType,
    sizeBytes: record.file?.sizeBytes,
    expiresAt: record.expiresAt,
    rejectionReason: review?.rejectionReason,
    submittedAt: record.file ? record.createdAt : undefined,
    updatedAt: record.updatedAt,
  };
}

/** A carrier's review of this document: the named one, or whichever rejected it. */
function carrierReviewOf(
  record: DocumentRecord,
  carrierId?: string,
): DocumentLink["review"] | undefined {
  const carrierLinks = record.links.filter((l) => !l.unlinkedAt && l.contextOrganizationId);
  if (carrierId) {
    return carrierLinks.find((l) => l.contextOrganizationId === carrierId)?.review;
  }
  return carrierLinks.find((l) => l.review.state === "rejected")?.review;
}

function currentDriverDocument(requirementKey: string): DocumentRecord | undefined {
  return documentInSlot("driver", ownProfile()?.id ?? DRIVER_PROFILE_ID, requirementKey);
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Synchronous reads for other modules.
 *
 * The driver's own permanent profile and their carrier relationships live here
 * and only here. Safety & Compliance reads them to build the compliance a
 * driver sees about themselves; it never copies the person.
 */
export function driverProfileSync(): DriverProfile | null {
  ensureSeeded();
  return ownProfile();
}

export function driverRelationshipsSync(): CarrierRelationship[] {
  ensureSeeded();
  const profile = ownProfile();
  return profile ? relationshipsForProfile(profile.id) : [];
}

/**
 * The driver's documents, read synchronously.
 *
 * Compliance builds its subject seeds outside async code, so it needs the rows
 * without awaiting. There is no local DOCUMENTS array any more — the Document
 * Center holds them — so this reads the same rows mockListDocuments returns.
 */
export function driverDocumentsSync(): DriverDocument[] {
  ensureSeeded();
  return driverDocumentRows();
}

export async function mockGetDriverProfile(): Promise<DriverProfile | null> {
  ensureSeeded();
  await sleep(250);
  return ownProfile();
}

export interface QuickOnboardingInput {
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  /**
   * The address the profile is reachable on for work, once it has been
   * verified. Omitted by the invitation flow, which already knows the account
   * it is onboarding; supplied by driver self-onboarding, where the address the
   * driver just proved is the one that belongs on the profile.
   */
  email?: string;
}

/**
 * Creates the permanent profile, or reuses the one the person already has.
 *
 * A driver who already has a profile and accepts a second carrier's invitation
 * must not be asked for their licence again, and must certainly not end up with
 * a second Antcolos account. The same is true the other way round: a driver who
 * signed up on their own keeps this profile when a carrier later invites them.
 *
 * A profile is a PERSON, not an engagement. Nothing here creates a carrier
 * relationship, and nothing here may: that is `mockCreateRelationship`, and it
 * is reached only by accepting a carrier's invitation.
 */
export async function mockCreateOrGetDriverProfile(
  input: QuickOnboardingInput,
): Promise<DriverProfile> {
  ensureSeeded();
  await sleep(LATENCY_MS);
  const user = currentUser();
  // DELEGATED. This module no longer builds a `DriverProfile`; it asks the
  // registry that owns them, keyed on who is signed in. A person who already
  // has a profile gets that one back — the resume arm lives there, so the
  // driver's own door and any other door reach the same record.
  const { profile } = createOrResumeProfile({
    userId: user.id,
    legalName: input.legalName,
    cdlNumber: input.cdlNumber,
    cdlState: input.cdlState,
    cdlExpiresAt: input.cdlExpiresAt,
    email: input.email?.trim() || user.email,
    phone: user.phone,
  });
  return profile;
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                               */
/* -------------------------------------------------------------------------- */

export async function mockListRelationships(): Promise<CarrierRelationship[]> {
  ensureSeeded();
  await sleep(250);
  return driverRelationshipsSync();
}

export interface NewRelationshipInput {
  carrierId: string;
  carrierName: string;
  engagementType: EngagementType;
  roleName: string;
  permissions: CarrierRelationship["permissions"];
  sharedDocumentKeys: string[];
  /** When the carrier asked. Defaults to now for a relationship made by hand. */
  invitedAt?: string;
  /**
   * A start date the CARRIER asserted, for an existing worker being connected.
   *
   * Passed through untouched and never invented. Absent for somebody genuinely
   * new, whose relationship has no start date until it is activated.
   */
  assertedStartDate?: string;
}

/**
 * ★ CREATE OR RESUME, AND NEVER A START DATE ★
 *
 * Two things changed here and both are product rules rather than tidying.
 *
 * It RESUMES. Keyed on the live `(driverProfileId, carrierId)` pair, so a
 * driver who accepts twice — a re-sent link, a double submit, a retry after
 * something later in the sequence failed — ends up with ONE relationship. The
 * previous version created unconditionally, which meant an invitation resent
 * after acceptance produced a second relationship with the same carrier and no
 * way to tell which was real.
 *
 * It does NOT set `startedAt`. Accepting an invitation is the person saying
 * yes; it is not the carrier saying they may work, and it is not the day the
 * relationship became effective. `startedAt` is set by the authorized
 * activation step, or carried from a carrier's asserted historical date when an
 * existing worker is migrated — and stamping today's date here would overwrite
 * that assertion with the afternoon somebody clicked a link, which is exactly
 * how a migrated workforce comes to look freshly hired. What acceptance records
 * instead is `acceptedAt`: observed, true, and a different fact.
 */
export function liveRelationshipWith(
  profileId: string, carrierId: string,
): CarrierRelationship | undefined {
  ensureSeeded();
  return liveRelationship(profileId, carrierId);
}

/**
 * ★ CONSENT RECORDED IS NOT ACCESS GRANTED ★
 *
 * Applies a driver's sharing consent to the documents they already hold: the
 * carrier gets its own LINK to each shared one, carrying its own review. Not a
 * copy, not a re-upload, not a change of owner.
 *
 * This exists as a separate command because the acceptance sequence needs the
 * granting of document access to be a step that can fail ON ITS OWN. While the
 * links were attached inside `mockCreateRelationship`, the acceptance step
 * called "the documents you agreed to share" wrote nothing at all — it reported
 * on work another step had done, which means it could never fail, could never
 * be interrupted, and could never be tested for the thing that matters: that a
 * carrier cannot read a document before the access basis for it exists.
 *
 * Idempotent twice over: the consent list is a set union, and a requirement
 * already linked to this carrier is skipped. Retrying adds nothing.
 *
 * Returns the number of links it ADDED, so a caller can tell "granted three"
 * from "there were already three".
 */
export function mockShareDocumentsWithCarrier(
  profileId: string,
  carrierId: string,
  requirementKeys: readonly string[],
): { relationship: CarrierRelationship; added: number } | undefined {
  ensureSeeded();
  const existing = liveRelationship(profileId, carrierId);
  // No live relationship means no basis to share under. The caller decides what
  // that is — here it is simply not something this command will invent.
  if (!existing) return undefined;

  // Narrowed before anything is written. Whatever a caller passes, a restricted
  // category is never handed over as part of joining — see `ordinaryKeysAmong`.
  const allowed = ordinaryKeysAmong(requirementKeys, existing.engagementType, carrierId);

  /*
   * ★ THE LINKS AND THE CONSENT ARE ONE GRANT ★
   *
   * They used to be two statements, links first and consent second. Either
   * order leaves a moment where one exists without the other, and a failure
   * landing in that moment left real, readable links behind a sharing decision
   * that was never completed — the invitation still pending, the run still
   * unfinished, and the carrier already reading.
   *
   * So the consent write is handed INTO the store's commit and runs inside it.
   * If it refuses, the links this call wrote are gone before the refusal comes
   * back. Belt and braces, every link is marked `driver_consent`, and a read
   * refuses one whose consent is not on the live relationship — so even a link
   * left behind by some other half-finished path cannot be read through.
   */
  let relationship: CarrierRelationship | undefined;
  const added = attachSharedDocuments(
    { ...existing, sharedDocumentKeys: allowed },
    () => {
      relationship = addSharedDocumentKeys(profileId, carrierId, allowed);
      if (!relationship) {
        throw new Error(
          `No live relationship between ${profileId} and ${carrierId} to record consent on.`,
        );
      }
    },
  );
  if (!relationship) return undefined;
  return { relationship, added };
}

/**
 * DELEGATED, and narrowed twice on the way through.
 *
 * This module no longer builds a `CarrierRelationship`; it asks the registry
 * that owns them. Two rules are applied here because this is the door the
 * driver's own screens come through:
 *
 *  · `sharedDocumentKeys` is filtered to ORDINARY paperwork. Whatever a caller
 *    passes, a restricted category — a social security number, bank details, a
 *    state driving record — is never handed over as part of starting a
 *    relationship. Access to one of those is asked for separately.
 *  · No `startedAt`. The registry command refuses to invent one; see the note
 *    on `createOrResumeRelationship`.
 */
export async function mockCreateRelationship(
  profileId: string,
  input: NewRelationshipInput,
): Promise<CarrierRelationship> {
  ensureSeeded();
  await sleep(LATENCY_MS);
  const at = iso(now());
  const allowed = ordinaryKeysAmong(input.sharedDocumentKeys, input.engagementType, input.carrierId);

  const result = createOrResumeRelationship({
    driverProfileId: profileId,
    carrierId: input.carrierId,
    carrierName: input.carrierName,
    engagementType: input.engagementType,
    roleName: input.roleName,
    permissions: input.permissions,
    sharedDocumentKeys: allowed,
    invitedAt: at,
    acceptedAt: at,
  });
  if (!result.relationship) throw new Error(`No such driver profile: ${profileId}`);

  // Sharing consent, applied to the documents the driver ALREADY has: the
  // carrier gets its own link to each shared one, carrying its own review. Not
  // a copy, not a re-upload, and not a change of owner — the driver's link is
  // untouched, and ending this relationship will end only the carrier's.
  attachSharedDocuments(result.relationship);

  return result.relationship;
}

/**
 * ★ EXACTLY WHAT ONE ACCEPTANCE COVERS, BEFORE ANYBODY AGREES TO IT ★
 *
 * Accepting a carrier's invitation is ONE decision about the ordinary,
 * purpose-bound paperwork that relationship needs — not a row of switches. But
 * "one decision" only works if the person can see what it actually covers, and
 * the honest answer has three parts:
 *
 *   covered   the documents they already hold, named with the VERSION this
 *             agreement applies to. Not "your documents" in the abstract.
 *   awaiting  required paperwork they have not uploaded yet. The carrier does
 *             NOT receive these — there is nothing to receive — and saying so
 *             is the difference between an honest summary and a lie that the
 *             carrier got something. The existing Needs You path raises each
 *             one as a missing document; this only refuses to pretend.
 *   withheld  restricted records. Never part of this decision at all, named so
 *             the shorter list has a reason.
 *
 * Later versions are covered by the same agreement: replacing a document keeps
 * the carrier's link and resets their review, so they see the new file and look
 * at it again. That is the canonical sharing rule and this does not invent a
 * second one.
 */
export interface DriverSharingPlan {
  covered: Array<{ key: string; label: string; version: number; uploadedAt: string }>;
  awaiting: Array<{ key: string; label: string }>;
  withheld: Array<{ key: string; label: string; reason?: string }>;
}

export function driverSharingPlan(
  engagementType: EngagementType,
  carrierId: string,
): DriverSharingPlan {
  ensureSeeded();
  const profileId = ownProfile()?.id ?? DRIVER_PROFILE_ID;
  const checklist = documentRequirements(engagementType, carrierId);
  const { ordinary, restricted } = splitByRestriction(checklist);

  const plan: DriverSharingPlan = { covered: [], awaiting: [], withheld: [] };
  for (const requirement of ordinary) {
    if (requirement.applicability !== "required") continue;
    const document = documentInSlot("driver", profileId, requirement.key);
    if (document) {
      plan.covered.push({
        key: requirement.key,
        label: requirement.label,
        version: document.version,
        uploadedAt: document.createdAt,
      });
    } else {
      plan.awaiting.push({ key: requirement.key, label: requirement.label });
    }
  }
  for (const requirement of restricted) {
    plan.withheld.push({
      key: requirement.key,
      label: requirement.label,
      reason: restrictedReason(requirement.typeKey),
    });
  }
  return plan;
}

/** The subset of the requested keys that a bulk consent may actually carry. */
function ordinaryKeysAmong(
  requested: readonly string[],
  engagementType: EngagementType,
  carrierId: string,
): string[] {
  const ordinary = new Set(
    ordinaryDocumentKeys(documentRequirements(engagementType, carrierId)),
  );
  return requested.filter((key) => ordinary.has(key));
}

/**
 * Every document this consent still owes the carrier, as one batch.
 *
 * Already-linked requirements are skipped here, which is where idempotence
 * belongs: the store writes what it is handed, and deciding that a requirement
 * is already shared is the driver module's business, not the store's.
 */
function pendingShareLinks(relationship: CarrierRelationship): AddLinkEntry[] {
  const profileId = ownProfile()?.id ?? DRIVER_PROFILE_ID;
  const entries: AddLinkEntry[] = [];
  for (const requirementKey of relationship.sharedDocumentKeys) {
    const existing = documentInSlot("driver", profileId, requirementKey);
    if (!existing) continue;
    const alreadyLinked = existing.links.some(
      (l) => !l.unlinkedAt && l.contextOrganizationId === relationship.carrierId,
    );
    if (alreadyLinked) continue;
    entries.push({
      documentId: existing.documentId,
      input: {
        subject: driverSubject(ownProfile()),
        requirementKey,
        contextOrganizationId: relationship.carrierId,
        contextOrganizationName: relationship.carrierName,
        actorName: ownProfile()?.legalName ?? "Driver",
        // The only reason this carrier holds it is that the driver said so, so
        // the consent record governs whether it may ever be read.
        basis: "driver_consent",
      },
    });
  }
  return entries;
}

function attachSharedDocuments(
  relationship: CarrierRelationship,
  commitConsent?: () => void,
): number {
  const entries = pendingShareLinks(relationship);
  // All of them or none, AND the consent that makes them readable in the same
  // commit. A half-applied consent grants access the grant did not finish
  // giving, and leaves a consent list that disagrees with it.
  addLinks(entries, commitConsent);
  return entries.length;
}

/**
 * Ending a relationship ends the carrier's access and nothing else.
 *
 * The permanent profile, the Antcolos account and every other carrier
 * relationship are untouched. What the carrier was already given stays in their
 * records as a snapshot; what changes afterwards is no longer theirs to see.
 */
export async function mockEndRelationship(
  relationshipId: string,
  reason: string,
): Promise<CarrierRelationship> {
  ensureSeeded();
  await sleep(LATENCY_MS);
  const existing = driverRelationshipsSync().find((r) => r.id === relationshipId);
  if (!existing) throw new Error(`No such relationship: ${relationshipId}`);
  // The registry's own ending command. This module does not reach into its
  // state — the difference between a module performing its own change and
  // another module writing into its store.
  const result = endCarrierRelationship(
    existing.driverProfileId, existing.carrierId, reason.trim(),
  );
  const ended = result.relationship ?? existing;

  // The carrier's links to the driver's documents are closed and its shares
  // revoked, with a snapshot of each kept. Not one record, version or event is
  // deleted: the carrier still has to be able to show what it held at the time.
  endRelationshipDocuments({
    subjectKind: "driver",
    subjectId: ownProfile()?.id ?? DRIVER_PROFILE_ID,
    organizationId: ended.carrierId,
    reason: ended.endReason || "Carrier relationship ended.",
    actorName: ownProfile()?.legalName ?? "Driver",
  });

  return { ...ended };
}

/**
 * Moves a relationship between live statuses.
 *
 * `ended` is deliberately not one of them: ending is `mockEndRelationship`,
 * which also writes the end date and reason and closes the carrier's document
 * links. A status setter that could end one would skip all three.
 */
export async function mockSetRelationshipStatus(
  relationshipId: string,
  status: Exclude<RelationshipStatus, "ended">,
): Promise<CarrierRelationship> {
  ensureSeeded();
  await sleep(LATENCY_MS);
  const existing = driverRelationshipsSync().find((r) => r.id === relationshipId);
  if (!existing) throw new Error(`No such relationship: ${relationshipId}`);
  const updated = setCarrierRelationshipStatus(
    existing.driverProfileId, existing.carrierId, status,
  );
  if (!updated) throw new Error(`No such relationship: ${relationshipId}`);
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export async function mockListDocuments(carrierId?: string): Promise<DriverDocument[]> {
  ensureSeeded();
  await sleep(250);
  return driverDocumentRows(carrierId);
}

function driverDocumentRows(carrierId?: string): DriverDocument[] {
  const profileId = ownProfile()?.id ?? DRIVER_PROFILE_ID;
  return documentsForSubject("driver", profileId)
    .map((record) => projectDriverDocument(record, carrierId))
    .filter((d): d is DriverDocument => Boolean(d));
}

/**
 * Which organization, if any, governs the document filling a requirement.
 *
 * A driver's licence, medical card and W-9 are the DRIVER'S. They are supplied
 * once, kept between carriers, and belong to nobody else — so they are created
 * with no organization at all, and the previous fallback that quietly stamped
 * them with "whichever carrier is around, and Cascade Haul if there is none" is
 * gone. It named a carrier that had never seen the file, and for a driver with
 * no carrier it invented one outright.
 *
 * A carrier-specific extra is different: that carrier asked for it, and it
 * exists only inside that relationship, so it carries their name.
 */
function contextForRequirement(
  requirementKey: string,
): { id?: string; name?: string } {
  for (const [organizationId, extras] of Object.entries(CARRIER_EXTRA_DOCUMENTS)) {
    if (extras.some((r) => r.key === requirementKey)) {
      const relationship = driverRelationshipsSync()
        .find((r) => r.carrierId === organizationId);
      return { id: organizationId, name: relationship?.carrierName ?? organizationId };
    }
  }
  return {};
}

/**
 * Records a chosen file against a requirement.
 *
 * Nothing is uploaded. The browser gives a name, a type and a size; the file
 * itself is let go. Choosing a file where one already sits creates a NEW
 * VERSION and keeps the old one — the driver's licence renewal does not erase
 * the licence the carrier approved last year.
 *
 * `onProgress` exists so the screen can show a progress bar over local work; a
 * real adapter reports genuine progress through the same callback.
 */
export async function mockUploadDocument(
  requirementKey: string,
  file: { name: string; type: string; size: number },
  onProgress: (percent: number) => void,
): Promise<DriverDocument> {
  for (let percent = 0; percent <= 100; percent += 20) {
    onProgress(percent);
    ensureSeeded();
    await sleep(140);
  }
  const fileRef = {
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    selectedAt: iso(now()),
  };
  const previous = currentDriverDocument(requirementKey);
  const context = contextForRequirement(requirementKey);

  const record = previous
    ? replaceDocument(previous, {
        file: fileRef,
        expiresAt: previous.expiresAt,
        status: "selected_local",
        addedByName: ownProfile()?.legalName ?? "Driver",
        contextOrganizationId: context.id,
      })
    : createDocument({
        owner: driverOwner(ownProfile()),
        typeKey: requirementByKey(requirementKey)?.typeKey
          ?? CARRIER_EXTRA_DOCUMENTS.org_northline.find((r) => r.key === requirementKey)?.typeKey
          ?? "other",
        subject: driverSubject(ownProfile()),
        requirementKey,
        contextOrganizationId: context.id,
        contextOrganizationName: context.name,
        status: "selected_local",
        file: fileRef,
        addedByName: ownProfile()?.legalName ?? "Driver",
      });

  return projectDriverDocument(record)!;
}

/**
 * Takes a file back off the checklist before it was ever submitted.
 *
 * Only a document nobody has looked at can be withdrawn, and even then the
 * record and its history stay: the link is ended rather than the row deleted,
 * so what happened is still readable afterwards.
 */
export async function mockRemoveDocument(requirementKey: string): Promise<void> {
  ensureSeeded();
  await sleep(250);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) return;
  const link = existing.links.find((l) => l.primary) ?? existing.links[0];
  updateDocument(existing.documentId, {
    status: "superseded",
    links: existing.links.map((l) =>
      l.id === link?.id
        ? { ...l, unlinkedAt: iso(now()), unlinkReason: "Withdrawn by the driver before review." }
        : l,
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "unlinked",
    summary: "Withdrawn before review",
    detail: "The record is kept; only the checklist link was ended.",
    actorName: ownProfile()?.legalName ?? "Driver",
  });
}

export async function mockSetDocumentExpiry(
  requirementKey: string,
  expiresAt: string,
): Promise<DriverDocument> {
  ensureSeeded();
  await sleep(200);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) throw new Error(`Nothing selected for ${requirementKey}`);
  const updated = updateDocument(existing.documentId, { expiresAt });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "expiry_set",
    summary: `Expiry recorded: ${expiresAt.slice(0, 10)}`,
    actorName: ownProfile()?.legalName ?? "Driver",
  });
  return projectDriverDocument(updated)!;
}

/**
 * Hands the document to the carriers who asked for it. Nobody actually reviews it.
 *
 * Only the carriers' links become pending. The driver's own link is not a
 * review queue — nobody reviews a person's document on their behalf — so it
 * stays as it is, and a driver with no carrier has nothing to submit to.
 */
export async function mockSubmitDocument(requirementKey: string): Promise<DriverDocument> {
  ensureSeeded();
  await sleep(LATENCY_MS);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) throw new Error(`Nothing selected for ${requirementKey}`);
  const updated = updateDocument(existing.documentId, {
    status: "pending_review",
    links: existing.links.map((l) =>
      l.unlinkedAt || !l.contextOrganizationId ? l : { ...l, review: { state: "pending" as const } },
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "submitted",
    summary: "Sent to the carrier for review",
    detail: "Nothing was uploaded or transmitted. The record is marked as waiting for a person.",
    actorName: ownProfile()?.legalName ?? "Driver",
  });
  return projectDriverDocument(updated)!;
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

export interface Completion {
  required: number;
  done: number;
  percent: number;
  outstanding: DocumentRequirement[];
}

/** Selected, pending review and approved all count as "the driver has done it". */
const DONE_STATUSES = new Set(["selected_local", "pending_review", "approved", "expiring_soon"]);

export function completion(
  requirements: readonly DocumentRequirement[],
  documents: readonly DriverDocument[],
): Completion {
  const required = requirements.filter((r) => r.applicability === "required");
  const byKey = new Map(documents.map((d) => [d.requirementKey, d]));
  const outstanding = required.filter((r) => {
    const doc = byKey.get(r.key);
    return !doc || !DONE_STATUSES.has(doc.status);
  });
  const done = required.length - outstanding.length;
  return {
    required: required.length,
    done,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
    outstanding,
  };
}

import {
  applicableDefinitions, evaluateApplicability, evaluateStatus, isOpen,
  nextDueAt, requirementDefinition,
} from "@/lib/compliance";
import { definitionsForSubjectKind } from "@/lib/compliance/catalog";
import type {
  ActorRef, ComplianceEvidenceRef, ComplianceHistoryAction, ComplianceHistoryEntry,
  ComplianceRequirement, ComplianceRequirementDefinition, ComplianceRequirementKey,
  ComplianceResolution, ComplianceResolutionMethod, ComplianceResponsibleParty,
  ComplianceShare, ComplianceSnapshot, ComplianceStatus, PermissionKey,
} from "@/types";
import {
  complianceOrganizationIds, subjectSeeds, type ComplianceSubjectSeed,
} from "./compliance-sources";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE compliance registry.
 *
 * Like the truck and trailer registries, this is deliberately NOT a per-screen
 * cache. It is the one place a requirement record exists, and every read and
 * every mutation goes through it.
 *
 * Three properties it is built to guarantee:
 *
 *  1. **A requirement is not a document.** Requirements are created from the
 *     catalog against the subject's real facts, and they exist whether or not
 *     anything satisfies them. Evidence is a pointer into the system that owns
 *     the file; remove the file and the requirement stands there, unsatisfied.
 *
 *  2. **Ending a relationship ends access, not history.** When a driver, truck,
 *     trailer, carrier or dispatch relationship ends, that subject's
 *     requirements are FROZEN and an immutable snapshot is taken. Nothing is
 *     deleted, ever, and the frozen records never re-enter a live queue.
 *
 *  3. **History is append-only.** Every status change, resolution, assignment,
 *     waiver, suspension and freeze appends an entry. Entries are never edited
 *     and never removed; a mistake is corrected by appending a correction.
 *
 * Nothing here is connected to FMCSA, the Clearinghouse, a state agency, an
 * insurance provider, an ELD or any monitoring service.
 */

/* -------------------------------------------------------------------------- */
/* Ids                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic, so the same subject and requirement always produce the same
 * record across a rebuild, and a reviewer can link straight to one.
 */
function requirementId(
  organizationId: string,
  subjectId: string,
  key: ComplianceRequirementKey,
): string {
  const slug = `${organizationId}|${subjectId}|${key}`;
  let hash = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `cr_${(hash >>> 0).toString(36)}`;
}

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

const DAY_MS = 86_400_000;
const nowIso = () => new Date().toISOString();
const daysAgoIso = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

/** How long a waiver holds before the requirement comes back. Bounded on purpose. */
export const WAIVER_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a person decided, kept apart from what the systems say.
 *
 * The derived half of a requirement is recomputed on every read from the
 * subject's real facts. This half is not: a waiver, an assignment or a recorded
 * resolution must survive the recomputation, or the record would quietly undo
 * whatever the safety manager did.
 */
interface ManualState {
  waivedAt?: string;
  waivedNote?: string;
  waivedBy?: ActorRef;
  suspendedReason?: string;
  responsible?: ComplianceResponsibleParty;
  /** Set by a recorded resolution with no file behind it. */
  attestation?: ComplianceEvidenceRef;
  attestedAt?: string;
}

interface RegistryState {
  requirements: Map<string, ComplianceRequirement>;
  manual: Map<string, ManualState>;
  snapshots: ComplianceSnapshot[];
  shares: ComplianceShare[];
  /** Organizations already materialized at least once. */
  synced: Set<string>;
}

let registry: RegistryState | null = null;

function db(): RegistryState {
  if (!registry) registry = buildInitialState();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetComplianceRegistry() {
  seq = 0;
  registry = buildInitialState();
}

/* -------------------------------------------------------------------------- */
/* Shares                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What carriers have explicitly shared with a dispatch organization.
 *
 * Written as data rather than derived from dispatch access on purpose. Having
 * dispatch access to a truck is permission to book freight on it; it is not
 * permission to read the carrier's insurance file. A dispatcher sees a
 * compliance record only because somebody chose to share that record, named it,
 * and said what work it was for.
 */
function seedShares(): ComplianceShare[] {
  const dispatcherKeys: ComplianceRequirementKey[] = [
    "truck.registration",
    "truck.annual_inspection",
    "truck.insurance_evidence",
  ];
  const trailerKeys: ComplianceRequirementKey[] = [
    "trailer.registration",
    "trailer.annual_inspection",
  ];

  const share = (
    id: string,
    subjectId: string,
    subjectLabel: string,
    subjectKind: "truck" | "trailer",
    keys: ComplianceRequirementKey[],
    daysAgo: number,
    status: ComplianceShare["status"] = "active",
  ): ComplianceShare => ({
    id,
    ownerOrganizationId: "org_baxter",
    viewerOrganizationId: "org_meridian",
    viewerOrganizationName: "Meridian Dispatch",
    subject: {
      kind: subjectKind,
      id: subjectId,
      label: subjectLabel,
      href: subjectKind === "truck" ? `/fleet/trucks/${subjectId}` : `/fleet/trailers/${subjectId}`,
    },
    requirementKeys: keys,
    purpose: "So the dispatcher can confirm the unit is legal to run before booking it.",
    status,
    grantedAt: daysAgoIso(daysAgo),
    grantedByMembershipId: "mem_baxter_owner",
    grantedByName: "Baxter Transit",
    revokedAt: status === "revoked" ? daysAgoIso(Math.max(1, daysAgo - 30)) : undefined,
    revokedReason: status === "revoked" ? "Unit moved to another dispatcher." : undefined,
  });

  // Ids come from the truck and trailer registries; nothing new is invented.
  return [
    share("cshare_bx_a12", "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2001", "Unit A-12", "truck", dispatcherKeys, 120),
    share("cshare_bx_a18", "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2004", "Unit A-18", "truck", dispatcherKeys, 70),
    share("cshare_bx_810", "8b2daf51-bb22-4c20-8202-2b2c3d4e0001", "Trailer BX-810", "trailer", trailerKeys, 100),
    // Revoked, so the state is visible rather than theoretical.
    share("cshare_bx_950", "8b2daf51-bb22-4c20-8202-2b2c3d4e0002", "Trailer BX-950", "trailer", trailerKeys, 80, "revoked"),
  ];
}

function buildInitialState(): RegistryState {
  return {
    requirements: new Map(),
    manual: new Map(),
    snapshots: [],
    shares: seedShares(),
    synced: new Set(),
  };
}

/* -------------------------------------------------------------------------- */
/* Materialization                                                             */
/* -------------------------------------------------------------------------- */

function history(
  action: ComplianceHistoryAction,
  actor: ActorRef,
  extra: Partial<ComplianceHistoryEntry> = {},
): ComplianceHistoryEntry {
  return { id: rowId("crh"), at: nowIso(), actor, action, ...extra };
}

/** The due date, preferring the fact the evidence itself carries. */
function resolveDueAt(
  definition: ComplianceRequirementDefinition,
  evidence: ComplianceEvidenceRef | undefined,
  satisfiedAt: string | undefined,
): string | undefined {
  // A registration expires when the registration says it does, whatever cycle
  // the catalog assumes — the document is the more specific fact.
  if (evidence?.expiresAt) return evidence.expiresAt;
  return nextDueAt(definition.renewal, { satisfiedAt, evidence });
}

function responsibleFor(
  definition: ComplianceRequirementDefinition,
  seed: ComplianceSubjectSeed,
): ComplianceResponsibleParty {
  return (
    seed.responsible[definition.defaultResponsibility] ??
    seed.responsible.organization ?? {
      kind: "organization",
      displayName: "This organization",
      organizationId: seed.context.organizationId,
    }
  );
}

interface DerivedState {
  status: ComplianceStatus;
  statusReason?: string;
  dueAt?: string;
  satisfiedAt?: string;
  evidence?: ComplianceEvidenceRef;
  responsible: ComplianceResponsibleParty;
}

function derive(
  definition: ComplianceRequirementDefinition,
  seed: ComplianceSubjectSeed,
  manual: ManualState | undefined,
  notApplicableReason: string | undefined,
  now: number,
): DerivedState {
  const link = seed.evidence.find((e) => e.key === definition.key);

  // Whichever is MORE RECENT wins — the evidence the owning system holds, or a
  // resolution somebody recorded here. Preferring one unconditionally gets it
  // wrong both ways round: a new certificate would lose to last year's recorded
  // note, and this morning's completed review would lose to the stale evidence
  // it was carried out to replace.
  const linkAt = link?.satisfiedAt ?? link?.evidence.capturedAt;
  const manualAt = manual?.attestedAt;
  const preferManual =
    Boolean(manualAt) && (!linkAt || new Date(manualAt!).getTime() > new Date(linkAt).getTime());

  const evidence = preferManual ? manual?.attestation : link?.evidence ?? manual?.attestation;
  const satisfiedAt = preferManual ? manualAt : link?.satisfiedAt ?? manualAt;
  const responsible = manual?.responsible ?? responsibleFor(definition, seed);
  const dueAt = resolveDueAt(definition, evidence, satisfiedAt);

  if (notApplicableReason) {
    return { status: "not_applicable", statusReason: notApplicableReason, responsible };
  }

  // A waiver is a decision, and a bounded one: it holds for a fixed window and
  // then the requirement comes back rather than disappearing for good.
  if (manual?.waivedAt) {
    const lapsesAt = new Date(new Date(manual.waivedAt).getTime() + WAIVER_DAYS * DAY_MS);
    if (lapsesAt.getTime() > now) {
      return {
        status: "compliant",
        statusReason: `Waived by ${manual.waivedBy?.displayNameSnapshot ?? "a manager"}. A waiver holds for ${WAIVER_DAYS} days and lapses on ${lapsesAt.toISOString().slice(0, 10)}.`,
        dueAt: lapsesAt.toISOString(),
        satisfiedAt: manual.waivedAt,
        evidence,
        responsible,
      };
    }
  }

  const manualSuspension = manual?.suspendedReason;
  const result = evaluateStatus(
    {
      renewal: definition.renewal,
      evidence,
      satisfiedAt,
      dueAt,
      suspended: Boolean(manualSuspension) || seed.suspended,
      suspendedReason: manualSuspension ?? seed.suspendedReason,
    },
    now,
  );

  return {
    status: result.status,
    statusReason: result.reason,
    dueAt: result.dueAt ?? dueAt,
    satisfiedAt,
    evidence,
    responsible,
  };
}

function freeze(
  requirement: ComplianceRequirement,
  reason: string,
  at: string,
): ComplianceRequirement {
  if (requirement.frozenAt) return requirement;
  return {
    ...requirement,
    frozenAt: at,
    frozenReason: reason,
    updatedAt: at,
    history: [
      ...requirement.history,
      history("access_ended", SYSTEM_ACTOR, {
        at,
        note: reason,
        fromStatus: requirement.status,
        toStatus: requirement.status,
        organizationId: requirement.organizationId,
      }),
    ],
  };
}

function takeSnapshot(
  organizationId: string,
  seedSubject: ComplianceRequirement["subject"],
  requirements: ComplianceRequirement[],
  reason: string,
  at: string,
) {
  const state = db();
  const already = state.snapshots.some(
    (s) => s.organizationId === organizationId && s.subject.id === seedSubject.id,
  );
  if (already || requirements.length === 0) return;

  state.snapshots.push({
    id: rowId("csnap"),
    organizationId,
    subject: seedSubject,
    takenAt: at,
    reason,
    takenBy: SYSTEM_ACTOR,
    entries: requirements.map((r) => ({
      requirementId: r.id,
      definitionKey: r.definitionKey,
      label: r.label,
      status: r.status,
      severity: r.severity,
      dueAt: r.dueAt,
      satisfiedAt: r.satisfiedAt,
      evidenceLabel: r.evidence?.label,
      responsibleName: r.responsible.displayName,
    })),
  });
}

/**
 * Bring one organization's requirement records up to date with the systems that
 * own its drivers, equipment, organization record and documents.
 *
 * Idempotent and cheap enough to run on every read, which is what keeps the
 * records honest: a truck connected this morning gets its requirements, and a
 * driver whose relationship ended yesterday gets frozen ones.
 */
export function syncOrganization(organizationId: string, now = Date.now()): void {
  const state = db();
  const seeds = subjectSeeds(organizationId);
  const at = new Date(now).toISOString();
  const seenSubjectIds = new Set<string>();

  for (const seed of seeds) {
    seenSubjectIds.add(seed.subject.id);
    const produced: ComplianceRequirement[] = [];

    for (const definition of definitionsForSubjectKind(seed.subject.kind)) {
      const verdict = evaluateApplicability(definition, seed.context);
      const id = requirementId(organizationId, seed.subject.id, definition.key);
      const manual = state.manual.get(id);
      const notApplicableReason = verdict.applies ? undefined : verdict.reason.explanation;
      const next = derive(definition, seed, manual, notApplicableReason, now);
      const existing = state.requirements.get(id);

      if (!existing) {
        const created: ComplianceRequirement = {
          id,
          organizationId,
          definitionKey: definition.key,
          subject: seed.subject,
          label: definition.label,
          description: definition.description,
          authority: definition.authority,
          severity: definition.severity,
          renewal: definition.renewal,
          verificationBasis: "recorded_in_antcolos",
          status: next.status,
          statusReason: next.statusReason,
          dueAt: next.dueAt,
          satisfiedAt: next.satisfiedAt,
          evidence: next.evidence,
          responsible: next.responsible,
          resolutions: [],
          history: [
            history("requirement_created", SYSTEM_ACTOR, {
              at,
              toStatus: next.status,
              note: verdict.applies
                ? `Applies to ${seed.subject.label}.`
                : notApplicableReason,
              evidence: next.evidence,
              organizationId,
            }),
          ],
          createdAt: at,
          updatedAt: at,
          requires: [...definition.requires] as PermissionKey[],
        };
        state.requirements.set(id, seed.live ? created : freeze(created, endedReason(seed), at));
        produced.push(state.requirements.get(id)!);
        continue;
      }

      // The record already exists. Recompute the derived half and append a
      // history entry only when something an operator would care about moved.
      const entries: ComplianceHistoryEntry[] = [];
      if (existing.status !== next.status) {
        entries.push(
          history(
            next.status === "not_applicable"
              ? "became_not_applicable"
              : existing.status === "not_applicable"
                ? "became_applicable"
                : "status_changed",
            SYSTEM_ACTOR,
            {
              at,
              fromStatus: existing.status,
              toStatus: next.status,
              note: next.statusReason,
              evidence: next.evidence,
              organizationId,
            },
          ),
        );
      }
      if (existing.evidence?.id !== next.evidence?.id) {
        entries.push(
          history(next.evidence ? "evidence_linked" : "evidence_cleared", SYSTEM_ACTOR, {
            at,
            note: next.evidence
              ? `Now satisfied by ${next.evidence.label}.`
              : "The evidence this requirement pointed at is no longer available.",
            evidence: next.evidence,
            organizationId,
          }),
        );
      }
      if (existing.frozenAt && seed.live) {
        entries.push(
          history("reinstated", SYSTEM_ACTOR, {
            at,
            note: "The relationship is live again. This record is actionable once more.",
            organizationId,
          }),
        );
      }

      let updated: ComplianceRequirement = {
        ...existing,
        subject: seed.subject,
        status: next.status,
        statusReason: next.statusReason,
        dueAt: next.dueAt,
        satisfiedAt: next.satisfiedAt,
        evidence: next.evidence,
        responsible: next.responsible,
        frozenAt: seed.live ? undefined : existing.frozenAt,
        frozenReason: seed.live ? undefined : existing.frozenReason,
        history: entries.length ? [...existing.history, ...entries] : existing.history,
        updatedAt: entries.length ? at : existing.updatedAt,
      };
      if (!seed.live) updated = freeze(updated, endedReason(seed), at);

      state.requirements.set(id, updated);
      produced.push(updated);
    }

    if (!seed.live) {
      takeSnapshot(organizationId, seed.subject, produced, endedReason(seed), seed.endedAt ?? at);
    }
  }

  // A subject that has dropped out of the seeds entirely — the relationship was
  // ended and the owning system no longer reports it at all. The records are
  // frozen and snapshotted, never removed.
  for (const [id, requirement] of state.requirements) {
    if (requirement.organizationId !== organizationId) continue;
    if (seenSubjectIds.has(requirement.subject.id)) continue;
    if (requirement.frozenAt) continue;
    const frozen = freeze(
      requirement,
      "Access to this record ended when the relationship ended. The record is kept as history.",
      at,
    );
    state.requirements.set(id, frozen);
  }
  for (const requirement of [...state.requirements.values()]) {
    if (requirement.organizationId !== organizationId) continue;
    if (seenSubjectIds.has(requirement.subject.id)) continue;
    takeSnapshot(
      organizationId,
      requirement.subject,
      requirementsForSubject(organizationId, requirement.subject.id),
      "Access to this record ended when the relationship ended.",
      at,
    );
  }

  // A share cannot outlive the relationship it describes: once a subject stops
  // being live for its owner, the dispatcher's view of it closes too.
  for (const share of state.shares) {
    if (share.status !== "active") continue;
    if (share.ownerOrganizationId !== organizationId) continue;
    const seed = seeds.find((s) => s.subject.id === share.subject.id);
    if (seed && seed.live) continue;
    share.status = "revoked";
    share.revokedAt = at;
    share.revokedReason = "The relationship this share was granted for has ended.";
  }

  state.synced.add(organizationId);
}

function endedReason(seed: ComplianceSubjectSeed): string {
  const base =
    seed.endedReason ??
    "The relationship that produced these records ended.";
  return `${base} Access has stopped; the records are kept as history.`;
}

function requirementsForSubject(organizationId: string, subjectId: string) {
  return [...db().requirements.values()].filter(
    (r) => r.organizationId === organizationId && r.subject.id === subjectId,
  );
}

/** Materialize every organization once, so cross-organization tests are real. */
export function syncAll(now = Date.now()): void {
  for (const organizationId of complianceOrganizationIds()) {
    syncOrganization(organizationId, now);
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function allRequirements(): ComplianceRequirement[] {
  return [...db().requirements.values()];
}

export function requirementById(id: string): ComplianceRequirement | undefined {
  return db().requirements.get(id);
}

export function organizationRequirements(organizationId: string): ComplianceRequirement[] {
  return [...db().requirements.values()].filter((r) => r.organizationId === organizationId);
}

export function allShares(): ComplianceShare[] {
  return db().shares.map((s) => ({ ...s }));
}

export function allSnapshots(): ComplianceSnapshot[] {
  return db().snapshots.map((s) => ({ ...s }));
}

/**
 * The active share, if any, that lets one organization read another's
 * requirement. Both the subject and the exact requirement key must be named —
 * there is no wildcard share, by design.
 */
export function activeShareFor(
  requirement: ComplianceRequirement,
  viewerOrganizationId: string,
): ComplianceShare | undefined {
  return db().shares.find(
    (s) =>
      s.status === "active" &&
      s.ownerOrganizationId === requirement.organizationId &&
      s.viewerOrganizationId === viewerOrganizationId &&
      s.subject.id === requirement.subject.id &&
      s.requirementKeys.includes(requirement.definitionKey),
  );
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export class ComplianceFrozenError extends Error {
  constructor() {
    super("This record is history. It was frozen when the relationship ended and cannot be changed.");
    this.name = "ComplianceFrozenError";
  }
}

export class ComplianceEvidenceRequiredError extends Error {
  constructor(readonly requirement: ComplianceRequirement) {
    super(
      `${requirement.label} is satisfied by a document, and its due date comes from that document. Update it where it lives, and this requirement follows.`,
    );
    this.name = "ComplianceEvidenceRequiredError";
  }
}

function mutable(id: string): ComplianceRequirement {
  const found = db().requirements.get(id);
  if (!found) throw new Error("Compliance requirement not found");
  if (found.frozenAt) throw new ComplianceFrozenError();
  return found;
}

function manualState(id: string): ManualState {
  const state = db();
  const existing = state.manual.get(id);
  if (existing) return existing;
  const created: ManualState = {};
  state.manual.set(id, created);
  return created;
}

function commit(requirement: ComplianceRequirement): ComplianceRequirement {
  db().requirements.set(requirement.id, requirement);
  // Recompute against the subject's live facts so the returned record is the
  // same one the next read would produce.
  syncOrganization(requirement.organizationId);
  return db().requirements.get(requirement.id)!;
}

/**
 * Record that a requirement no longer needs action.
 *
 * A resolution never edits history — it appends one. And it cannot invent
 * evidence: a requirement whose due date comes from a document is fixed by
 * fixing the document, not by asserting here that it is fine.
 */
export function recordResolution(
  id: string,
  actor: ActorRef,
  input: { method: ComplianceResolutionMethod; note: string },
): ComplianceRequirement {
  const requirement = mutable(id);
  const note = input.note.trim();
  if (!note) throw new Error("A resolution needs a note saying what was done.");

  const definition = requirementDefinition(requirement.definitionKey);
  const manual = manualState(id);
  const at = nowIso();

  if (input.method === "waived") {
    manual.waivedAt = at;
    manual.waivedNote = note;
    manual.waivedBy = actor;
  } else {
    const documentBacked =
      definition.renewal.basis === "document_expiry" &&
      definition.satisfiedBy.some((s) => s !== "recorded_attestation");
    if (documentBacked) throw new ComplianceEvidenceRequiredError(requirement);

    manual.attestedAt = at;
    manual.attestation = {
      system: "recorded_attestation",
      id: rowId("att"),
      label: `Recorded by ${actor.displayNameSnapshot} — no file`,
      state: "approved",
      capturedAt: at,
    };
    // A recorded resolution replaces a stale waiver rather than stacking on it.
    manual.waivedAt = undefined;
    manual.waivedNote = undefined;
    manual.waivedBy = undefined;
  }

  const resolution: ComplianceResolution = {
    id: rowId("cres"),
    at,
    actor,
    method: input.method,
    fromStatus: requirement.status,
    note,
    satisfiedDueAt: requirement.dueAt,
    evidence: manual.attestation ?? requirement.evidence,
  };

  return commit({
    ...requirement,
    resolutions: [...requirement.resolutions, resolution],
    history: [
      ...requirement.history,
      history(input.method === "waived" ? "waived" : "renewed", actor, {
        at,
        fromStatus: requirement.status,
        note,
        evidence: resolution.evidence,
        organizationId: requirement.organizationId,
      }),
    ],
    updatedAt: at,
  });
}

export function assignResponsibility(
  id: string,
  actor: ActorRef,
  input: { membershipId: string; displayName: string; note?: string },
): ComplianceRequirement {
  const requirement = mutable(id);
  const manual = manualState(id);
  manual.responsible = {
    kind: "membership",
    displayName: input.displayName,
    membershipId: input.membershipId,
    organizationId: requirement.organizationId,
    href: "/settings/users",
  };
  const at = nowIso();
  return commit({
    ...requirement,
    responsible: manual.responsible,
    history: [
      ...requirement.history,
      history("responsibility_assigned", actor, {
        at,
        note: input.note?.trim() || `Assigned to ${input.displayName}.`,
        organizationId: requirement.organizationId,
      }),
    ],
    updatedAt: at,
  });
}

export function suspendRequirement(
  id: string,
  actor: ActorRef,
  reason: string,
): ComplianceRequirement {
  const requirement = mutable(id);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A suspension needs a reason.");
  manualState(id).suspendedReason = trimmed;
  const at = nowIso();
  return commit({
    ...requirement,
    history: [
      ...requirement.history,
      history("suspended", actor, {
        at,
        fromStatus: requirement.status,
        toStatus: "suspended",
        note: trimmed,
        organizationId: requirement.organizationId,
      }),
    ],
    updatedAt: at,
  });
}

export function reinstateRequirement(id: string, actor: ActorRef): ComplianceRequirement {
  const requirement = mutable(id);
  manualState(id).suspendedReason = undefined;
  const at = nowIso();
  return commit({
    ...requirement,
    history: [
      ...requirement.history,
      history("reinstated", actor, {
        at,
        fromStatus: requirement.status,
        note: "Suspension lifted.",
        organizationId: requirement.organizationId,
      }),
    ],
    updatedAt: at,
  });
}

export function addNote(id: string, actor: ActorRef, note: string): ComplianceRequirement {
  const requirement = mutable(id);
  const trimmed = note.trim();
  if (!trimmed) throw new Error("An empty note is not worth recording.");
  const at = nowIso();
  return commit({
    ...requirement,
    history: [
      ...requirement.history,
      history("note_added", actor, { at, note: trimmed, organizationId: requirement.organizationId }),
    ],
    updatedAt: at,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers the service and the Needs You bridge share                          */
/* -------------------------------------------------------------------------- */

export function openRequirements(organizationId: string): ComplianceRequirement[] {
  return organizationRequirements(organizationId).filter(
    (r) => !r.frozenAt && isOpen(r.status),
  );
}

/** The requirement definitions that genuinely reach a subject. Used by tests. */
export { applicableDefinitions };

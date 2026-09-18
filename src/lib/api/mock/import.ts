import {
  IMPORT_ASSERTION_BASIS,
  type ClaimCandidate, type ClaimDecision, type ClaimResolution, type ImportBatch,
  type ImportClaim, type ImportCommitResult, type ImportRun, type ImportSubjectKind,
  type PermissionKey, type PersonClaim, type TruckClaim,
} from "@/types";
import {
  rank, scorePerson, scoreTruck, type PersonRecord, type TruckRecord,
} from "@/lib/setup/identity-matching";
import {
  carrierDriverRelationshipsUnscoped, driverProfileUnscoped,
} from "./driver-registry";
import { mockWorkforceService } from "./workforce";
import { appendAuditEvent } from "./audit";
import {
  addClaim, batchByContentKey, batchById, batchesForOrganization, claimById,
  claimsForBatch, nextImportId, putBatch, putResolution, putRun, resolutionFor,
  runForBatch,
} from "./import-store";
import { nowIso } from "./time";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import type {
  ImportPlan, ImportPlanSummary, ImportService, StageImportInput, StagedImport,
} from "../contracts/import";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The import: claims in, canonical records out, through the modules that own
 * them.
 *
 * ★ EVERY WRITE GOES SOMEWHERE ELSE ★
 * This module owns no canonical record and writes none. A person becomes a
 * `WorkforceEngagement` through `mockWorkforceService.create`, which already
 * holds the duplicate check. A truck would become one through the truck
 * registry's `registerOrConnectTruck`, which is already VIN-keyed and already
 * create-or-connect. Nothing here re-implements either, and nothing here mints
 * a `DriverProfile` — see the note on `ImportService`.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 140;
const sleep = (ms: number) => (ms ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

function required(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/* -------------------------------------------------------------------------- */
/* Content keys                                                                */
/* -------------------------------------------------------------------------- */

/** FNV-1a. Short, stable, and not a security property. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const clean = (v?: string) => (v ?? "").trim().toLowerCase();

/**
 * A stable key for what a row IDENTIFIES, not for everything it says.
 *
 * Deliberately narrow: correcting a phone number in the second upload must not
 * make a second person. It covers the fields that decide identity plus the
 * name, so two genuinely different people in one file never collide.
 */
function contentKeyFor(subject: PersonClaim | TruckClaim): string {
  if (subject.kind === "person") {
    return `p:${hash([
      clean(subject.fullName), clean(subject.cdlNumber), clean(subject.cdlState),
      clean(subject.email),
    ].join("|"))}`;
  }
  return `t:${hash([
    clean(subject.vin), clean(subject.plateNumber), clean(subject.plateState),
    clean(subject.unitNumber),
  ].join("|"))}`;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function problemsFor(subject: PersonClaim | TruckClaim) {
  const problems: ImportClaim["problems"] = [];
  if (subject.kind === "person") {
    if (!subject.fullName.trim()) {
      problems.push({ field: "fullName", message: "A row with no name names nobody.", severity: "blocking" });
    }
    if (!subject.classification) {
      problems.push({
        field: "classification",
        message: "Say whether this person is an employee, a contractor or an owner-operator. "
          + "It decides their paperwork and their pay, so Antcolos will not guess it.",
        severity: "blocking",
      });
    }
    if (subject.cdlNumber && !subject.cdlState) {
      // Half a licence is not an identifier: states reuse numbers, so a number
      // with no state cannot be matched and must not be guessed at.
      problems.push({
        field: "cdlState",
        message: "A licence number needs its issuing state before it can identify anybody.",
        severity: "warning",
      });
    }
  } else if (!subject.vin) {
    problems.push({
      field: "vin",
      message: "Without a VIN this truck cannot be told apart from another one.",
      severity: "blocking",
    });
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* The candidate pool — this organization's own records, and nothing else      */
/* -------------------------------------------------------------------------- */

/**
 * People this carrier already has, from the two places it can legitimately
 * know about them.
 *
 * Its own Workforce engagements, and its own driver relationships. Both are
 * records this organization already holds — nothing here reaches into the
 * driver registry to look somebody up by licence, which is a surface that
 * would let any carrier ask Antcolos who another carrier's drivers are.
 */
async function personPool(ctx: ServiceContext): Promise<PersonRecord[]> {
  const organizationId = ctx.organizationId;
  const byId = new Map<string, PersonRecord>();

  for (const row of carrierDriverRelationshipsUnscoped(organizationId)) {
    const profile = driverProfileUnscoped(row.driverProfileId);
    if (!profile) continue;
    byId.set(profile.id, {
      entityId: profile.id,
      legalName: profile.legalName,
      email: profile.email,
      phone: profile.phone,
      cdlNumber: profile.cdlNumber,
      cdlState: profile.cdlState,
      detail: "Already drives for you",
    });
  }

  /*
   * ★ THROUGH THE MODULE, NOT THE STORE ★
   * `workforce.list` is what seeds the workforce store and what applies its own
   * rules about which engagements are live. Reading the store directly returned
   * an EMPTY roster whenever an import happened to run before anything else had
   * asked the workforce for anything — and an empty pool matches nobody, so
   * every person the carrier already had would have been created a second time.
   */
  for (const view of await mockWorkforceService.list(ctx)) {
    const engagement = view.engagement;
    const profileId = engagement.person.driverProfileId;
    if (profileId && byId.has(profileId)) continue;
    const profile = profileId ? driverProfileUnscoped(profileId) : undefined;
    // An engagement with no profile is still a person this carrier has on
    // record — the migrated worker who has not connected an account yet — and
    // importing the same row again must find them rather than making a second.
    byId.set(profileId ?? `weng:${engagement.id}`, {
      entityId: profileId ?? `weng:${engagement.id}`,
      legalName: profile?.legalName ?? engagement.person.displayName,
      email: profile?.email ?? engagement.person.email,
      phone: profile?.phone,
      cdlNumber: profile?.cdlNumber,
      cdlState: profile?.cdlState,
      detail: profile ? "On your workforce" : "On your workforce, no Antcolos account yet",
    });
  }

  return [...byId.values()];
}

/** Placeholder for the truck pool. PR-3a stages truck claims and plans them
 *  against an empty pool; committing them through `registerOrConnectTruck` is
 *  the next slice, and saying so beats a half-written write path. */
function truckPool(): TruckRecord[] {
  return [];
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

function summarize(resolutions: ClaimResolution[]): ImportPlanSummary {
  const summary: ImportPlanSummary = { matched: 0, new: 0, needsDecision: 0, blocked: 0 };
  for (const r of resolutions) {
    if (r.outcome === "matched") summary.matched += 1;
    else if (r.outcome === "new") summary.new += 1;
    else if (r.outcome === "blocked") summary.blocked += 1;
    else summary.needsDecision += 1;
  }
  return summary;
}

export const mockImportService: ImportService = {
  async list(ctx) {
    await sleep(LATENCY_MS);
    required(ctx, "workforce:view");
    return batchesForOrganization(ctx.organizationId);
  },

  async stage(ctx, input: StageImportInput): Promise<StagedImport> {
    await sleep(LATENCY_MS);
    required(ctx, "workforce:view", "workforce:manage");

    const at = nowIso();
    const rowKeys = input.rows.map((r) => contentKeyFor(r));
    const batchKey = hash(`${input.kind}|${rowKeys.join(",")}`);

    // The same file twice is the same batch. A nervous second upload otherwise
    // produces a second batch of the same fifty people, each of which matches
    // what the first one created — duplicates nobody sees until they count.
    const existing = batchByContentKey(ctx.organizationId, batchKey);
    if (existing) {
      return { batch: existing, claims: claimsForBatch(existing.id), resumed: true };
    }

    const batch: ImportBatch = {
      id: nextImportId("imb"),
      organizationId: ctx.organizationId,
      label: input.label.trim() || "Imported roster",
      kind: input.kind,
      createdAt: at,
      createdBy: ctx.actor,
      contentKey: batchKey,
    };
    putBatch(batch);

    const claims = input.rows.map((subject, index) => addClaim({
      id: nextImportId("imc"),
      organizationId: ctx.organizationId,
      batchId: batch.id,
      rowNumber: index + 1,
      subject,
      problems: problemsFor(subject),
      contentKey: rowKeys[index],
      receivedAt: at,
      source: "manual_entry",
      provenance: {
        module: "document_center",
        adapter: "mock:roster-import",
        mock: true,
        // The carrier supplied the file now; what it ASSERTS about the past is
        // on each `ImportedAssertion`, and the two are never the same date.
        observedAt: at,
        receivedAt: at,
      },
    }));

    appendAuditEvent(ctx, {
      module: "workforce",
      action: "workforce.engagement_created",
      sourceAction: "import.batch_staged",
      // Attributed to the organization: there is no canonical "import batch"
      // entity and inventing an audit kind for one would imply a record that
      // does not exist.
      entity: { kind: "organization", id: ctx.organizationId, label: batch.label },
      summary: `${claims.length} rows staged for import from ${batch.label}. Nothing was created.`,
    });

    return { batch, claims, resumed: false };
  },

  async plan(ctx, batchId): Promise<ImportPlan | null> {
    await sleep(LATENCY_MS);
    required(ctx, "workforce:view");
    const batch = batchById(batchId);
    if (!batch || batch.organizationId !== ctx.organizationId) return null;

    const people = await personPool(ctx);
    const trucks = truckPool();
    const at = nowIso();

    const resolutions = claimsForBatch(batch.id).map((claim) => {
      if (claim.problems.some((p) => p.severity === "blocking")) {
        return putResolution({
          claimId: claim.id,
          outcome: "blocked",
          candidates: [],
          rationale: claim.problems.filter((p) => p.severity === "blocking")
            .map((p) => p.message).join(" "),
          plannedAt: at,
        });
      }

      const candidates: ClaimCandidate[] = claim.subject.kind === "person"
        ? people.map((record) => scorePerson(claim.subject as PersonClaim, record))
        : trucks.map((record) => scoreTruck(claim.subject as TruckClaim, record));

      const ranking = rank(candidates);
      return putResolution({
        claimId: claim.id,
        outcome: ranking.outcome,
        candidates: ranking.candidates,
        rationale: ranking.rationale,
        plannedAt: at,
      });
    });

    return {
      batch,
      claims: claimsForBatch(batch.id),
      resolutions,
      summary: summarize(resolutions),
    };
  },

  async decide(ctx, claimId, decision): Promise<ClaimResolution | null> {
    await sleep(LATENCY_MS);
    required(ctx, "workforce:manage");
    const claim = claimById(claimId);
    if (!claim || claim.organizationId !== ctx.organizationId) return null;
    const current = resolutionFor(claimId);
    if (!current) return null;

    const recorded: ClaimDecision = {
      ...decision,
      decidedAt: nowIso(),
      decidedBy: ctx.actor,
    };
    return putResolution({ ...current, decision: recorded });
  },

  async commit(ctx, batchId): Promise<ImportRun | null> {
    await sleep(LATENCY_MS);
    required(ctx, "workforce:view", "workforce:manage");
    const batch = batchById(batchId);
    if (!batch || batch.organizationId !== ctx.organizationId) return null;

    const previous = runForBatch(batch.id);
    const done = new Map((previous?.results ?? []).map((r) => [r.claimId, r]));
    const results: ImportCommitResult[] = [];

    for (const claim of claimsForBatch(batch.id)) {
      // Already committed by an earlier run. Resuming repeats nothing.
      const before = done.get(claim.id);
      if (before && (before.outcome === "created" || before.outcome === "linked"
        || before.outcome === "already_done")) {
        results.push({ ...before, outcome: "already_done", detail: "Already done by an earlier run." });
        continue;
      }
      results.push(await commitOne(ctx, claim));
    }

    // A run is complete when every row landed. A row that failed, and a row
    // still waiting on somebody's answer, both leave it incomplete — and a
    // retry is what finishes it.
    const outstanding = results.some(
      (r) => r.outcome === "failed" || (r.outcome === "skipped" && retryable(r.claimId)),
    );

    const run: ImportRun = {
      id: previous?.id ?? nextImportId("imr"),
      batchId: batch.id,
      organizationId: ctx.organizationId,
      state: outstanding ? "incomplete" : "complete",
      startedAt: previous?.startedAt ?? nowIso(),
      completedAt: nowIso(),
      results,
    };
    return putRun(run);
  },
};

/**
 * Whether a skipped row could still be finished.
 *
 * A row somebody deliberately skipped is DONE — asking again would be nagging
 * about a decision already made. A row waiting for a decision, or blocked on
 * something the carrier can fix, is outstanding and keeps the run honest.
 */
function retryable(claimId: string): boolean {
  const resolution = resolutionFor(claimId);
  if (!resolution) return true;
  if (resolution.decision?.choice === "skip") return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* One claim                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ███ TEST SEAM — NEVER SET BY THE PRODUCT ███
 *
 * Refuses one row's commit, with the rows before it already written.
 *
 * An import over fifty rows is fifty separate writes to another module, and the
 * failure that matters is not the one before it starts — it is row twenty-seven
 * failing with twenty-six people already on the roster. Without a seam this
 * mock never reaches that state, so "the retry repeats nothing" would be an
 * untested claim about the only moment it has to be true.
 *
 * Inert in a browser, which is where a production surface would have to reach
 * it from. That is a guard against an accident, not a security property: it is
 * the module boundary and the absence of any caller that keep the product out,
 * and a backend must not carry this seam at all.
 */
const COMMIT_SEAM_AVAILABLE = typeof window === "undefined";
let commitFaultRow: number | null = null;

export function failCommitAtRowForTests(rowNumber: number | null): void {
  if (!COMMIT_SEAM_AVAILABLE) return;
  commitFaultRow = rowNumber;
}

async function commitOne(ctx: ServiceContext, claim: ImportClaim): Promise<ImportCommitResult> {
  const resolution = resolutionFor(claim.id);
  if (!resolution) {
    return {
      claimId: claim.id, outcome: "skipped",
      detail: "Not planned yet, so there is nothing to act on.",
    };
  }

  // A person's decision OUTRANKS the ranking, which may have been re-derived
  // since they made it.
  const decided = resolution.decision;
  if (decided?.choice === "skip") {
    return { claimId: claim.id, outcome: "skipped", detail: "Skipped by a person." };
  }
  if (resolution.outcome === "blocked") {
    return { claimId: claim.id, outcome: "skipped", detail: resolution.rationale };
  }
  if (resolution.outcome === "needs_decision" && !decided) {
    return {
      claimId: claim.id, outcome: "skipped",
      detail: "Waiting for somebody to say which record this is.",
    };
  }

  if (claim.subject.kind !== "person") {
    return {
      claimId: claim.id, outcome: "skipped",
      detail: "Trucks are staged and planned in this slice; committing them through the "
        + "truck registry is the next one.",
    };
  }

  if (commitFaultRow === claim.rowNumber) {
    return {
      claimId: claim.id,
      outcome: "failed",
      detail: `Row ${claim.rowNumber} could not be written.`,
      failureReason: "injected failure (test seam)",
    };
  }

  return commitPerson(ctx, claim, claim.subject, resolution);
}

async function commitPerson(
  ctx: ServiceContext,
  claim: ImportClaim,
  subject: PersonClaim,
  resolution: ClaimResolution,
): Promise<ImportCommitResult> {
  const chosen = resolution.decision?.choice === "link"
    ? resolution.decision.entityId
    : resolution.outcome === "matched"
      ? resolution.candidates.find((c) => c.confidence === "exact")?.entityId
      : undefined;

  /*
   * ★ A MATCH LINKS; IT DOES NOT RE-CREATE ★
   * The person already exists to this carrier, so the honest outcome is to say
   * so and write nothing. Creating an engagement beside the one they already
   * have is exactly the duplicate roster this module exists to prevent.
   */
  if (chosen) {
    const label = resolution.candidates.find((c) => c.entityId === chosen)?.label
      ?? subject.fullName;
    return {
      claimId: claim.id,
      outcome: "linked",
      entity: { kind: "person" as ImportSubjectKind, id: chosen, label },
      detail: `${label} is already on your roster. Nothing was created.`,
    };
  }

  /*
   * ★ WHAT A NEW ROW ACTUALLY CREATES ★
   * The CARRIER'S OWN record of somebody they employ — not a DriverProfile.
   * The person keeps that; they connect it themselves by accepting an
   * invitation, and `driverProfileId` stays absent until they do. Importing a
   * roster is describing who you already employ; it is not signing anybody up.
   */
  const asserted = subject.startedWithCarrier;
  try {
    const created = await mockWorkforceService.create(ctx, {
      person: {
        displayName: subject.fullName.trim(),
        email: subject.email?.trim().toLowerCase(),
      },
      classification: subject.classification!,
      positionTitle: subject.positionTitle?.trim() || "Driver",
      // The carrier's claim about when this person started, carried as the
      // date it asserts — never today. `receivedAt` on the claim is when we
      // learned it, and the two stay different fields forever.
      startDate: asserted?.occurredAt,
      source: {
        kind: "roster_import",
        id: claim.id,
        label: IMPORT_ASSERTION_BASIS,
      },
    });
    return {
      claimId: claim.id,
      outcome: "created",
      entity: { kind: "person", id: created.engagement.id, label: created.engagement.person.displayName },
      detail: asserted
        ? `Added to your workforce, starting ${asserted.occurredAt.slice(0, 10)} as you stated. `
          + "They have no Antcolos account yet — invite them to connect one."
        : "Added to your workforce. They have no Antcolos account yet — invite them to connect one.",
    };
  } catch (error) {
    return {
      claimId: claim.id,
      outcome: "failed",
      detail: `${subject.fullName} could not be added to your workforce.`,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export { contentKeyFor as contentKeyForTests };

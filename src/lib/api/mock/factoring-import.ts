import type {
  BrokerFactorabilityCheck, FactoringConnection, FactoringDecision,
  FactoringImportBatch, FactoringImportPreview, FactoringImportResult,
  FactoringImportRow, FactoringImportRowInput, FactoringImportRowState,
} from "@/types";
import { normalizeMcNumber } from "@/lib/directory/normalize";
import { NotFoundError } from "../contracts/context";
import type { ServiceContext } from "../contracts/context";
import { brokerByVerifiedMcSync } from "./party-registry";
import {
  appendCheck, connectionForSync, factoringInternals, resolveBrokerSubject,
} from "./factoring-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Bringing in a factoring company's debtor / credit export.
 *
 * ★ WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ★
 *
 * It is the one honest way a carrier can get its factor's answers into Antcolos
 * today: the carrier signs in to its OWN factoring portal, downloads the debtor
 * or credit list it is entitled to, and brings the file here. Antcolos does not
 * sign in, does not scrape, does not store a portal login and does not automate
 * a browser. Those are excluded on purpose and are not a later milestone.
 *
 * It follows the same three-step shape `ImportService` already uses — stage,
 * preview, commit — for the same reason: a carrier has to be able to SEE what a
 * file is about to do before it does it, and the rows a person has to look at
 * are exactly the ones a progress bar would hide.
 *
 * ★ FOUR RULES, AND WHAT EACH ONE PREVENTS ★
 *
 *  1. MATCH ON THE MC NUMBER. A row with no MC never attaches to a broker,
 *     however confident the name looks. Four companies are called "Summit
 *     Logistics" and one of them is on nobody's approved list.
 *  2. NEVER MINT A BROKER. An MC this carrier's directory does not know stays
 *     unmatched and goes to review. Creating a canonical party from a factoring
 *     export is how a directory acquires a second Apex Logistics.
 *  3. IDEMPOTENT. The same file staged twice resumes the same batch; a row
 *     already committed is reported and written by nothing. So a commit that
 *     fails halfway is finished by running it again, not by starting over and
 *     doubling every decision it already made.
 *  4. SUPERSEDE, DO NOT DELETE. A newer file's answer stands the older one down
 *     and keeps it. A carrier can always see what the list said last week, and
 *     which answer a booking was made on.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface ImportState {
  batches: FactoringImportBatch[];
  rows: FactoringImportRow[];
}

let state: ImportState | null = null;

function db(): ImportState {
  if (!state) state = { batches: [], rows: [] };
  return state;
}

/** Test hook. Never called by the UI. */
export function resetFactoringImports() {
  state = null;
}

/* -------------------------------------------------------------------------- */
/* Reading a provider's status word                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a factor's own word means in Antcolos terms.
 *
 * Deliberately conservative. A word this table does not know becomes
 * `unreadable` and goes to a person — it does NOT fall through to `rejected`,
 * which would turn every unfamiliar export dialect into a wall of refusals no
 * factor ever issued.
 */
const STATUS_WORDS: Record<string, FactoringDecision> = {
  approved: "approved_imported",
  approve: "approved_imported",
  active: "approved_imported",
  open: "approved_imported",
  "credit approved": "approved_imported",
  ok: "approved_imported",
  yes: "approved_imported",
  conditional: "conditional",
  "approved with conditions": "conditional",
  restricted: "conditional",
  watch: "conditional",
  declined: "rejected",
  decline: "rejected",
  denied: "rejected",
  rejected: "rejected",
  "do not fund": "rejected",
  "no buy": "rejected",
  closed: "rejected",
  pending: "pending",
  review: "pending",
  "under review": "pending",
};

function readStatusWord(statusText: string): FactoringDecision | undefined {
  return STATUS_WORDS[statusText.trim().toLowerCase().replace(/\s+/g, " ")];
}

/**
 * A money column, as a factor prints it: "$12,500", "12500.00", "" or "N/A".
 *
 * ★ AN UNREADABLE COLUMN PRODUCES NOTHING ★
 * Not zero. A limit of zero is a statement the factor did not make, and a
 * dispatcher reading "$0 limit" would conclude something false about a broker
 * whose file simply had an empty cell.
 */
function readMoneyCents(text?: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return undefined;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

function readDate(text?: string): string | undefined {
  if (!text?.trim()) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * The batch's identity: the rows, not the file name.
 *
 * Re-uploading "debtors.csv" after editing it is a NEW batch; re-uploading the
 * same file under a different name is the SAME batch. Hashing the content is
 * what makes "run it again to finish it" safe and "run it again after a
 * correction" meaningful.
 */
function hashRows(rows: FactoringImportRowInput[]): string {
  const canonical = rows
    .map((r) => [
      r.lineNumber, r.debtorName.trim().toLowerCase(), r.mcNumber ?? "", r.dotNumber ?? "",
      r.statusText.trim().toLowerCase(), r.creditLimitText ?? "", r.availableText ?? "",
      r.reason ?? "", r.conditions ?? "", r.effectiveDate ?? "", r.expiryDate ?? "",
    ].join("|"))
    .join("\n");
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fih_${(h >>> 0).toString(36)}_${rows.length}`;
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

export interface StageFactoringImportInput {
  carrierOrganizationId: string;
  /** The file name, as the person saw it. */
  label: string;
  rows: FactoringImportRowInput[];
}

/**
 * Work out what a file would do, without doing any of it.
 *
 * Re-derived on every call and safe to call again: it replaces the row
 * resolutions and preserves everything a previous commit already wrote.
 */
export function previewFactoringImportSync(
  ctx: ServiceContext,
  input: StageFactoringImportInput,
): FactoringImportPreview {
  factoringInternals.requireCarrierAdministration(ctx, input.carrierOrganizationId);

  const connection = connectionForSync(input.carrierOrganizationId);
  if (!connection) throw new NotFoundError("Factoring connection");

  const contentHash = hashRows(input.rows);
  const existing = db().batches.find(
    (b) => b.carrierOrganizationId === input.carrierOrganizationId
      && b.contentHash === contentHash,
  );

  const batch: FactoringImportBatch = existing ?? {
    batchId: factoringInternals.rowId("fib"),
    carrierOrganizationId: input.carrierOrganizationId,
    connectionId: connection.connectionId,
    providerName: connection.providerName,
    label: input.label,
    contentHash,
    state: "preview",
    rowCount: input.rows.length,
    stagedAt: nowIso(),
    stagedBy: ctx.actor,
    committedRowCount: 0,
  };
  if (!existing) db().batches.push(batch);

  const previous = db().rows.filter((r) => r.batchId === batch.batchId);
  const rows = input.rows.map((row) =>
    resolveRow(batch, connection, row, previous.find((p) => p.lineNumber === row.lineNumber)),
  );

  db().rows = db().rows.filter((r) => r.batchId !== batch.batchId).concat(rows);

  return {
    batch,
    rows,
    summary: {
      ready: rows.filter((r) => r.state === "matched").length,
      needsReview: rows.filter(
        (r) => r.state !== "matched" && r.state !== "already_committed",
      ).length,
      alreadyCommitted: rows.filter((r) => r.state === "already_committed").length,
      supersedes: rows.filter((r) => r.state === "matched" && r.supersedesCheckId).length,
    },
    resumed: Boolean(existing),
  };
}

/** One row, resolved against this carrier's own directory. Creates nothing. */
function resolveRow(
  batch: FactoringImportBatch,
  connection: FactoringConnection,
  input: FactoringImportRowInput,
  previous: FactoringImportRow | undefined,
): FactoringImportRow {
  const base = {
    rowId: previous?.rowId ?? factoringInternals.rowId("fir"),
    batchId: batch.batchId,
    lineNumber: input.lineNumber,
    input,
  };

  /* A row this batch has already written stays written. Idempotency lives
     here as much as in the commit: a second preview must not re-arm it. */
  if (previous?.committedCheckId) {
    return {
      ...base,
      ...previous,
      input,
      state: "already_committed",
      reviewReason: undefined,
    };
  }

  const mcNumber = normalizeMcNumber(input.mcNumber);
  const decision = readStatusWord(input.statusText);

  if (!mcNumber) {
    return {
      ...base,
      state: "name_only" as FactoringImportRowState,
      decision,
      reviewReason:
        `"${input.debtorName}" has no MC number on this row. A name is not an identifier, `
        + "so Antcolos will not attach this answer to a broker. Add the MC to the export, "
        + "or record the answer against the right company by hand.",
    };
  }

  if (!decision) {
    return {
      ...base,
      state: "unreadable",
      mcNumber,
      reviewReason:
        `Antcolos does not recognise the status "${input.statusText}". Nothing has been `
        + "assumed about it — tell us what your factor means by it, or record this one by hand.",
    };
  }

  const party = brokerByVerifiedMcSync(batch.carrierOrganizationId, mcNumber);
  if (!party) {
    return {
      ...base,
      state: "unmatched",
      mcNumber,
      decision,
      reviewReason:
        `MC ${mcNumber} is not a company in your directory. Antcolos will not create a broker `
        + "profile from a factoring export — add the company first, then import again.",
    };
  }

  /*
   * A conflict worth stopping for: the row's name is nothing like the profile
   * its MC points at. The MC still decides — it is the identifier — but a
   * carrier ought to look at a row that says "Apex Logistics" against a profile
   * called "Harbor Point Freight" rather than have it applied quietly.
   */
  const rowName = input.debtorName.trim().toLowerCase();
  const profileNames = [party.legalName, party.dbaName]
    .filter(Boolean)
    .map((n) => n!.trim().toLowerCase());
  const namesAgree = profileNames.some(
    (n) => n.includes(rowName) || rowName.includes(n) || sharesFirstWord(n, rowName),
  );

  const creditLimitCents = readMoneyCents(input.creditLimitText);
  const availableAmountCents = readMoneyCents(input.availableText);
  const expiresAt = readDate(input.expiryDate);
  const current = factoringInternals.currentCheck(
    batch.carrierOrganizationId,
    connection,
    resolveBrokerSubject(batch.carrierOrganizationId, {
      brokerNameObserved: input.debtorName,
      brokerMcNumber: mcNumber,
    }),
  );

  if (!namesAgree) {
    return {
      ...base,
      state: "conflicted",
      mcNumber,
      brokerPartyId: party.partyId,
      brokerLegalName: party.legalName,
      decision,
      creditLimitCents,
      availableAmountCents,
      expiresAt,
      supersedesCheckId: current?.checkId,
      reviewReason:
        `This row is called "${input.debtorName}" but MC ${mcNumber} is `
        + `${party.legalName} in your directory. Check which one your factor meant.`,
    };
  }

  return {
    ...base,
    state: "matched",
    mcNumber,
    brokerPartyId: party.partyId,
    brokerLegalName: party.legalName,
    decision,
    creditLimitCents,
    availableAmountCents,
    expiresAt,
    supersedesCheckId: current?.checkId,
  };
}

function sharesFirstWord(a: string, b: string): boolean {
  const first = (s: string) => s.split(/\s+/)[0] ?? "";
  const x = first(a);
  return x.length >= 4 && x === first(b);
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Write the rows that are ready, one at a time.
 *
 * ★ RESUMABLE BY CONSTRUCTION ★
 * Each row is marked committed the instant its check is written, so a failure
 * anywhere in the loop leaves everything before it done and everything after it
 * untouched. Running it again picks up exactly where it stopped: committed rows
 * report `already_committed` and produce nothing, and the batch's
 * `committedRowCount` is the honest count rather than an optimistic one.
 *
 * Rows that need a person are SKIPPED, not guessed at. A commit that resolved
 * ambiguity on its own would defeat the preview.
 */
export function commitFactoringImportSync(
  ctx: ServiceContext,
  batchId: string,
): FactoringImportResult {
  const batch = db().batches.find((b) => b.batchId === batchId);
  if (!batch) throw new NotFoundError("Import batch");
  factoringInternals.requireCarrierAdministration(ctx, batch.carrierOrganizationId);

  const connection = connectionForSync(batch.carrierOrganizationId);
  if (!connection) throw new NotFoundError("Factoring connection");

  const rows = db().rows
    .filter((r) => r.batchId === batchId)
    .sort((a, b) => a.lineNumber - b.lineNumber);

  const written: BrokerFactorabilityCheck[] = [];
  let skipped = 0;

  for (const row of rows) {
    if (row.committedCheckId) continue;
    if (row.state !== "matched" || !row.decision || !row.mcNumber) {
      skipped++;
      continue;
    }

    const subject = resolveBrokerSubject(batch.carrierOrganizationId, {
      brokerNameObserved: row.input.debtorName,
      brokerMcNumber: row.mcNumber,
    });

    const check = appendCheck({
      carrierOrganizationId: batch.carrierOrganizationId,
      connection,
      subject,
      decision: row.decision,
      source: "imported_list",
      // The factor's own words off the file, and nothing composed here.
      reason: row.input.reason?.trim() || undefined,
      conditions: row.input.conditions
        ? row.input.conditions.split(";").map((c) => c.trim()).filter(Boolean)
        : undefined,
      creditLimitCents: row.creditLimitCents,
      availableAmountCents: row.availableAmountCents,
      expiresAt: row.expiresAt,
      checkedAt: readDate(row.input.effectiveDate) ?? batch.stagedAt,
      batchId: batch.batchId,
      evidence: {
        kind: "import_batch",
        reference: batch.batchId,
        note: `Row ${row.lineNumber} of ${batch.label}.`,
      },
      recordedBy: ctx.actor,
      recordedByOrganizationId: ctx.organizationId,
    });

    row.committedCheckId = check.checkId;
    row.state = "already_committed";
    batch.committedRowCount++;
    written.push(check);
  }

  batch.state = skipped > 0 ? "partially_committed" : "committed";
  batch.committedAt = nowIso();
  batch.committedBy = ctx.actor;
  connection.lastImportBatchId = batch.batchId;

  return {
    batch,
    rows: db().rows.filter((r) => r.batchId === batchId),
    committed: written.length,
    skipped,
    checks: written,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function importBatchesSync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
): FactoringImportBatch[] {
  factoringInternals.requireReach(ctx, carrierOrganizationId);
  factoringInternals.requirePermissions(ctx, "factoring:view");
  return db()
    .batches.filter((b) => b.carrierOrganizationId === carrierOrganizationId)
    .sort((a, b) => Date.parse(b.stagedAt) - Date.parse(a.stagedAt));
}

export function importRowsSync(
  ctx: ServiceContext,
  batchId: string,
): FactoringImportRow[] {
  const batch = db().batches.find((b) => b.batchId === batchId);
  if (!batch) throw new NotFoundError("Import batch");
  factoringInternals.requireReach(ctx, batch.carrierOrganizationId);
  factoringInternals.requirePermissions(ctx, "factoring:view");
  return db().rows.filter((r) => r.batchId === batchId).sort((a, b) => a.lineNumber - b.lineNumber);
}

/** Exposed so a screen can say how long a carrier's list has been unrefreshed. */
export function lastCommittedBatchSync(
  carrierOrganizationId: string,
): FactoringImportBatch | undefined {
  return db()
    .batches.filter(
      (b) => b.carrierOrganizationId === carrierOrganizationId && b.committedAt,
    )
    .sort((a, b) => Date.parse(b.committedAt!) - Date.parse(a.committedAt!))[0];
}

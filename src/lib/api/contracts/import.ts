import type {
  ClaimDecision, ClaimResolution, ImportBatch, ImportClaim, ImportRun,
  ImportSubjectKind, PersonClaim, TruckClaim,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * Bringing a carrier that already exists into Antcolos.
 *
 * ★ WHAT THIS SERVICE MAY CREATE, AND WHAT IT MAY NOT ★
 *
 * It may create the CARRIER'S OWN records: a Workforce engagement describing
 * somebody they employ, a truck in their fleet. It may LINK to a person's
 * permanent records when it can prove which person that is.
 *
 * It may not create a `DriverProfile`. That is not a limitation of this build —
 * it is what a permanent professional profile means. A profile belongs to a
 * person and is keyed to their account; minting one from a name on a carrier's
 * spreadsheet would create a second permanent identity for somebody who may
 * already have one, and attach a licence and a medical card to it, without that
 * person having said anything at all. The existing invitation path is how a
 * person connects their own profile — see `AccessService.accept` — and the
 * engagement waits, with `driverProfileId` absent, until they do.
 *
 * ★ AND WHY IT CANNOT SEARCH FOR THEM EITHER ★
 * Candidates are drawn only from records THIS organization already holds: its
 * own Workforce engagements, its own driver relationships, its own fleet. The
 * driver registry deliberately offers no way to find a profile by licence
 * number, and an importer that could would be a way for any carrier to ask
 * Antcolos who its competitor's drivers are.
 */
export interface StageImportInput {
  label: string;
  kind: ImportSubjectKind;
  /**
   * The rows, already structured.
   *
   * Parsing a file into these is a separate concern and a later slice: this
   * service takes claims, not CSV, so the matching and commit rules can be
   * tested without a parser in the way.
   */
  rows: Array<PersonClaim | TruckClaim>;
}

export interface StagedImport {
  batch: ImportBatch;
  claims: ImportClaim[];
  /** True when this exact file was already staged. Nothing was added. */
  resumed: boolean;
}

export interface ImportPlan {
  batch: ImportBatch;
  claims: ImportClaim[];
  resolutions: ClaimResolution[];
  /** What is ready, and what is waiting. Never "50 trucks in ten minutes". */
  summary: ImportPlanSummary;
}

/**
 * The honest count.
 *
 * Deliberately four numbers rather than a percentage: a carrier needs to know
 * how many rows will go through untouched, how many need them, and how many
 * cannot go at all — and a single progress bar hides exactly the rows somebody
 * has to act on.
 */
export interface ImportPlanSummary {
  matched: number;
  new: number;
  needsDecision: number;
  blocked: number;
}

export interface ImportService {
  /** Records what a carrier gave us. Writes claims and nothing canonical. */
  stage(ctx: ServiceContext, input: StageImportInput): Promise<StagedImport>;
  /**
   * Works out what each claim means, against this organization's own records.
   *
   * Re-derived on every call, and safe to call again: it replaces resolutions
   * and preserves any decision a person has already made.
   */
  plan(ctx: ServiceContext, batchId: string): Promise<ImportPlan | null>;
  /** Records an authorized person's answer to a claim that stopped. */
  decide(
    ctx: ServiceContext, claimId: string, decision: Omit<ClaimDecision, "decidedAt" | "decidedBy">,
  ): Promise<ClaimResolution | null>;
  /**
   * Creates or links, one claim at a time, through the module that owns each
   * record.
   *
   * IDEMPOTENT throughout: a claim already committed is reported
   * `already_done` and nothing is written, so a retry after a partial failure
   * finishes what is missing and repeats nothing.
   */
  commit(ctx: ServiceContext, batchId: string): Promise<ImportRun | null>;
  list(ctx: ServiceContext): Promise<ImportBatch[]>;
}

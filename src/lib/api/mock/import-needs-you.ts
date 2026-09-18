import type { NeedsYouItem, PermissionKey, PersonClaim, TruckClaim } from "@/types";
import type { ServiceContext } from "../contracts/context";
import { batchById, undecidedClaims } from "./import-store";

/**
 * The rows an import would not decide.
 *
 * ★ WHY THIS IS THE ONLY IMPORT ITEM ★
 * Not "you have an import in progress", and not one item per row that went
 * through — a queue full of successes is the inbox this codebase keeps
 * refusing to build. What needs a person is the row where two answers are both
 * plausible and only one is true: this could be the driver you already have, or
 * it could be somebody new with a similar name, and every signal in the file is
 * the kind people share.
 *
 * Deciding it automatically is what produces a second permanent profile for
 * somebody who already had one. That damage is quiet — two records, each
 * half-right, and the carrier finds out when a licence expires on the copy
 * nobody is looking at. So the row stops, and stops HERE, where work that needs
 * a person already lives.
 *
 * DERIVED, like every other item in this queue. Answer the row and the item
 * stops existing, with nobody resolving anything.
 */

export const IMPORT_ITEM_PREFIX = "nyimp_";

export function isImportNeedsYouId(id: string): boolean {
  return id.startsWith(IMPORT_ITEM_PREFIX);
}

const REQUIRES: PermissionKey[] = ["workforce:manage"];

/** What the row says, in the words the carrier wrote. */
function describe(subject: PersonClaim | TruckClaim): string {
  if (subject.kind === "person") {
    const parts = [subject.fullName.trim()];
    if (subject.email) parts.push(subject.email);
    if (subject.cdlNumber) parts.push(`${subject.cdlNumber}${subject.cdlState ? ` (${subject.cdlState})` : ""}`);
    return parts.join(" · ");
  }
  const parts = [subject.unitNumber ? `Unit ${subject.unitNumber}` : "Truck"];
  if (subject.vin) parts.push(subject.vin);
  return parts.join(" · ");
}

export function importNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!REQUIRES.every((k) => ctx.permissions.has(k))) return [];

  const out: NeedsYouItem[] = [];
  for (const { claim, resolution } of undecidedClaims()) {
    if (claim.organizationId !== ctx.organizationId) continue;
    const batch = batchById(claim.batchId);
    if (!batch || batch.organizationId !== ctx.organizationId) continue;

    const label = describe(claim.subject);
    const names = resolution.candidates
      .slice(0, 3)
      .map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`)
      .join("; ");

    out.push({
      id: `${IMPORT_ITEM_PREFIX}${claim.id}`,
      organizationId: claim.organizationId,
      category: "import_claim_unresolved",
      /*
       * MEDIUM, and deliberately not higher. Nothing is broken and nothing is
       * at risk while this waits — the row simply has not been imported, and
       * the import said so plainly. Marking it high would put an unfinished
       * spreadsheet above a medical card that expires on Friday.
       */
      severity: "medium",
      status: "open",
      title: `Which person is row ${claim.rowNumber} of ${batch.label}?`,
      reason: resolution.candidates.length > 0
        ? `The file says ${label}. That could be ${names}, and nothing in the row `
          + "proves which. Antcolos will not guess, because guessing wrong makes a "
          + "second permanent record for somebody who already has one."
        : `The file says ${label}, and there is not enough in the row to tell whether `
          + "this is somebody you already have.",
      detail: resolution.rationale,
      entity: {
        // The claim, never a person: nobody has established there is a person
        // here yet, and an entity that said otherwise would be the guess.
        kind: "import_claim",
        id: claim.id,
        label,
      },
      recommendedAction: {
        kind: "resolve_import_claim",
        label: "Say which record this is",
        requires: REQUIRES,
      },
      requires: REQUIRES,
      source: "system",
      createdAt: claim.receivedAt,
      history: [],
    });
  }
  return out;
}

import { beforeEach, describe, expect, it } from "vitest";
import {
  FACTORING_FORBIDDEN_FIELDS, isFactoringApproved, isFactoringUnanswered,
} from "@/types";
import type {
  FactoringImportRowInput, PermissionKey,
} from "@/types";
import { resetAllMocks } from "@/lib/api/mock/registry";
import { mockFactoringService } from "@/lib/api/mock/factoring";
import {
  connectionForSync, factoringReachFor, factoringStatusSync, resetFactoring,
} from "@/lib/api/mock/factoring-registry";
import { matchesFactoringFilter } from "@/lib/factoring";
import { auditLedger } from "@/lib/api/mock/audit-ledger";
import { listDirectory } from "@/lib/api/mock/party-registry";
import { PermissionDeniedError, NotFoundError } from "@/lib/api/contracts/context";
import {
  FactoringOverrideNotPermittedError, FactoringReasonRequiredError,
} from "@/lib/api/contracts/factoring";
import {
  contextFor, BAXTER_OWNER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, SUMMIT_OWNER,
} from "../../../../tests/responsibility/harness";

/**
 * ★ THE FACTORING CHECK FOUNDATION ★
 *
 * ███ NOTHING UNDER TEST HERE CONTACTS A FACTORING COMPANY ███
 *
 * Every claim below is a rule that, broken, produces a specific real-world
 * failure — a carrier booking freight its factor will not fund, a competitor
 * reading another carrier's credit file, or a dispatcher trusting an approval
 * that expired on Tuesday.
 *
 * The fixtures do the heavy lifting: Apex Logistics (MC 612884) is a single
 * canonical broker that Northline's factor approves and Baxter's factor
 * refuses, and both of those are true at the same time.
 */

const NORTHLINE = "org_northline";
const BAXTER = "org_baxter";
const APEX_MC = "MC-612884";
const APEX_NAME = "Apex Logistics LLC";

const HOUR_MS = 3_600_000;

function northline(over: { without?: PermissionKey[] } = {}) {
  return contextFor(NORTHLINE_OWNER, over);
}
function baxter(over: { without?: PermissionKey[] } = {}) {
  return contextFor(BAXTER_OWNER, over);
}
/** Meridian dispatches Baxter's trucks. It has no authority over Northline. */
function meridian(over: { without?: PermissionKey[] } = {}) {
  return contextFor(MERIDIAN_DISPATCHER, over);
}
/** Summit dispatches for BOTH carriers, which is the harder case. */
function summit(over: { without?: PermissionKey[] } = {}) {
  return contextFor(SUMMIT_OWNER, over);
}

const apex = (carrierOrganizationId: string, extra: Record<string, unknown> = {}) => ({
  carrierOrganizationId,
  brokerNameObserved: APEX_NAME,
  brokerMcNumber: APEX_MC,
  ...extra,
});

beforeEach(() => {
  resetAllMocks();
  resetFactoring();
});

/* -------------------------------------------------------------------------- */

describe("1 — one broker, two carriers, two answers", () => {
  it("is approved for Northline and rejected for Baxter, with no leakage", async () => {
    const forNorthline = await mockFactoringService.status(northline(), apex(NORTHLINE));
    const forBaxter = await mockFactoringService.status(baxter(), apex(BAXTER));

    expect(isFactoringApproved(forNorthline.decision)).toBe(true);
    expect(forBaxter.decision).toBe("rejected");

    // Different factors answered, and each result names its own.
    expect(forNorthline.providerName).toBe("OTR Solutions");
    expect(forBaxter.providerName).toBe("RTS Financial");

    // Neither carrier's result carries anything about the other's.
    expect(forNorthline.check?.carrierOrganizationId).toBe(NORTHLINE);
    expect(forBaxter.check?.carrierOrganizationId).toBe(BAXTER);
    expect(JSON.stringify(forNorthline)).not.toContain("RTS");
    expect(JSON.stringify(forBaxter)).not.toContain("OTR");
  });

  it("gives a carrier no way to read the other's factoring at all", async () => {
    await expect(mockFactoringService.status(northline(), apex(BAXTER)))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(mockFactoringService.connection(baxter(), NORTHLINE))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("2 — a dispatch organization cannot use one carrier's result for another", () => {
  it("reaches only the carriers that granted it dispatch authority", () => {
    expect(factoringReachFor(meridian(), BAXTER)).toBe("dispatch_delegation");
    expect(factoringReachFor(meridian(), NORTHLINE)).toBeNull();
  });

  it("refuses Northline's factoring to Meridian, which dispatches Baxter", async () => {
    await expect(mockFactoringService.status(meridian(), apex(NORTHLINE)))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives a delegate covering both carriers two different answers", async () => {
    const forNorthline = await mockFactoringService.status(summit(), apex(NORTHLINE));
    const forBaxter = await mockFactoringService.status(summit(), apex(BAXTER));

    expect(isFactoringApproved(forNorthline.decision)).toBe(true);
    expect(forBaxter.decision).toBe("rejected");
    // The SAME caller, the SAME broker, on one screen. The carrier decides.
    expect(forNorthline.providerName).not.toBe(forBaxter.providerName);
  });

  it("never lets a delegate administer a carrier's factoring account", async () => {
    await expect(mockFactoringService.setPolicy(summit(), NORTHLINE, { allowOverride: false }))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(mockFactoringService.connect(summit(), {
      carrierOrganizationId: NORTHLINE,
      providerKind: "apex",
      accountLabel: "Taken over",
      mode: "manual",
    })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("3 — the four non-answers never become approvals", () => {
  it("reports not_connected for a carrier with no factor, and never rejected", async () => {
    await mockFactoringService.disconnect(northline(), NORTHLINE);
    const status = await mockFactoringService.status(northline(), apex(NORTHLINE));

    expect(status.decision).toBe("not_connected");
    expect(isFactoringApproved(status.decision)).toBe(false);
    expect(status.decision).not.toBe("rejected");
  });

  it("reports unknown for a broker nobody has asked about", async () => {
    const status = await mockFactoringService.status(northline(), {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: "Someone Nobody Called",
      brokerMcNumber: "MC-999111",
    });
    expect(status.decision).toBe("unknown");
    expect(status.everChecked).toBe(false);
  });

  it("reports provider_unavailable for the reserved API mode, never connected", async () => {
    const connection = await mockFactoringService.connect(baxter(), {
      carrierOrganizationId: BAXTER,
      providerKind: "rts",
      accountLabel: "RTS — API",
      mode: "api",
    });
    // The reserved mode is never presented as connected or functional.
    expect(connection.status).toBe("provider_unavailable");

    const status = await mockFactoringService.status(baxter(), {
      carrierOrganizationId: BAXTER,
      brokerNameObserved: "Brand New Broker",
      brokerMcNumber: "MC-771221",
    });
    expect(status.decision).toBe("provider_unavailable");
    expect(status.liveApi).toBe(true);
    expect(isFactoringApproved(status.decision)).toBe(false);
  });

  it("keeps all four as themselves rather than collapsing them", () => {
    for (const decision of ["unknown", "stale", "not_connected", "provider_unavailable"] as const) {
      expect(isFactoringUnanswered(decision)).toBe(true);
      expect(isFactoringApproved(decision)).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

const APEX_ROW: FactoringImportRowInput = {
  lineNumber: 1,
  debtorName: "Apex Logistics LLC",
  mcNumber: "MC-612884",
  statusText: "Approved",
  creditLimitText: "$25,000",
  availableText: "$18,400",
  expiryDate: new Date(Date.now() + 5 * 24 * HOUR_MS).toISOString(),
};

const NAME_ONLY_ROW: FactoringImportRowInput = {
  lineNumber: 2,
  // Deliberately the name of a company the fixtures DO hold, with no MC.
  debtorName: "Apex Logistics",
  statusText: "Declined",
};

const UNKNOWN_MC_ROW: FactoringImportRowInput = {
  lineNumber: 3,
  debtorName: "Somebody Else Freight",
  mcNumber: "MC-4455667",
  statusText: "Approved",
  creditLimitText: "$9,000",
};

describe("4 — a re-import creates no duplicate decisions and no broker profiles", () => {
  it("resumes the same batch and writes each row once", async () => {
    const ctx = northline();
    const rows = [APEX_ROW, NAME_ONLY_ROW, UNKNOWN_MC_ROW];

    const first = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "otr-debtors.csv", rows,
    });
    expect(first.resumed).toBe(false);
    expect(first.summary.ready).toBe(1);

    const run = await mockFactoringService.commitImport(ctx, first.batch.batchId);
    expect(run.committed).toBe(1);

    const directoryBefore = await listDirectory(partyCtx(ctx));

    // The SAME file again.
    const second = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "otr-debtors.csv", rows,
    });
    expect(second.resumed).toBe(true);
    expect(second.batch.batchId).toBe(first.batch.batchId);

    const rerun = await mockFactoringService.commitImport(ctx, second.batch.batchId);
    expect(rerun.committed).toBe(0);

    // One answer in force, not two.
    const history = await mockFactoringService.history(ctx, apex(NORTHLINE));
    const live = history.filter((c) => !c.supersededByCheckId);
    expect(live).toHaveLength(1);

    // And no broker was minted from the file.
    const directoryAfter = await listDirectory(partyCtx(ctx));
    expect(directoryAfter.length).toBe(directoryBefore.length);
  });

  // 14 — a commit interrupted half-way is finished by running it again.
  it("is resumable after a failure part-way through", async () => {
    const ctx = northline();
    const rows = [APEX_ROW, UNKNOWN_MC_ROW];
    const preview = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "partial.csv", rows,
    });
    const run = await mockFactoringService.commitImport(ctx, preview.batch.batchId);
    expect(run.committed).toBe(1);
    expect(run.skipped).toBe(1);
    expect(run.batch.state).toBe("partially_committed");

    // Somebody adds the missing broker's MC to the export and runs it again:
    // the row that already went through produces nothing a second time.
    const again = await mockFactoringService.commitImport(ctx, preview.batch.batchId);
    expect(again.committed).toBe(0);
    expect(again.batch.committedRowCount).toBe(1);
  });
});

describe("5 — a corrected later import supersedes rather than overwrites", () => {
  it("keeps the earlier answer and points the two at each other", async () => {
    const ctx = northline();

    const first = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "monday.csv", rows: [APEX_ROW],
    });
    const firstRun = await mockFactoringService.commitImport(ctx, first.batch.batchId);
    const firstCheck = firstRun.checks[0];
    expect(firstCheck.decision).toBe("approved_imported");

    const corrected: FactoringImportRowInput = {
      ...APEX_ROW, statusText: "Declined", creditLimitText: undefined,
      reason: "Debtor went past due on Wednesday.",
    };
    const second = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "thursday.csv", rows: [corrected],
    });
    expect(second.batch.batchId).not.toBe(first.batch.batchId);
    expect(second.summary.supersedes).toBe(1);

    const secondRun = await mockFactoringService.commitImport(ctx, second.batch.batchId);
    const secondCheck = secondRun.checks[0];

    const history = await mockFactoringService.history(ctx, apex(NORTHLINE));
    const kept = history.find((c) => c.checkId === firstCheck.checkId);

    expect(kept).toBeDefined();
    expect(kept!.decision).toBe("approved_imported");
    expect(kept!.supersededByCheckId).toBe(secondCheck.checkId);
    expect(secondCheck.supersedesCheckId).toBe(firstCheck.checkId);

    // The answer in force is the corrected one.
    const status = await mockFactoringService.status(ctx, apex(NORTHLINE));
    expect(status.decision).toBe("rejected");
    expect(status.reason).toBe("Debtor went past due on Wednesday.");
  });
});

describe("6 — a name-only row never attaches to a broker", () => {
  it("leaves the row for review and changes nothing about the company it names", async () => {
    const ctx = northline();
    const before = await mockFactoringService.status(ctx, apex(NORTHLINE));

    const preview = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "names.csv", rows: [NAME_ONLY_ROW],
    });
    const row = preview.rows[0];
    expect(row.state).toBe("name_only");
    expect(row.brokerPartyId).toBeUndefined();
    expect(row.reviewReason).toMatch(/no MC number/i);

    const run = await mockFactoringService.commitImport(ctx, preview.batch.batchId);
    expect(run.committed).toBe(0);

    // Apex — whose name that row carried — is untouched and still approved.
    const after = await mockFactoringService.status(ctx, apex(NORTHLINE));
    expect(after.decision).toBe(before.decision);
    expect(after.check?.checkId).toBe(before.check?.checkId);
  });

  it("stops a row whose name disagrees with the MC's profile", async () => {
    const ctx = northline();
    const preview = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE,
      label: "mismatch.csv",
      rows: [{
        lineNumber: 1,
        debtorName: "Harbor Point Freight",
        mcNumber: APEX_MC,
        statusText: "Declined",
      }],
    });
    expect(preview.rows[0].state).toBe("conflicted");
    const run = await mockFactoringService.commitImport(ctx, preview.batch.batchId);
    expect(run.committed).toBe(0);
  });
});

describe("7 — a credit limit is never invented", () => {
  it("leaves the limit absent when the file's column is empty", async () => {
    const ctx = northline();
    const preview = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE,
      label: "no-limits.csv",
      rows: [{ ...APEX_ROW, creditLimitText: "", availableText: "N/A" }],
    });
    const run = await mockFactoringService.commitImport(ctx, preview.batch.batchId);

    expect(run.checks[0].creditLimitCents).toBeUndefined();
    expect(run.checks[0].availableAmountCents).toBeUndefined();

    const status = await mockFactoringService.status(ctx, apex(NORTHLINE));
    expect(status.creditLimitCents).toBeUndefined();
    // Absent, not zero. A rendered "$0" would be a statement nobody made.
    expect(status.creditLimitCents).not.toBe(0);
    expect(status.detail).toContain("No credit limit was given");
  });

  it("leaves the limit absent on a rejection recorded by hand", async () => {
    const check = await mockFactoringService.recordResult(baxter(), {
      carrierOrganizationId: BAXTER,
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      decision: "rejected",
      source: "phone_confirmation",
    });
    expect(check.creditLimitCents).toBeUndefined();
    expect(check.reason).toBeUndefined();
  });
});

describe("8 — expiry turns approved into stale at read time", () => {
  it("needs no scheduler: the same stored row reads differently as it lapses", async () => {
    const ctx = northline();
    const recorded = await mockFactoringService.recordResult(ctx, {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      decision: "approved_manual",
      source: "manual_portal_check",
      providerReference: "OTR-77120",
      checkedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
      expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
    });

    const fresh = await mockFactoringService.status(ctx, apex(NORTHLINE));
    expect(fresh.decision).toBe("approved_manual");
    expect(fresh.stale).toBe(false);

    // Nothing runs. Nothing is written. The clock simply moves.
    const later = { ...apex(NORTHLINE) };
    const lapsed = await mockFactoringService.status(ctx, later);
    expect(lapsed.decision).toBe("approved_manual");

    // Read as of a moment after the expiry, exactly as a screen would an hour later.
    const afterExpiry = readAt(
      ctx, NORTHLINE, new Date(Date.parse(recorded.expiresAt!) + 60_000).toISOString(),
    );
    expect(afterExpiry.decision).toBe("stale");
    // The recorded answer is kept, so the screen can still say what was approved.
    expect(afterExpiry.recordedDecision).toBe("approved_manual");
    expect(afterExpiry.recheckRequired).toBe(true);
    expect(afterExpiry.decision).not.toBe("rejected");

    // And the STORED row never changed.
    const history = await mockFactoringService.history(ctx, apex(NORTHLINE));
    expect(history[0].decision).toBe("approved_manual");
  });
});

describe("9 — booking is blocked by a rejection when policy requires it", () => {
  /*
   * The gate is OFF by default — see `DEFAULT_FACTORING_POLICY` for why — so
   * every test in here turns it on first, the same way a carrier would.
   */
  beforeEach(async () => {
    await mockFactoringService.setPolicy(baxter(), BAXTER, { requireApprovalToBook: true });
  });

  it("blocks, and says which factor refused and why", async () => {
    const gate = await mockFactoringService.evaluateBooking(baxter(), apex(BAXTER, {
      dispatchCycleId: "cyc_test_1",
      proposedAmountCents: 240_000,
    }));

    expect(gate.status.decision).toBe("rejected");
    expect(gate.allowed).toBe(false);
    expect(gate.block?.kind).toBe("rejected");
    expect(gate.block?.detail).toContain("RTS Financial");
    expect(gate.policyRequiresApproval).toBe(true);
  });

  it("does not block when the carrier's policy does not require an approval", async () => {
    await mockFactoringService.setPolicy(baxter(), BAXTER, { requireApprovalToBook: false });
    const gate = await mockFactoringService.evaluateBooking(baxter(), apex(BAXTER, {
      dispatchCycleId: "cyc_test_2",
    }));
    expect(gate.allowed).toBe(true);
    // The answer is still shown. It just stops nothing.
    expect(gate.status.decision).toBe("rejected");
  });

  it("is honest that no live recheck happened in a manual-mode carrier", async () => {
    const gate = await mockFactoringService.evaluateBooking(baxter(), apex(BAXTER, {
      dispatchCycleId: "cyc_test_3",
    }));
    expect(gate.recheckedLive).toBe(false);
    expect(gate.recheckNote).toMatch(/No live recheck happened/i);
  });
});

describe("10 — an override needs a reason and writes one immutable audit event", () => {
  beforeEach(async () => {
    await mockFactoringService.setPolicy(baxter(), BAXTER, { requireApprovalToBook: true });
  });

  it("records exactly one event, carrying the reason", async () => {
    const ctx = baxter();
    const before = auditLedger.all(BAXTER).length;

    const override = await mockFactoringService.override(ctx, {
      carrierOrganizationId: BAXTER,
      dispatchCycleId: "cyc_override_1",
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      reason: "Broker is paying this one direct, factor is not involved.",
    });

    const after = auditLedger.all(BAXTER);
    expect(after.length).toBe(before + 1);

    const event = after.find((e) => e.id === override.auditEventId);
    expect(event).toBeDefined();
    expect(event!.action).toBe("factoring.override_recorded");
    expect(event!.summary).toContain("Broker is paying this one direct");
    expect(override.overriddenDecision).toBe("rejected");

    // Frozen, and the ledger has no method that could edit it.
    expect(Object.isFrozen(event)).toBe(true);
    expect(() => {
      (override as { reason: string }).reason = "changed";
    }).toThrow();

    // And the gate now lets the booking through, on the record.
    const gate = await mockFactoringService.evaluateBooking(ctx, apex(BAXTER, {
      dispatchCycleId: "cyc_override_1",
    }));
    expect(gate.allowed).toBe(true);
    expect(gate.override?.overrideId).toBe(override.overrideId);
  });

  it("refuses an empty reason and writes nothing at all", async () => {
    const ctx = baxter();
    const before = auditLedger.all(BAXTER).length;

    await expect(mockFactoringService.override(ctx, {
      carrierOrganizationId: BAXTER,
      dispatchCycleId: "cyc_override_2",
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      reason: "   ",
    })).rejects.toBeInstanceOf(FactoringReasonRequiredError);

    expect(auditLedger.all(BAXTER).length).toBe(before);
  });

  it("refuses when the carrier's policy does not permit an override", async () => {
    await mockFactoringService.setPolicy(baxter(), BAXTER, { allowOverride: false });
    // The audit ledger gained a policy-change event; the override must still
    // add nothing at all.
    await expect(mockFactoringService.override(baxter(), {
      carrierOrganizationId: BAXTER,
      dispatchCycleId: "cyc_override_3",
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      reason: "A real reason that will not save it.",
    })).rejects.toBeInstanceOf(FactoringOverrideNotPermittedError);
  });
});

describe("11 — an unauthorized user cannot connect, import, check or override", () => {
  it("refuses each act on the permission it actually needs", async () => {
    await expect(mockFactoringService.connect(
      northline({ without: ["factoring:manage"] }),
      { carrierOrganizationId: NORTHLINE, providerKind: "apex", accountLabel: "x", mode: "manual" },
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(mockFactoringService.previewImport(
      northline({ without: ["factoring:manage"] }),
      { carrierOrganizationId: NORTHLINE, label: "x.csv", rows: [APEX_ROW] },
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(mockFactoringService.setPolicy(
      northline({ without: ["factoring:manage"] }), NORTHLINE, { freshnessHours: 1 },
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(mockFactoringService.check(
      northline({ without: ["factoring:check"] }), apex(NORTHLINE),
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(mockFactoringService.recordResult(
      northline({ without: ["factoring:check"] }),
      {
        carrierOrganizationId: NORTHLINE, brokerNameObserved: APEX_NAME,
        brokerMcNumber: APEX_MC, decision: "approved_manual", source: "manual_portal_check",
      },
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(mockFactoringService.override(
      northline({ without: ["factoring:override"] }),
      {
        carrierOrganizationId: NORTHLINE, brokerNameObserved: APEX_NAME,
        brokerMcNumber: APEX_MC, reason: "Because I said so.",
      },
    )).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a read to somebody without factoring:view", async () => {
    await expect(mockFactoringService.status(
      northline({ without: ["factoring:view"] }), apex(NORTHLINE),
    )).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("gives a dispatcher the everyday keys and not the carrier's own", () => {
    const dispatcher = meridian();
    expect(dispatcher.permissions.has("factoring:view")).toBe(true);
    expect(dispatcher.permissions.has("factoring:check")).toBe(true);
    expect(dispatcher.permissions.has("factoring:manage")).toBe(false);
    expect(dispatcher.permissions.has("factoring:override")).toBe(false);
  });
});

describe("12 — carrier-private factoring never reaches the global broker profile", () => {
  it("keeps every factoring word out of the directory payload", async () => {
    const ctx = northline();
    await mockFactoringService.recordResult(ctx, {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC,
      decision: "approved_manual",
      source: "manual_portal_check",
      creditLimitCents: 4_200_000,
      reason: "Confidential: OTR line is four two.",
      providerReference: "OTR-CONF-1",
    });

    const directory = await listDirectory(partyCtx(ctx));
    const payload = JSON.stringify(directory);

    expect(payload).not.toContain("OTR");
    expect(payload).not.toContain("Confidential");
    expect(payload).not.toContain("4200000");
    expect(payload).not.toMatch(/factoring/i);

    // The company itself is still there, with its public identity facts.
    const party = directory.find((row) => row.mcNumber === "612884");
    expect(party).toBeDefined();
  });
});

describe("13 — the search filter is scoped to the selected carrier", () => {
  it("reads one carrier at a time, and a status call cannot return two", async () => {
    const both = await mockFactoringService.statuses(summit(), [
      apex(NORTHLINE), apex(BAXTER),
    ]);
    expect(both).toHaveLength(2);
    expect(both[0].carrierOrganizationId).toBe(NORTHLINE);
    expect(both[1].carrierOrganizationId).toBe(BAXTER);
    expect(both[0].decision).not.toBe(both[1].decision);

    // And a carrier the caller has no authority over throws rather than
    // silently contributing a row.
    await expect(mockFactoringService.statuses(meridian(), [apex(NORTHLINE)]))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("files each answer under the filter a dispatcher would expect", async () => {
    const approved = await mockFactoringService.status(northline(), apex(NORTHLINE));
    const rejected = await mockFactoringService.status(baxter(), apex(BAXTER));
    const never = await mockFactoringService.status(northline(), {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: "Nobody Has Asked Freight",
      brokerMcNumber: "MC-888222",
    });

    expect(matchesFactoringFilter(approved, "approved")).toBe(true);
    expect(matchesFactoringFilter(approved, "rejected")).toBe(false);
    expect(matchesFactoringFilter(rejected, "rejected")).toBe(true);

    // Never asked is "Not checked", and is NOT swept into Pending/Unknown.
    expect(matchesFactoringFilter(never, "not_checked")).toBe(true);
    expect(matchesFactoringFilter(never, "pending_unknown")).toBe(false);
    expect(matchesFactoringFilter(never, "approved")).toBe(false);

    // A row with no factoring view at all is never counted as approved.
    expect(matchesFactoringFilter(undefined, "approved")).toBe(false);
    expect(matchesFactoringFilter(undefined, "not_checked")).toBe(true);
    expect(matchesFactoringFilter(undefined, "all")).toBe(true);
  });
});

describe("15 — no credential is anywhere in the domain model", () => {
  it("finds no forbidden field name in any serialized factoring record", async () => {
    const ctx = northline();
    await mockFactoringService.connect(ctx, {
      carrierOrganizationId: NORTHLINE,
      providerKind: "otr",
      accountLabel: "OTR — main",
      accountReference: "NL-4471",
      mode: "mock_adapter",
      fallback: { creditCheckEmail: "creditchecks@otr.example", portalUrl: "https://portal.otr.example" },
    });
    const preview = await mockFactoringService.previewImport(ctx, {
      carrierOrganizationId: NORTHLINE, label: "otr.csv", rows: [APEX_ROW],
    });
    await mockFactoringService.commitImport(ctx, preview.batch.batchId);
    await mockFactoringService.recordResult(ctx, {
      carrierOrganizationId: NORTHLINE, brokerNameObserved: APEX_NAME,
      brokerMcNumber: APEX_MC, decision: "approved_manual", source: "recorded_email",
      evidence: { kind: "email_message", reference: "msg-1" },
    });

    const everything = [
      await mockFactoringService.connection(ctx, NORTHLINE),
      await mockFactoringService.policy(ctx, NORTHLINE),
      await mockFactoringService.history(ctx, apex(NORTHLINE)),
      await mockFactoringService.importBatches(ctx, NORTHLINE),
      await mockFactoringService.importRows(ctx, preview.batch.batchId),
      await mockFactoringService.fallbackPrefill(ctx, apex(NORTHLINE)),
      await mockFactoringService.evaluateBooking(ctx, apex(NORTHLINE)),
    ];

    for (const key of collectKeys(everything)) {
      for (const forbidden of FACTORING_FORBIDDEN_FIELDS) {
        expect(
          key.toLowerCase().includes(forbidden),
          `"${key}" looks like a credential field`,
        ).toBe(false);
      }
    }
  });

  it("stores nothing a browser could replay as a provider login", () => {
    const connection = connectionForSync(NORTHLINE)!;
    const keys = Object.keys(connection).concat(Object.keys(connection.fallback));
    // The account reference is a client number off a statement, which is an
    // identifier. There is no field here that authenticates anybody.
    expect(keys).toContain("accountReference");
    expect(keys.some((k) => /password|token|secret/i.test(k))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function partyCtx(ctx: ReturnType<typeof northline>) {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    userId: ctx.actor.userId,
    permissions: ctx.permissions,
  };
}

/** A read as of a chosen instant, which is what a screen does an hour later. */
function readAt(
  ctx: ReturnType<typeof northline>,
  carrierOrganizationId: string,
  now: string,
) {
  return factoringStatusSync(ctx, {
    carrierOrganizationId,
    brokerNameObserved: APEX_NAME,
    brokerMcNumber: APEX_MC,
    now,
  });
}

/** Every key name in a nested structure, for the credential sweep. */
function collectKeys(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v) => collectKeys(v, seen));
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => [key, ...collectKeys(child, seen)],
  );
}

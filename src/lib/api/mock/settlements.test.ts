import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { availablePermissionKeys } from "@/lib/permissions/catalog";
import { DEFAULT_SCOPE, OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import {
  NotFoundError,
  OrganizationScopeError,
  PermissionDeniedError,
  type ServiceContext,
} from "../contracts/context";
import { settlementStore } from "./settlement-registry";
import {
  mockSettlementsService as service,
  SeparationOfDutiesError,
  SettlementImmutableError,
  SettlementNotReadyError,
} from "./settlements";

/* -------------------------------------------------------------------------- */
/* Contexts                                                                    */
/* -------------------------------------------------------------------------- */

function ctxFor(
  organizationId: string,
  membershipId: string,
  permissions: PermissionKey[],
  over: Partial<ServiceContext> = {},
): ServiceContext {
  return {
    organizationId,
    membershipId,
    permissions: new Set(permissions),
    scope: DEFAULT_SCOPE,
    actor: {
      userId: "usr_sam",
      membershipId,
      displayNameSnapshot: "Sam Murtaza",
      source: "web",
    },
    ...over,
  };
}

/** Northline's owner: every permission the organization type offers. */
const northlineOwner = () =>
  ctxFor("org_northline", "mem_northline_owner", availablePermissionKeys("CARRIER"));

/** Baxter's owner — a different carrier entirely. */
const baxterOwner = () =>
  ctxFor("org_baxter", "mem_baxter_owner", availablePermissionKeys("CARRIER"));

/** Cascade, where the signed-in user is a driver scoped to their own money. */
const cascadeDriver = () =>
  ctxFor("org_cascade", "mem_cascade_driver", ["settlements:view", "settlements:dispute", "loads:view"], {
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_cascade_0192",
  });

/** Cascade's office, for the carrier side of the same data. */
const cascadeOffice = () =>
  ctxFor("org_cascade", "mem_cascade_office", availablePermissionKeys("CARRIER"));

/** A Meridian dispatcher with no settlement access at all. */
const noAccess = () => ctxFor("org_meridian", "mem_meridian_dispatcher", ["loads:view"]);

beforeEach(() => {
  settlementStore.reset();
});

async function findByNumber(ctx: ServiceContext, number: string) {
  const page = await service.list(ctx, { search: number });
  const row = page.items.find((s) => s.number === number);
  if (!row) throw new Error(`No settlement numbered ${number} visible to ${ctx.membershipId}`);
  return row;
}

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

describe("permissions", () => {
  it("refuses a caller without settlements:view", async () => {
    await expect(service.list(noAccess())).rejects.toThrow(PermissionDeniedError);
    await expect(service.attention(noAccess())).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses to approve without settlements:approve", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    const weak = ctxFor("org_northline", "mem_clerk", ["settlements:view"]);
    await expect(service.approve(weak, row.id)).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses to record a payment without settlements:pay", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1036");
    const weak = ctxFor("org_northline", "mem_clerk", ["settlements:view", "settlements:approve"]);
    await expect(
      service.recordPayment(weak, row.id, {
        amountCents: 100,
        method: "ach",
        paidAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Carrier isolation                                                           */
/* -------------------------------------------------------------------------- */

describe("carrier isolation", () => {
  it("shows each carrier only its own settlements", async () => {
    const northline = await service.list(northlineOwner());
    const baxter = await service.list(baxterOwner());

    expect(northline.items.length).toBeGreaterThan(0);
    expect(baxter.items.length).toBeGreaterThan(0);
    for (const row of northline.items) expect(row.carrierOrganizationId).toBe("org_northline");
    for (const row of baxter.items) expect(row.carrierOrganizationId).toBe("org_baxter");

    const overlap = northline.items.filter((n) => baxter.items.some((b) => b.id === n.id));
    expect(overlap).toHaveLength(0);
  });

  it("reports another carrier's settlement as NOT FOUND, never as forbidden", async () => {
    // A 403 would confirm the record exists, which is itself the leak.
    const row = await findByNumber(northlineOwner(), "NL-STL-1042");
    await expect(service.get(baxterOwner(), row.id)).rejects.toThrow(NotFoundError);
  });

  it("refuses to mutate another carrier's settlement", async () => {
    const row = await findByNumber(northlineOwner(), "NL-STL-1042");
    await expect(service.approve(baxterOwner(), row.id)).rejects.toThrow(NotFoundError);
    await expect(
      service.void(baxterOwner(), row.id, { reason: "not mine" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("raises a scope error for an organization with no settlement partition", async () => {
    const stranger = ctxFor("org_unknown", "mem_x", ["settlements:view"]);
    await expect(service.list(stranger)).rejects.toThrow(OrganizationScopeError);
  });
});

/* -------------------------------------------------------------------------- */
/* Payee privacy                                                               */
/* -------------------------------------------------------------------------- */

describe("payee privacy", () => {
  it("shows a payee their own settlements and nobody else's", async () => {
    const driver = await service.list(cascadeDriver());
    expect(driver.items.length).toBeGreaterThan(0);
    for (const row of driver.items) {
      expect(row.payee.driverProfileId).toBe("drv_cascade_0192");
    }
    expect(driver.items.some((r) => r.payee.displayNameSnapshot === "Owen Fitz")).toBe(false);
  });

  it("hides another payee's settlement behind NOT FOUND", async () => {
    const owen = await findByNumber(cascadeOffice(), "CS-STL-0440");
    await expect(service.get(cascadeDriver(), owen.id)).rejects.toThrow(NotFoundError);
    await expect(service.breakdown(cascadeDriver(), owen.id)).rejects.toThrow(NotFoundError);
    await expect(service.audit(cascadeDriver(), owen.id)).rejects.toThrow(NotFoundError);
    await expect(service.statements(cascadeDriver(), owen.id)).rejects.toThrow(NotFoundError);
  });

  it("gives a payee their own settlement in full, not redacted", async () => {
    const mine = await findByNumber(cascadeDriver(), "CS-STL-0442");
    const view = await service.get(cascadeDriver(), mine.id);
    expect(view.privacy).toBe("payee_self");
    expect(view.settlement.loadLines.length).toBeGreaterThan(0);
    expect(view.settlement.snapshot.steps.length).toBeGreaterThan(0);
    expect(view.settlement.totals.netPayCents).toBeGreaterThan(0);
  });

  it("gives a payee no carrier-wide roll-up", async () => {
    expect(await service.listTotals(cascadeDriver())).toBeNull();
    expect(await service.listTotals(cascadeOffice())).not.toBeNull();
  });

  it("offers a payee only the payees they are, in the filter list", async () => {
    const payees = await service.payees(cascadeDriver());
    expect(payees).toHaveLength(1);
    expect(payees[0].driverProfileId).toBe("drv_cascade_0192");
  });

  it("refuses to let a payee administer settlements at all", async () => {
    const mine = await findByNumber(cascadeDriver(), "CS-STL-0442");
    // Even handed permissions they should never hold, the privacy check stops them.
    const overreaching = ctxFor(
      "org_cascade",
      "mem_cascade_driver",
      ["settlements:view", "settlements:approve", "settlements:pay", "settlements:create"],
      { scope: OWN_RECORDS_SCOPE, driverProfileId: "drv_cascade_0192" },
    );
    await expect(service.approve(overreaching, mine.id)).rejects.toThrow(PermissionDeniedError);
    await expect(service.recalculate(overreaching, mine.id)).rejects.toThrow(PermissionDeniedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Separation of duties                                                        */
/* -------------------------------------------------------------------------- */

describe("separation of duties", () => {
  it("stops a carrier-side caller approving a settlement they are the payee of", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    // The owner, acting as the payee of this settlement.
    const asPayee = ctxFor("org_northline", "mem_northline_owner", availablePermissionKeys("CARRIER"), {
      driverProfileId: "drv_nl_04",
    });
    await expect(service.approve(asPayee, row.id)).rejects.toThrow(SeparationOfDutiesError);
  });

  it("reports the same restriction in the capabilities the screen renders from", async () => {
    const asPayee = ctxFor("org_northline", "mem_northline_owner", availablePermissionKeys("CARRIER"), {
      driverProfileId: "drv_nl_04",
    });
    const row = await findByNumber(asPayee, "NL-STL-1042");
    const view = await service.get(asPayee, row.id);
    expect(view.capabilities.canApprove).toBe(false);
    expect(view.capabilities.canVoid).toBe(false);
    expect(view.capabilities.canRecordPayment).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Immutability                                                                */
/* -------------------------------------------------------------------------- */

describe("an approved or paid settlement is never silently edited", () => {
  it("refuses to recalculate an approved settlement", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1039");
    await expect(service.recalculate(ctx, row.id)).rejects.toThrow(SettlementImmutableError);
  });

  it("refuses to recalculate a paid settlement", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1030");
    await expect(service.recalculate(ctx, row.id)).rejects.toThrow(SettlementImmutableError);
  });

  it("freezes the calculation snapshot on approval", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    const before = await service.get(ctx, row.id);
    expect(before.settlement.snapshot.frozen).toBe(false);

    const after = await service.approve(ctx, row.id, { note: "Checked against the invoices." });
    expect(after.settlement.status).toBe("approved");
    expect(after.settlement.snapshot.frozen).toBe(true);
    expect(after.settlement.snapshot.frozenAt).toBeTruthy();
    expect(after.settlement.approvals[0].snapshotRevision).toBe(after.settlement.snapshot.revision);
  });

  it("keeps the frozen figures identical after approval", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    const before = await service.get(ctx, row.id);
    const netBefore = before.settlement.totals.netPayCents;
    const stepsBefore = before.settlement.snapshot.steps;

    const after = await service.approve(ctx, row.id);
    expect(after.settlement.totals.netPayCents).toBe(netBefore);
    expect(after.settlement.snapshot.steps).toEqual(stepsBefore);
  });

  it("refuses to approve while a blocking gap remains", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1041");
    expect(row.blockingGapCount).toBeGreaterThan(0);
    await service.submitForReview(ctx, row.id);
    await expect(service.approve(ctx, row.id)).rejects.toThrow(SettlementNotReadyError);
  });

  it("corrects a paid settlement with a NEW record, leaving the original alone", async () => {
    const ctx = northlineOwner();
    const original = await findByNumber(ctx, "NL-STL-1030");
    const beforeNet = original.netPayCents;

    const correction = await service.createAdjustment(ctx, original.id, {
      reason: "Detention on NL-24710 was never paid.",
      lines: [
        {
          kind: "adjustment",
          direction: "addition",
          label: "Detention, NL-24710",
          amountCents: 6_800,
        },
      ],
    });

    // A new record, with its own UUID.
    expect(correction.settlement.id).not.toBe(original.id);
    expect(correction.settlement.kind).toBe("adjustment");
    expect(correction.settlement.correctsSettlementId).toBe(original.id);
    expect(correction.settlement.totals.netPayCents).toBe(6_800);

    // The original is untouched apart from the link and the audit entry.
    const after = await service.get(ctx, original.id);
    expect(after.settlement.status).toBe("paid");
    expect(after.settlement.totals.netPayCents).toBe(beforeNet);
    expect(after.settlement.adjustmentSettlementIds).toContain(correction.settlement.id);
    expect(after.settlement.audit.some((a) => a.action === "adjustment_settlement_created")).toBe(true);
  });

  it("refuses to raise a correction against a settlement that is still editable", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1041");
    await expect(
      service.createAdjustment(ctx, row.id, {
        reason: "too early",
        lines: [{ kind: "adjustment", direction: "addition", label: "x", amountCents: 1 }],
      }),
    ).rejects.toThrow(SettlementNotReadyError);
  });

  it("never voids a settlement that has already been paid", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1030");
    await expect(service.void(ctx, row.id, { reason: "changed my mind" })).rejects.toThrow();
  });

  it("keeps a voided settlement visible, with its reason", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1044");
    const view = await service.get(ctx, row.id);
    expect(view.settlement.status).toBe("voided");
    expect(view.settlement.voidReason).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

describe("audit trail", () => {
  it("is append-only across a full lifecycle", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");

    const start = (await service.audit(ctx, row.id)).slice().reverse();
    await service.approve(ctx, row.id);
    await service.markReadyForPayment(ctx, row.id);
    const end = (await service.audit(ctx, row.id)).slice().reverse();

    // Every entry that existed before still exists, unchanged and in order.
    expect(end.length).toBeGreaterThan(start.length);
    expect(end.slice(0, start.length)).toEqual(start);
    expect(end.some((e) => e.action === "approved")).toBe(true);
    expect(end.some((e) => e.action === "snapshot_frozen")).toBe(true);
    expect(end.some((e) => e.action === "marked_ready_for_payment")).toBe(true);
  });

  it("never carries an entry dated in the future", async () => {
    const ctx = northlineOwner();
    const now = Date.now();
    const page = await service.list(ctx, {}, undefined, { limit: 100 });
    for (const row of page.items) {
      for (const entry of await service.audit(ctx, row.id)) {
        expect(new Date(entry.at).getTime()).toBeLessThanOrEqual(now + 1_000);
      }
    }
  });

  it("reads in order, oldest first", async () => {
    const ctx = northlineOwner();
    const page = await service.list(ctx, {}, undefined, { limit: 100 });
    for (const row of page.items) {
      // `audit` returns newest first, so reversing gives the true sequence.
      const times = (await service.audit(ctx, row.id))
        .slice()
        .reverse()
        .map((e) => new Date(e.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it("records who did what, from the caller's own actor", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    await service.approve(ctx, row.id);
    const entries = await service.audit(ctx, row.id);
    const approval = entries.find((e) => e.action === "approved")!;
    expect(approval.actor.membershipId).toBe("mem_northline_owner");
    expect(approval.fromStatus).toBe("needs_review");
    expect(approval.toStatus).toBe("approved");
  });
});

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

describe("recording payments", () => {
  it("moves a settlement to partially paid, then paid", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1036");
    const net = row.netPayCents;

    const part = await service.recordPayment(ctx, row.id, {
      amountCents: Math.floor(net / 2),
      method: "ach",
      referenceNumber: "ACH-1",
      paidAt: new Date().toISOString(),
    });
    expect(part.settlement.status).toBe("partially_paid");
    expect(part.settlement.amountOutstandingCents).toBe(net - Math.floor(net / 2));

    const full = await service.recordPayment(ctx, row.id, {
      amountCents: part.settlement.amountOutstandingCents,
      method: "ach",
      referenceNumber: "ACH-2",
      paidAt: new Date().toISOString(),
    });
    expect(full.settlement.status).toBe("paid");
    expect(full.settlement.amountOutstandingCents).toBe(0);
  });

  it("refuses to record more than is outstanding", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1036");
    await expect(
      service.recordPayment(ctx, row.id, {
        amountCents: row.netPayCents + 1,
        method: "ach",
        paidAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(SettlementNotReadyError);
  });

  it("refuses to record a payment against a settlement that is not queued", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1039");
    expect(row.status).toBe("approved");
    await expect(
      service.recordPayment(ctx, row.id, {
        amountCents: 100,
        method: "ach",
        paidAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(SettlementNotReadyError);
  });

  it("stores no account details on a recorded payment", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1036");
    const view = await service.recordPayment(ctx, row.id, {
      amountCents: 500,
      method: "check",
      referenceNumber: "CHK-9001",
      paidAt: new Date().toISOString(),
    });
    const payment = view.settlement.payments[view.settlement.payments.length - 1];
    expect(Object.keys(payment).sort()).toEqual(
      ["amountCents", "id", "method", "note", "paidAt", "recordedAt", "recordedBy", "referenceNumber", "settlementId"].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Disputes                                                                    */
/* -------------------------------------------------------------------------- */

describe("disputes", () => {
  it("lets a payee dispute their own settled statement", async () => {
    const driver = cascadeDriver();
    const row = await findByNumber(driver, "CS-STL-0441");
    const view = await service.raiseDispute(driver, row.id, {
      reason: "incorrect_miles",
      summary: "The Boise run was 501 miles, not 430.",
      claimedAmountCents: 3_800,
    });
    expect(view.settlement.status).toBe("disputed");
    expect(view.settlement.disputes[0].statusBeforeDispute).toBe("paid");
  });

  it("refuses to dispute a settlement that has not been signed off", async () => {
    const driver = cascadeDriver();
    const row = await findByNumber(driver, "CS-STL-0442");
    expect(row.status).toBe("needs_review");
    await expect(
      service.raiseDispute(driver, row.id, { reason: "other", summary: "too early" }),
    ).rejects.toThrow(SettlementNotReadyError);
  });

  it("returns an upheld dispute to exactly the status it interrupted", async () => {
    const driver = cascadeDriver();
    const office = cascadeOffice();
    const row = await findByNumber(driver, "CS-STL-0441");
    await service.raiseDispute(driver, row.id, {
      reason: "incorrect_miles",
      summary: "Mileage looks short.",
    });

    const disputed = await service.get(office, row.id);
    const resolved = await service.resolveDispute(office, row.id, disputed.settlement.disputes[0].id, {
      resolution: "upheld",
      note: "Checked the ELD trace; the mileage is right.",
    });

    // A paid settlement goes back to paid, not into review.
    expect(resolved.settlement.status).toBe("paid");
    expect(resolved.settlement.disputes[0].status).toBe("resolved");
  });

  it("resolves an accepted dispute by raising a correction, not by editing", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1038");
    const before = await service.get(ctx, row.id);
    const netBefore = before.settlement.totals.netPayCents;
    const disputeId = before.settlement.disputes[0].id;

    const resolved = await service.resolveDispute(ctx, row.id, disputeId, {
      resolution: "adjusted",
      note: "Photos show the damage predates the pickup. Refunding the deduction.",
      adjustment: {
        reason: "Cargo claim deduction reversed after review.",
        lines: [
          {
            kind: "adjustment",
            direction: "addition",
            label: "Cargo claim deduction reversed",
            amountCents: 25_000,
          },
        ],
      },
    });

    // The disputed settlement keeps its figures; the money moves on a new record.
    expect(resolved.settlement.totals.netPayCents).toBe(netBefore);
    const correctionId = resolved.settlement.disputes[0].adjustmentSettlementId!;
    expect(correctionId).toBeTruthy();
    const correction = await service.get(ctx, correctionId);
    expect(correction.settlement.kind).toBe("adjustment");
    expect(correction.settlement.totals.netPayCents).toBe(25_000);
  });

  it("refuses to accept a dispute without the correction that goes with it", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1038");
    const view = await service.get(ctx, row.id);
    await expect(
      service.resolveDispute(ctx, row.id, view.settlement.disputes[0].id, {
        resolution: "adjusted",
        note: "agreed",
      }),
    ).rejects.toThrow(SettlementNotReadyError);
  });
});

/* -------------------------------------------------------------------------- */
/* Statements                                                                  */
/* -------------------------------------------------------------------------- */

describe("statements", () => {
  it("refuses to produce one before the figures are frozen", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1041");
    await expect(service.generateStatement(ctx, row.id)).rejects.toThrow(SettlementNotReadyError);
  });

  it("ties a statement to the snapshot revision it printed", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1030");
    const statement = await service.generateStatement(ctx, row.id);
    const view = await service.get(ctx, row.id);
    expect(statement.snapshotRevision).toBe(view.settlement.snapshot.revision);
  });

  it("supersedes rather than reprints when regenerated", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1030");
    const first = await service.generateStatement(ctx, row.id);
    const second = await service.generateStatement(ctx, row.id);

    expect(second.number).not.toBe(first.number);
    const all = await service.statements(ctx, row.id);
    const original = all.find((s) => s.id === first.id)!;
    expect(original.supersededByStatementId).toBe(second.id);
  });

  it("lets a payee produce their own statement without export permission", async () => {
    const driver = cascadeDriver();
    const row = await findByNumber(driver, "CS-STL-0441");
    const statement = await service.generateStatement(driver, row.id);
    expect(statement.settlementId).toBe(row.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

describe("attention items", () => {
  it("raises real items for missing data, disputes and overdue payments", async () => {
    const items = await service.attention(northlineOwner());
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("missing_data")).toBe(true);
    expect(kinds.has("open_dispute")).toBe(true);
    expect(kinds.has("overdue_payment")).toBe(true);
  });

  it("orders them worst first", async () => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const items = await service.attention(northlineOwner());
    const ranks = items.map((i) => rank[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("counts days overdue from the due date", async () => {
    const items = await service.attention(northlineOwner());
    const overdue = items.filter((i) => i.kind === "overdue_payment");
    expect(overdue.length).toBeGreaterThan(0);
    for (const item of overdue) {
      expect(item.daysOverdue).toBeGreaterThan(0);
      expect(item.amountCents).toBeGreaterThan(0);
    }
  });

  it("hides items the caller could not act on anyway", async () => {
    // settlements:view only — so no approval or payment items, which need more.
    const viewer = ctxFor("org_northline", "mem_viewer", ["settlements:view"]);
    const items = await service.attention(viewer);
    expect(items.some((i) => i.kind === "awaiting_approval")).toBe(false);
    expect(items.some((i) => i.kind === "overdue_payment")).toBe(false);
    // Missing data only needs settlements:view, so it still appears.
    expect(items.some((i) => i.kind === "missing_data")).toBe(true);
  });

  it("stops producing an item once the underlying problem is gone", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1042");
    expect((await service.attention(ctx)).some((i) => i.settlementId === row.id && i.kind === "awaiting_approval")).toBe(true);

    await service.approve(ctx, row.id);
    expect((await service.attention(ctx)).some((i) => i.settlementId === row.id && i.kind === "awaiting_approval")).toBe(false);
  });

  it("shows a payee only their own attention items", async () => {
    const items = await service.attention(cascadeDriver());
    for (const item of items) {
      expect(item.payee.driverProfileId).toBe("drv_cascade_0192");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Filters and search                                                          */
/* -------------------------------------------------------------------------- */

describe("filters and search", () => {
  it("finds a settlement by its number, payee, period or a load reference", async () => {
    const ctx = northlineOwner();
    expect((await service.list(ctx, { search: "NL-STL-1042" })).items).toHaveLength(1);
    expect((await service.list(ctx, { search: "amir" })).items.length).toBeGreaterThan(0);
    expect((await service.list(ctx, { search: "NL-24812" })).items.length).toBeGreaterThan(0);
  });

  it("filters by status, payee kind and the named views", async () => {
    const ctx = northlineOwner();
    const paid = await service.list(ctx, { status: ["paid"] });
    expect(paid.items.every((s) => s.status === "paid")).toBe(true);

    const orgs = await service.list(ctx, { payeeKind: ["dispatch_organization"] });
    expect(orgs.items.every((s) => s.payee.kind === "dispatch_organization")).toBe(true);

    const overdue = await service.list(ctx, { view: "overdue" });
    expect(overdue.items.length).toBeGreaterThan(0);
    expect(overdue.items.every((s) => s.amountOutstandingCents > 0)).toBe(true);
  });

  it("covers every payee kind in the seeded data", async () => {
    const ctx = northlineOwner();
    const page = await service.list(ctx, {}, undefined, { limit: 100 });
    const kinds = new Set(page.items.map((s) => s.payee.kind));
    for (const kind of [
      "company_driver", "owner_operator", "dispatcher", "dispatch_organization", "other_payee",
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("sorts by net pay in both directions", async () => {
    const ctx = northlineOwner();
    const asc = await service.list(ctx, {}, { field: "netPay", direction: "asc" }, { limit: 100 });
    const nets = asc.items.map((s) => s.netPayCents);
    expect(nets).toEqual([...nets].sort((a, b) => a - b));
  });

  it("pages without losing or repeating a row", async () => {
    const ctx = northlineOwner();
    const all = await service.list(ctx, {}, undefined, { limit: 100 });
    const first = await service.list(ctx, {}, undefined, { limit: 3 });
    expect(first.items).toHaveLength(3);
    const second = await service.list(ctx, {}, undefined, { limit: 3, cursor: first.nextCursor });
    const ids = new Set([...first.items, ...second.items].map((s) => s.id));
    expect(ids.size).toBe(Math.min(6, all.items.length));
  });

  it("returns an empty list, not an error, for a carrier that has settled nothing", async () => {
    const summit = ctxFor("org_summit", "mem_summit_owner", availablePermissionKeys("DISPATCH_AGENCY"));
    const page = await service.list(summit);
    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Seeded data integrity                                                       */
/* -------------------------------------------------------------------------- */

describe("the seeded data itself", () => {
  it("gives every settlement a distinct UUID", async () => {
    const ctx = northlineOwner();
    const page = await service.list(ctx, {}, undefined, { limit: 100 });
    const ids = page.items.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("agrees with the engine on every settlement's net pay", async () => {
    const ctx = northlineOwner();
    const page = await service.list(ctx, {}, undefined, { limit: 100 });
    for (const row of page.items) {
      const view = await service.get(ctx, row.id);
      const { totals, snapshot } = view.settlement;
      expect(totals).toEqual(snapshot.totals);
      expect(totals.netPayCents).toBe(
        totals.grossEarningsCents + totals.totalAdditionsCents - totals.totalSubtractionsCents,
      );
    }
  });

  it("never says paid while money is still outstanding", async () => {
    // A row reading "Paid", "Paid in full" and "still owed $10.08" at once is
    // the exact contradiction this module exists to prevent.
    for (const ctx of [northlineOwner(), cascadeOffice(), baxterOwner()]) {
      const page = await service.list(ctx, {}, undefined, { limit: 100 });
      for (const row of page.items) {
        if (row.status === "paid") {
          expect(row.amountOutstandingCents).toBe(0);
          expect(row.amountPaidCents).toBe(row.netPayCents);
        }
        if (row.amountOutstandingCents > 0) expect(row.status).not.toBe("paid");
      }
    }
  });

  it("gives a voided settlement no payment due date", async () => {
    const ctx = northlineOwner();
    const row = await findByNumber(ctx, "NL-STL-1044");
    expect(row.paymentDueAt).toBeUndefined();
  });

  it("keeps paid and voided settlements out of the overdue view", async () => {
    const ctx = northlineOwner();
    const overdue = await service.list(ctx, { view: "overdue" }, undefined, { limit: 100 });
    for (const row of overdue.items) {
      expect(["approved", "ready_for_payment", "partially_paid"]).toContain(row.status);
    }
  });

  it("prices an older load under the agreement that was in force then", async () => {
    const ctx = northlineOwner();
    const older = await service.get(ctx, (await findByNumber(ctx, "NL-STL-1030")).id);
    const newer = await service.get(ctx, (await findByNumber(ctx, "NL-STL-1042")).id);

    // Same owner-operator, same agreement id, two different versions.
    expect(older.settlement.payee.id).toBe(newer.settlement.payee.id);
    expect(older.settlement.loadLines[0].agreement.agreementVersion).toBe(1);
    expect(newer.settlement.loadLines[0].agreement.agreementVersion).toBe(2);
    expect(older.settlement.loadLines[0].agreement.components[0].percentageBasisPoints).toBe(6_800);
    expect(newer.settlement.loadLines[0].agreement.components[0].percentageBasisPoints).toBe(7_200);
  });

  it("links a settlement to loads the Loads module can actually open", async () => {
    const ctx = northlineOwner();
    const view = await service.get(ctx, (await findByNumber(ctx, "NL-STL-1042")).id);
    // NL-24812 and NL-24805 are current freight, so both resolve.
    expect(view.resolvableLoadIds).toHaveLength(2);
  });

  it("does not claim an archived load is openable", async () => {
    const ctx = northlineOwner();
    const view = await service.get(ctx, (await findByNumber(ctx, "NL-STL-1030")).id);
    expect(view.resolvableLoadIds).toHaveLength(0);
  });
});

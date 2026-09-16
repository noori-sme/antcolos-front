import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Listing, OpportunityMatch, PermissionKey } from "@/types";
import {
  LEARNING_ALLOWED_KEYS, LEARNING_DATA_USE_POLICY,
} from "@/config/learning";
import { integrations } from "@/lib/integrations";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import type { ServiceContext } from "../contracts/context";
import { mockAuditService } from "./audit";
import { mockLoadsService } from "./loads";
import { resetAllMocks } from "./registry";
import {
  allowlisted, anonymize, learningFor, localPoolForTests, networkPoolForTests,
  observeDecision, SHARED_FIELDS, WITHHELD_FIELDS,
} from "./ranking";

/**
 * ★ NOBODY OPTS IN, SO THE BOUNDARY HAS TO HOLD ★
 *
 * Learning is a platform function rather than a feature a workspace switches
 * on. There is no toggle to hide behind, which means every guarantee has to be
 * a property of the code: an exhaustive allowlist that fields must pass through
 * rather than be remembered out of, a pool that cannot be attributed, a
 * workspace that never learns from its own echo, and a floor that cannot be
 * manufactured past.
 *
 * These tests are those properties. Several of them are the only thing standing
 * between "we anonymise carefully" and it being true.
 */

/* -------------------------------------------------------------------------- */
/* Contexts and fixtures                                                       */
/* -------------------------------------------------------------------------- */

const ORG_A = "org_northline";
const ORG_B = "org_baxter";

const DISPATCHER: PermissionKey[] = ["loads:view", "trucks:view", "audit:view"];

function ctxFor(
  organizationId: string,
  permissions: PermissionKey[] = DISPATCHER,
  membershipId = `mem_${organizationId}`,
): ServiceContext {
  return {
    organizationId,
    organizationName: `Org ${organizationId}`,
    workspaceKind: "carrier_organization",
    membershipId,
    permissions: new Set(permissions),
    scope: { loads: "all", financials: "all" },
    actor: {
      userId: `usr_${membershipId}`,
      membershipId,
      displayNameSnapshot: `Actor ${membershipId}`,
      source: "web",
    },
  };
}

/**
 * A listing stuffed with every identifying thing a real one carries.
 *
 * Deliberately full of names, numbers, addresses and cities: the anonymisation
 * tests are worth nothing against a fixture that had nothing to leak.
 */
function listingFixture(over: Partial<Listing> = {}): Listing {
  return {
    listingId: "lst_identifiable_1",
    fingerprint: "fp_dallas_atlanta_20260401_van_tql",
    dispatchOrganizationId: ORG_A,
    source: "load_board",
    sourceName: "Test Board",
    connection: "mock",
    sourceReference: "BOARD-REF-99887",
    observedAt: "2026-04-01T12:00:00.000Z",
    sightings: [],
    broker: {
      name: "Total Quality Logistics",
      mcNumber: "MC-123456",
      mcAgeMonths: 96,
      contactName: "Dana Whitfield",
      email: "dana.whitfield@tql.example",
      phone: "+1-555-0147",
      creditScore: 82,
      daysToPay: 28,
      workedWithBefore: true,
    },
    origin: { city: "Dallas", state: "TX" },
    destination: { city: "Atlanta", state: "GA" },
    pickupAt: "2026-04-02T14:00:00.000Z",
    deliverBy: "2026-04-03T18:00:00.000Z",
    equipment: "dry_van",
    weightLbs: 42000,
    commodity: "Packaged food",
    hazmat: false,
    teamRequired: false,
    loadedMiles: 781,
    offeredRateCents: 218_000,
    ratePerMileCents: 279,
    notes: "Driver Marcus Bell, truck NL-104, trailer TR-88, DOT 3344556.",
    status: "open",
    createdAt: "2026-04-01T12:00:00.000Z",
    ...over,
  };
}

function matchFixture(over: Partial<OpportunityMatch> = {}): OpportunityMatch {
  return {
    matchId: "mch_identifiable_1",
    listingId: "lst_identifiable_1",
    dispatchCycleId: "loop_11111111-2222-3333-4444-555555555555",
    truckId: "trk_permanent_104",
    truckUnit: "NL-104",
    carrierOrganizationId: ORG_A,
    carrierName: "Northline Freight",
    dispatchOrganizationId: ORG_A,
    status: "eligible",
    score: { total: 81, components: [] },
    checks: [],
    deadheadMiles: 52,
    loadedMiles: 781,
    totalMiles: 833,
    allInRatePerMileCents: 262,
    estimatedProfitCents: 74_000,
    createdAt: "2026-04-01T12:05:00.000Z",
    history: [],
    ...over,
  };
}

/**
 * Enough decisions, split both ways, for the learning to be willing to speak.
 *
 * `offset` keeps successive calls on DISTINCT matches. One match is one decision
 * however often it is observed, so a second call reusing the first call's ids
 * would add nothing and would quietly make every test about accumulation prove
 * the opposite of what it says.
 */
function recordDecisions(organizationId: string, count = 12, offset = 0) {
  const ctx = ctxFor(organizationId);
  for (let i = offset; i < offset + count; i++) {
    const pursued = i % 2 === 0;
    observeDecision(
      ctx,
      matchFixture({
        matchId: `mch_${organizationId}_${i}`,
        deadheadMiles: pursued ? 20 : 180,
        allInRatePerMileCents: pursued ? 310 : 190,
      }),
      listingFixture({
        broker: { name: "Broker", creditScore: pursued ? 90 : 40, mcAgeMonths: pursued ? 90 : 3 },
      }),
      pursued,
    );
  }
}

beforeEach(() => {
  resetAllMocks();
});

/* -------------------------------------------------------------------------- */
/* The allowlist is the boundary                                               */
/* -------------------------------------------------------------------------- */

describe("the data-use allowlist", () => {
  it("lets exactly the allowlisted keys into the pool, and nothing else", () => {
    observeDecision(ctxFor(ORG_A), matchFixture(), listingFixture(), true);

    const [row] = networkPoolForTests();
    expect(Object.keys(row).sort()).toEqual([...LEARNING_ALLOWED_KEYS].sort());
  });

  it("drops a field nobody remembered to exclude", () => {
    // The failure mode a denylist has and an allowlist does not: somebody adds
    // a field upstream and nothing stops it travelling. Tested at the boundary
    // itself, because it is not observable from the happy path — `anonymize`
    // already produces exactly the allowlisted keys, so a projection that did
    // nothing would look identical there.
    const smuggled = {
      ...anonymize(matchFixture(), listingFixture(), true),
      carrierName: "Northline Freight",
      driverPhone: "+1-555-0147",
      organizationId: ORG_A,
    } as unknown as ReturnType<typeof anonymize>;

    const projected = allowlisted(smuggled);

    expect(projected).not.toHaveProperty("carrierName");
    expect(projected).not.toHaveProperty("driverPhone");
    expect(projected).not.toHaveProperty("organizationId");
    expect(JSON.stringify(projected)).not.toContain("Northline Freight");
    for (const key of Object.keys(projected)) {
      expect(LEARNING_ALLOWED_KEYS).toContain(key);
    }
  });

  it("has exactly one way into the pool, and it is the projected one", () => {
    // The projection only protects what goes through it, so there is one
    // `network.push` in the module and it is inside `contribute`.
    const source = readFileSync(join(process.cwd(), "src/lib/api/mock/ranking.ts"), "utf8");
    expect([...source.matchAll(/network\.push\(/g)]).toHaveLength(1);
    expect(source).toMatch(/network\.push\(\{\s*\.\.\.allowlisted\(/);
    // And the one in-place correction re-projects rather than assigning raw.
    expect([...source.matchAll(/Object\.assign\(pooled,/g)]).toHaveLength(1);
    expect(source).toContain("Object.assign(pooled, allowlisted(observation));");
  });

  it("stamps every row with the policy version it was gathered under", () => {
    recordDecisions(ORG_A, 3);
    for (const row of networkPoolForTests()) {
      expect(row.policyVersion).toBe(LEARNING_DATA_USE_POLICY.version);
    }
    expect(learningFor(ORG_A).policyVersion).toBe(LEARNING_DATA_USE_POLICY.version);
  });

  it("names every prohibited category the policy forbids", () => {
    const prohibited = WITHHELD_FIELDS.join(" ").toLowerCase();
    for (const category of [
      "organization", "carrier", "driver", "mc and dot", "email", "phone",
      "postal address", "location", "hours of service", "licence", "banking",
      "payment", "settlement", "rate confirmation", "contract", "message",
      "uploaded file", "broker", "shipper", "receiver", "customer", "claims",
      "safety", "compliance", "credential",
    ]) {
      expect(prohibited).toContain(category);
    }
  });

  it("derives both lists from the one policy rather than restating them", () => {
    expect(SHARED_FIELDS).toHaveLength(LEARNING_DATA_USE_POLICY.allowed.length);
    expect(WITHHELD_FIELDS).toHaveLength(LEARNING_DATA_USE_POLICY.prohibited.length);
  });

  it("records what production launch still requires", () => {
    const owed = LEARNING_DATA_USE_POLICY.launchRequirements.join(" ").toLowerCase();
    expect(owed).toContain("terms of service");
    expect(owed).toContain("privacy notice");
    expect(owed).toContain("retention");
    expect(owed).toContain("legal review");
    // And it does not pretend a free service carries lighter obligations.
    expect(owed).not.toMatch(/free|no charge|not required/);
  });
});

/* -------------------------------------------------------------------------- */
/* Local learning, always                                                      */
/* -------------------------------------------------------------------------- */

describe("local learning", () => {
  it("suggests from the workspace's own decisions first", () => {
    recordDecisions(ORG_A);

    const summary = learningFor(ORG_A);
    expect(summary.suggested).toBeDefined();
    expect(summary.suggestedFrom).toBe("local");
    expect(summary.localObservations).toBe(12);
  });

  it("keeps one workspace's own decisions out of another's local evidence", () => {
    recordDecisions(ORG_A);

    expect(localPoolForTests(ORG_B)).toHaveLength(0);
    expect(learningFor(ORG_B).localObservations).toBe(0);
  });

  it("says why there is no suggestion instead of returning a quiet nothing", () => {
    const summary = learningFor(ORG_B);
    expect(summary.suggested).toBeUndefined();
    expect(summary.networkAvailability).toBe("insufficient_evidence");
  });
});

/* -------------------------------------------------------------------------- */
/* A workspace never learns from itself through the pool                       */
/* -------------------------------------------------------------------------- */

describe("self-contributed evidence", () => {
  it("does not hand a workspace its own contribution back as network evidence", () => {
    observeDecision(ctxFor(ORG_A), matchFixture(), listingFixture(), true);

    const summary = learningFor(ORG_A);
    expect(networkPoolForTests()).toHaveLength(1);
    expect(summary.contributedObservations).toBe(1);
    expect(summary.networkObservations).toBe(0);
    expect(summary.networkAvailability).toBe("insufficient_evidence");
    expect(summary.suggested).toBeUndefined();
  });

  it("subtracts its own rows even when the pool is large enough without them", () => {
    // The case a count alone would miss: A's own contributions clear the
    // minimum, and its local evidence is one-sided so the local path declines.
    // Without subtraction A would learn from itself here.
    const ctx = ctxFor(ORG_A);
    for (let i = 0; i < 12; i++) {
      observeDecision(
        ctx,
        matchFixture({ matchId: `mch_self_${i}`, deadheadMiles: 20 }),
        listingFixture(),
        true,
      );
    }

    const summary = learningFor(ORG_A);
    expect(networkPoolForTests()).toHaveLength(12);
    expect(summary.networkObservations).toBe(0);
    expect(summary.suggested).toBeUndefined();
  });

  it("still lets another workspace consume that evidence, once it is eligible", () => {
    recordDecisions(ORG_A, 4);
    expect(learningFor(ORG_B).networkAvailability).toBe("insufficient_evidence");
    expect(learningFor(ORG_B).suggested).toBeUndefined();

    recordDecisions(ORG_A, 8, 4);
    const b = learningFor(ORG_B);
    expect(b.networkObservations).toBe(12);
    expect(b.networkAvailability).toBe("available");
    expect(b.suggested).toBeDefined();
    expect(b.suggestedFrom).toBe("network");

    // And A, looking at the same pool, still sees none of it as network evidence.
    expect(learningFor(ORG_A).networkObservations).toBe(0);
  });

  it("gives every pooled row its own token, so the pool groups nobody", () => {
    recordDecisions(ORG_A, 6);
    recordDecisions(ORG_B, 6);

    const tokens = networkPoolForTests().map((o) => o.contributionId);
    expect(tokens).toHaveLength(12);
    // Unique per ROW, not per organization: the pool cannot be partitioned into
    // contributors, let alone attributed to one.
    expect(new Set(tokens).size).toBe(12);
    for (const token of tokens) {
      expect(token).not.toContain(ORG_A);
      expect(token).not.toContain(ORG_B);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* One decision is one row, however many times it arrives                      */
/* -------------------------------------------------------------------------- */

describe("duplicate observations", () => {
  const again = (organizationId: string, pursued = true, matchId = "mch_repeat") =>
    observeDecision(
      ctxFor(organizationId),
      matchFixture({ matchId }),
      listingFixture(),
      pursued,
    );

  it("does not grow local evidence when the same decision is retried", () => {
    for (let i = 0; i < 12; i++) again(ORG_A);

    expect(localPoolForTests(ORG_A)).toHaveLength(1);
    expect(learningFor(ORG_A).localObservations).toBe(1);
  });

  it("does not grow network evidence when the same decision is retried", () => {
    for (let i = 0; i < 12; i++) again(ORG_A);

    expect(networkPoolForTests()).toHaveLength(1);
    expect(learningFor(ORG_A).contributedObservations).toBe(1);
    expect(learningFor(ORG_B).networkObservations).toBe(1);
  });

  it("cannot manufacture enough rows to clear the minimum-evidence floor", () => {
    // The attack this closes: one real decision, pressed enough times to look
    // like a market. Sixty presses, split both ways so the derivation would
    // have something to chew on, on a grand total of two loads.
    for (let i = 0; i < 30; i++) {
      again(ORG_A, true, "mch_one");
      again(ORG_A, false, "mch_two");
    }

    expect(networkPoolForTests()).toHaveLength(2);
    expect(localPoolForTests(ORG_A)).toHaveLength(2);
    expect(learningFor(ORG_A).suggested).toBeUndefined();

    const b = learningFor(ORG_B);
    expect(b.networkObservations).toBe(2);
    expect(b.networkAvailability).toBe("insufficient_evidence");
    expect(b.suggested).toBeUndefined();
  });

  it("keeps one contribution identity per decision, and unlinkable ones across decisions", () => {
    again(ORG_A, true, "mch_one");
    const firstToken = networkPoolForTests()[0].contributionId;

    for (let i = 0; i < 5; i++) again(ORG_A, true, "mch_one");
    again(ORG_A, false, "mch_one");

    expect(networkPoolForTests()).toHaveLength(1);
    expect(networkPoolForTests()[0].contributionId).toBe(firstToken);
    // The change of mind corrected the row rather than adding a second one.
    expect(networkPoolForTests()[0].pursued).toBe(false);

    again(ORG_A, true, "mch_two");
    const tokens = networkPoolForTests().map((o) => o.contributionId);
    expect(new Set(tokens).size).toBe(2);
    expect(tokens[1]).not.toBe(tokens[0]);
  });

  it("keeps two workspaces deciding the same load apart", () => {
    again(ORG_A, true, "mch_shared");
    again(ORG_B, false, "mch_shared");

    expect(localPoolForTests(ORG_A)).toHaveLength(1);
    expect(localPoolForTests(ORG_B)).toHaveLength(1);
    expect(networkPoolForTests()).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* What a consumer can see                                                     */
/* -------------------------------------------------------------------------- */

describe("anonymisation", () => {
  const IDENTIFIERS = [
    ORG_A, "Northline Freight", "Total Quality Logistics", "MC-123456",
    "Dana Whitfield", "dana.whitfield@tql.example", "+1-555-0147",
    "Marcus Bell", "NL-104", "TR-88", "trk_permanent_104", "Dallas", "Atlanta",
    "lst_identifiable_1", "mch_identifiable_1", "BOARD-REF-99887", "3344556",
    "loop_11111111-2222-3333-4444-555555555555",
  ];

  it("strips every identifier from the shared shape", () => {
    const row = anonymize(matchFixture(), listingFixture(), true);
    const serialized = JSON.stringify(row);
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
  });

  it("exposes no source organization, person, asset, load or credential to a consumer", () => {
    // The consumer's-eye view: everything B can reach when A has contributed.
    // Not just the stored rows — the whole summary B is given.
    recordDecisions(ORG_A);

    const consumed = learningFor(ORG_B);
    expect(consumed.suggestedFrom).toBe("network");

    const serialized = JSON.stringify({ summary: consumed, pool: networkPoolForTests() });
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    // A suggestion is six weights and nothing else — no row, no id, no count
    // that could be resolved to a contributor.
    expect(Object.keys(consumed.suggested!).sort()).toEqual([
      "broker_quality", "deadhead", "home_time", "lane_preference", "profit", "rate",
    ]);
  });

  it("bands money and distance rather than passing them through", () => {
    observeDecision(ctxFor(ORG_A), matchFixture(), listingFixture(), true);
    const serialized = JSON.stringify(networkPoolForTests());
    expect(serialized).not.toContain("262");
    expect(serialized).not.toContain("781");
  });

  it("does not let the pool share an object with the workspace's own record", () => {
    observeDecision(ctxFor(ORG_A), matchFixture(), listingFixture(), true);
    expect(networkPoolForTests()[0]).not.toBe(localPoolForTests(ORG_A)[0].observation);
  });
});

/* -------------------------------------------------------------------------- */
/* Auditability                                                                */
/* -------------------------------------------------------------------------- */

describe("audit", () => {
  it("records in the one ledger that a workspace is contributing, and under which policy", async () => {
    const ctx = ctxFor(ORG_A);
    recordDecisions(ORG_A, 3);

    const page = await mockAuditService.list(ctx, {
      filters: { module: ["organization"] },
      limit: 200,
    });
    const event = page.items.find((e) => e.sourceAction === "learning.policy_engaged");

    expect(event).toBeDefined();
    expect(event!.action).toBe("organization.settings_changed");
    expect(event!.entity.kind).toBe("organization");
    expect(event!.entity.id).toBe(ORG_A);
    expect(event!.changes?.changes[0].field).toBe("learning.policyVersion");
    expect(event!.changes?.changes[0].after).toBe(LEARNING_DATA_USE_POLICY.version);
  });

  it("records it once per workspace per policy version, not once per decision", async () => {
    recordDecisions(ORG_A, 12);

    const page = await mockAuditService.list(ctxFor(ORG_A), {
      filters: { module: ["organization"] },
      limit: 200,
    });
    expect(page.items.filter((e) => e.sourceAction === "learning.policy_engaged"))
      .toHaveLength(1);
  });

  it("does not leak one workspace's participation into another's ledger", async () => {
    recordDecisions(ORG_A, 3);

    const page = await mockAuditService.list(ctxFor(ORG_B), {
      filters: { module: ["organization"] },
      limit: 200,
    });
    expect(page.items.filter((e) => e.sourceAction === "learning.policy_engaged"))
      .toHaveLength(0);
  });

  it("keeps no second log of its own", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/api/mock/ranking.ts"), "utf8");
    expect(source).toContain("appendAuditEvent");
    expect(source).not.toMatch(/consentHistory|consentLog|auditTrail/);
  });
});

/* -------------------------------------------------------------------------- */
/* Reset                                                                       */
/* -------------------------------------------------------------------------- */

describe("fixture reset", () => {
  it("clears both pools and the decision index together", () => {
    recordDecisions(ORG_A);
    expect(networkPoolForTests().length).toBeGreaterThan(0);

    resetAllMocks();

    expect(networkPoolForTests()).toHaveLength(0);
    expect(localPoolForTests(ORG_A)).toHaveLength(0);

    // And the index went with them: the same decision is new again rather than
    // being silently swallowed as a duplicate of a row that no longer exists.
    recordDecisions(ORG_A, 1);
    expect(localPoolForTests(ORG_A)).toHaveLength(1);
    expect(networkPoolForTests()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The three-path boundary                                                     */
/* -------------------------------------------------------------------------- */

describe("the intelligence data boundary", () => {
  /**
   * ★ ONE FACT, ONE OWNER, THREE PATHS ★
   *
   * The allowlist governs Shared Network Intelligence and nothing else. The
   * two misreadings that would cost most are opposite: taking it as a
   * restriction on an organization's own records, or as permission to send
   * something outside. These prove it is neither.
   */

  it("leaves a prohibited field readable in its canonical module by the owning organization", async () => {
    // Customer identity and exact rates are both prohibited from the pool. The
    // Loads module still serves both to the workspace that owns the record —
    // which is the whole of Private Organization Intelligence's room to exist.
    const owner = ctxFor(ORG_A, ["loads:view", "rates:view"]);
    const page = await mockLoadsService.list(owner);
    const load = page.items[0];

    expect(load).toBeDefined();
    expect(load.customer.name).toBeTruthy();
    expect(load.financials?.totalRateCents).toBeGreaterThan(0);

    // And it is the DOMAIN's rule that decides, not this policy: the same read
    // without `rates:view` omits the money entirely.
    const withoutRates = await mockLoadsService.list(ctxFor(ORG_A, ["loads:view"]));
    expect(withoutRates.items[0].customer.name).toBeTruthy();
    expect(withoutRates.items[0].financials).toBeUndefined();
  });

  it("keeps those same fields out of the shared pool", () => {
    const owner = ctxFor(ORG_A, ["loads:view", "rates:view"]);
    observeDecision(owner, matchFixture(), listingFixture(), true);

    const serialized = JSON.stringify(networkPoolForTests());
    // The exact rate and the customer's name are in the canonical record above
    // and in no row here.
    expect(serialized).not.toContain("262");
    expect(serialized).not.toContain("Total Quality Logistics");
    expect(Object.keys(networkPoolForTests()[0]).sort())
      .toEqual([...LEARNING_ALLOWED_KEYS].sort());
  });

  it("creates no outbound payload, integration or sharing grant merely by learning", async () => {
    recordDecisions(ORG_A);
    expect(learningFor(ORG_A).suggested).toBeDefined();

    // Learning produced a suggestion. It produced nothing pointed outwards:
    // an external action needs a person, a recipient and a purpose, and a
    // suggestion is none of those.
    await expect(integrations.downstream.pending(ORG_A)).resolves.toEqual([]);
  });

  it("grants no access to another organization's records", async () => {
    recordDecisions(ORG_A);

    // B consumed A's contributions as network evidence, and that changed
    // nothing about what B may read.
    expect(learningFor(ORG_B).suggestedFrom).toBe("network");
    const page = await mockLoadsService.list(ctxFor(ORG_B, ["loads:view", "rates:view"]));
    for (const load of page.items) {
      expect(load.organizationId).toBe(ORG_B);
    }
  });

  it("states in its own data that it governs only the shared pool", () => {
    expect(LEARNING_DATA_USE_POLICY.governs.toLowerCase()).toContain("shared network");

    const nonClaims = LEARNING_DATA_USE_POLICY.doesNotGovern.join(" ").toLowerCase();
    expect(nonClaims).toContain("canonical");
    expect(nonClaims).toContain("private organization intelligence");
    expect(nonClaims).toContain("outside antcolos");
    // And it carries no field that could grant anything to anybody.
    expect(Object.keys(LEARNING_DATA_USE_POLICY)).not.toContain("grants");
    expect(Object.keys(LEARNING_DATA_USE_POLICY)).not.toContain("recipients");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

describe("milestone scope", () => {
  /**
   * ★ WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT ★
   *
   * The claim worth testing is "this milestone introduced none of that work",
   * and the honest way to test it is over the files this milestone OWNS. A
   * repository-wide prohibition would be a different claim — "nobody may ever
   * build Goals" — and it would turn a later approved milestone into a failing
   * build for no reason anybody could act on.
   */
  const OWNED = [
    "src/config/learning.ts",
    "src/lib/api/mock/ranking.ts",
    "src/features/opportunities/learning-data-use-screen.tsx",
    "src/app/(app)/settings/learning/page.tsx",
  ];

  const ownedSources = () =>
    OWNED.map((rel) => ({ rel, text: readFileSync(join(process.cwd(), rel), "utf8") }));

  function offendersIn(forbidden: readonly string[]): string[] {
    const found: string[] = [];
    for (const { rel, text } of ownedSources()) {
      for (const name of forbidden) {
        if (text.includes(name)) found.push(`${rel}: ${name}`);
      }
    }
    return found;
  }

  it("builds no Goals, Metric Observations, Recommendations or Outcomes", () => {
    expect(offendersIn([
      "OrganizationGoal", "GoalProgress", "MetricObservation",
      "OutcomeAttribution", "RecommendationStatus",
    ])).toEqual([]);
  });

  it("builds no external service provider records", () => {
    expect(offendersIn([
      "ServiceProvider", "ExternalProvider", "service_delegation",
      "carrier_service_provider",
    ])).toEqual([]);
  });

  it("trains, scores and serves no model", () => {
    expect(offendersIn([
      "trainModel", "LearningModel", "inference", "embedding", "classifier",
    ])).toEqual([]);
  });

  it("delivers no Insurance quote, Safety score or provider adapter", () => {
    // The three paths are documented by this PR. Only the second is built.
    expect(offendersIn([
      "InsuranceQuote", "quoteRequest", "SafetyScore", "ProviderAdapter",
      "DownstreamPort", "sharingGrant",
    ])).toEqual([]);
  });

  it("publishes no domain event, so it adds no event kind", () => {
    expect(offendersIn([
      "propagationBus", "buildDomainEvent", "DomainEventKind",
    ])).toEqual([]);
  });

  it("mints no permission key, and leaves the page reachable by the same one", () => {
    expect(requiredPermissionsForPath("/settings/learning")).toEqual(["organization:manage"]);
    const [, { text }] = ownedSources();
    expect(text).not.toMatch(/"learning:[a-z:]+"/);
  });

  it("adds no store of its own, so the reset surface is unchanged", () => {
    const [, { text }] = ownedSources();
    const resets = [...text.matchAll(/export function (reset[A-Za-z]*)/g)].map((m) => m[1]);
    expect(resets).toEqual(["resetRanking", "resetRankingWeights"]);
  });

  it("keeps no per-organization consent setting", () => {
    // The product decision this milestone now implements: learning is a
    // platform function, so there is no toggle and nothing storing a choice.
    expect(offendersIn(["LearningConsent", "setLearningConsent", "consent.set"]))
      .toEqual([]);
  });
});

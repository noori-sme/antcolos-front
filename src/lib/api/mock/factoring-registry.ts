import type {
  ActorRef, BrokerFactorabilityCheck, FactoringCheckPolicy, FactoringConnection,
  FactoringConnectionMode, FactoringConnectionStatus, FactoringDecision,
  FactoringDecisionSource, FactoringEvidence, FactoringFallbackConfig,
  FactoringOverride, FactoringProviderKind, FactoringStatusView, PermissionKey,
} from "@/types";
import {
  DEFAULT_FACTORING_POLICY, FACTORING_MODE_IS_AUTOMATIC, FACTORING_MODE_IS_LIVE_API,
  FACTORING_PROVIDER_LABEL, FACTORING_SOURCE_LABEL, isFactoringApproved,
} from "@/types";
import { normalizeMcNumber } from "@/lib/directory/normalize";
import { NotFoundError, PermissionDeniedError } from "../contracts/context";
import type { ServiceContext } from "../contracts/context";
import { dispatchGrantsByCarrier } from "./truck-registry";
import { brokerByVerifiedMcSync, partyVisibleToCarrierSync } from "./party-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOT CONNECTED TO ANY FACTOR ███
 *
 * The factoring store, and the rules that make an answer mean what it says.
 *
 * Antcolos has no production API access from OTR, RTS or anybody else. Every
 * record here was produced by a mock adapter, an authorized export a carrier
 * imported, or a person writing down what their factor told them. Nothing in
 * this file contacts a factoring company, and nothing in it may be read as a
 * factoring decision unless a source and an evidence trail say where it came
 * from.
 *
 * ★ THE PARTITION IS THE WHOLE DESIGN ★
 *
 * Every row below is keyed by `carrierOrganizationId`, the same way
 * `CarrierPartyRelationship` is. A factoring answer is not a fact about a
 * broker; it is a fact about one carrier's arrangement with one factor. Apex
 * Logistics is approved for Northline and blocked at Baxter, and both are true
 * at once — so there is no read in this file that takes a broker without also
 * taking the carrier, and no index that could be used to answer "who else is
 * approved for this MC".
 *
 * ★ FIVE RULES THIS FILE EXISTS TO KEEP ★
 *
 *  1. NOTHING IS INVENTED. A credit limit, an available amount, a reason and a
 *     set of conditions are written only when a provider, an import row or a
 *     person supplied them. Absent means nobody said, and absent is never
 *     rendered as zero.
 *  2. NOTHING IS OVERWRITTEN. A newer answer SUPERSEDES an older one and points
 *     back at it. A corrected import is auditable because the wrong answer is
 *     still there with the right one pointing at it.
 *  3. EXPIRY IS RESOLVED AT READ TIME. There is no scheduler on a frontend, so
 *     an approval that lapsed at 03:00 reads as `stale` at 03:01 because the
 *     read derives it, not because a job ran.
 *  4. "NO ANSWER" IS NEVER "NO". `unknown`, `stale`, `not_connected` and
 *     `provider_unavailable` stay themselves all the way to the screen.
 *  5. NOTHING SECRET IS STORED. There is no field on any record below that can
 *     hold a password, a token or a portal session, and a test walks the whole
 *     serialized model to prove it.
 *
 * ███ FRONTEND ONLY ███ Authorization here is a frontend check over an
 * in-memory store. Real authorization, encryption, durable storage, audit
 * retention and provider rate limiting are the backend's.
 */

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface FactoringState {
  /** At most one per carrier in this slice. The type already allows more. */
  connections: FactoringConnection[];
  policies: FactoringCheckPolicy[];
  /** APPEND ONLY. Superseding sets a pointer; it never removes a row. */
  checks: BrokerFactorabilityCheck[];
  overrides: FactoringOverride[];
  /** idempotency key -> the check it produced. */
  recorded: Map<string, string>;
}

let state: FactoringState | null = null;

function db(): FactoringState {
  if (!state) state = buildFixtures();
  return state;
}

/** Test hook. Never called by the UI. */
export function resetFactoring() {
  state = null;
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const NORTHLINE = "org_northline";
const BAXTER = "org_baxter";

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

const HOUR_MS = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();
const hoursAhead = (h: number) => new Date(Date.now() + h * HOUR_MS).toISOString();

/**
 * Two carriers with two different arrangements, chosen so the isolation is
 * something a person can look at rather than something a comment asserts.
 *
 * Northline runs the development adapter, so its search screen checks in the
 * background and shows no button — the automatic workflow. Baxter records its
 * factor's answers by hand, so its search screen offers "Check with factoring"
 * — the fallback workflow. The same broker, Apex Logistics (MC 612884), is
 * approved for one and rejected by the other's factor.
 *
 * Every other organization has no connection at all, which is the third state
 * the product has to render honestly: `not_connected`, and never `rejected`.
 */
function buildFixtures(): FactoringState {
  const at = hoursAgo(72);

  const northlineConnection: FactoringConnection = {
    connectionId: "fcn_northline_otr",
    carrierOrganizationId: NORTHLINE,
    providerKind: "otr",
    providerName: FACTORING_PROVIDER_LABEL.otr,
    accountLabel: "OTR — main",
    accountReference: "NL-4471",
    mode: "mock_adapter",
    status: "connected",
    fallback: {
      creditCheckEmail: "creditchecks@otr.example",
      portalUrl: "https://portal.otr.example",
      phone: "+1 (470) 555-0133",
      instructions: "Ask for the debtor by MC number. They will not answer on a name.",
    },
    connectedBy: SYSTEM_ACTOR,
    connectedAt: at,
    updatedAt: at,
    lastResultAt: hoursAgo(4),
  };

  const baxterConnection: FactoringConnection = {
    connectionId: "fcn_baxter_rts",
    carrierOrganizationId: BAXTER,
    providerKind: "rts",
    providerName: FACTORING_PROVIDER_LABEL.rts,
    accountLabel: "RTS Financial",
    accountReference: "BX-22108",
    mode: "manual",
    status: "connected",
    fallback: {
      creditCheckEmail: "credit@rts.example",
      portalUrl: "https://portal.rts.example",
      phone: "+1 (816) 555-0190",
      instructions: "Credit desk is open 07:00–18:00 Central. They answer on MC only.",
    },
    connectedBy: SYSTEM_ACTOR,
    connectedAt: at,
    updatedAt: at,
    lastResultAt: hoursAgo(20),
  };

  const apexMc = "612884";

  const northlineApex: BrokerFactorabilityCheck = {
    checkId: "fck_seed_nl_apex",
    carrierOrganizationId: NORTHLINE,
    connectionId: northlineConnection.connectionId,
    providerKind: "otr",
    providerName: northlineConnection.providerName,
    accountLabel: northlineConnection.accountLabel,
    brokerMcNumber: apexMc,
    brokerNameObserved: "Apex Logistics LLC",
    decision: "approved_live",
    // Supplied by the (mock) provider, which is the only reason they are here.
    creditLimitCents: 1_500_000,
    availableAmountCents: 1_150_000,
    source: "mock_adapter",
    checkedAt: hoursAgo(4),
    expiresAt: hoursAhead(68),
    recordedBy: SYSTEM_ACTOR,
    recordedByOrganizationId: NORTHLINE,
    providerReference: `MOCK-${apexMc}`,
    createdAt: hoursAgo(4),
  };

  const baxterApex: BrokerFactorabilityCheck = {
    checkId: "fck_seed_bx_apex",
    carrierOrganizationId: BAXTER,
    connectionId: baxterConnection.connectionId,
    providerKind: "rts",
    providerName: baxterConnection.providerName,
    accountLabel: baxterConnection.accountLabel,
    brokerMcNumber: apexMc,
    brokerNameObserved: "Apex Logistics LLC",
    decision: "rejected",
    // The factor's own words, as the person who rang them wrote them down.
    reason: "Debtor is past due with us and is off the approved list.",
    // No credit limit. A refusal carries no line, and inventing a zero would
    // read on screen as "a limit of $0" rather than "nobody gave a figure".
    source: "phone_confirmation",
    checkedAt: hoursAgo(20),
    expiresAt: hoursAhead(4),
    recordedBy: SYSTEM_ACTOR,
    recordedByOrganizationId: BAXTER,
    providerReference: "RTS-CALL-88412",
    evidence: {
      kind: "call_note",
      reference: "RTS-CALL-88412",
      note: "Spoke to the RTS credit desk at 09:14.",
    },
    createdAt: hoursAgo(20),
  };

  return {
    connections: [northlineConnection, baxterConnection],
    policies: [],
    checks: [northlineApex, baxterApex],
    overrides: [],
    recorded: new Map(),
  };
}

/* -------------------------------------------------------------------------- */
/* Who may reach whose factoring                                               */
/* -------------------------------------------------------------------------- */

export type FactoringReach = "own_carrier" | "dispatch_delegation";

/**
 * Whether this caller may touch this carrier's factoring at all.
 *
 * Read from the carrier's OWN dispatch grants — the same records that decide
 * whether a dispatch organization may book a load — rather than from anything
 * the screen supplied. A dispatch organization that covers Northline's trucks
 * may ask about Northline's factoring; the same organization asking about
 * Baxter gets nothing back, whatever it holds in its own permission set.
 *
 * ★ AND CARRIER A'S ANSWER NEVER TRAVELS TO CARRIER B ★
 * A delegate that covers both carriers still reads them one at a time: every
 * call takes a `carrierOrganizationId`, every stored row carries one, and there
 * is no query in this file that returns rows for more than one carrier.
 */
export function factoringReachFor(
  ctx: Pick<ServiceContext, "organizationId">,
  carrierOrganizationId: string,
): FactoringReach | null {
  if (ctx.organizationId === carrierOrganizationId) return "own_carrier";
  const granted = dispatchGrantsByCarrier(carrierOrganizationId).some(
    (g) => g.dispatchOrganizationId === ctx.organizationId,
  );
  return granted ? "dispatch_delegation" : null;
}

/**
 * The carrier gate. Throws `NotFoundError` for a carrier this caller has no
 * authority over, exactly as the directory does for a party it may not see:
 * a "forbidden" would confirm that the carrier uses a factor at all.
 */
function requireReach(
  ctx: Pick<ServiceContext, "organizationId">,
  carrierOrganizationId: string,
): FactoringReach {
  const reach = factoringReachFor(ctx, carrierOrganizationId);
  if (!reach) throw new NotFoundError("Factoring");
  return reach;
}

function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * Administering a factoring account is the CARRIER's, never a delegate's.
 *
 * A carrier that hands its trucks to a dispatch agency has delegated dispatch,
 * not its banking. Connecting a factor, importing its debtor list and changing
 * the booking policy stay with the carrier even when everything else about the
 * truck has been handed over — so this gate asks for `own_carrier` reach and
 * refuses `dispatch_delegation` outright.
 */
function requireCarrierAdministration(ctx: ServiceContext, carrierOrganizationId: string) {
  const reach = requireReach(ctx, carrierOrganizationId);
  if (reach !== "own_carrier") throw new NotFoundError("Factoring");
  requirePermissions(ctx, "factoring:manage");
}

/* -------------------------------------------------------------------------- */
/* Connections                                                                 */
/* -------------------------------------------------------------------------- */

export function connectionForSync(carrierOrganizationId: string): FactoringConnection | undefined {
  return db().connections.find((c) => c.carrierOrganizationId === carrierOrganizationId);
}

/**
 * The status a connection reads as RIGHT NOW.
 *
 * ★ THE RESERVED API MODE IS NEVER "CONNECTED" ★
 * No factoring company has authorized Antcolos for an API, so a connection in
 * `api` mode reports `provider_unavailable` whatever is stored on it. That is
 * not a bug to fix later: it is the true state, and a screen that showed
 * "Connected" for it would be claiming an integration that does not exist.
 */
export function effectiveConnectionStatus(
  connection: FactoringConnection,
): FactoringConnectionStatus {
  if (connection.mode === "api") return "provider_unavailable";
  return connection.status;
}

export interface ConnectFactoringInput {
  carrierOrganizationId: string;
  providerKind: FactoringProviderKind;
  /** Defaults to the provider's own name. */
  providerName?: string;
  accountLabel: string;
  /** The factor's client number. An identifier; there is no password field. */
  accountReference?: string;
  mode: FactoringConnectionMode;
  fallback?: FactoringFallbackConfig;
}

export interface ConnectionChange {
  connection: FactoringConnection;
  /** True when this replaced an existing connection rather than creating one. */
  replaced: boolean;
  previousProviderName?: string;
}

/** Requires `factoring:manage`, in the carrier's own organization. */
export function connectFactoringSync(
  ctx: ServiceContext,
  input: ConnectFactoringInput,
): ConnectionChange {
  requireCarrierAdministration(ctx, input.carrierOrganizationId);

  const at = nowIso();
  const existing = connectionForSync(input.carrierOrganizationId);
  const connection: FactoringConnection = {
    connectionId: existing?.connectionId ?? rowId("fcn"),
    carrierOrganizationId: input.carrierOrganizationId,
    providerKind: input.providerKind,
    providerName: input.providerName?.trim() || FACTORING_PROVIDER_LABEL[input.providerKind],
    accountLabel: input.accountLabel.trim(),
    accountReference: input.accountReference?.trim() || undefined,
    mode: input.mode,
    // A newly wired connection is connected in every mode but the reserved one,
    // and `effectiveConnectionStatus` keeps that honest on the way out.
    status: "connected",
    fallback: input.fallback ?? existing?.fallback ?? {},
    connectedBy: ctx.actor,
    connectedAt: existing?.connectedAt ?? at,
    updatedAt: at,
    lastResultAt: existing?.lastResultAt,
    lastImportBatchId: existing?.lastImportBatchId,
  };

  const rows = db().connections;
  const index = rows.findIndex((c) => c.carrierOrganizationId === input.carrierOrganizationId);
  if (index >= 0) rows[index] = connection;
  else rows.push(connection);

  return {
    connection,
    replaced: Boolean(existing),
    previousProviderName: existing?.providerName,
  };
}

/**
 * Ending the arrangement.
 *
 * The connection goes; the CHECKS do not. What a factor said last Tuesday is
 * still what it said, and deleting the history because the carrier changed
 * factors would remove the record of every booking decision made on it. The
 * answers simply stop resolving, because nothing reads a check without a live
 * connection to read it through.
 */
export function disconnectFactoringSync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
): FactoringConnection | undefined {
  requireCarrierAdministration(ctx, carrierOrganizationId);
  const rows = db().connections;
  const index = rows.findIndex((c) => c.carrierOrganizationId === carrierOrganizationId);
  if (index < 0) return undefined;
  const [removed] = rows.splice(index, 1);
  return removed;
}

/** Requires `factoring:view` and reach. Never another carrier's. */
export function readConnectionSync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
): FactoringConnection | undefined {
  requireReach(ctx, carrierOrganizationId);
  requirePermissions(ctx, "factoring:view");
  const connection = connectionForSync(carrierOrganizationId);
  if (!connection) return undefined;
  return { ...connection, status: effectiveConnectionStatus(connection) };
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/** The carrier's rules, defaulted. Reading a policy is not an administration act. */
export function policyForSync(carrierOrganizationId: string): FactoringCheckPolicy {
  const found = db().policies.find((p) => p.carrierOrganizationId === carrierOrganizationId);
  if (found) return found;
  return {
    carrierOrganizationId,
    ...DEFAULT_FACTORING_POLICY,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

export function readPolicySync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
): FactoringCheckPolicy {
  requireReach(ctx, carrierOrganizationId);
  requirePermissions(ctx, "factoring:view");
  return policyForSync(carrierOrganizationId);
}

export type FactoringPolicyPatch = Partial<
  Omit<FactoringCheckPolicy, "carrierOrganizationId" | "updatedAt" | "updatedBy">
>;

export interface PolicyChange {
  policy: FactoringCheckPolicy;
  before: FactoringCheckPolicy;
}

export function setPolicySync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
  patch: FactoringPolicyPatch,
): PolicyChange {
  requireCarrierAdministration(ctx, carrierOrganizationId);
  const before = policyForSync(carrierOrganizationId);
  const policy: FactoringCheckPolicy = {
    ...before,
    ...patch,
    // A freshness window of zero would make every answer stale the instant it
    // was written, which reads on screen as a broken product rather than as a
    // strict policy. One hour is the floor.
    freshnessHours: Math.max(1, Math.round(patch.freshnessHours ?? before.freshnessHours)),
    carrierOrganizationId,
    updatedAt: nowIso(),
    updatedBy: ctx.actor,
  };

  const rows = db().policies;
  const index = rows.findIndex((p) => p.carrierOrganizationId === carrierOrganizationId);
  if (index >= 0) rows[index] = policy;
  else rows.push(policy);
  return { policy, before };
}

/* -------------------------------------------------------------------------- */
/* Finding the answer that applies                                             */
/* -------------------------------------------------------------------------- */

/** What identifies the broker a question is about. */
export interface BrokerSubject {
  brokerNameObserved: string;
  /** As printed. Normalized on the way in. */
  brokerMcNumber?: string;
  brokerPartyId?: string;
}

/** The normalized subject, with the canonical profile resolved where possible. */
export interface ResolvedBrokerSubject {
  brokerNameObserved: string;
  /** Digits only, or absent. */
  mcNumber?: string;
  brokerPartyId?: string;
  /** True when the MC resolved to a company this carrier already knows. */
  resolvedFromDirectory: boolean;
}

/**
 * Turn what a listing says about a broker into something a factor can be asked.
 *
 * ★ A NAME NEVER RESOLVES TO A PROFILE ★
 * The MC is the only identifier here that decides anything. A row carrying only
 * "Summit Logistics" resolves to no `brokerPartyId` at all, which is what stops
 * an imported approval attaching to whichever of the four companies with that
 * name happens to sort first.
 */
export function resolveBrokerSubject(
  carrierOrganizationId: string,
  subject: BrokerSubject,
): ResolvedBrokerSubject {
  const mcNumber = normalizeMcNumber(subject.brokerMcNumber);

  if (subject.brokerPartyId) {
    const party = partyVisibleToCarrierSync(carrierOrganizationId, subject.brokerPartyId);
    if (party) {
      return {
        brokerNameObserved: subject.brokerNameObserved,
        mcNumber: mcNumber ?? party.identifiers.mcNumber,
        brokerPartyId: party.partyId,
        resolvedFromDirectory: true,
      };
    }
  }

  if (mcNumber) {
    const party = brokerByVerifiedMcSync(carrierOrganizationId, mcNumber);
    return {
      brokerNameObserved: subject.brokerNameObserved,
      mcNumber,
      brokerPartyId: party?.partyId,
      resolvedFromDirectory: Boolean(party),
    };
  }

  return {
    brokerNameObserved: subject.brokerNameObserved,
    mcNumber: undefined,
    brokerPartyId: undefined,
    resolvedFromDirectory: false,
  };
}

/**
 * Every answer this carrier holds about this broker, newest first.
 *
 * Matched on MC first and on the canonical profile second. NEVER on the name:
 * two different companies called "Summit Logistics" would share one factoring
 * history, and one of them would be approved on the other's answer.
 */
export function checkHistorySync(
  carrierOrganizationId: string,
  subject: ResolvedBrokerSubject,
): BrokerFactorabilityCheck[] {
  if (!subject.mcNumber && !subject.brokerPartyId) return [];
  return db()
    .checks.filter((c) => {
      if (c.carrierOrganizationId !== carrierOrganizationId) return false;
      if (subject.mcNumber && c.brokerMcNumber === subject.mcNumber) return true;
      if (subject.brokerPartyId && c.brokerPartyId === subject.brokerPartyId) return true;
      return false;
    })
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
}

/** The answer in force: newest, not superseded, from this carrier's factor. */
function currentCheck(
  carrierOrganizationId: string,
  connection: FactoringConnection | undefined,
  subject: ResolvedBrokerSubject,
): BrokerFactorabilityCheck | undefined {
  return checkHistorySync(carrierOrganizationId, subject).find(
    (c) => !c.supersededByCheckId
      && (!connection || c.connectionId === connection.connectionId),
  );
}

/* -------------------------------------------------------------------------- */
/* Resolving a status at read time                                             */
/* -------------------------------------------------------------------------- */

export interface FactoringStatusRequest extends BrokerSubject {
  carrierOrganizationId: string;
  /** Only where the caller actually has an amount. */
  proposedAmountCents?: number;
  dispatchCycleId?: string;
  listingId?: string;
  /** Test seam. Defaults to the real clock; never supplied by a screen. */
  now?: string;
}

/**
 * ★ THE READ THAT MAKES EXPIRY WORK WITHOUT A SCHEDULER ★
 *
 * Nothing stored ever changes when an answer runs out. This function compares
 * `expiresAt` against the clock on every single read and hands back `stale`,
 * keeping the recorded decision alongside so the screen can still say what was
 * approved and when. There is no window in which a lapsed approval is shown as
 * current, because there is no job that has to have run.
 */
export function factoringStatusSync(
  ctx: ServiceContext,
  request: FactoringStatusRequest,
): FactoringStatusView {
  requireReach(ctx, request.carrierOrganizationId);
  requirePermissions(ctx, "factoring:view");

  const now = request.now ?? nowIso();
  const stored = connectionForSync(request.carrierOrganizationId);
  const connection = stored
    ? { ...stored, status: effectiveConnectionStatus(stored) }
    : undefined;
  const subject = resolveBrokerSubject(request.carrierOrganizationId, request);
  const check = currentCheck(request.carrierOrganizationId, connection, subject);
  const mayCheck = ctx.permissions.has("factoring:check");

  /* ---- No connection: `not_connected`, and never anything worse ---------- */
  if (!connection) {
    return {
      carrierOrganizationId: request.carrierOrganizationId,
      decision: "not_connected",
      connectionStatus: "not_connected",
      liveApi: false,
      automatic: false,
      stale: false,
      everChecked: Boolean(check),
      recheckRequired: false,
      // Nothing to check WITH. Offering a button here would send a dispatcher
      // to a panel with no provider, no address and no account on it.
      offersManualCheck: false,
      conditions: [],
      detail: "This carrier has no factoring connection, so nothing has been checked.",
    };
  }

  const automatic = FACTORING_MODE_IS_AUTOMATIC[connection.mode]
    && connection.status === "connected";
  const liveApi = FACTORING_MODE_IS_LIVE_API[connection.mode];

  const base = {
    carrierOrganizationId: request.carrierOrganizationId,
    providerName: connection.providerName,
    accountLabel: connection.accountLabel,
    connectionMode: connection.mode,
    connectionStatus: connection.status,
    liveApi,
    automatic,
  } as const;

  /*
   * The button rule, in one line.
   *
   * With a working automatic connection there is NO button: the check runs by
   * itself and a "Check with factoring" control would imply a manual step that
   * does not exist. Everywhere else — import, email, manual, and the reserved
   * API mode that cannot answer — there is exactly one.
   */
  const offersManualCheck = mayCheck && !automatic;

  /* ---- The provider side is not answering -------------------------------- */
  if (connection.status === "provider_unavailable" && !check) {
    return {
      ...base,
      decision: "provider_unavailable",
      stale: false,
      everChecked: false,
      recheckRequired: true,
      offersManualCheck,
      conditions: [],
      detail: connection.mode === "api"
        ? `No factoring company has authorized Antcolos for an API, so ${connection.providerName} cannot be asked automatically.`
        : `${connection.providerName} is not answering right now.`,
    };
  }

  /* ---- Nobody has ever asked -------------------------------------------- */
  if (!check) {
    return {
      ...base,
      decision: "unknown",
      stale: false,
      everChecked: false,
      recheckRequired: true,
      offersManualCheck,
      conditions: [],
      detail: subject.mcNumber
        ? `Nobody has asked ${connection.providerName} about MC ${subject.mcNumber}.`
        : "There is no MC number on this load, so nothing can be asked about it.",
    };
  }

  /* ---- There is an answer. Is it still current? -------------------------- */
  const expired = Boolean(check.expiresAt && Date.parse(check.expiresAt) <= Date.parse(now));
  const decision: FactoringDecision = expired ? "stale" : check.decision;
  const conditions = [...(check.conditions ?? [])];

  return {
    ...base,
    decision,
    recordedDecision: check.decision,
    check,
    source: check.source,
    checkedAt: check.checkedAt,
    expiresAt: check.expiresAt,
    stale: expired,
    everChecked: true,
    recheckRequired: expired || decision === "pending",
    /*
     * ★ NEVER BOTH A BUTTON AND A LIVE RESULT ★
     * An automatic connection that has an answer shows the answer. It shows a
     * button only in the state where there is nothing automatic to rely on.
     */
    offersManualCheck,
    reason: check.reason,
    conditions,
    creditLimitCents: check.creditLimitCents,
    availableAmountCents: check.availableAmountCents,
    detail: describe(check, decision, connection.providerName),
  };
}

/** The one sentence a chip's tooltip shows. Never invents a figure. */
function describe(
  check: BrokerFactorabilityCheck,
  decision: FactoringDecision,
  providerName: string,
): string {
  const when = relativeAge(check.checkedAt);
  const how = FACTORING_SOURCE_LABEL[check.source].toLowerCase();

  if (decision === "stale") {
    return `${providerName} answered ${when} (${how}) and that answer has expired. Check again before you book.`;
  }
  if (isFactoringApproved(decision)) {
    const line = check.creditLimitCents !== undefined
      ? ` Limit ${usd(check.creditLimitCents)}${check.availableAmountCents !== undefined ? `, ${usd(check.availableAmountCents)} available` : ""}.`
      // Absent is absent. "No limit given" is the truth; "$0" would be a lie
      // and "unlimited" would be a worse one.
      : " No credit limit was given.";
    return `${providerName} approved this broker ${when} (${how}).${line}`;
  }
  if (decision === "rejected") {
    return check.reason
      ? `${providerName} refused this broker ${when} (${how}): ${check.reason}`
      : `${providerName} refused this broker ${when} (${how}). No reason was given.`;
  }
  if (decision === "conditional") {
    return `${providerName} will fund this broker with conditions, answered ${when} (${how}).`;
  }
  if (decision === "pending") {
    return `Asked ${providerName} ${when}. No answer yet.`;
  }
  return `${providerName} has not given an answer.`;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** "4 hours ago", in the words a dispatcher uses. */
export function relativeAge(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "at an unknown time";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* -------------------------------------------------------------------------- */
/* Writing an answer down                                                      */
/* -------------------------------------------------------------------------- */

export interface WriteCheckInput {
  carrierOrganizationId: string;
  connection: FactoringConnection;
  subject: ResolvedBrokerSubject;
  decision: FactoringDecision;
  source: FactoringDecisionSource;
  reason?: string;
  conditions?: string[];
  creditLimitCents?: number;
  availableAmountCents?: number;
  proposedAmountCents?: number;
  providerReference?: string;
  evidence?: FactoringEvidence;
  batchId?: string;
  dispatchCycleId?: string;
  listingId?: string;
  loadId?: string;
  checkedAt?: string;
  expiresAt?: string;
  recordedBy?: ActorRef;
  recordedByOrganizationId: string;
}

/**
 * Append one answer and stand the previous one down.
 *
 * ★ SUPERSEDES, NEVER OVERWRITES ★
 * The old row stays exactly as it was, gains a pointer to its replacement, and
 * the new row points back. That is what makes a corrected import reviewable: a
 * carrier can see that Tuesday's file said approved, Thursday's said rejected,
 * and which of the two a Wednesday booking was made on.
 */
export function appendCheck(input: WriteCheckInput): BrokerFactorabilityCheck {
  const at = input.checkedAt ?? nowIso();
  const policy = policyForSync(input.carrierOrganizationId);
  const previous = currentCheck(
    input.carrierOrganizationId, input.connection, input.subject,
  );

  const check: BrokerFactorabilityCheck = {
    checkId: rowId("fck"),
    carrierOrganizationId: input.carrierOrganizationId,
    connectionId: input.connection.connectionId,
    providerKind: input.connection.providerKind,
    providerName: input.connection.providerName,
    accountLabel: input.connection.accountLabel,
    brokerPartyId: input.subject.brokerPartyId,
    brokerMcNumber: input.subject.mcNumber,
    brokerNameObserved: input.subject.brokerNameObserved,
    proposedAmountCents: input.proposedAmountCents,
    dispatchCycleId: input.dispatchCycleId,
    listingId: input.listingId,
    loadId: input.loadId,
    decision: input.decision,
    reason: input.reason,
    conditions: input.conditions?.length ? [...input.conditions] : undefined,
    creditLimitCents: input.creditLimitCents,
    availableAmountCents: input.availableAmountCents,
    source: input.source,
    checkedAt: at,
    /*
     * An expiry the source gave, or the carrier's own freshness window.
     *
     * Written onto the row rather than derived later, so the record says when
     * it stops being trusted and a policy change afterwards does not silently
     * revive or kill answers somebody already booked against.
     *
     * `pending` gets none: a question that has not been answered has not
     * started ageing, and expiring it would turn "we are waiting" into "we
     * looked and it went stale".
     */
    expiresAt: input.decision === "pending"
      ? input.expiresAt
      : input.expiresAt
        ?? new Date(Date.parse(at) + policy.freshnessHours * HOUR_MS).toISOString(),
    recordedBy: input.recordedBy,
    recordedByOrganizationId: input.recordedByOrganizationId,
    providerReference: input.providerReference,
    evidence: input.evidence,
    batchId: input.batchId,
    supersedesCheckId: previous?.checkId,
    createdAt: nowIso(),
  };

  if (previous) {
    previous.supersededByCheckId = check.checkId;
    previous.supersededAt = check.createdAt;
  }

  db().checks.push(check);

  const connection = connectionForSync(input.carrierOrganizationId);
  if (connection) connection.lastResultAt = check.checkedAt;

  return check;
}

/** Idempotency: the same key returns the check it already produced. */
export function checkForIdempotencyKey(key: string): BrokerFactorabilityCheck | undefined {
  const id = db().recorded.get(key);
  return id ? db().checks.find((c) => c.checkId === id) : undefined;
}

export function rememberIdempotencyKey(key: string, checkId: string) {
  db().recorded.set(key, checkId);
}

/* -------------------------------------------------------------------------- */
/* Overrides                                                                   */
/* -------------------------------------------------------------------------- */

export function overrideFor(
  carrierOrganizationId: string,
  dispatchCycleId?: string,
  listingId?: string,
): FactoringOverride | undefined {
  if (!dispatchCycleId && !listingId) return undefined;
  return db()
    .overrides.filter(
      (o) => o.carrierOrganizationId === carrierOrganizationId
        && (dispatchCycleId ? o.dispatchCycleId === dispatchCycleId : true)
        && (listingId && !dispatchCycleId ? o.listingId === listingId : true),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

export function appendOverride(override: FactoringOverride): FactoringOverride {
  // Frozen on the way in. There is no function in this module that edits or
  // removes one, which is the same rule the audit ledger keeps.
  const frozen = Object.freeze({ ...override });
  db().overrides.push(frozen);
  return frozen;
}

/** Test/inspection read. Overrides for one carrier, newest first. */
export function overridesForCarrierSync(
  ctx: ServiceContext,
  carrierOrganizationId: string,
): FactoringOverride[] {
  requireReach(ctx, carrierOrganizationId);
  requirePermissions(ctx, "factoring:view");
  return db()
    .overrides.filter((o) => o.carrierOrganizationId === carrierOrganizationId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/* -------------------------------------------------------------------------- */
/* Internal access for the sibling factoring modules                           */
/* -------------------------------------------------------------------------- */

/**
 * The raw rows, for the import and service modules in this folder ONLY.
 *
 * Named so that using it as a listing would be obviously wrong, and never
 * reached by a screen: everything a screen sees comes through
 * `factoringStatusSync`, which applies the carrier gate and expiry.
 */
export const factoringInternals = {
  checks: () => db().checks,
  connections: () => db().connections,
  requireReach,
  requirePermissions,
  requireCarrierAdministration,
  currentCheck,
  rowId,
};

import type {
  FactoringAdapterOutcome, FactoringCheckRequest, FactoringConnectionMode,
  FactoringProviderAdapter, FactoringProviderKind,
} from "@/types";
import { FACTORING_PROVIDER_LABEL } from "@/types";

/**
 * ███ MOCK ONLY — NO FACTORING COMPANY IS CONTACTED BY ANY LINE IN THIS FILE ███
 *
 * The provider adapter seam, and the two adapters that exist today.
 *
 * ★ WHY AN ADAPTER TAKES NO CREDENTIAL ★
 * A real OTR or RTS integration authenticates with provider-issued
 * authorization that Antcolos would hold on the BACKEND. The adapter the
 * frontend talks to calls an Antcolos endpoint and is handed an answer; it is
 * never handed a secret, which is why `FactoringProviderAdapter.check` takes a
 * `FactoringCheckRequest` with nowhere to put one. That is a structural
 * property rather than a convention: there is no field to fill in.
 *
 * What is deliberately NOT here, and will not be added:
 *   - portal scraping or any headless-browser automation;
 *   - CAPTCHA handling of any kind;
 *   - storing or replaying a carrier's factoring portal login.
 * A carrier's login belongs to the carrier and its factor. The fallback
 * workflows exist precisely so that a person, signed in as themselves, gets the
 * answer and records it.
 */

/* -------------------------------------------------------------------------- */
/* The deterministic development adapter                                       */
/* -------------------------------------------------------------------------- */

/**
 * A stable hash over the MC number.
 *
 * Deterministic on purpose: the same broker gets the same answer on every run,
 * in every test, on every machine. A mock that answered randomly would make the
 * search screen look alive and make every assertion about it flaky.
 */
function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const HOUR_MS = 3_600_000;

/**
 * The development adapter.
 *
 * It answers automatically, which is what makes the "no button, the status is
 * just there" workflow something a person can actually look at before any
 * factor has authorized us. It is NOT live: `liveApi` is false, its source is
 * `mock_adapter`, and every surface that renders one of its answers says so.
 *
 * ★ WHAT IT WILL NOT DO ★
 * It never invents a credit limit for a broker it "approves" unless the shape
 * it is imitating would carry one, and the two decisions where a real factor
 * gives no figure — conditional-with-conditions and rejected — carry none here
 * either. An invented limit is the single most dangerous thing a mock in this
 * domain could produce, because a dispatcher would book against it.
 */
class MockFactoringAdapter implements FactoringProviderAdapter {
  readonly mode: FactoringConnectionMode = "mock_adapter";
  readonly liveApi = false;
  readonly canCheck = true;

  constructor(
    readonly providerKind: FactoringProviderKind,
    readonly providerName: string,
  ) {}

  async check(request: FactoringCheckRequest): Promise<FactoringAdapterOutcome> {
    const checkedAt = new Date().toISOString();

    /*
     * No MC, no answer.
     *
     * A factoring company is asked about an MC number. A name is not an
     * identifier — "Summit Logistics" is four companies — and an adapter that
     * answered on one would be inventing the single fact the whole decision
     * rests on. `unknown` is the honest outcome, and the workflow turns it into
     * "check with factoring" rather than a decision.
     */
    if (!request.brokerMcNumber) {
      return {
        decision: "unknown",
        source: "mock_adapter",
        checkedAt,
        reason: undefined,
      };
    }

    const bucket = hashOf(request.brokerMcNumber) % 100;

    /* The provider side is down. A real integration has these, and a workflow
       that has never seen one handles it for the first time in production. */
    if (bucket >= 96) {
      return { decision: "provider_unavailable", source: "mock_adapter", checkedAt };
    }

    if (bucket >= 88) {
      return {
        decision: "rejected",
        // The provider's words, in the shape a factor actually replies in. It
        // is a mock's sentence and the UI labels it as coming from the mock
        // adapter; nothing here is presented as a real factoring decision.
        reason: "Debtor is over its limit with this factor.",
        source: "mock_adapter",
        checkedAt,
        expiresAt: new Date(Date.parse(checkedAt) + 24 * HOUR_MS).toISOString(),
      };
    }

    if (bucket >= 76) {
      return {
        decision: "conditional",
        reason: "Funding available with conditions.",
        conditions: [
          "Signed rate confirmation required before funding.",
          "Proof of delivery must be submitted within 48 hours.",
        ],
        // A conditional answer carries no figure here, because a factor giving
        // conditions usually has not set a line yet. Absent, not zero.
        source: "mock_adapter",
        checkedAt,
        expiresAt: new Date(Date.parse(checkedAt) + 48 * HOUR_MS).toISOString(),
      };
    }

    /*
     * Approved, with a line — because this is the one shape where a real
     * provider response does carry one. The figure is derived from the MC hash
     * so it is stable, and it is the ONLY place in this module that a credit
     * limit comes into existence without a person or a file supplying it.
     */
    const limitCents = (5 + (hashOf(`limit:${request.brokerMcNumber}`) % 20)) * 100_000;
    const availableCents = limitCents - (hashOf(`used:${request.brokerMcNumber}`) % 5) * 50_000;

    return {
      decision: "approved_live",
      creditLimitCents: limitCents,
      availableAmountCents: Math.max(0, availableCents),
      providerReference: `MOCK-${request.brokerMcNumber}`,
      source: "mock_adapter",
      checkedAt,
      expiresAt: new Date(Date.parse(checkedAt) + 72 * HOUR_MS).toISOString(),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The reserved API adapter                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ★ RESERVED, AND DELIBERATELY NOT FUNCTIONAL ★
 *
 * No factoring company has authorized Antcolos for an API. This adapter exists
 * so the seam is real and a future integration is a swap rather than a
 * migration — and it answers `provider_unavailable`, every time, for every
 * broker, so that nothing anywhere can render an authorized-API approval that
 * does not exist.
 *
 * It is NOT an error state to be fixed. It is the true state of the world, and
 * the screens say "Provider unavailable" and offer the carrier's fallback.
 */
class ReservedApiAdapter implements FactoringProviderAdapter {
  readonly mode: FactoringConnectionMode = "api";
  readonly liveApi = true;
  /** It is reachable, and it always says the same thing. */
  readonly canCheck = true;

  constructor(
    readonly providerKind: FactoringProviderKind,
    readonly providerName: string,
  ) {}

  async check(): Promise<FactoringAdapterOutcome> {
    return {
      decision: "provider_unavailable",
      // No reason string: nothing was refused, and a sentence here would read
      // as the provider having said something.
      source: "live_api",
      checkedAt: new Date().toISOString(),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The adapter for a connection, or `undefined` when the mode has no adapter at
 * all.
 *
 * `import`, `email` and `manual` return nothing ON PURPOSE. There is no
 * software that can answer a credit-check email for you, and giving those modes
 * an adapter that returned `unknown` would make the workflow believe a check
 * had been attempted. The absence is what makes the search screen offer
 * "Check with factoring" instead of silently producing nothing.
 */
export function adapterFor(
  mode: FactoringConnectionMode,
  providerKind: FactoringProviderKind,
  providerName = FACTORING_PROVIDER_LABEL[providerKind],
): FactoringProviderAdapter | undefined {
  if (mode === "mock_adapter") return new MockFactoringAdapter(providerKind, providerName);
  if (mode === "api") return new ReservedApiAdapter(providerKind, providerName);
  return undefined;
}

/** Exposed for tests that want to assert the adapter's own behaviour. */
export function mockAdapterFor(
  providerKind: FactoringProviderKind,
  providerName = FACTORING_PROVIDER_LABEL[providerKind],
): FactoringProviderAdapter {
  return new MockFactoringAdapter(providerKind, providerName);
}

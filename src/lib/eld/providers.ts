import type { EldProvider, TelemetrySignalKind } from "@/types";

/**
 * ███ EVERY PROVIDER HERE IS A MOCK ███
 *
 * These are not real vendors, and none of the names below belongs to a real
 * company — they are deliberately generic so that nobody reading a screen can
 * mistake one for a product Antcolos has integrated. Nothing in this build
 * talks to an ELD, a GPS receiver, a vehicle, an FMCSA system or a compliance
 * service, and every provider's `mock` field is the literal `true` so the type
 * system agrees.
 *
 * What they ARE is a set of realistically DIFFERENT shapes, because a boundary
 * proven against one well-behaved provider is a boundary that will break on the
 * second one. So:
 *
 *   Alpha    hybrid, webhooks, stamps its own event ids. The easy case.
 *   Beta     telematics only. No HOS at all — asking it for a driver's clock is
 *            genuinely `unsupported`, not an error and not an empty list.
 *   Gamma    ELD only, nightly file import, no external ids. Deduplication has
 *            to work on a derived key, and staleness has to be judged against a
 *            nightly expectation rather than a webhook's.
 *   Delta    a trailer tracker: position and nothing else, on a slow poll.
 */
export const MOCK_ELD_PROVIDERS: readonly EldProvider[] = [
  {
    id: "prov_mock_alpha",
    name: "Mock Telematics — Alpha (simulated)",
    kind: "hybrid",
    mock: true,
    description:
      "A simulated hybrid provider: position, meters, faults and an hours-of-service "
      + "summary, delivered by webhook with the provider's own event ids.",
    supports: [
      "location", "speed", "heading", "odometer", "engine_hours",
      "ignition", "motion", "fuel_level", "diagnostic", "hos_summary",
    ],
    transports: ["webhook", "poll", "simulated"],
    emitsExternalIds: true,
  },
  {
    id: "prov_mock_beta",
    name: "Mock Telematics — Beta (simulated)",
    kind: "telematics",
    mock: true,
    description:
      "A simulated vehicle-telematics provider. Position, meters and fault codes only — "
      + "it has no hours-of-service data, and says so rather than returning nothing.",
    supports: [
      "location", "speed", "heading", "odometer", "engine_hours",
      "ignition", "motion", "fuel_level", "diagnostic",
    ],
    transports: ["webhook", "poll", "simulated"],
    emitsExternalIds: true,
  },
  {
    id: "prov_mock_gamma",
    name: "Mock ELD — Gamma (simulated)",
    kind: "eld",
    mock: true,
    description:
      "A simulated electronic logging provider that exports a file overnight. "
      + "No event ids of its own, so deduplication rests on a derived key.",
    supports: ["location", "odometer", "engine_hours", "hos_summary"],
    transports: ["import", "simulated"],
    emitsExternalIds: false,
  },
  {
    id: "prov_mock_delta",
    name: "Mock Asset Tracker — Delta (simulated)",
    kind: "telematics",
    mock: true,
    description:
      "A simulated battery-powered trailer tracker. Position and motion on a slow "
      + "poll, and nothing else — no engine, no meters, no driver.",
    supports: ["location", "motion"],
    transports: ["poll", "simulated"],
    emitsExternalIds: true,
  },
] as const;

const BY_ID = new Map(MOCK_ELD_PROVIDERS.map((p) => [p.id, p]));

export function findProvider(providerId: string): EldProvider | undefined {
  return BY_ID.get(providerId);
}

export function providerName(providerId: string): string {
  return BY_ID.get(providerId)?.name ?? "Unknown provider";
}

/**
 * Whether a provider can serve a signal kind at all.
 *
 * The answer drives the `unsupported` connection state, which exists precisely
 * so that "this provider does not do HOS" and "this provider is broken" are
 * never shown as the same thing.
 */
export function providerSupports(providerId: string, kind: TelemetrySignalKind): boolean {
  return BY_ID.get(providerId)?.supports.includes(kind) ?? false;
}

/** True for every provider in this build. Kept as a function so callers read honestly. */
export function providerIsMock(providerId: string): boolean {
  return BY_ID.get(providerId)?.mock ?? true;
}

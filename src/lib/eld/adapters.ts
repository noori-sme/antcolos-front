import type {
  EldProvider, EldTransport, TelemetryDiagnosticSeverity, TelemetryMeasurement,
  TelemetrySignalKind,
} from "@/types";
import { findProvider, MOCK_ELD_PROVIDERS } from "./providers";

/**
 * ★ THE PROVIDER BOUNDARY ★
 *
 * One interface, four deliberately different mock providers behind it, and
 * nothing above this file knows which one produced a given event.
 *
 * The rule this boundary exists to keep is narrow and absolute: an adapter
 * TRANSLATES. It does not decide whether a signal is plausible, it does not
 * deduplicate, it does not attribute a signal to a driver or a truck, and it
 * does not publish anything. Those are the pipeline's jobs, and keeping them
 * out of the adapter is what lets a second provider be added by writing one
 * function rather than by re-auditing the whole module.
 *
 * What an adapter MAY do is refuse. `unsupported` and `malformed` come back as
 * data rather than exceptions, because a delivery with one bad row in it should
 * land nine good rows and a reason for the tenth — not disappear.
 */

/* -------------------------------------------------------------------------- */
/* The wire                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A delivery, as it arrives at the boundary.
 *
 * `body` is whatever the provider sent, untyped on purpose: the moment this is
 * given a shape, the shape becomes a second normalization living outside the
 * adapter that owns it.
 */
export interface RawDelivery {
  organizationId: string;
  providerId: string;
  connectionId: string;
  transport: EldTransport;
  receivedAt: string;
  /** The provider's id for the delivery, when it stamps one. */
  externalId?: string;
  body: Record<string, unknown>;
  /** The shared secret a webhook presented, if any. Mock console sends none. */
  secret?: string;
}

/**
 * One signal an adapter managed to read out of a delivery.
 *
 * Note what is NOT here: no truck, no driver, no organization, no confidence in
 * the sense of "do we believe it", no dedupe key. A candidate is a translation
 * and nothing more. `sourceAt` is carried as the raw string the provider sent,
 * unvalidated, because deciding that a timestamp is unusable is a validation
 * decision and validation has not run yet.
 */
export interface NormalizedCandidate {
  /** The provider's own device identifier, verbatim. */
  deviceExternalId: string;
  kind: TelemetrySignalKind;
  value: TelemetryMeasurement;
  /** Exactly as the provider expressed it. May be nonsense; that is the point. */
  sourceAt: string;
  accuracyMeters?: number;
  /** The provider's own confidence, when it expresses one. 0–1. */
  reportedConfidence?: number;
  /** The provider's id for this single signal, when it has one. */
  externalEventId?: string;
}

export interface NormalizationResult {
  candidates: NormalizedCandidate[];
  /** Signal kinds the provider sent that it is not contracted to support. */
  unsupported: { kind: string; reason: string }[];
  /** Rows the adapter could not read at all. Kept, with a reason. */
  malformed: { reason: string; fragment: unknown }[];
}

export type SignatureVerdict = "verified" | "unsigned" | "invalid";

export interface EldProviderAdapter {
  readonly providerId: string;
  describe(): EldProvider;
  acceptsTransport(transport: EldTransport): boolean;
  /**
   * Whether a delivery's signature checks out.
   *
   * Every mock adapter returns "unsigned" for a delivery with no secret, and
   * that is reported as "unsigned" rather than quietly upgraded to "verified".
   * There is no real signing here and the module does not pretend there is.
   */
  verify(delivery: RawDelivery): SignatureVerdict;
  normalize(delivery: RawDelivery): NormalizationResult;
}

/* -------------------------------------------------------------------------- */
/* Small shared readers                                                        */
/* -------------------------------------------------------------------------- */

const rows = (body: Record<string, unknown>, key: string): unknown[] => {
  const raw = body[key];
  return Array.isArray(raw) ? raw : [];
};

const str = (o: Record<string, unknown>, k: string): string | undefined =>
  typeof o[k] === "string" ? (o[k] as string) : undefined;

const num = (o: Record<string, unknown>, k: string): number | undefined =>
  typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : undefined;

const bool = (o: Record<string, unknown>, k: string): boolean | undefined =>
  typeof o[k] === "boolean" ? (o[k] as boolean) : undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const KM_PER_MILE = 1.609344;
const kmToMiles = (km: number) => km / KM_PER_MILE;

const SEVERITIES: readonly TelemetryDiagnosticSeverity[] = ["info", "warning", "critical"];
const severityOf = (v: unknown): TelemetryDiagnosticSeverity =>
  typeof v === "string" && (SEVERITIES as readonly string[]).includes(v)
    ? (v as TelemetryDiagnosticSeverity)
    : "info";

/**
 * Only the kinds a provider is contracted for get through.
 *
 * An adapter that quietly passed a kind its provider does not support would
 * produce an event whose `providerId` claims a capability the catalog denies —
 * and the `unsupported` connection state would then be unreachable by the one
 * thing that should trigger it.
 */
function gate(
  providerId: string,
  kind: TelemetrySignalKind,
  result: NormalizationResult,
): boolean {
  const provider = findProvider(providerId);
  if (provider?.supports.includes(kind)) return true;
  result.unsupported.push({
    kind,
    reason: `${provider?.name ?? providerId} does not report ${kind}.`,
  });
  return false;
}

function push(
  result: NormalizationResult,
  providerId: string,
  candidate: NormalizedCandidate,
) {
  if (gate(providerId, candidate.kind, result)) result.candidates.push(candidate);
}

const empty = (): NormalizationResult => ({ candidates: [], unsupported: [], malformed: [] });

/**
 * The one piece of signature logic, shared by every mock adapter.
 *
 * `MOCK_SHARED_SECRET` is a constant in the source. It is not a credential, it
 * protects nothing, and it exists only so the three signature verdicts are all
 * reachable in a demo. Real provider authentication is explicitly out of scope
 * for this milestone.
 */
export const MOCK_SHARED_SECRET = "mock-shared-secret";

function verifyShared(delivery: RawDelivery): SignatureVerdict {
  if (delivery.secret == null) return "unsigned";
  return delivery.secret === MOCK_SHARED_SECRET ? "verified" : "invalid";
}

/* -------------------------------------------------------------------------- */
/* Alpha — hybrid, webhook, one event per row                                  */
/* -------------------------------------------------------------------------- */

/**
 * Alpha's wire shape:
 *
 *   { events: [ { id, device, ts, type, ...typed fields } ] }
 *
 * Miles, MPH and percent, which is the easy case and the reason the other three
 * exist.
 */
const alphaAdapter: EldProviderAdapter = {
  providerId: "prov_mock_alpha",
  describe: () => findProvider("prov_mock_alpha")!,
  acceptsTransport: (t) => t === "webhook" || t === "poll" || t === "simulated",
  verify: verifyShared,
  normalize(delivery) {
    const result = empty();
    for (const row of rows(delivery.body, "events")) {
      if (!isRecord(row)) {
        result.malformed.push({ reason: "Row was not an object.", fragment: row });
        continue;
      }
      const device = str(row, "device");
      const ts = str(row, "ts");
      const type = str(row, "type");
      if (!device || !type) {
        result.malformed.push({ reason: "Row had no device or no type.", fragment: row });
        continue;
      }
      const base = {
        deviceExternalId: device,
        // Missing entirely is carried through as an empty string so that
        // validation — not the adapter — is what calls it invalid.
        sourceAt: ts ?? "",
        externalEventId: str(row, "id"),
        accuracyMeters: num(row, "accuracy_m"),
        reportedConfidence: num(row, "confidence"),
      };
      const value = alphaValue(type, row, result);
      if (value) push(result, this.providerId, { ...base, kind: value.kind, value });
    }
    return result;
  },
};

function alphaValue(
  type: string,
  row: Record<string, unknown>,
  result: NormalizationResult,
): TelemetryMeasurement | undefined {
  switch (type) {
    case "location": {
      const lat = num(row, "lat");
      const lon = num(row, "lon");
      if (lat == null || lon == null) {
        result.malformed.push({ reason: "Location row had no coordinates.", fragment: row });
        return undefined;
      }
      return {
        kind: "location", latitude: lat, longitude: lon,
        city: str(row, "city"), state: str(row, "state"), description: str(row, "place"),
      };
    }
    case "speed": {
      const mph = num(row, "mph");
      return mph == null ? undefined : { kind: "speed", milesPerHour: mph };
    }
    case "heading": {
      const deg = num(row, "deg");
      return deg == null ? undefined : { kind: "heading", degrees: deg };
    }
    case "odometer": {
      const miles = num(row, "miles");
      return miles == null ? undefined : { kind: "odometer", miles };
    }
    case "engine_hours": {
      const hours = num(row, "hours");
      return hours == null ? undefined : { kind: "engine_hours", hours };
    }
    case "ignition": {
      const on = bool(row, "on");
      return on == null ? undefined : { kind: "ignition", on };
    }
    case "motion": {
      const moving = bool(row, "moving");
      return moving == null ? undefined : { kind: "motion", moving };
    }
    case "fuel_level": {
      const percent = num(row, "percent");
      return percent == null ? undefined : { kind: "fuel_level", percent };
    }
    case "diagnostic": {
      const code = str(row, "code");
      if (!code) {
        result.malformed.push({ reason: "Diagnostic row had no code.", fragment: row });
        return undefined;
      }
      return {
        kind: "diagnostic",
        code,
        description: str(row, "desc"),
        severity: severityOf(row.severity),
        active: bool(row, "active") ?? true,
        spn: num(row, "spn"),
        fmi: num(row, "fmi"),
      };
    }
    case "hos": {
      const duty = str(row, "duty");
      const allowed = ["off_duty", "sleeper", "driving", "on_duty_not_driving"];
      if (!duty || !allowed.includes(duty)) {
        result.malformed.push({ reason: "HOS row had no recognisable duty status.", fragment: row });
        return undefined;
      }
      return {
        kind: "hos_summary",
        dutyStatus: duty as "off_duty" | "sleeper" | "driving" | "on_duty_not_driving",
        driveSecondsRemaining: num(row, "drive_s"),
        shiftSecondsRemaining: num(row, "shift_s"),
        cycleSecondsRemaining: num(row, "cycle_s"),
        personalConveyance: bool(row, "pc"),
      };
    }
    default:
      result.unsupported.push({ kind: type, reason: `Alpha sent an unknown row type "${type}".` });
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Beta — telematics only, metric units, no HOS                                */
/* -------------------------------------------------------------------------- */

/**
 * Beta's wire shape:
 *
 *   { records: [ { unit, recorded_at, metric, value } ] }
 *
 * Metric units throughout, which is the whole reason it is here: an adapter
 * that forgot to convert would put a truck at 110 miles an hour and the
 * impossible-jump check would then be arguing with a units bug.
 *
 * Beta has no hours-of-service data at all. A delivery that contains one comes
 * back in `unsupported` — which is what drives the `unsupported` connection
 * state — rather than being silently dropped.
 */
const betaAdapter: EldProviderAdapter = {
  providerId: "prov_mock_beta",
  describe: () => findProvider("prov_mock_beta")!,
  acceptsTransport: (t) => t === "webhook" || t === "poll" || t === "simulated",
  verify: verifyShared,
  normalize(delivery) {
    const result = empty();
    for (const row of rows(delivery.body, "records")) {
      if (!isRecord(row)) {
        result.malformed.push({ reason: "Record was not an object.", fragment: row });
        continue;
      }
      const unit = str(row, "unit");
      const metric = str(row, "metric");
      if (!unit || !metric) {
        result.malformed.push({ reason: "Record had no unit or no metric.", fragment: row });
        continue;
      }
      const base = {
        deviceExternalId: unit,
        sourceAt: str(row, "recorded_at") ?? "",
        externalEventId: str(row, "record_id"),
        accuracyMeters: num(row, "hdop_m"),
      };
      const value = betaValue(metric, row, result);
      if (value) push(result, this.providerId, { ...base, kind: value.kind, value });
    }
    return result;
  },
};

function betaValue(
  metric: string,
  row: Record<string, unknown>,
  result: NormalizationResult,
): TelemetryMeasurement | undefined {
  switch (metric) {
    case "position": {
      const lat = num(row, "latitude");
      const lon = num(row, "longitude");
      if (lat == null || lon == null) {
        result.malformed.push({ reason: "Position record had no coordinates.", fragment: row });
        return undefined;
      }
      return {
        kind: "location", latitude: lat, longitude: lon,
        city: str(row, "locality"), state: str(row, "region"),
      };
    }
    case "speed_kph": {
      const kph = num(row, "value");
      return kph == null ? undefined : { kind: "speed", milesPerHour: kmToMiles(kph) };
    }
    case "heading_deg": {
      const deg = num(row, "value");
      return deg == null ? undefined : { kind: "heading", degrees: deg };
    }
    case "odometer_km": {
      const km = num(row, "value");
      return km == null ? undefined : { kind: "odometer", miles: kmToMiles(km) };
    }
    case "engine_hours": {
      const hours = num(row, "value");
      return hours == null ? undefined : { kind: "engine_hours", hours };
    }
    case "ignition": {
      const v = num(row, "value");
      return v == null ? undefined : { kind: "ignition", on: v !== 0 };
    }
    case "motion": {
      const v = num(row, "value");
      return v == null ? undefined : { kind: "motion", moving: v !== 0 };
    }
    case "fuel_pct": {
      const percent = num(row, "value");
      return percent == null ? undefined : { kind: "fuel_level", percent };
    }
    case "fault": {
      const code = str(row, "code");
      if (!code) {
        result.malformed.push({ reason: "Fault record had no code.", fragment: row });
        return undefined;
      }
      return {
        kind: "diagnostic", code,
        description: str(row, "text"),
        severity: severityOf(row.level),
        active: (num(row, "value") ?? 1) !== 0,
        spn: num(row, "spn"), fmi: num(row, "fmi"),
      };
    }
    case "hos":
    case "duty_status":
      // Contracted capability, not a bug: Beta genuinely has no HOS data.
      result.unsupported.push({
        kind: "hos_summary",
        reason: "Mock Telematics — Beta reports vehicle data only. It has no hours-of-service feed.",
      });
      return undefined;
    default:
      result.unsupported.push({ kind: metric, reason: `Beta sent an unknown metric "${metric}".` });
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Gamma — nightly file import, no event ids                                   */
/* -------------------------------------------------------------------------- */

/**
 * Gamma's wire shape:
 *
 *   { export_date, rows: [ { vehicle, at, odo, hours, lat, lon, duty, drive_left } ] }
 *
 * One row carries several signals at once, which is how a file export usually
 * looks and is a second useful difference: one row produces up to four
 * candidates, and they must not collide on the dedupe key — which is exactly
 * why that key includes the signal kind.
 *
 * Gamma stamps no ids of its own. Deduplication therefore rests entirely on the
 * derived key, and if that key were wrong a re-uploaded file would double every
 * number in the system. It is the case most worth having a test for.
 */
const gammaAdapter: EldProviderAdapter = {
  providerId: "prov_mock_gamma",
  describe: () => findProvider("prov_mock_gamma")!,
  acceptsTransport: (t) => t === "import" || t === "simulated",
  verify: verifyShared,
  normalize(delivery) {
    const result = empty();
    for (const row of rows(delivery.body, "rows")) {
      if (!isRecord(row)) {
        result.malformed.push({ reason: "Export row was not an object.", fragment: row });
        continue;
      }
      const vehicle = str(row, "vehicle");
      if (!vehicle) {
        result.malformed.push({ reason: "Export row had no vehicle.", fragment: row });
        continue;
      }
      const base = {
        deviceExternalId: vehicle,
        sourceAt: str(row, "at") ?? "",
        // Deliberately no externalEventId: Gamma does not issue one.
      };
      const lat = num(row, "lat");
      const lon = num(row, "lon");
      if (lat != null && lon != null) {
        push(result, this.providerId, {
          ...base, kind: "location",
          value: {
            kind: "location", latitude: lat, longitude: lon,
            city: str(row, "city"), state: str(row, "state"),
          },
        });
      }
      const odo = num(row, "odo");
      if (odo != null) {
        push(result, this.providerId, {
          ...base, kind: "odometer", value: { kind: "odometer", miles: odo },
        });
      }
      const hours = num(row, "hours");
      if (hours != null) {
        push(result, this.providerId, {
          ...base, kind: "engine_hours", value: { kind: "engine_hours", hours },
        });
      }
      const duty = str(row, "duty");
      const allowed = ["off_duty", "sleeper", "driving", "on_duty_not_driving"];
      if (duty && allowed.includes(duty)) {
        push(result, this.providerId, {
          ...base, kind: "hos_summary",
          value: {
            kind: "hos_summary",
            dutyStatus: duty as "off_duty" | "sleeper" | "driving" | "on_duty_not_driving",
            driveSecondsRemaining: num(row, "drive_left_s"),
            shiftSecondsRemaining: num(row, "shift_left_s"),
            cycleSecondsRemaining: num(row, "cycle_left_s"),
          },
        });
      } else if (duty) {
        result.malformed.push({ reason: `Unrecognised duty status "${duty}".`, fragment: row });
      }
    }
    return result;
  },
};

/* -------------------------------------------------------------------------- */
/* Delta — trailer tracker, position only                                      */
/* -------------------------------------------------------------------------- */

/**
 * Delta's wire shape:
 *
 *   { pings: [ { tag, t, lat, lng, acc, moving } ] }
 *
 * A battery tracker on a slow poll. It knows nothing about an engine, a driver
 * or a meter, and it will never be asked to.
 */
const deltaAdapter: EldProviderAdapter = {
  providerId: "prov_mock_delta",
  describe: () => findProvider("prov_mock_delta")!,
  acceptsTransport: (t) => t === "poll" || t === "simulated",
  verify: verifyShared,
  normalize(delivery) {
    const result = empty();
    for (const row of rows(delivery.body, "pings")) {
      if (!isRecord(row)) {
        result.malformed.push({ reason: "Ping was not an object.", fragment: row });
        continue;
      }
      const tag = str(row, "tag");
      const lat = num(row, "lat");
      const lng = num(row, "lng");
      if (!tag) {
        result.malformed.push({ reason: "Ping had no tag.", fragment: row });
        continue;
      }
      const base = {
        deviceExternalId: tag,
        sourceAt: str(row, "t") ?? "",
        externalEventId: str(row, "ping_id"),
        accuracyMeters: num(row, "acc"),
      };
      if (lat != null && lng != null) {
        push(result, this.providerId, {
          ...base, kind: "location",
          value: { kind: "location", latitude: lat, longitude: lng, city: str(row, "near") },
        });
      }
      const moving = bool(row, "moving");
      if (moving != null) {
        push(result, this.providerId, {
          ...base, kind: "motion", value: { kind: "motion", moving },
        });
      }
    }
    return result;
  },
};

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const MOCK_ELD_ADAPTERS: readonly EldProviderAdapter[] = [
  alphaAdapter, betaAdapter, gammaAdapter, deltaAdapter,
] as const;

const ADAPTERS = new Map(MOCK_ELD_ADAPTERS.map((a) => [a.providerId, a]));

export class UnknownProviderError extends Error {
  constructor(readonly providerId: string) {
    super(
      `No adapter is registered for provider "${providerId}". Antcolos will not `
      + "guess at the shape of a payload it has never been taught to read.",
    );
    this.name = "UnknownProviderError";
  }
}

export function adapterFor(providerId: string): EldProviderAdapter {
  const adapter = ADAPTERS.get(providerId);
  if (!adapter) throw new UnknownProviderError(providerId);
  return adapter;
}

export function hasAdapter(providerId: string): boolean {
  return ADAPTERS.has(providerId);
}

/** Every adapter in this build is a mock. Stated as a function, not a comment. */
export function adaptersAreMocked(): boolean {
  return MOCK_ELD_PROVIDERS.every((p) => p.mock);
}

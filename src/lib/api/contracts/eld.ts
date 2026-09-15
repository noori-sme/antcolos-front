import type {
  EldBindingEndReason, EldConnection, EldDashboard, EldDeviceDetail, EldDeviceKind,
  EldDeviceView, EldDriverBinding, EldIngestionResult, EldProvider, EldPublishedSignal,
  EldRawPayload, EldShare, EldSignalClass, EldTransport, EldVehicleBinding,
  EquipmentTelemetrySnapshot, NeedsYouItem, TelemetryEvent, TelemetrySignalKind,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ELD & Telematics, as the UI sees it.
 *
 * Read the method list for what is NOT here. There is no `setTruckStatus`, no
 * `recordArrival`, no `updateMaintenanceMeter`, no `fileIftaMileage` and no
 * `confirmMilestone`. Fleet, the Trip Workflow, Maintenance, Fuel/IFTA and
 * Compliance own those, they already exist, and a second way to change one of
 * their facts is how a product ends up with two screens that disagree.
 *
 * What this layer offers instead is: what devices exist, what state they are
 * in, what they were bound to and when, what they reported, what Antcolos made
 * of it, and what it has QUEUED for the modules that consume it. `signals()`
 * returns records addressed to those modules. Nothing has been transmitted, and
 * every record says so.
 *
 * One more absence worth naming: there is no `confirm` method. Nothing in this
 * module can promote an inference to a confirmed fact, because confirming is a
 * human act that belongs to the module that owns the record — and a machine
 * with a `confirm()` in reach eventually calls it.
 */

export interface EldEventQuery {
  deviceId?: string;
  truckId?: string;
  driverProfileId?: string;
  kinds?: readonly TelemetrySignalKind[];
  ingestion?: readonly TelemetryEvent["ingestion"][];
  sinceIso?: string;
  limit?: number;
}

export interface ConnectProviderInput {
  providerId: string;
  label: string;
  transport: EldTransport;
  freshnessExpectationMinutes: number;
  /** Signal kinds this link is being asked for. Unsupported ones are reported. */
  requestedSignals?: readonly TelemetrySignalKind[];
}

export interface RegisterDeviceInput {
  connectionId: string;
  serialNumber: string;
  kind: EldDeviceKind;
  /** The provider's own identifier for the unit. */
  externalId: string;
  model?: string;
  firmware?: string;
}

export interface BindDeviceInput {
  deviceId: string;
  truckId: string;
  /** Defaults to now. A binding may be recorded as having started earlier. */
  effectiveFrom?: string;
  note?: string;
}

export interface BindDriverInput {
  deviceId: string;
  driverProfileId: string;
  effectiveFrom?: string;
  note?: string;
}

/**
 * A delivery arriving at the webhook / import / poll boundary.
 *
 * The same shape for all three, because the difference between them is the
 * transport and not the data — and a module with three ingestion paths would
 * have three places for a deduplication bug to hide.
 */
export interface IngestDeliveryInput {
  connectionId: string;
  transport: EldTransport;
  body: Record<string, unknown>;
  externalId?: string;
  secret?: string;
}

export interface GrantShareInput {
  viewerOrganizationId: string;
  truckId: string;
  signalClasses: readonly EldSignalClass[];
  note?: string;
}

export interface EldService {
  /** The organization-scoped picture. Requires `eld:view`. */
  dashboard(ctx: ServiceContext): Promise<EldDashboard>;
  /** Every provider this build knows. All of them are mocks. */
  providers(ctx: ServiceContext): Promise<EldProvider[]>;
  connections(ctx: ServiceContext): Promise<EldConnection[]>;
  devices(ctx: ServiceContext): Promise<EldDeviceView[]>;
  /** One device in full. Unknown and forbidden are the same answer. */
  device(ctx: ServiceContext, deviceId: string): Promise<EldDeviceDetail>;
  /** The derived equipment picture, one per truck the caller may see. */
  snapshots(ctx: ServiceContext): Promise<EquipmentTelemetrySnapshot[]>;
  snapshot(ctx: ServiceContext, truckId: string): Promise<EquipmentTelemetrySnapshot>;
  /** Normalized events, including the flagged and rejected ones. */
  events(ctx: ServiceContext, query?: EldEventQuery): Promise<TelemetryEvent[]>;
  /** What the provider actually sent. Requires `eld:raw:view`. */
  rawPayloads(ctx: ServiceContext, limit?: number): Promise<EldRawPayload[]>;
  rawPayload(ctx: ServiceContext, rawPayloadId: string): Promise<EldRawPayload>;
  /** Typed handoffs queued for other modules. Nothing has been transmitted. */
  signals(ctx: ServiceContext, limit?: number): Promise<EldPublishedSignal[]>;

  connect(ctx: ServiceContext, input: ConnectProviderInput): Promise<EldConnection>;
  disconnect(ctx: ServiceContext, connectionId: string, reason: string): Promise<EldConnection>;
  registerDevice(ctx: ServiceContext, input: RegisterDeviceInput): Promise<EldDeviceView>;
  retireDevice(ctx: ServiceContext, deviceId: string): Promise<EldDeviceView>;

  bindDeviceToTruck(ctx: ServiceContext, input: BindDeviceInput): Promise<EldVehicleBinding>;
  endVehicleBinding(
    ctx: ServiceContext, bindingId: string, reason: EldBindingEndReason,
  ): Promise<EldVehicleBinding>;
  bindDriverToDevice(ctx: ServiceContext, input: BindDriverInput): Promise<EldDriverBinding>;
  endDriverBinding(
    ctx: ServiceContext, bindingId: string, reason: EldBindingEndReason,
  ): Promise<EldDriverBinding>;

  /**
   * The webhook / import / poll boundary, exercised from the labelled mock
   * console. Requires `eld:ingest`, and the payload is stored before it is
   * judged — even a refused delivery leaves a row.
   */
  ingest(ctx: ServiceContext, input: IngestDeliveryInput): Promise<EldIngestionResult>;

  /** Explicit grants to dispatch workspaces. Nothing is shared by default. */
  shares(ctx: ServiceContext): Promise<EldShare[]>;
  grantShare(ctx: ServiceContext, input: GrantShareInput): Promise<EldShare>;
  revokeShare(ctx: ServiceContext, shareId: string): Promise<EldShare>;

  /** Operational exceptions derived from devices and the event stream. */
  needsYou(ctx: ServiceContext): Promise<NeedsYouItem[]>;
}

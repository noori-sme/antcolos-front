import type {
  FleetAssetKind, FleetAssignmentRecord, FleetDashboard, FleetEquipmentFilters,
  FleetEquipmentRow, FleetIntegrationDescriptor, FleetLocationReading,
  FleetTelemetryReading, FleetUtilizationSummary, NeedsYouItem,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * The shared operational fleet layer, as the UI sees it.
 *
 * Read the method list and notice what is missing: there is no `setStatus`, no
 * `assignDriver`, no `attachTrailer` and no `endLease`. Those already exist on
 * the modules that own the records, and putting a second copy here is how a
 * product ends up with two ways to change one fact that can disagree.
 *
 * This layer reads across those records and writes exactly one thing of its
 * own — a telemetry reading — because nothing else in Antcolos knows where the
 * equipment physically is.
 */

export interface RecordTelemetryInput {
  assetKind: FleetAssetKind;
  assetId: string;
  location?: FleetLocationReading;
  odometerMiles?: number;
  engineHours?: number;
  /** When the fact was true in the world. Defaults to now. */
  observedAt?: string;
  note?: string;
}

export interface FleetAssetDetail {
  row: FleetEquipmentRow;
  utilization: FleetUtilizationSummary;
  /** Newest first. Append-only: a correction is a new row, never an edit. */
  telemetryHistory: FleetTelemetryReading[];
  /**
   * Every dated assignment this asset has ever had that the viewer may see,
   * open and closed. Ended rows are kept — reassigning ends an assignment, it
   * never erases one.
   */
  assignmentHistory: FleetAssignmentRecord[];
}

export interface FleetService {
  /** The organization-scoped operational picture. Requires `fleet:view`. */
  dashboard(ctx: ServiceContext): Promise<FleetDashboard>;
  /** One row per asset the caller may operationally see. */
  equipment(ctx: ServiceContext, filters?: FleetEquipmentFilters): Promise<FleetEquipmentRow[]>;
  /** One asset in full. Unknown and forbidden are the same answer. */
  asset(ctx: ServiceContext, assetKind: FleetAssetKind, assetId: string): Promise<FleetAssetDetail>;
  /** The immutable assignment history for one asset. */
  assignmentHistory(
    ctx: ServiceContext, assetKind: FleetAssetKind, assetId: string,
  ): Promise<FleetAssignmentRecord[]>;
  /** Append a location / odometer / engine-hours reading. Never an update. */
  recordTelemetry(ctx: ServiceContext, input: RecordTelemetryInput): Promise<FleetTelemetryReading>;
  /** The typed extension points. Every one of them reports `not_connected`. */
  integrations(ctx: ServiceContext): Promise<FleetIntegrationDescriptor[]>;
  /** Operational exceptions derived from the records, for the Needs You queue. */
  needsYou(ctx: ServiceContext): Promise<NeedsYouItem[]>;
}

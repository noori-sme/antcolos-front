import type { LoadException } from "./load-exception";
import type { LoadRecordStatus, LoadRecordStop } from "./load-record";

/**
 * A load as its driver sees it on the real API (F1.4, plan 16):
 * ../antcolos/docs/requirements/loads-api-contract.md §12. No rate, TONU,
 * broker contact or internal notes.
 */

export type DriverMilestone =
  | "start_trip"
  | "arrived"
  | "loaded"
  | "awaiting_release"
  | "released"
  | "departed"
  | "delivered";

export interface NextMilestone {
  milestone: DriverMilestone;
  /** The stop it applies to; null for start_trip, awaiting_release, released. */
  stopSequence: number | null;
}

export type LoadDocumentType = "rate_confirmation" | "bol" | "pod";

/** A document on a load (contract §13). Download with GET /documents/:id/file. */
export interface LoadDocument {
  id: string;
  type: LoadDocumentType;
  status: "expected" | "received" | "extracted" | "reviewed" | "accepted";
  stopSequence: number | null;
  version: number;
  superseded: boolean;
  source: string;
  uploadedByUserId: string;
  receivedAt: string;
}

export interface DriverLoad {
  id: string;
  status: LoadRecordStatus;
  statusChangedAt: string;
  brokerLoadNumber: string;
  referenceNumbers: string[];
  equipmentType: string;
  weightLbs: number | null;
  commodity: string | null;
  specialInstructions: string | null;
  requiresBrokerRelease: boolean;
  truckId: string | null;
  driverAssignedAt: string | null;
  driverAcceptedAt: string | null;
  stops: LoadRecordStop[];
  documents: LoadDocument[];
  /** Problems reported on this load, newest first (no money; F1.5). */
  exceptions: LoadException[];
  nextMilestones: NextMilestone[];
}

export interface DriverLoadPage {
  items: DriverLoad[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** What the driver records (contract §11). */
export interface RecordMilestoneInput {
  milestone: DriverMilestone;
  stopSequence?: number | null;
}

/** A BOL or POD upload (contract §13). */
export interface UploadLoadDocumentInput {
  type: "bol" | "pod";
  stopSequence?: number | null;
  file: File;
}

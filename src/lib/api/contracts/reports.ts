import type {
  DrilldownRecord, DrilldownRef, ReportAudience, ReportCatalogEntry,
  ReportFilters, ReportId, ReportRequest, ReportResult, ReportSourceStatus,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * Reporting.
 *
 * Read-only by construction: there is no method here that creates, edits or
 * deletes anything. Reporting analyzes records that other modules own, and the
 * absence of a write method is what keeps a second set of books from appearing.
 *
 * Everything is enforced here rather than in the UI: the permission to open a
 * report, the audience a membership belongs to, the workspace its records come
 * from, and which carriers a dispatch workspace may analyze. A screen that
 * renders a forbidden button still fails at this seam.
 */

export interface ReportWorkspace {
  organizationId: string;
  organizationName: string;
  /** Resolved from the organization type and the caller's permissions. */
  audience: ReportAudience;
  /** Reports this membership may run, and what is missing where it may not. */
  entries: ReportCatalogEntry[];
  /**
   * Carriers selectable in the organization filter. A dispatch workspace only
   * ever sees carriers that have shared their records; a carrier workspace sees
   * itself, because there is nothing else it could report on.
   */
  carriers: { id: string; name: string }[];
}

export interface DrilldownRequest {
  reportId: ReportId;
  /** The filters the number was produced under. Drill-down re-runs them. */
  filters: ReportFilters;
  ref: DrilldownRef;
}

export interface ReportsService {
  /** What this membership may run here, and why. */
  workspace(ctx: ServiceContext): Promise<ReportWorkspace>;

  /**
   * Runs one report. Throws PermissionDeniedError when the membership lacks
   * reports:view or the report's own permissions, and when an individual
   * membership asks for an organization-wide report.
   */
  run(ctx: ServiceContext, request: ReportRequest): Promise<ReportResult>;

  /**
   * The source records behind one number. Ids that do not belong to the
   * caller's workspace, scope or shared carriers are not returned — a
   * drill-down cannot be used to reach a record the report itself excluded.
   */
  drilldown(ctx: ServiceContext, request: DrilldownRequest): Promise<DrilldownRecord[]>;

  /** Every module reporting reads, and whether it is live or a mock adapter. */
  sources(ctx: ServiceContext): Promise<ReportSourceStatus[]>;
}

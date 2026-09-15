export * from "./context";
export type * from "./needs-you";
export type * from "./home";
export type * from "./directory";
export type * from "./loads";
export type * from "./fuel";
export type * from "./reports";
export type * from "./compliance";
export type * from "./fleet";
export type * from "./settlements";
export type * from "./driver-workflow";
export type * from "./invoices";
export type * from "./documents";
export type * from "./agreements";
export type * from "./audit";
export type * from "./risk";




import type { AuditService } from "./audit";
import type { RiskService } from "./risk";
import type { ComplianceService } from "./compliance";
import type { DirectoryService } from "./directory";
import type { FuelService, IftaService } from "./fuel";
import type { FleetService } from "./fleet";
import type { DriverWorkflowService } from "./driver-workflow";
import type { InvoicesService } from "./invoices";
import type { DocumentsService } from "./documents";
import type { AgreementsService } from "./agreements";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { SettlementsService } from "./settlements";
import type { NeedsYouService } from "./needs-you";
import type { ReportsService } from "./reports";

/** The seam Taqi implements against. The UI only ever sees this shape. */
export interface AntcolosServices {
  needsYou: NeedsYouService;
  home: HomeService;
  directory: DirectoryService;
  loads: LoadsService;
  fuel: FuelService;
  ifta: IftaService;
  reports: ReportsService;
  compliance: ComplianceService;
  /** The shared operational layer over trucks, trailers, drivers and leases. */
  fleet: FleetService;
  settlements: SettlementsService;
  /** Driver proposals, finalized load posts and the trip workflow. */
  driverWorkflow: DriverWorkflowService;
  invoices: InvoicesService;
  documents: DocumentsService;
  /**
   * Contracts & Relationships — the TERMS of a business relationship.
   *
   * Named `agreements` because "contract" already means the service interface in
   * this folder. It holds no method that creates, alters or ends anybody's
   * access: those belong to the services above and to the registries, and this
   * one can only ask.
   */
  agreements: AgreementsService;
  /**
   * The ONE audit ledger. Every module projects into it; none of them keeps a
   * second one, and nothing but `audit.record` appends to it.
   */
  audit: AuditService;
  /** Signals and cases, which are not audit events. See contracts/risk.ts. */
  risk: RiskService;
}

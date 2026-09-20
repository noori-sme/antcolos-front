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
export type * from "./responsibility";
export type * from "./access";
export type * from "./workforce";
export type * from "./qualification";
export type * from "./referrals";
export type * from "./profile";
export {
  AvatarRejectedError, NotProfileOwnerError, ProfileAlreadyInitializedError,
  ProfileInputError, ProfileNotFoundError, UsernameImmutableError,
} from "./profile";
export type * from "./import";




import type { AccessService } from "./access";
import type { ImportService } from "./import";
import type { AuditService } from "./audit";
import type { RiskService } from "./risk";
import type { ComplianceService } from "./compliance";
import type { DirectoryService } from "./directory";
import type { FuelService, IftaService } from "./fuel";
import type { FleetService } from "./fleet";
import type { EldService } from "./eld";
import type { DriverWorkflowService } from "./driver-workflow";
import type { InvoicesService } from "./invoices";
import type { DocumentsService } from "./documents";
import type { AgreementsService } from "./agreements";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { SettlementsService } from "./settlements";
import type { NeedsYouService } from "./needs-you";
import type { ReportsService } from "./reports";
import type { ResponsibilityService } from "./responsibility";
import type { WorkforceService } from "./workforce";
import type { ProfileService } from "./profile";
import type { QualificationService } from "./qualification";
import type { ReferralsService } from "./referrals";

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
  /**
   * ELD & Telematics: devices, connections, bindings and the normalized event
   * stream underneath the fleet. It publishes typed signals to the modules
   * above it and writes to none of their records.
   */
  eld: EldService;
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
  /**
   * Hierarchical responsibility, delegation and escalation.
   *
   * The layer that answers "who" for every piece of work above. It owns no MT
   * Loop and no Needs You item — it reads the typed responsibility context each
   * of those emits and writes back nothing about the work itself. It is also
   * not a second permission, team or notification system: see
   * contracts/responsibility.ts for what it deliberately is not.
   */
  responsibility: ResponsibilityService;
  /**
   * Workforce & HR — the WORKING RELATIONSHIP with a person.
   *
   * It owns no identity, no access, no document, no contract term, no
   * qualification decision and no money. It answers the one question the
   * records above could not: on what basis, in what capacity, from what date
   * and in what status does this person work with this organization.
   */
  /** Invitations, and what accepting one actually does. */
  access: AccessService;
  workforce: WorkforceService;
  /**
   * The driver qualification file: a carrier's custody of the exact document
   * VERSIONS it received, reviewed and relied on, and of its obligation to keep
   * them.
   *
   * Not a second Document Center. Every record is a pinned reference into the
   * one document store, and there is no method that takes or stores a file.
   */
  qualification: QualificationService;
  /**
   * Bringing an existing operation's records in.
   *
   * It owns no canonical record. Every commit goes through the module that
   * already writes that record, and a claim it cannot resolve stays a claim
   * rather than becoming a second registry of people and trucks.
   */
  import: ImportService;
  /**
   * Introductions — one person telling a company about another person.
   *
   * It owns no identity, no seat, no permission, no engagement and no
   * document, and it cannot create one: read `contracts/referrals.ts` for the
   * list of things a Referral deliberately is not. Its only route into the
   * rest of the product is a set of PREFILL VALUES for `access.create`, which
   * is still the one invitation command.
   */
  referrals: ReferralsService;
  /**
   * The permanent, organization-independent career record.
   *
   * ★ THE ONE SERVICE WHOSE READS TAKE NO ServiceContext ★
   * Every other entry on this interface is read AS A MEMBERSHIP, INSIDE AN
   * ORGANIZATION, because every other record belongs to one. A profile belongs
   * to a person: it is read by signed-out strangers following a link and by
   * link-preview crawlers, and it outlives every organization the person ever
   * joins. Its reads take a viewer — an optional user id, and no permission —
   * which is what makes it structurally impossible for an employer to unlock a
   * profile section its owner chose to hide. See contracts/profile.ts.
   */
  profile: ProfileService;
}

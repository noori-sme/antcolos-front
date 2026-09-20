/** Flat, granular, composable. `domain:action`. A typo is a compile error. */
export type PermissionKey =
  // Loads
  | "loads:view" | "loads:create" | "loads:edit"
  | "loads:delete" | "loads:status:update" | "loads:export"
  // Dispatch
  | "dispatch:view" | "loads:assign"
  // Tracking — watching a load run, and letting a customer watch a little of it.
  // Seeing where a truck is, sharing that outside the organization, and sending
  // an update to a broker are three different powers and three different keys.
  | "tracking:view" | "tracking:share" | "tracking:update:send"
  // Driver decision and trip workflow
  | "proposals:view" | "proposals:respond" | "trips:execute"
  // Drivers
  | "drivers:view" | "drivers:create" | "drivers:edit" | "drivers:delete"
  // Trucks
  | "trucks:view" | "trucks:create" | "trucks:edit" | "trucks:delete"
  | "trucks:documents:manage" | "trucks:assignments:manage"
  | "trucks:relationships:manage" | "trucks:ownership:review"
  // Trailers — a separate module from trucks, never the same permission
  | "trailers:view" | "trailers:create" | "trailers:edit" | "trailers:delete"
  | "trailers:documents:manage" | "trailers:attachments:manage"
  | "trailers:relationships:manage" | "trailers:ownership:review"
  | "trailers:status:manage"
  // Fleet operations — the shared layer over trucks, trailers and drivers.
  // Deliberately small: assigning and attaching already have their own keys in
  // the modules that own those records, and duplicating them here would create
  // two permissions that can disagree about one action.
  | "fleet:view" | "fleet:telemetry:record"
  // ELD & Telematics — the machine layer under the fleet. Separate from
  // `fleet:*` on purpose: seeing the reconciled fleet picture is not the same
  // power as reading a driver's clock, a truck's fault codes or the raw
  // payloads a provider posted, and collapsing them would hand all four to
  // anybody with one.
  | "eld:view" | "eld:devices:manage" | "eld:bindings:manage" | "eld:ingest"
  | "eld:location:precise:view" | "eld:diagnostics:view" | "eld:hos:view"
  | "eld:raw:view"
  // Customers
  | "customers:view" | "customers:create" | "customers:edit" | "customers:delete"
  | "customers:private:manage" | "customers:resolve"
  // Documents
  | "documents:view" | "documents:upload" | "documents:download"
  | "documents:approve" | "documents:delete"
  // Settlements
  | "settlements:view" | "settlements:create" | "settlements:approve" | "settlements:export"
  | "settlements:dispute" | "settlements:dispute:resolve" | "settlements:adjust"
  | "settlements:pay" | "settlements:void"
  // Invoices
  | "invoices:view" | "invoices:create" | "invoices:edit"
  | "invoices:send" | "invoices:export"
  // Reports
  | "reports:view" | "reports:export"
  // Accounting and financial information
  | "rates:view" | "rates:edit"
  | "revenue:view" | "expenses:view" | "profitability:view"
  // Fuel and IFTA — a fuel purchase and a mileage record are separate powers
  | "fuel:view" | "fuel:record" | "fuel:import"
  | "fuel:review" | "fuel:correct" | "fuel:export" | "fuel:costs:view"
  | "mileage:view" | "mileage:record" | "mileage:review"
  | "ifta:view" | "ifta:manage"
  // Compliance & safety
  | "compliance:view" | "compliance:manage"
  // Maintenance — equipment upkeep. Separate from compliance, which is paperwork.
  | "maintenance:view" | "maintenance:manage"
  | "maintenance:defects:report" | "maintenance:defects:manage"
  | "maintenance:repairs:manage" | "maintenance:service:record"
  | "maintenance:costs:view" | "maintenance:outofservice:manage"
  | "maintenance:share:manage"
  // Insurance and claims — a module of its own, never folded into compliance
  | "insurance:view" | "insurance:manage"
  | "insurance:sensitive:view" | "insurance:share:manage"
  | "claims:view" | "claims:create" | "claims:manage" | "claims:financials:view"
  // Contracts and relationships — the TERMS of a business relationship.
  // Deliberately separate from the keys that control access: `members:edit`,
  // `invitations:create` and `trucks:relationships:manage` are what actually
  // change what somebody can do. A contract permission never grants access.
  | "contracts:view" | "contracts:create" | "contracts:edit"
  | "contracts:review" | "contracts:sign" | "contracts:amend"
  | "contracts:terminate" | "contracts:cancel"
  | "contracts:signers:manage" | "contracts:requirements:waive"
  | "contracts:links:manage" | "contracts:financials:view" | "contracts:export"
  // Workforce & HR — the WORKING RELATIONSHIP, and nothing else.
  //
  // Deliberately separate from `members:*`, which is ACCESS. An HR coordinator
  // who may onboard somebody must not thereby be able to change what anybody
  // can do in Antcolos, and `members:edit` is exactly that power. Ending an
  // engagement is split from managing one because they are different
  // authorities: whoever fills a seat is not automatically whoever may end
  // somebody's employment.
  | "workforce:view" | "workforce:manage" | "workforce:end"
  // Driver qualification file — a carrier's retained custody records.
  //
  // `qualification:view` exists because `documents:view` and `compliance:view`
  // are held broadly — every seeded dispatcher has both — and retained
  // qualification evidence must not follow a relationship's end into their
  // hands. Adoption itself reuses `compliance:manage`: deciding somebody is
  // qualified has always been Safety's. Disposal is its own narrow key because
  // it discharges a retention obligation, which is a different act from
  // reading the file.
  | "qualification:view" | "qualification:dispose"
  // Organization members
  | "members:view" | "members:edit" | "members:suspend" | "permissions:manage"
  // Invitations
  | "invitations:view" | "invitations:create" | "invitations:resend" | "invitations:revoke"
  // Organization settings
  | "organization:manage" | "integrations:view" | "integrations:manage" | "audit:view"
  // Audit & Risk — the one ledger, and the cases opened off it.
  //
  // Reading the ledger, reading risk, and WORKING risk are three different
  // powers on purpose: a compliance reviewer who may read everything is not
  // thereby somebody who may close an investigation into a colleague.
  | "audit:export"
  | "risk:view" | "risk:assign" | "risk:investigate" | "risk:resolve";

/**
 * One group per product module, in the order an owner reads them: the daily
 * work first, then the money, then who is allowed in.
 */
export type PermissionGroup =
  | "loads" | "dispatch" | "tracking" | "drivers" | "trucks" | "trailers"
  | "fleet" | "eld"
  | "loads" | "dispatch" | "driver_workflow" | "drivers" | "trucks" | "trailers"
  | "customers" | "documents" | "settlements" | "invoices" | "reports"
  | "accounting" | "fuel" | "compliance"
  | "accounting" | "compliance" | "maintenance" | "insurance" | "claims"
  | "contracts"
  | "workforce"
  | "members" | "invitations" | "organization" | "audit";

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  /** Plain language. Written for an owner who has never seen a permission UI. */
  description: string;
  group: PermissionGroup;
  /** Shown with a warning before it can be granted. */
  sensitive?: boolean;
  /** Money and margin. Warned about separately and more loudly. */
  financial?: boolean;
  /** Absent = available to every organization type. */
  orgTypes?: OrganizationType[];
  /**
   * Keys that have to be held alongside this one for it to mean anything.
   *
   * ADVISORY, not enforced: a template carrying `loads:edit` without
   * `loads:view` is saved exactly as chosen, and the editor says so rather than
   * quietly adding a permission nobody ticked. Silently widening a selection is
   * how an owner ends up granting access they never agreed to.
   */
  prerequisites?: PermissionKey[];
  /**
   * What this key reaches BEYOND the action itself — the sentence an owner needs
   * in order to read the grant correctly.
   *
   * Two kinds of thing live here, and both are already true of the product:
   * record scope (`MembershipScope` narrows some keys to the holder's own
   * records) and a second basis that has to agree (a carrier's per-truck
   * Dispatch delegation, a driver's own sharing consent). Holding the key is
   * necessary in those cases and never sufficient.
   */
  scopeNote?: string;
}

export type OrganizationType = "CARRIER" | "DISPATCH_AGENCY";

/**
 * A reusable, organization-scoped way of CHOOSING permissions. Not a role in
 * the sense of a second authorization system.
 *
 * ★ WHAT A TEMPLATE IS NOT ★
 * Nothing in Antcolos asks a template what somebody may do. `can()` reads a
 * permission set, and that set comes from the Membership — see
 * `AppliedTemplate` below for why the two can never disagree. A template that
 * is edited, archived or deleted changes nobody's access, because nobody's
 * access was ever being read from it.
 *
 * `version` is what makes that checkable. It rises on every saved edit to the
 * permission selection, so a Membership carrying version 3 of "Limited
 * Dispatcher" can be compared against the template's current version and the
 * difference shown — rather than the difference being applied to them while
 * they are working.
 */
export interface PermissionTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /**
   * Rises by one whenever `permissions` changes. Renaming or rewording does
   * NOT bump it: nobody's access depends on the name, so re-applying a template
   * because its description was tidied would be asking an owner to confirm a
   * change that is not one.
   */
  version: number;
  /** Seeded templates may be edited but not deleted. */
  seeded: boolean;
  /** Archived templates keep working for whoever holds them and cannot be applied again. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The record of a template having been applied to one Membership.
 *
 * ★ THE SNAPSHOT IS THE POINT ★
 * `permissions` is a COPY of what the template carried at the moment somebody
 * applied it, not a pointer to what it carries now. That single decision is
 * what makes "editing a saved template does not silently change existing
 * people's access" a structural property rather than a promise: there is no
 * code path from a template edit to a Membership's effective permissions,
 * because the Membership stopped reading the template the instant it was
 * applied.
 *
 * What is kept BESIDES the snapshot is provenance — which template, under which
 * name, at which version, applied by whom and when — so a screen can say "this
 * came from Limited Dispatcher (v2)" and an owner can be shown, later, exactly
 * what moving them to v4 would change.
 */
export interface AppliedTemplate {
  templateId: string;
  /** Snapshotted, so a renamed template does not rewrite the history of a seat. */
  templateName: string;
  /** The template version this snapshot was taken from. */
  version: number;
  /** Exactly the keys the template carried when applied. Never re-read. */
  permissions: PermissionKey[];
  appliedAt: string;
  /**
   * The membership that applied it. Never a User: applying a template is an act
   * performed from inside an organization, by a seat that held the authority.
   */
  appliedByMembershipId: string;
  /** Snapshotted for the same reason as `templateName`. */
  appliedByName: string;
}

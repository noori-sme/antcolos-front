import type {
  DriverVisibleAdoption, QualificationFilters, QualificationPurpose,
  QualificationRecordCategory, QualificationRecordView, QualificationSourceKind,
  RetentionPolicy,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE DRIVER QUALIFICATION FILE SEAM ★
 *
 * A carrier's custody of the exact document versions it received, reviewed and
 * relied on — and of its own obligation to keep them.
 *
 * Notice what is NOT here. There is no `upload`, no `store`, no `replace` and
 * no method that takes a file: every record is a pinned reference into the one
 * Document Center, by the ids it already assigns. There is no `delete` either —
 * `authorizeDisposal` is the only way a record leaves the working file, it
 * refuses while any retention obligation stands, and it appends rather than
 * removes.
 *
 * Adoption is deliberately its own command. Sharing a document is not
 * acceptance, opening it is not adoption, and a review is not an engagement:
 * each is a separate, explicit, audited act, and this interface has no method
 * that could quietly perform two of them at once.
 *
 * ── HOW READS ARE SCOPED (A6) ─────────────────────────────────────────────
 * Every method takes a `ServiceContext` and none takes an organization id, so
 * the caller cannot name a workspace. Records are read through
 * `record.organizationId` — the carrier that holds the file — and through
 * nothing else. In particular a record is never readable because it NAMES the
 * reader: `driverProfileId` identifies a person the way `FactScope`'s carrier
 * field identifies a carrier, and A6 is explicit that such a field is
 * attribution, never a grant. The one read that crosses an organization is
 * `adoptionsForDriver` for the driver's own record, which rests on the existing
 * self-access basis — the membership's own `driverProfileId` — and returns a
 * narrow projection built field by field.
 *
 * ███ FRONTEND ONLY ███
 * This build proves the SHAPE: version pinning, independent per-carrier
 * custody, organization isolation, retention states and the refusals. It is not
 * a compliant DQ-file system. Durable encrypted storage, content hashing,
 * immutable version storage, retention locks, legal holds, record-specific
 * retention schedules, server-side authorization, deletion jobs and any
 * official MVR, Clearinghouse, testing or medical-source verification are the
 * backend's.
 */

export interface AdoptDocumentInput {
  /**
   * The EXACT document version being adopted. Not a lineage: a qualification
   * record never points at "whatever is current".
   */
  documentId: string;
  driverProfileId: string;
  category: QualificationRecordCategory;
  purpose: QualificationPurpose;
  /** The engagement it is being adopted under, when there is one. */
  engagementId?: string;
  /** The share package it arrived through, when it arrived through one. */
  sharePackageId?: string;
  /**
   * Where the bytes came from. Defaults to `driver_self_provided` for a
   * document the driver owns, and cannot be raised to an authority source
   * without `sourceDetail` naming that authority.
   */
  source?: QualificationSourceKind;
  sourceDetail?: string;
  /** The reviewer's note, kept with the frozen review. Carrier-private. */
  note?: string;
}

export interface RecordCarrierEvidenceInput {
  driverProfileId: string;
  category: QualificationRecordCategory;
  purpose: QualificationPurpose;
  engagementId?: string;
  /** Name, type and size as the browser reported them. Nothing is uploaded. */
  file: { name: string; type: string; size: number };
  source: QualificationSourceKind;
  sourceDetail?: string;
  note?: string;
}

export interface DisposalInput {
  /** Why it may go. Required: a disposal with no reason cannot be reviewed. */
  reason: string;
}

/** What adopting this exact version would mean. Shown before confirming. */
export interface AdoptionPreview {
  documentId: string;
  lineageId: string;
  documentVersion: number;
  label: string;
  /** True when this carrier already adopted this exact version. */
  alreadyAdopted: boolean;
  /** The record this adoption would supersede, when there is one. */
  supersedesRecordId?: string;
  supersedesVersion?: number;
  /** The basis, and the honest answer about the date. */
  retentionSummary: string;
  /** The sentences the confirmation must show. Never a tooltip. */
  consequences: string[];
}

export interface QualificationService {
  /**
   * Records this organization holds. Never another organization's.
   *
   * There is no organization parameter, deliberately: one carrier's review,
   * adoption and retention are not addressable through this interface at all.
   */
  list(ctx: ServiceContext, filters?: QualificationFilters): Promise<QualificationRecordView[]>;
  get(ctx: ServiceContext, recordId: string): Promise<QualificationRecordView>;

  /** What adoption would do, computed rather than described. */
  previewAdoption(ctx: ServiceContext, documentId: string): Promise<AdoptionPreview>;

  /**
   * Pins one document version into this carrier's qualification file.
   *
   * Requires a review to exist already: the carrier must have looked at this
   * exact version and recorded an outcome, because adopting something nobody
   * reviewed is precisely the claim a qualification file must never be able to
   * make. Idempotent — adopting the same version twice returns the first
   * record and writes no second history entry.
   */
  adopt(ctx: ServiceContext, input: AdoptDocumentInput): Promise<QualificationRecordView>;

  /**
   * Records evidence the CARRIER obtained or created — an application, an MVR
   * it ordered, a road test its examiner signed.
   *
   * It creates a carrier-owned `DocumentRecord` in the one Document Center and
   * a qualification record pointing at it. It never touches the driver's wallet
   * and never claims a verification the carrier did not perform.
   */
  recordCarrierEvidence(
    ctx: ServiceContext, input: RecordCarrierEvidenceInput,
  ): Promise<QualificationRecordView>;

  /**
   * The retention BASIS rows, so a screen can explain an obligation instead of
   * asserting a date. No row carries a period: see
   * `src/lib/qualification/retention.ts`.
   */
  retentionPolicies(ctx: ServiceContext): Promise<readonly RetentionPolicy[]>;

  /**
   * Authorises disposal of a record whose retention obligation has ended.
   *
   * Refused while any obligation stands — which, with no backend policy
   * configured, is always. That is the safe direction: a record whose period
   * nobody can compute is a record still under obligation.
   */
  authorizeDisposal(
    ctx: ServiceContext, recordId: string, input: DisposalInput,
  ): Promise<QualificationRecordView>;

  /**
   * What the DRIVER is told: that a carrier adopted a specific version of their
   * document, the general purpose, when, and the retention status.
   *
   * Never the carrier's review, its reviewer, its notes, any risk assessment or
   * any other organization-private content.
   */
  adoptionsForDriver(
    ctx: ServiceContext, driverProfileId: string,
  ): Promise<DriverVisibleAdoption[]>;
}

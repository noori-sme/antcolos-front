/**
 * ★ THE PERMANENT PROFILE ★
 *
 * A person's career record on Antcolos. It belongs to the User, which means it
 * belongs to nobody else: joining, leaving or switching an organization never
 * replaces, recreates or erases it, and no employer owns, edits or deletes it.
 *
 * Read `src/types/user.ts` first. `User` is the identity the session carries;
 * this is the record that identity accumulates. The split matters because the
 * two have different lifetimes — a User is created once and barely changes, a
 * profile grows for years — and because the profile is the only part of a
 * person that is readable OUTSIDE any organization.
 *
 * ── WHAT IS STRUCTURALLY IMPOSSIBLE HERE ──────────────────────────────────
 * There is no `permissions` field, no `role` field and no `organizationId`.
 * A profile says where somebody HAS WORKED; it never says what they may do,
 * and an employer reading a profile learns nothing it could act on. Authority
 * lives on Membership and only there — see `src/types/membership.ts`.
 *
 * Nothing on a profile is typed by hand except the four things a person wrote
 * about themselves (name, headline, bio, links) and their avatar. Every number
 * and every date is DERIVED from records another module already owns, so a
 * profile cannot claim a load that was never dispatched.
 */

import type { OrganizationType } from "./organization";

/* -------------------------------------------------------------------------- */
/* The handle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The username chosen at signup, lowercased, and never changed.
 *
 * It is the profile's primary key in every place a human sees one: the URL,
 * the share card, the @mention. Immutability is the whole point — a career
 * record whose address changes is a career record nobody can cite.
 */
export type Username = string;

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

/** How much of a profile a stranger may read. Set by the person, not by an employer. */
export type ProfileVisibility = "public" | "signed-in" | "private";

/** The optional sections, each independently hideable. */
export interface ProfileSectionVisibility {
  metrics: boolean;
  workplaces: boolean;
  achievements: boolean;
}

/**
 * Something Antcolos checked, rather than something the person typed.
 *
 * A verification is a claim about EVIDENCE, and the evidence lives in the
 * module that checked it. Nothing here is a permission: a verified CDL does
 * not let anybody drive, it says Safety saw a licence.
 */
export type ProfileVerificationKind =
  | "email"
  | "identity"
  | "cdl"
  | "carrier-authority"
  | "organization-owner";

export interface ProfileVerification {
  kind: ProfileVerificationKind;
  verifiedAt: string;
  /** The module that did the checking. Display only; never read for authority. */
  source: "account" | "safety" | "fmcsa" | "workforce";
}

export interface ProfileLink {
  label: string;
  url: string;
}

/**
 * The permanent record, created once, at the moment the account exists.
 *
 * `completedAt` is absent for a profile the person skipped past during
 * onboarding. The RECORD still exists — skipping an avatar is not skipping an
 * identity — and the missing pieces are a prompt rather than a gap in the data
 * model.
 */
export interface UserProfile {
  userId: string;
  /** Immutable. See `Username`. */
  username: Username;
  fullName: string;
  /** One line. What this person does, in their own words. */
  headline?: string;
  bio?: string;
  avatarUrl?: string;
  location?: string;
  links: ProfileLink[];
  visibility: ProfileVisibility;
  sections: ProfileSectionVisibility;
  verifications: ProfileVerification[];
  /** When the ACCOUNT was created — not when the profile was filled in. */
  joinedAt: string;
  /** When the setup step was finished. Absent while it is still skippable. */
  completedAt?: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Workplace history                                                           */
/* -------------------------------------------------------------------------- */

/**
 * In what capacity somebody worked somewhere. NOT a permission template and
 * not a job title — those belong to Membership and Workforce respectively.
 */
export type ProfileCapacity =
  | "dispatcher"
  | "driver"
  | "carrier-owner"
  | "dispatch-owner"
  | "safety"
  | "back-office";

export const CAPACITY_LABEL: Record<ProfileCapacity, string> = {
  dispatcher: "Dispatcher",
  driver: "Driver",
  "carrier-owner": "Carrier owner",
  "dispatch-owner": "Dispatch owner",
  safety: "Safety",
  "back-office": "Back office",
};

/** Which capacities the operational metric grids are built for. */
export const METERED_CAPACITIES: readonly ProfileCapacity[] = [
  "dispatcher",
  "driver",
] as const;

/**
 * One period of working with one organization.
 *
 * ★ THE ORGANIZATION'S NAME IS A SNAPSHOT. ★
 * Taken when the association opened and never recomputed, for the same reason
 * fuel attribution is snapshotted: a carrier that rebrands, is sold or closes
 * must not silently rewrite where somebody worked in 2026. `organizationId`
 * still points at the live record for anybody allowed to look it up.
 *
 * `endedAt` absent means current. An association is never deleted — somebody
 * who leaves and returns gets a SECOND association, and the first one stays.
 */
export interface WorkplaceAssociation {
  id: string;
  userId: string;
  organizationId: string;
  organizationNameSnapshot: string;
  organizationType: OrganizationType;
  capacity: ProfileCapacity;
  /** The organization-specific job title, if it had one. Display only. */
  positionTitle?: string;
  startedAt: string;
  endedAt?: string;
  /**
   * True when the association was opened by Antcolos from a real membership
   * or engagement rather than typed in by the person. An unverified entry is
   * shown as unverified and never counted toward a metric.
   */
  verified: boolean;
}

/* -------------------------------------------------------------------------- */
/* Contributions — the only thing metrics are computed from                    */
/* -------------------------------------------------------------------------- */

/**
 * A unit of measured work, posted by the module that owns the underlying
 * record, attributed to the person who did it.
 *
 * ★ WHY A LEDGER RATHER THAN COUNTERS ★
 * A counter on a profile is a number nobody can check, and a number nobody can
 * check is a number somebody will eventually be accused of inflating. Every
 * figure on a profile folds from these rows, each of which names the
 * organization the work was done for and the moment it happened. That makes a
 * metric reproducible, makes it attributable to a period, and makes a
 * correction a new row rather than an edit to a total.
 *
 * Rows are append-only. A load that is later cancelled is corrected by a
 * reversing row, never by subtracting from a total.
 */
export type ContributionKind =
  | "load_dispatched"
  | "revenue_booked"
  | "load_delivered"
  | "miles_driven"
  | "delivery_on_time"
  | "delivery_late"
  | "safety_event"
  | "clean_inspection";

/** The unit each kind's `value` is counted in. Nothing else is meaningful. */
export const CONTRIBUTION_UNIT: Record<ContributionKind, "count" | "cents" | "miles"> = {
  load_dispatched: "count",
  revenue_booked: "cents",
  load_delivered: "count",
  miles_driven: "miles",
  delivery_on_time: "count",
  delivery_late: "count",
  safety_event: "count",
  clean_inspection: "count",
};

export interface ProfileContribution {
  id: string;
  userId: string;
  /** Who the work was done for. Snapshotted, exactly as on the association. */
  organizationId: string;
  organizationNameSnapshot: string;
  capacity: ProfileCapacity;
  kind: ContributionKind;
  /** In the unit `CONTRIBUTION_UNIT` declares for the kind. May be negative. */
  value: number;
  occurredAt: string;
  /** Present on load-shaped rows, so lane figures can be folded from them. */
  lane?: { origin: string; destination: string };
  /** The record this row was derived from, for anybody auditing a figure. */
  sourceRef?: { kind: string; id: string };
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export interface LaneMetric {
  origin: string;
  destination: string;
  loads: number;
  /** Mean rate across the loads on this lane, in cents. Dispatcher rows only. */
  averageRateCents: number;
}

/** What a dispatcher's work adds up to. Folded from contributions, never stored. */
export interface DispatcherMetrics {
  capacity: "dispatcher";
  loadsDispatched: number;
  grossRevenueBookedCents: number;
  /** Gross over loads. Zero loads means zero, never a division by nothing. */
  averageLoadRateCents: number;
  topLanes: LaneMetric[];
}

/** What a driver's work adds up to. */
export interface DriverMetrics {
  capacity: "driver";
  loadsDelivered: number;
  milesDriven: number;
  /**
   * 0–100, or null for somebody with no driving history at all.
   *
   * Null rather than 100: a driver who has never turned a wheel has not earned
   * a perfect safety record, and a page that awarded one would be the first
   * thing a safety director stopped believing.
   */
  safetyScore: number | null;
  /** 0–100. Null when nothing has been delivered yet — not zero. */
  onTimePercentage: number | null;
  cleanInspections: number;
  topLanes: LaneMetric[];
}

export type CapacityMetrics = DispatcherMetrics | DriverMetrics;

/** How long somebody has been here, and how much of it they were working. */
export interface ProfileTenure {
  joinedAt: string;
  /** Whole days since `joinedAt`, as of the moment the profile was read. */
  daysOnPlatform: number;
  /**
   * Days covered by at least one workplace association.
   *
   * Overlapping associations count ONCE — somebody dispatching for two
   * carriers in the same week worked one week, not two — which is why this is
   * a union of intervals rather than a sum of durations.
   */
  activeDays: number;
  /** Associations that have no end date. */
  currentWorkplaces: number;
  organizationsWorkedWith: number;
}

/* -------------------------------------------------------------------------- */
/* Achievements                                                                */
/* -------------------------------------------------------------------------- */

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export const TIER_LABEL: Record<AchievementTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

/**
 * How a badge came to exist, and it is the distinction that keeps the whole
 * system honest.
 *
 * `earned` badges are DERIVED: a pure rule over this person's own
 * contributions, recomputed on every read, and therefore impossible to award
 * by mistake or to lose by a missed job run.
 *
 * `conferred` badges cannot be derived, because they are about a COMPARISON
 * between people — "Top Dispatcher Q3 2026" needs every other dispatcher's
 * quarter, which no profile read has and no client should ever be handed. They
 * are written by the platform, carry the period they were decided for, and the
 * rule engine deliberately refuses to invent them.
 */
export type AchievementOrigin = "earned" | "conferred";

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  tier: AchievementTier;
  origin: AchievementOrigin;
  /** Which capacity's work this badge is about. */
  capacity: ProfileCapacity | "any";
  /** Lucide icon name, resolved by the UI. Kept as a string so this file stays pure. */
  icon: string;
}

export interface Achievement {
  key: string;
  definition: AchievementDefinition;
  earnedAt: string;
  /** The figure that met the threshold, for a badge that shows its number. */
  value?: number;
  /** Set on conferred badges: the period the award was decided for. */
  period?: string;
  /** Set on conferred badges: who it was decided for, snapshotted. */
  organizationNameSnapshot?: string;
}

/* -------------------------------------------------------------------------- */
/* The assembled views                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a reader gets back. Sections the person hid are ABSENT, not empty —
 * an empty array would say "this dispatcher has booked nothing", and that is a
 * different statement from "this is none of your business".
 */
export interface ProfileView {
  profile: UserProfile;
  tenure: ProfileTenure;
  workplaces?: WorkplaceAssociation[];
  metrics?: CapacityMetrics[];
  achievements?: Achievement[];
  /** True when the viewer is the person the profile is about. */
  isOwner: boolean;
  /** Sections withheld from THIS viewer, so the UI can say so rather than lie. */
  withheld: Array<keyof ProfileSectionVisibility>;
}

/* -------------------------------------------------------------------------- */
/* Share cards                                                                 */
/* -------------------------------------------------------------------------- */

/** Which social surface a share link is being built for. */
export type ShareTarget = "link" | "linkedin" | "x" | "whatsapp" | "telegram" | "email";

export const SHARE_TARGET_LABEL: Record<ShareTarget, string> = {
  link: "Copy link",
  linkedin: "LinkedIn",
  x: "X",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
};

/**
 * Everything a share card renders, resolved once so the image route, the modal
 * preview and the Open Graph tags cannot drift apart.
 *
 * Deliberately flat and free of dates-as-objects: it is serialized into an
 * image route, and a card that needs a locale to render is a card that renders
 * differently for the person sharing it than for the person receiving it.
 */
export interface ShareCard {
  kind: "profile" | "achievement";
  username: Username;
  fullName: string;
  headline?: string;
  avatarUrl?: string;
  /** Up to four figures, already formatted for display. */
  stats: Array<{ label: string; value: string }>;
  /** Set on an achievement card. */
  achievement?: { title: string; description: string; tier: AchievementTier };
  /** The canonical URL the card points back at. */
  url: string;
}

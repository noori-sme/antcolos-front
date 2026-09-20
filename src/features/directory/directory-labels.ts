import type {
  AuthorityStatus, BrokerIdentityState, BrokerObservationState, MatchConfidence,
  PartyClaimState, PartyContactKind, PartyProvenanceKind, PartyRecordStatus,
  PartyRole, PartyStanding, PartyVerificationState, ResolutionRecommendation,
} from "@/types";

/**
 * Every word the directory shows a dispatcher, in one place.
 *
 * The descriptions matter as much as the labels here. A dispatcher deciding
 * whether to link a broker needs to know what "provisional" commits them to,
 * and a tooltip written by the person who wrote the matching rules is the only
 * place that can honestly say so.
 */

export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  broker: "Broker",
  shipper: "Shipper",
  receiver: "Receiver",
};

export const PARTY_ROLE_DESCRIPTION: Record<PartyRole, string> = {
  broker: "Books the freight and pays you.",
  shipper: "Where the freight is picked up from.",
  receiver: "Where the freight is delivered to.",
};

export const PARTY_STATUS_LABEL: Record<PartyRecordStatus, string> = {
  active: "Confirmed",
  provisional: "Needs review",
  merged: "Merged",
  archived: "Archived",
};

export const PARTY_STATUS_DESCRIPTION: Record<PartyRecordStatus, string> = {
  active: "A person has confirmed this profile is this company.",
  provisional:
    "Created from a match nobody could be sure of. It works and you can book against it, " +
    "but it is waiting for somebody to confirm or correct it.",
  merged: "Superseded by another profile. Kept so old loads still resolve.",
  archived: "Retired on purpose. Old loads still point at it.",
};

export const VERIFICATION_LABEL: Record<PartyVerificationState, string> = {
  unverified: "Not checked",
  dispatcher_confirmed: "Confirmed by a dispatcher",
  externally_verified: "Verified with FMCSA",
};

export const VERIFICATION_DESCRIPTION: Record<PartyVerificationState, string> = {
  unverified: "Nothing here has been checked against anything yet.",
  dispatcher_confirmed:
    "Somebody in your organization read the rate confirmation and stood behind it. " +
    "That is not the same as checking the MC number with FMCSA.",
  externally_verified:
    "Checked against the authority that issues the number. Antcolos cannot reach FMCSA yet, " +
    "so nothing carries this today.",
};

export const STANDING_LABEL: Record<PartyStanding, string> = {
  preferred: "Preferred",
  standard: "Standard",
  watch: "Watch",
  blocked: "Blocked",
};

export const STANDING_DESCRIPTION: Record<PartyStanding, string> = {
  preferred: "Good to run for. Yours alone — no other carrier sees it.",
  standard: "Nothing recorded either way.",
  watch: "Something went wrong last time. Read the notes before booking.",
  blocked: "Do not run for them. Yours alone — no other carrier sees it.",
};

export const CONTACT_KIND_LABEL: Record<PartyContactKind, string> = {
  broker_agent: "Broker agent",
  facility_contact: "Facility contact",
  accounting: "Accounting",
  after_hours: "After hours",
  other: "Contact",
};

export const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  exact: "Identifier matched",
  strong: "Strong match",
  possible: "Possible match",
  none: "No match",
};

export const CONFIDENCE_DESCRIPTION: Record<MatchConfidence, string> = {
  exact:
    "A number the outside world issues matched — for a broker, the MC number. " +
    "Still yours to confirm.",
  strong: "Several details agree. Convincing, and still a guess.",
  possible: "One detail agrees. Worth a look, not worth acting on.",
  none: "Nothing agreed.",
};

export const RECOMMENDATION_LABEL: Record<ResolutionRecommendation, string> = {
  link_existing: "Link to the existing profile",
  choose_between: "Pick the right profile",
  create_new: "Create a new profile",
  create_provisional: "Create, flagged for review",
};

/** A date the way a dispatcher writes it. */
export function formatDate(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "MC-612884" from the stored digits. The prefix is display, not data. */
export function formatMcNumber(value?: string): string | undefined {
  return value ? `MC-${value}` : undefined;
}

export function formatPhone(value?: string, extension?: string): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "").replace(/^1/, "");
  const pretty =
    digits.length === 10
      ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : value;
  return extension ? `${pretty} ext. ${extension}` : pretty;
}

export function formatAddress(address?: {
  line1?: string;
  line2?: string;
  city: string;
  state: string;
  postalCode?: string;
}): string {
  if (!address) return "—";
  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const locality = [address.city, address.state].filter(Boolean).join(", ");
  return [street, locality, address.postalCode].filter(Boolean).join(" · ");
}

export function formatCityState(address?: { city?: string; state?: string }): string {
  if (!address?.city) return "—";
  return address.state ? `${address.city}, ${address.state}` : address.city;
}

/* -------------------------------------------------------------------------- */
/* The three broker axes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Three questions, three vocabularies, and no word shared between them.
 *
 * ★ "UNCLAIMED" IS NEVER WRITTEN AS "UNVERIFIED" ★
 * A profile the federal register confirmed, that no brokerage has signed up to
 * claim, is `FMCSA verified` and `Unclaimed`. Both are true, they are about
 * different things, and calling such a record unverified would be a falsehood
 * about a company whose identity is a matter of public record.
 */
export const IDENTITY_LABEL: Record<BrokerIdentityState, string> = {
  verified: "FMCSA verified",
  pending: "Identity pending",
  conflicted: "Identity conflict",
};

export const IDENTITY_DESCRIPTION: Record<BrokerIdentityState, string> = {
  verified:
    "FMCSA returned a record for this MC number and Antcolos took the legal name, address " +
    "and authority status from it. It says nothing about whether anybody from the company " +
    "has an account here.",
  pending:
    "The MC number on the paperwork has not been resolved against FMCSA yet. Until it is, " +
    "everything on this profile is what a document said rather than what the register says.",
  conflicted:
    "The register and the paperwork disagree, or two documents disagree with each other. " +
    "Somebody has to settle it; nothing was merged or overwritten in the meantime.",
};

export const AUTHORITY_LABEL: Record<AuthorityStatus, string> = {
  active: "Authority active",
  inactive: "Authority inactive",
  revoked: "Authority revoked",
  unknown: "Authority unknown",
};

export const AUTHORITY_DESCRIPTION: Record<AuthorityStatus, string> = {
  active: "FMCSA showed active operating authority when this was last checked.",
  inactive:
    "FMCSA showed the operating authority as not currently active. Check before booking.",
  revoked:
    "FMCSA showed the operating authority as revoked. This company should not be brokering " +
    "freight.",
  unknown:
    "The authority status has not been checked. Not a warning — simply a question nobody " +
    "has asked yet.",
};

export const CLAIM_LABEL: Record<PartyClaimState, string> = {
  unclaimed: "Unclaimed",
  claim_pending: "Claim pending",
  claimed: "Claimed",
};

export const CLAIM_DESCRIPTION: Record<PartyClaimState, string> = {
  unclaimed:
    "Nobody from this company has an Antcolos account tied to this profile. That is the " +
    "ordinary state of a broker who has never heard of us, and it says nothing about " +
    "whether their details are right.",
  claim_pending:
    "Somebody has asserted they represent this company. It has not been proved yet, and it " +
    "grants them nothing until it is.",
  claimed:
    "Somebody at this company proved control of the profile. They may correct their own " +
    "contact details and description. They cannot change the register's fields, delete a " +
    "rate confirmation observation, or see your loads, rates, notes or payment history.",
};

export const OBSERVATION_LABEL: Record<BrokerObservationState, string> = {
  resolved: "Matched",
  pending_authority: "Awaiting FMCSA",
  conflicted: "Disagrees with the register",
  needs_review: "Needs review",
};

/**
 * Where a record came from, in words rather than in enum spelling.
 *
 * The two rate-confirmation kinds read differently on purpose: one had a person
 * in it and the other did not.
 */
export const PROVENANCE_LABEL: Record<PartyProvenanceKind, string> = {
  rate_confirmation: "A rate confirmation, confirmed by a person",
  rate_confirmation_auto: "Discovered on a rate confirmation, resolved against FMCSA",
  manual_entry: "Typed in by hand",
  import: "An import",
  carrier_packet: "A carrier packet",
  system: "Antcolos",
};

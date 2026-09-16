import type { IsoDateTime } from "@/types";

/**
 * ★ THE PLATFORM DATA-USE POLICY FOR LEARNING ★
 *
 * Antcolos ranks loads better by watching which ones dispatchers pursue and
 * which they throw away. That is a core platform function rather than a feature
 * a workspace switches on, so there is no per-organization toggle and no
 * consent dialog — which puts the whole weight of this on being able to say,
 * exactly and checkably, WHAT leaves a workspace and what never can.
 *
 * This file is that statement. It is the single source for both lists, it is
 * versioned, and it is DATA rather than prose, so a test can assert it and a
 * screen can render it. `SHARED_FIELDS` and `WITHHELD_FIELDS` in the ranking
 * module are derived from it — there is one policy, in one place.
 *
 * ── AN ALLOWLIST, NOT A DENYLIST ──────────────────────────────────────────
 * `allowed` is exhaustive. A field that is not on it does not reach the shared
 * pool, and that is enforced at the boundary by projecting every contribution
 * through these keys rather than by anybody remembering to leave it out. Adding
 * a field to the pool is therefore a deliberate edit to this list, reviewable on
 * its own, and forgetting to edit it fails closed.
 *
 * `prohibited` is not the mechanism — the allowlist already excludes everything
 * absent from it. It is written out anyway because "we only send what we listed"
 * is a claim somebody can check, and because a reader deserves to see the
 * categories named rather than inferred from an absence.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * Not a settings system: nothing here is per-organization, nothing stores a
 * choice, and there is no code path that edits it at runtime. Not a second
 * policy: the ranking module reads this one. Not model training: no model is
 * trained, scored or served anywhere in Antcolos, and `derivation` below
 * describes arithmetic a person could do on paper.
 *
 * ███ FRONTEND ONLY ███
 * A constant in a browser tab. It describes the contract a backend must honour
 * and enforces it over an in-memory array; it is not a guarantee about a system
 * that does not run this code. See `launchRequirements`.
 */

/** One field that MAY travel, and the reduction that makes it safe to. */
export interface LearningAllowedField {
  /** The key as it appears on a pooled row. Nothing else may appear. */
  readonly key: string;
  readonly label: string;
  /** How the underlying value is reduced before it may leave. */
  readonly derivation: string;
}

/** One category that may NEVER travel, and why. */
export interface LearningProhibitedField {
  readonly label: string;
  readonly reason: string;
}

export interface LearningDataUsePolicy {
  /**
   * Incremented, never reinterpreted.
   *
   * Every pooled row is stamped with the version it was contributed under, so a
   * later widening of the allowlist cannot silently re-license what was already
   * collected: rows carry the terms they were gathered on. That is the same rule
   * `DomainEvent.version` keeps for payloads, and it is the whole of the
   * versioning mechanism — there is no second policy record and no per-workspace
   * override to reconcile it with.
   */
  readonly version: number;
  readonly effectiveFrom: IsoDateTime;
  /** One sentence a person can read without reading the rest. */
  readonly summary: string;
  /** THE ALLOWLIST. Exhaustive. */
  readonly allowed: readonly LearningAllowedField[];
  /** Named for the reader. The allowlist is what enforces. */
  readonly prohibited: readonly LearningProhibitedField[];
  /**
   * How many decisions from OTHER workspaces the pool needs before it may say
   * anything. Below it, no suggestion is offered at all.
   */
  readonly minimumObservations: number;
  /** What this build does NOT settle, and must not be read as settling. */
  readonly launchRequirements: readonly string[];
}

export const LEARNING_DATA_USE_POLICY: LearningDataUsePolicy = {
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  summary:
    "Antcolos learns from the SHAPE of the loads workspaces pursue and decline — an equipment type, four rounded bands and a yes or no — and from nothing else. No name, no identifier, no document and no location ever enters it.",

  allowed: [
    {
      key: "equipment",
      label: "Equipment type",
      derivation: "The category only — dry van, reefer, flatbed. Never a specific trailer.",
    },
    {
      key: "loadedMileBand",
      label: "Loaded-mile band",
      derivation: "Loaded miles rounded to the nearest 100. The exact distance never travels.",
    },
    {
      key: "deadheadBand",
      label: "Deadhead band",
      derivation: "Empty miles rounded to the nearest 25. The exact distance never travels.",
    },
    {
      key: "ratePerMileBand",
      label: "Rate-per-mile band",
      derivation: "All-in rate per mile rounded to the nearest 10 cents. The exact rate never travels.",
    },
    {
      key: "creditBand",
      label: "Broker credit band",
      derivation: "A credit score rounded to the nearest 10, and only where one is already known. Never the broker it belongs to.",
    },
    {
      key: "mcAgeBand",
      label: "Broker MC age band",
      derivation: "One of four buckets — under 6 months, 6 to 24, over 24, unknown. Never the MC number itself.",
    },
    {
      key: "pursued",
      label: "Whether it was pursued",
      derivation: "A yes or a no. The decision itself, with nothing about who made it.",
    },
    {
      key: "contributionId",
      label: "One-time row token",
      derivation:
        "A random token unique to that single row, held by the contributing workspace so it can be given back its own rows to exclude. It groups nothing: two rows from one workspace share no part of it, so the pool cannot be partitioned by contributor, let alone attributed.",
    },
    {
      key: "policyVersion",
      label: "Policy version",
      derivation:
        "The version of this policy the row was gathered under. Identical for every workspace contributing in the same period, so it separates eras rather than contributors.",
    },
  ],

  prohibited: [
    {
      label: "Organization, carrier, user and driver identity",
      reason: "No workspace id, company name, membership, person or driver profile, in any form.",
    },
    {
      label: "MC and DOT numbers",
      reason: "The age of an authority travels as a bucket; the authority itself never does.",
    },
    {
      label: "Email addresses, phone numbers and postal addresses",
      reason: "Contact details of any party, on any side of a load.",
    },
    {
      label: "Precise location and hours of service",
      reason: "No GPS position, no geofence crossing, no driver clock. A driver's day is not ranking data.",
    },
    {
      label: "Licences and personal documents",
      reason: "Medical cards, CDLs and anything else about a person's right to work.",
    },
    {
      label: "Banking, payment and settlement details",
      reason: "What anybody is paid or paid with, and every account it moves through.",
    },
    {
      label: "Raw rate confirmations, contracts, messages and uploaded files",
      reason: "No document body, no attachment and no correspondence, extracted or otherwise.",
    },
    {
      label: "Broker, shipper, receiver and customer identity",
      reason: "The company on the other side of a load is never named, only banded.",
    },
    {
      label: "Claims, safety and compliance records",
      reason: "Anything attributable to a person or an organization, including incidents, inspections and requirement history.",
    },
    {
      label: "Exact rates, exact mileage and any credential",
      reason: "Money and distance travel as bands only. No token, key or password travels at all.",
    },
  ],

  minimumObservations: 8,

  launchRequirements: [
    "Terms of Service that describe this use of data accurately, in the words of this policy.",
    "A Privacy Notice naming what is collected, the basis for it, and who it is shared with.",
    "Retention rules: how long anonymised contributions are kept, and what expires them.",
    "A deletion and withdrawal position, stated plainly — including the honest limit that rows carrying no organization id cannot be found and removed per workspace.",
    "Legal review before any of this runs outside a demonstration.",
  ],
};

/**
 * The honest note every surface shows beside the numbers.
 *
 * Kept with the policy rather than written into one screen, because the same
 * sentence is owed wherever the learning is described.
 */
export const LEARNING_DATA_USE_NOTE =
  "Contributing these derived signals is part of the service and is not a per-workspace setting. What that makes non-negotiable is the boundary: the list above is exhaustive, anything absent from it is dropped before a row is stored, and nothing on it can be traced back to a workspace, a person or a company. How long anonymised contributions are kept, and what a deletion request can reach, are policy questions this build does not settle — a row carrying no organization id cannot be found and removed per workspace, and no screen here should be read as promising otherwise.";

/** Every allowlisted key, for the projection that enforces the list. */
export const LEARNING_ALLOWED_KEYS: readonly string[] =
  LEARNING_DATA_USE_POLICY.allowed.map((f) => f.key);

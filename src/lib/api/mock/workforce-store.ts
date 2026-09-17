import type {
  OffboardingResultStep, OnboardingWaiver, WorkforceEngagement,
  WorkforceEngagementEvent,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The workforce store: engagements, their immutable history, the waivers
 * somebody authorised, and the offboarding steps that did not finish.
 *
 * It holds NOTHING that belongs to another module. There is no permission here,
 * no document, no contract term, no licence, no settlement and no membership —
 * only ids pointing at the records that own those, which is what makes "HR does
 * not copy facts" a property of the data rather than a promise in a comment.
 *
 * A LEAF, like the document store: it imports no registry, so every registry
 * can read it without a cycle, and it enforces nothing. Permissions and
 * organization isolation live one layer up where the caller's context exists.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. A real backend owes this seam persistence,
 * a transaction around the multi-module commands the service performs one at a
 * time, and the uniqueness constraint described in
 * `docs/workforce-hr-foundation.md`.
 */

interface StoreState {
  engagements: WorkforceEngagement[];
  /**
   * Keyed `${engagementId}:${stepKey}`. Deliberately not on the engagement: a
   * waiver is a fact about a checklist line, and the checklist is derived.
   */
  waivers: Record<string, OnboardingWaiver>;
  /** Offboarding steps that failed, kept until somebody finishes them. */
  incompleteOffboarding: Record<string, OffboardingResultStep[]>;
  seeded: boolean;
}

function emptyState(): StoreState {
  return { engagements: [], waivers: {}, incompleteOffboarding: {}, seeded: false };
}

let state: StoreState = emptyState();
let seq = 0;

const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/** Test hook. Never called by the UI. */
export function resetWorkforceStore() {
  state = emptyState();
  seq = 0;
}

export function nextEngagementId(): string {
  return rowId("weng");
}

export function nextEventId(): string {
  return rowId("wev");
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Seeded on first read rather than on import, so a reset genuinely resets.
 *
 * The fixtures deliberately describe people who ALREADY exist elsewhere in
 * Antcolos — Northline's drivers and its safety lead — by reference. Not one of
 * them is a new person: the engagement says on what basis somebody already in
 * the driver registry or the membership directory works here, which is the one
 * thing that was missing.
 */
export function ensureSeeded(seed: () => WorkforceEngagement[]) {
  if (state.seeded) return;
  state.seeded = true;
  state.engagements = seed();
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function engagementsForOrganization(organizationId: string): WorkforceEngagement[] {
  return state.engagements
    .filter((e) => e.organizationId === organizationId)
    .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName));
}

export function engagementById(id: string): WorkforceEngagement | undefined {
  return state.engagements.find((e) => e.id === id);
}

/**
 * The one live engagement for a person in an organization, if there is one.
 *
 * "Live" excludes the terminal states, because a person who left and came back
 * has TWO engagements and the old one is history — not a row to be reopened.
 * This is the read a backend's unique constraint would replace.
 */
export function liveEngagementFor(
  organizationId: string,
  person: { userId?: string; driverProfileId?: string; email?: string },
): WorkforceEngagement | undefined {
  return state.engagements.find((e) => {
    if (e.organizationId !== organizationId) return false;
    if (e.state === "ended" || e.state === "rejected" || e.state === "withdrawn") return false;
    if (person.driverProfileId && e.driverProfileId === person.driverProfileId) return true;
    if (person.userId && e.person.userId === person.userId) return true;
    if (person.email && e.person.email && e.person.email === person.email) return true;
    return false;
  });
}

export function waiversFor(engagementId: string): Record<string, OnboardingWaiver> {
  const out: Record<string, OnboardingWaiver> = {};
  for (const [key, value] of Object.entries(state.waivers)) {
    const at = key.indexOf(":");
    if (key.slice(0, at) === engagementId) out[key.slice(at + 1)] = value;
  }
  return out;
}

export function incompleteOffboardingFor(engagementId: string): OffboardingResultStep[] {
  return state.incompleteOffboarding[engagementId] ?? [];
}

export function allEngagements(): readonly WorkforceEngagement[] {
  return state.engagements;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function putEngagement(engagement: WorkforceEngagement): WorkforceEngagement {
  const i = state.engagements.findIndex((e) => e.id === engagement.id);
  state.engagements = i >= 0
    ? state.engagements.map((e) => (e.id === engagement.id ? engagement : e))
    : [...state.engagements, engagement];
  return engagement;
}

/**
 * The only mutation path, and it APPENDS to history on every call.
 *
 * `history`, `createdAt`, `id`, `organizationId` and `version` are excluded by
 * construction, so nothing in this module can rewrite what happened to an
 * engagement or move it to another workspace — only add to it. That is the same
 * rule the audit ledger and the document store keep, and it is why an ended
 * engagement is safe to leave in place forever.
 */
export function amendEngagement(
  engagementId: string,
  changes: Partial<Omit<WorkforceEngagement,
    "id" | "organizationId" | "history" | "createdAt" | "version">>,
  event: Omit<WorkforceEngagementEvent, "id" | "at"> & { at?: string },
): WorkforceEngagement {
  const existing = engagementById(engagementId);
  if (!existing) throw new Error(`No such engagement: ${engagementId}`);
  const at = new Date().toISOString();
  return putEngagement({
    ...existing,
    ...changes,
    history: [...existing.history, { id: nextEventId(), at: event.at ?? at, ...event }],
    updatedAt: at,
    version: existing.version + 1,
  });
}

export function putWaiver(engagementId: string, stepKey: string, waiver: OnboardingWaiver) {
  state.waivers[`${engagementId}:${stepKey}`] = waiver;
}

/**
 * Records the offboarding steps that did NOT finish.
 *
 * Kept on the engagement rather than dropped, because a half-finished
 * offboarding is the most dangerous state this module can produce: the person
 * is gone and something they held is not. The Needs You derivation reads
 * exactly this, and clearing it is the only way that item goes away.
 */
export function putIncompleteOffboarding(
  engagementId: string,
  steps: OffboardingResultStep[],
) {
  if (steps.length === 0) delete state.incompleteOffboarding[engagementId];
  else state.incompleteOffboarding[engagementId] = steps;
}

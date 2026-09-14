import type {
  ActorRef, DriverLoadPost, DriverWorkflow, DriverWorkflowEvent, ExternalRef,
  IsoDateTime, LoadProposal, Provenance, ProposalEvent,
} from "@/types";
import type { FullRate } from "@/lib/driver-workflow/policy";
import type { ProposalEventDraft } from "@/lib/driver-workflow/proposal-machine";
import type { WorkflowEventDraft } from "@/lib/driver-workflow/trip-machine";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * In-memory store for proposals, finalized posts and trip workflows,
 * PARTITIONED BY ORGANIZATION exactly like the rest of the mock layer. Every
 * accessor requires an organizationId; there is no method that can read across
 * the boundary, which is how cross-organization access fails in development for
 * the same reason it will fail in production.
 *
 * Two things live here that the state machines deliberately do not own:
 * identifiers, and the idempotency ledger. Both are persistence concerns.
 */

/**
 * A stored post keeps the FULL rate. Disclosure happens on read, in the
 * service, against carrier policy — so a post is never stored pre-redacted for
 * one audience and then shown to another.
 */
export type StoredPost = Omit<DriverLoadPost, "rate"> & { fullRate: FullRate };

export interface OrgWorkflowData {
  proposals: LoadProposal[];
  proposalEvents: ProposalEvent[];
  posts: StoredPost[];
  workflows: DriverWorkflow[];
  workflowEvents: DriverWorkflowEvent[];
  /** idempotencyKey → the ids of the events it produced. A retry replays these. */
  idempotency: Map<string, string[]>;
  /** loadId → postId, so finalizing the same load twice is a no-op. */
  postByLoad: Map<string, string>;
  /** The last signal instant consumed per workflow, so polling does not re-infer. */
  signalCursor: Map<string, IsoDateTime>;
}

function emptyOrg(): OrgWorkflowData {
  return {
    proposals: [],
    proposalEvents: [],
    posts: [],
    workflows: [],
    workflowEvents: [],
    idempotency: new Map(),
    postByLoad: new Map(),
    signalCursor: new Map(),
  };
}

let sequence = 0;
export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence.toString(36).padStart(4, "0")}`;
}

class DriverWorkflowStore {
  private data = new Map<string, OrgWorkflowData>();
  /** Hydration promises, so a burst of concurrent reads seeds an org once. */
  private hydration = new Map<string, Promise<void>>();

  org(organizationId: string): OrgWorkflowData {
    let org = this.data.get(organizationId);
    if (!org) {
      org = emptyOrg();
      this.data.set(organizationId, org);
    }
    return org;
  }

  /** Seeds an organization exactly once, however many callers ask at once. */
  hydrate(organizationId: string, seed: () => Promise<void>): Promise<void> {
    const existing = this.hydration.get(organizationId);
    if (existing) return existing;
    const promise = seed().catch((error) => {
      // A failed hydration must not be cached, or the org stays empty forever.
      this.hydration.delete(organizationId);
      throw error;
    });
    this.hydration.set(organizationId, promise);
    return promise;
  }

  /* ---- Proposals -------------------------------------------------------- */

  proposal(organizationId: string, proposalId: string): LoadProposal | undefined {
    return this.org(organizationId).proposals.find((p) => p.id === proposalId);
  }

  replaceProposal(organizationId: string, next: LoadProposal): void {
    const org = this.org(organizationId);
    const i = org.proposals.findIndex((p) => p.id === next.id);
    if (i >= 0) org.proposals[i] = next;
    else org.proposals.push(next);
  }

  appendProposalEvents(
    organizationId: string,
    proposalId: string,
    drafts: readonly ProposalEventDraft[],
  ): ProposalEvent[] {
    const org = this.org(organizationId);
    const existing = org.proposalEvents.filter((e) => e.proposalId === proposalId);
    let seq = existing.length;
    const created = drafts.map((draft): ProposalEvent => {
      seq += 1;
      return {
        id: nextId("pev"),
        organizationId,
        proposalId,
        sequence: seq,
        type: draft.type,
        occurredAt: draft.occurredAt,
        recordedAt: new Date().toISOString(),
        actor: draft.actor,
        source: draft.source,
        idempotencyKey: draft.idempotencyKey,
        payload: draft.payload,
      };
    });
    org.proposalEvents.push(...created);
    return created;
  }

  proposalEventsFor(organizationId: string, proposalId: string): ProposalEvent[] {
    return this.org(organizationId)
      .proposalEvents.filter((e) => e.proposalId === proposalId)
      .sort((a, b) => b.sequence - a.sequence);
  }

  /* ---- Workflows -------------------------------------------------------- */

  workflow(organizationId: string, workflowId: string): DriverWorkflow | undefined {
    return this.org(organizationId).workflows.find((w) => w.id === workflowId);
  }

  replaceWorkflow(organizationId: string, next: DriverWorkflow): void {
    const org = this.org(organizationId);
    const i = org.workflows.findIndex((w) => w.id === next.id);
    if (i >= 0) org.workflows[i] = next;
    else org.workflows.push(next);
  }

  post(organizationId: string, postId: string): StoredPost | undefined {
    return this.org(organizationId).posts.find((p) => p.id === postId);
  }

  appendWorkflowEvents(
    organizationId: string,
    workflow: DriverWorkflow,
    drafts: readonly WorkflowEventDraft[],
  ): DriverWorkflowEvent[] {
    const org = this.org(organizationId);
    const existing = org.workflowEvents.filter((e) => e.workflowId === workflow.id);
    let seq = existing.length;
    const created = drafts.map((draft): DriverWorkflowEvent => {
      seq += 1;
      return {
        id: nextId("wev"),
        organizationId,
        workflowId: workflow.id,
        loadId: workflow.loadId,
        sequence: seq,
        type: draft.type,
        milestone: draft.milestone,
        activity: draft.activity,
        occurredAt: draft.occurredAt,
        recordedAt: new Date().toISOString(),
        actor: draft.actor,
        source: draft.source,
        confirmation: draft.confirmation,
        inference: draft.inference,
        idempotencyKey: draft.idempotencyKey,
        correctsEventId: draft.correctsEventId,
        payload: draft.payload,
      };
    });
    org.workflowEvents.push(...created);
    return created;
  }

  workflowEventsFor(organizationId: string, workflowId: string): DriverWorkflowEvent[] {
    return this.org(organizationId).workflowEvents.filter((e) => e.workflowId === workflowId);
  }

  /* ---- Idempotency ------------------------------------------------------ */

  /** The events a key already produced, or undefined if it is new. */
  replayOf(organizationId: string, key: string): string[] | undefined {
    return this.org(organizationId).idempotency.get(key);
  }

  recordKey(organizationId: string, key: string, eventIds: string[]): void {
    this.org(organizationId).idempotency.set(key, eventIds);
  }

  /** Test/debug helper. Not used by the UI. */
  reset(): void {
    this.data.clear();
    this.hydration.clear();
    sequence = 0;
  }
}

export const driverWorkflowStore = new DriverWorkflowStore();

/* -------------------------------------------------------------------------- */
/* Small shared builders                                                       */
/* -------------------------------------------------------------------------- */

export const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

export function refsOf(...refs: (ExternalRef | undefined)[]): ExternalRef[] {
  return refs.filter((r): r is ExternalRef => Boolean(r));
}

export function provenanceOf(source: Provenance): Provenance {
  return { ...source, receivedAt: new Date().toISOString() };
}

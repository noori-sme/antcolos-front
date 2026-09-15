import type { ActorRef, IsoDateTime, RiskCase, RiskSignalStatus } from "@/types";

/**
 * State for signals and cases, PARTITIONED BY ORGANIZATION.
 *
 * Signals are DERIVED from the audit ledger on every read, so nothing about a
 * signal is stored except what a PERSON decided about it — whether it was
 * dismissed, and which case it belongs to. That is the same pattern the Needs
 * You queue uses for derived items, and for the same reason: a signal whose
 * text was stored would keep saying "4 refused actions" after the fifth.
 *
 * Cases ARE stored, because a case is a record of human work rather than a
 * function of the ledger. Their timelines are append-only.
 */

export interface SignalOverlay {
  status: RiskSignalStatus;
  caseId?: string;
  dismissedAt?: IsoDateTime;
  dismissedBy?: ActorRef;
  dismissalReason?: string;
}

interface OrgRisk {
  overlays: Map<string, SignalOverlay>;
  cases: RiskCase[];
  nextCaseNumber: number;
}

class RiskStore {
  private data = new Map<string, OrgRisk>();

  private org(organizationId: string): OrgRisk {
    let org = this.data.get(organizationId);
    if (!org) {
      org = { overlays: new Map(), cases: [], nextCaseNumber: 1 };
      this.data.set(organizationId, org);
    }
    return org;
  }

  overlay(organizationId: string, signalId: string): SignalOverlay | undefined {
    return this.org(organizationId).overlays.get(signalId);
  }

  setOverlay(organizationId: string, signalId: string, overlay: SignalOverlay) {
    this.org(organizationId).overlays.set(signalId, overlay);
  }

  cases(organizationId: string): RiskCase[] {
    return this.org(organizationId).cases;
  }

  findCase(organizationId: string, caseId: string): RiskCase | undefined {
    return this.org(organizationId).cases.find((c) => c.id === caseId);
  }

  /**
   * Replaces a case with its next version.
   *
   * "Next version" always means a case whose timeline GREW: every mutation in
   * the service appends an entry, and this is the only way a case changes.
   */
  putCase(next: RiskCase) {
    const org = this.org(next.organizationId);
    const i = org.cases.findIndex((c) => c.id === next.id);
    if (i >= 0) org.cases[i] = next;
    else org.cases.push(next);
  }

  nextReference(organizationId: string): string {
    const org = this.org(organizationId);
    const n = org.nextCaseNumber;
    org.nextCaseNumber += 1;
    return `RC-${String(n).padStart(4, "0")}`;
  }

  /** Test/debug helper. Not used by the UI. */
  reset() {
    this.data = new Map();
  }
}

export const riskStore = new RiskStore();

export function resetRiskStore() {
  riskStore.reset();
}

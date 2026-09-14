import type { AntcolosServices } from "../contracts";

/**
 * Real API adapter — Taqi's seam. Every method implements the SAME contract the
 * mock does, so switching NEXT_PUBLIC_API_MODE=http is the only change the UI
 * ever sees. Deliberately unimplemented: nothing here pretends to be connected.
 */
const notImplemented = (method: string) => (): never => {
  throw new Error(
    `HTTP adapter not implemented: ${method}. Set NEXT_PUBLIC_API_MODE to use mocks.`,
  );
};

export const httpServices: AntcolosServices = {
  needsYou: {
    list: notImplemented("needsYou.list"),
    get: notImplemented("needsYou.get"),
    openCount: notImplemented("needsYou.openCount"),
    assign: notImplemented("needsYou.assign"),
    snooze: notImplemented("needsYou.snooze"),
    unsnooze: notImplemented("needsYou.unsnooze"),
    escalate: notImplemented("needsYou.escalate"),
    resolve: notImplemented("needsYou.resolve"),
    reopen: notImplemented("needsYou.reopen"),
  },
  home: { summary: notImplemented("home.summary") },
  loads: {
    list: notImplemented("loads.list"),
    get: notImplemented("loads.get"),
    events: notImplemented("loads.events"),
    documents: notImplemented("loads.documents"),
  },
  settlements: {
    list: notImplemented("settlements.list"),
    listTotals: notImplemented("settlements.listTotals"),
    get: notImplemented("settlements.get"),
    breakdown: notImplemented("settlements.breakdown"),
    audit: notImplemented("settlements.audit"),
    periods: notImplemented("settlements.periods"),
    payees: notImplemented("settlements.payees"),
    attention: notImplemented("settlements.attention"),
    recalculate: notImplemented("settlements.recalculate"),
    submitForReview: notImplemented("settlements.submitForReview"),
    approve: notImplemented("settlements.approve"),
    raiseDispute: notImplemented("settlements.raiseDispute"),
    addDisputeMessage: notImplemented("settlements.addDisputeMessage"),
    resolveDispute: notImplemented("settlements.resolveDispute"),
    markReadyForPayment: notImplemented("settlements.markReadyForPayment"),
    recordPayment: notImplemented("settlements.recordPayment"),
    createAdjustment: notImplemented("settlements.createAdjustment"),
    void: notImplemented("settlements.void"),
    generateStatement: notImplemented("settlements.generateStatement"),
    statements: notImplemented("settlements.statements"),
  },
  directory: {
    load: notImplemented("directory.load"),
    truck: notImplemented("directory.truck"),
    driver: notImplemented("directory.driver"),
    assignableMembers: notImplemented("directory.assignableMembers"),
  },
};

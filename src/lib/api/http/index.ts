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
  fuel: {
    dashboard: notImplemented("fuel.dashboard"),
    listTransactions: notImplemented("fuel.listTransactions"),
    getTransaction: notImplemented("fuel.getTransaction"),
    recordTransaction: notImplemented("fuel.recordTransaction"),
    verifyTransaction: notImplemented("fuel.verifyTransaction"),
    rejectTransaction: notImplemented("fuel.rejectTransaction"),
    markDuplicate: notImplemented("fuel.markDuplicate"),
    correctTransaction: notImplemented("fuel.correctTransaction"),
    attachReceipt: notImplemented("fuel.attachReceipt"),
    listMileage: notImplemented("fuel.listMileage"),
    getMileage: notImplemented("fuel.getMileage"),
    recordMileage: notImplemented("fuel.recordMileage"),
    verifyMileage: notImplemented("fuel.verifyMileage"),
    rejectMileage: notImplemented("fuel.rejectMileage"),
    correctMileage: notImplemented("fuel.correctMileage"),
    runImport: notImplemented("fuel.runImport"),
    integrations: notImplemented("fuel.integrations"),
    audit: notImplemented("fuel.audit"),
    sharingGrants: notImplemented("fuel.sharingGrants"),
  },
  ifta: {
    listPeriods: notImplemented("ifta.listPeriods"),
    getPeriod: notImplemented("ifta.getPeriod"),
    recordFiling: notImplemented("ifta.recordFiling"),
    amendPeriod: notImplemented("ifta.amendPeriod"),
  },
  directory: {
    load: notImplemented("directory.load"),
    truck: notImplemented("directory.truck"),
    driver: notImplemented("directory.driver"),
    assignableMembers: notImplemented("directory.assignableMembers"),
  },
};

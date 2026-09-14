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
  invoices: {
    list: notImplemented("invoices.list"),
    get: notImplemented("invoices.get"),
    summary: notImplemented("invoices.summary"),
    readiness: notImplemented("invoices.readiness"),
    invoiceableLoads: notImplemented("invoices.invoiceableLoads"),
    create: notImplemented("invoices.create"),
    addLineItem: notImplemented("invoices.addLineItem"),
    removeLineItem: notImplemented("invoices.removeLineItem"),
    refreshDocuments: notImplemented("invoices.refreshDocuments"),
    issue: notImplemented("invoices.issue"),
    recheck: notImplemented("invoices.recheck"),
    submit: notImplemented("invoices.submit"),
    recordPayment: notImplemented("invoices.recordPayment"),
    openDispute: notImplemented("invoices.openDispute"),
    resolveDispute: notImplemented("invoices.resolveDispute"),
    void: notImplemented("invoices.void"),
  },
  documents: {
    list: notImplemented("documents.list"),
    get: notImplemented("documents.get"),
    workspaceChecklist: notImplemented("documents.workspaceChecklist"),
    entityChecklist: notImplemented("documents.entityChecklist"),
    addDocument: notImplemented("documents.addDocument"),
    replaceDocument: notImplemented("documents.replaceDocument"),
    submitForReview: notImplemented("documents.submitForReview"),
    approve: notImplemented("documents.approve"),
    reject: notImplemented("documents.reject"),
    setExpiry: notImplemented("documents.setExpiry"),
    link: notImplemented("documents.link"),
    share: notImplemented("documents.share"),
    revokeShare: notImplemented("documents.revokeShare"),
    listShares: notImplemented("documents.listShares"),
    upgradePlan: notImplemented("documents.upgradePlan"),
  },
  directory: {
    load: notImplemented("directory.load"),
    truck: notImplemented("directory.truck"),
    driver: notImplemented("directory.driver"),
    assignableMembers: notImplemented("directory.assignableMembers"),
  },
};

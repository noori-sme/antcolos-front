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
  compliance: {
    list: notImplemented("compliance.list"),
    get: notImplemented("compliance.get"),
    bySubject: notImplemented("compliance.bySubject"),
    summary: notImplemented("compliance.summary"),
    openCount: notImplemented("compliance.openCount"),
    snapshots: notImplemented("compliance.snapshots"),
    shares: notImplemented("compliance.shares"),
    recordResolution: notImplemented("compliance.recordResolution"),
    assignResponsibility: notImplemented("compliance.assignResponsibility"),
    suspend: notImplemented("compliance.suspend"),
    reinstate: notImplemented("compliance.reinstate"),
    addNote: notImplemented("compliance.addNote"),
    extensionPoints: notImplemented("compliance.extensionPoints"),
  },
  directory: {
    load: notImplemented("directory.load"),
    truck: notImplemented("directory.truck"),
    driver: notImplemented("directory.driver"),
    assignableMembers: notImplemented("directory.assignableMembers"),
  },
};

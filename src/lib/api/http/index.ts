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
    decide: notImplemented("needsYou.decide"),
    resolve: notImplemented("needsYou.resolve"),
    reopen: notImplemented("needsYou.reopen"),
  },
  home: { summary: notImplemented("home.summary") },
  loads: {
    list: notImplemented("loads.list"),
    get: notImplemented("loads.get"),
    events: notImplemented("loads.events"),
    documents: notImplemented("loads.documents"),
    createBooked: notImplemented("loads.createBooked"),
    recordConsent: notImplemented("loads.recordConsent"),
    applyRateConfirmation: notImplemented("loads.applyRateConfirmation"),
  },
  fuel: {
    dashboard: notImplemented("fuel.dashboard"),
    listTransactions: notImplemented("fuel.listTransactions"),
    getTransaction: notImplemented("fuel.getTransaction"),
    recordTransaction: notImplemented("fuel.recordTransaction"),
    verifyTransaction: notImplemented("fuel.verifyTransaction"),
    rejectTransaction: notImplemented("fuel.rejectTransaction"),
    acceptAttributionNotEstablishable: notImplemented("fuel.acceptAttributionNotEstablishable"),
    acceptMileageAttributionNotEstablishable:
      notImplemented("fuel.acceptMileageAttributionNotEstablishable"),
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
  reports: {
    workspace: notImplemented("reports.workspace"),
    run: notImplemented("reports.run"),
    drilldown: notImplemented("reports.drilldown"),
    sources: notImplemented("reports.sources"),
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
  eld: {
    dashboard: notImplemented("eld.dashboard"),
    providers: notImplemented("eld.providers"),
    connections: notImplemented("eld.connections"),
    devices: notImplemented("eld.devices"),
    device: notImplemented("eld.device"),
    snapshots: notImplemented("eld.snapshots"),
    snapshot: notImplemented("eld.snapshot"),
    events: notImplemented("eld.events"),
    rawPayloads: notImplemented("eld.rawPayloads"),
    rawPayload: notImplemented("eld.rawPayload"),
    signals: notImplemented("eld.signals"),
    connect: notImplemented("eld.connect"),
    disconnect: notImplemented("eld.disconnect"),
    registerDevice: notImplemented("eld.registerDevice"),
    retireDevice: notImplemented("eld.retireDevice"),
    bindDeviceToTruck: notImplemented("eld.bindDeviceToTruck"),
    endVehicleBinding: notImplemented("eld.endVehicleBinding"),
    bindDriverToDevice: notImplemented("eld.bindDriverToDevice"),
    endDriverBinding: notImplemented("eld.endDriverBinding"),
    ingest: notImplemented("eld.ingest"),
    shares: notImplemented("eld.shares"),
    grantShare: notImplemented("eld.grantShare"),
    revokeShare: notImplemented("eld.revokeShare"),
    needsYou: notImplemented("eld.needsYou"),
  },
  fleet: {
    dashboard: notImplemented("fleet.dashboard"),
    equipment: notImplemented("fleet.equipment"),
    asset: notImplemented("fleet.asset"),
    assignmentHistory: notImplemented("fleet.assignmentHistory"),
    recordTelemetry: notImplemented("fleet.recordTelemetry"),
    integrations: notImplemented("fleet.integrations"),
    needsYou: notImplemented("fleet.needsYou"),
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
  driverWorkflow: {
    listProposals: notImplemented("driverWorkflow.listProposals"),
    getProposal: notImplemented("driverWorkflow.getProposal"),
    proposalEvents: notImplemented("driverWorkflow.proposalEvents"),
    executeProposalCommand: notImplemented("driverWorkflow.executeProposalCommand"),
    finalize: notImplemented("driverWorkflow.finalize"),
    listTrips: notImplemented("driverWorkflow.listTrips"),
    getTrip: notImplemented("driverWorkflow.getTrip"),
    getTripByLoad: notImplemented("driverWorkflow.getTripByLoad"),
    executeWorkflowCommand: notImplemented("driverWorkflow.executeWorkflowCommand"),
    ingestSignals: notImplemented("driverWorkflow.ingestSignals"),
    policy: notImplemented("driverWorkflow.policy"),
    pendingHandoffs: notImplemented("driverWorkflow.pendingHandoffs"),
    integrationStatus: notImplemented("driverWorkflow.integrationStatus"),
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
  audit: {
    record: notImplemented("audit.record"),
    list: notImplemented("audit.list"),
    get: notImplemented("audit.get"),
    forEntity: notImplemented("audit.forEntity"),
    forActor: notImplemented("audit.forActor"),
    correct: notImplemented("audit.correct"),
    exportView: notImplemented("audit.exportView"),
    sources: notImplemented("audit.sources"),
  },
  risk: {
    dashboard: notImplemented("risk.dashboard"),
    rules: notImplemented("risk.rules"),
    signals: notImplemented("risk.signals"),
    signal: notImplemented("risk.signal"),
    dismissSignal: notImplemented("risk.dismissSignal"),
    cases: notImplemented("risk.cases"),
    case: notImplemented("risk.case"),
    openCase: notImplemented("risk.openCase"),
    linkSignal: notImplemented("risk.linkSignal"),
    assign: notImplemented("risk.assign"),
    setDueDate: notImplemented("risk.setDueDate"),
    addNote: notImplemented("risk.addNote"),
    addEvidence: notImplemented("risk.addEvidence"),
    recordDecision: notImplemented("risk.recordDecision"),
    transition: notImplemented("risk.transition"),
    eligibleAssignees: notImplemented("risk.eligibleAssignees"),
    extensionPoints: notImplemented("risk.extensionPoints"),
  },
  agreements: {
    dashboard: notImplemented("agreements.dashboard"),
    list: notImplemented("agreements.list"),
    get: notImplemented("agreements.get"),
    getVersion: notImplemented("agreements.getVersion"),
    compensationAt: notImplemented("agreements.compensationAt"),
    timeline: notImplemented("agreements.timeline"),
    create: notImplemented("agreements.create"),
    updateDraftTerms: notImplemented("agreements.updateDraftTerms"),
    sendForReview: notImplemented("agreements.sendForReview"),
    returnFromReview: notImplemented("agreements.returnFromReview"),
    issueForSignature: notImplemented("agreements.issueForSignature"),
    cancel: notImplemented("agreements.cancel"),
    authorizeSigner: notImplemented("agreements.authorizeSigner"),
    revokeSigner: notImplemented("agreements.revokeSigner"),
    sign: notImplemented("agreements.sign"),
    amend: notImplemented("agreements.amend"),
    renew: notImplemented("agreements.renew"),
    giveTerminationNotice: notImplemented("agreements.giveTerminationNotice"),
    confirmTerminationStep: notImplemented("agreements.confirmTerminationStep"),
    withdrawTermination: notImplemented("agreements.withdrawTermination"),
    requirements: notImplemented("agreements.requirements"),
    waiveRequirement: notImplemented("agreements.waiveRequirement"),
    linkRelationship: notImplemented("agreements.linkRelationship"),
    detachRelationship: notImplemented("agreements.detachRelationship"),
    linkRecord: notImplemented("agreements.linkRecord"),
    requestRelationshipTransition: notImplemented("agreements.requestRelationshipTransition"),
    transitionRequests: notImplemented("agreements.transitionRequests"),
    capabilities: notImplemented("agreements.capabilities"),
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
  // Responsibility, delegation and escalation. When the real backend exists,
  // this is where the SLA clocks, the escalation jobs and the reminder delivery
  // the frontend cannot honestly provide will actually live.
  responsibility: {
    board: notImplemented("responsibility.board"),
    attention: notImplemented("responsibility.attention"),
    get: notImplemented("responsibility.get"),
    explain: notImplemented("responsibility.explain"),
    acknowledge: notImplemented("responsibility.acknowledge"),
    keep: notImplemented("responsibility.keep"),
    delegate: notImplemented("responsibility.delegate"),
    reassign: notImplemented("responsibility.reassign"),
    takeOver: notImplemented("responsibility.takeOver"),
    changeAccountable: notImplemented("responsibility.changeAccountable"),
    requestApproval: notImplemented("responsibility.requestApproval"),
    decideApproval: notImplemented("responsibility.decideApproval"),
    requestHelp: notImplemented("responsibility.requestHelp"),
    escalate: notImplemented("responsibility.escalate"),
    addWatcher: notImplemented("responsibility.addWatcher"),
    removeWatcher: notImplemented("responsibility.removeWatcher"),
    fleetProfile: notImplemented("responsibility.fleetProfile"),
    setFleetSize: notImplemented("responsibility.setFleetSize"),
    policies: notImplemented("responsibility.policies"),
    updatePolicy: notImplemented("responsibility.updatePolicy"),
    assignable: notImplemented("responsibility.assignable"),
  },
  workforce: {
    list: notImplemented("workforce.list"),
    get: notImplemented("workforce.get"),
    summary: notImplemented("workforce.summary"),
    create: notImplemented("workforce.create"),
    takeShareForward: notImplemented("workforce.takeShareForward"),
    onboardingChecklist: notImplemented("workforce.onboardingChecklist"),
    startOnboarding: notImplemented("workforce.startOnboarding"),
    waiveStep: notImplemented("workforce.waiveStep"),
    activate: notImplemented("workforce.activate"),
    suspend: notImplemented("workforce.suspend"),
    restore: notImplemented("workforce.restore"),
    reject: notImplemented("workforce.reject"),
    withdraw: notImplemented("workforce.withdraw"),
    changeClassification: notImplemented("workforce.changeClassification"),
    recordStartDate: notImplemented("workforce.recordStartDate"),
    assignFunction: notImplemented("workforce.assignFunction"),
    removeFunction: notImplemented("workforce.removeFunction"),
    recordLeave: notImplemented("workforce.recordLeave"),
    endLeave: notImplemented("workforce.endLeave"),
    cancelLeave: notImplemented("workforce.cancelLeave"),
    reconcileAvailability: notImplemented("workforce.reconcileAvailability"),
    changeManager: notImplemented("workforce.changeManager"),
    linkContract: notImplemented("workforce.linkContract"),
    requestAccessStep: notImplemented("workforce.requestAccessStep"),
    offboardingPlan: notImplemented("workforce.offboardingPlan"),
    offboard: notImplemented("workforce.offboard"),
  },
  qualification: {
    list: notImplemented("qualification.list"),
    get: notImplemented("qualification.get"),
    previewAdoption: notImplemented("qualification.previewAdoption"),
    adopt: notImplemented("qualification.adopt"),
    recordCarrierEvidence: notImplemented("qualification.recordCarrierEvidence"),
    retentionPolicies: notImplemented("qualification.retentionPolicies"),
    authorizeDisposal: notImplemented("qualification.authorizeDisposal"),
    adoptionsForDriver: notImplemented("qualification.adoptionsForDriver"),
  },
  /*
   * ███ WHEN THIS IS IMPLEMENTED, IDENTITY DOES NOT CROSS THE WIRE ███
   *
   * `lookUp`, `preview`, `accept` and `decline` take an `AcceptingIdentity` in
   * the mock because a browser has no server to ask who is signed in. This
   * adapter must NOT serialize it. The server derives the acting identity from
   * the session it issued and binds it to the operation; an endpoint that
   * accepts a user id or an email from its caller is an endpoint that accepts
   * anyone's. The addressee match belongs on that side, against the
   * authenticated principal, and the invitation token proves which invitation
   * — never who is holding it.
   *
   * See the note on `AcceptingIdentity` in ../contracts/access.ts.
   */
  access: {
    list: notImplemented("access.list"),
    create: notImplemented("access.create"),
    revoke: notImplemented("access.revoke"),
    resend: notImplemented("access.resend"),
    lookUp: notImplemented("access.lookUp"),
    preview: notImplemented("access.preview"),
    accept: notImplemented("access.accept"),
    decline: notImplemented("access.decline"),
    /*
     * ███ TEMPLATES: WHAT THE SERVER OWES, BEYOND SERIALIZING THESE ███
     *
     * Every refusal the mock returns is computed in a browser out of a set the
     * browser assembled, so none of it survives the trip. On this side the
     * server must, from the authenticated session and its own records:
     *
     *   • Scope every call to the acting membership's organization. A template
     *     id from elsewhere answers "not found", never "forbidden" — the second
     *     one confirms the template exists.
     *   • Derive the acting membership's permissions itself and refuse a saved
     *     selection containing anything outside them, and clamp an application
     *     to the same set. Both, not one: the save guard stops a template being
     *     written that its author could not grant, the apply clamp stops one
     *     being USED to hand out more than the applier holds.
     *   • Refuse a self-application outright.
     *   • Keep the applied snapshot immutable. `updateTemplate` must not touch a
     *     single existing membership; if that is one UPDATE statement away in
     *     the schema, the schema is wrong.
     *   • Write an audit event for every one of these, refusals included, with
     *     the template, its version, the seat, and the before/after counts.
     */
    templates: notImplemented("access.templates"),
    createTemplate: notImplemented("access.createTemplate"),
    updateTemplate: notImplemented("access.updateTemplate"),
    duplicateTemplate: notImplemented("access.duplicateTemplate"),
    setTemplateArchived: notImplemented("access.setTemplateArchived"),
    deleteTemplate: notImplemented("access.deleteTemplate"),
    previewApplication: notImplemented("access.previewApplication"),
    applyToMembership: notImplemented("access.applyToMembership"),
    removeFromMembership: notImplemented("access.removeFromMembership"),
    roster: notImplemented("access.roster"),
    endSeat: notImplemented("access.endSeat"),
    leaveOrganization: notImplemented("access.leaveOrganization"),
  },
  /*
   * ███ REFERRALS: WHAT THE SERVER OWES THAT A BROWSER CANNOT ███
   *
   * More than serialization, and the list is not optional:
   *
   *   • The claim token. Minted from a CSPRNG, stored as a hash, compared in
   *     constant time, single-use and expiring. The mock's token is
   *     `Math.random` in a tab.
   *   • The email. A transactional provider, its credentials, the send, and the
   *     delivery webhook — which is the ONLY thing allowed to write `delivered`
   *     or `bounced`. A sender never writes its own delivery receipt.
   *   • The rate limits in `REFERRAL_LIMITS`, enforced server-side per referrer,
   *     per recipient address and per target organization, before the email is
   *     queued. The mock counts what one tab has seen.
   *   • The duplicate guard, as a unique partial index on
   *     `(targetOrganizationId, candidateEmail) WHERE still open` — not a read
   *     followed by a write, which two requests race straight through.
   *   • `ReferringIdentity` DOES NOT CROSS THE WIRE. Derive it from the session
   *     the server issued. The claim token proves which referral, never who is
   *     holding it, and the addressee match belongs on this side against the
   *     authenticated principal.
   *   • `referrals:review` and the organization scope, checked here. A referral
   *     for another organization answers as missing, never as forbidden.
   *   • The opt-out list, durable and never readable through an endpoint.
   */
  referrals: {
    searchOrganizations: notImplemented("referrals.searchOrganizations"),
    resolveOrganization: notImplemented("referrals.resolveOrganization"),
    disclose: notImplemented("referrals.disclose"),
    submit: notImplemented("referrals.submit"),
    myReferrals: notImplemented("referrals.myReferrals"),
    withdraw: notImplemented("referrals.withdraw"),
    resend: notImplemented("referrals.resend"),
    companyInbox: notImplemented("referrals.companyInbox"),
    companyGet: notImplemented("referrals.companyGet"),
    accept: notImplemented("referrals.accept"),
    reject: notImplemented("referrals.reject"),
    handoff: notImplemented("referrals.handoff"),
    recordInvitation: notImplemented("referrals.recordInvitation"),
    lookUpClaim: notImplemented("referrals.lookUpClaim"),
    claim: notImplemented("referrals.claim"),
    decline: notImplemented("referrals.decline"),
    reportUnwanted: notImplemented("referrals.reportUnwanted"),
    recordDelivery: notImplemented("referrals.recordDelivery"),
  },
  /**
   * Import.
   *
   * The backend must enforce two things this stub cannot: a claim is evidence
   * of what a carrier asserted, so `stage` is append-only and a re-upload of
   * the same content resolves to the batch that already exists; and a commit
   * writes through the module that owns the record, so the import endpoint
   * never gets its own people or truck tables.
   */
  import: {
    stage: notImplemented("import.stage"),
    plan: notImplemented("import.plan"),
    decide: notImplemented("import.decide"),
    commit: notImplemented("import.commit"),
    list: notImplemented("import.list"),
  },
  /**
   * The permanent profile.
   *
   * Four things the backend must enforce that no frontend can. The username is
   * unique and immutable, so `initialize` is idempotent per account and never
   * reads a handle from its own request body. Avatar bytes are re-checked and
   * scanned on the server, because a content type and a byte length reported by
   * a browser are claims rather than evidence. Public reads are rate limited
   * and answer identically for a handle nobody holds and a profile the caller
   * may not read. And the contribution ledger is append-only, with a uniqueness
   * constraint on `sourceRef`, so a retried job cannot post the same load twice
   * and inflate somebody's record.
   */
  /**
   * Factoring.
   *
   * ███ NO FACTORING COMPANY HAS AUTHORIZED ANTCOLOS ███ Implementing this
   * adapter is not enough on its own: a live check needs the provider's own
   * authorization, held on the SERVER and never handed to a browser. The
   * backend also owes encryption at rest for credit limits and rejection
   * reasons, append-only storage of results, server-side enforcement of both
   * the permissions and the carrier boundary, audit retention for overrides,
   * and provider-specific rate limiting.
   */
  factoring: {
    connection: notImplemented("factoring.connection"),
    connect: notImplemented("factoring.connect"),
    disconnect: notImplemented("factoring.disconnect"),
    policy: notImplemented("factoring.policy"),
    setPolicy: notImplemented("factoring.setPolicy"),
    status: notImplemented("factoring.status"),
    statuses: notImplemented("factoring.statuses"),
    history: notImplemented("factoring.history"),
    check: notImplemented("factoring.check"),
    fallbackPrefill: notImplemented("factoring.fallbackPrefill"),
    recordResult: notImplemented("factoring.recordResult"),
    evaluateBooking: notImplemented("factoring.evaluateBooking"),
    override: notImplemented("factoring.override"),
    previewImport: notImplemented("factoring.previewImport"),
    commitImport: notImplemented("factoring.commitImport"),
    importBatches: notImplemented("factoring.importBatches"),
    importRows: notImplemented("factoring.importRows"),
  },
  profile: {
    initialize: notImplemented("profile.initialize"),
    getOwn: notImplemented("profile.getOwn"),
    getByUsername: notImplemented("profile.getByUsername"),
    update: notImplemented("profile.update"),
    setVisibility: notImplemented("profile.setVisibility"),
    uploadAvatar: notImplemented("profile.uploadAvatar"),
    removeAvatar: notImplemented("profile.removeAvatar"),
    listWorkplaces: notImplemented("profile.listWorkplaces"),
    recordContribution: notImplemented("profile.recordContribution"),
    shareCard: notImplemented("profile.shareCard"),
  },
};

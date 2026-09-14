import { API_MODE } from "@/lib/api/mode";
import { mockIntegrationPorts } from "./mock/adapters";
import type { IntegrationPorts } from "./ports";

/**
 * ★ THE INTEGRATION REGISTRY ★
 *
 * One import, one swap. When Dispatch, Rate Confirmation, the Document Center
 * and the telematics feeds land, a real `IntegrationPorts` is built against the
 * same interfaces and assigned here — and nothing in `features/`, in the state
 * machines or in the service adapter changes, because none of them import an
 * adapter directly.
 *
 * Until then every port is a labelled mock and `integrationsAreMocked()` says
 * so out loud, so a screen can tell the driver what is and is not connected
 * instead of implying it all works.
 */

const notWired = (name: string) => (): never => {
  throw new Error(
    `Integration port "${name}" has no real adapter yet. It is owned by another branch; set NEXT_PUBLIC_API_MODE=mock to use the labelled placeholder.`,
  );
};

/**
 * The real boundary, deliberately unimplemented. It exists so that switching
 * modes fails loudly at the seam rather than quietly serving fixtures.
 */
const httpIntegrationPorts: IntegrationPorts = {
  loadSource: {
    getLoad: notWired("loadSource.getLoad"),
    getRateConfirmation: notWired("loadSource.getRateConfirmation"),
  },
  opportunities: {
    listInbound: notWired("opportunities.listInbound"),
    reportDriverDecision: notWired("opportunities.reportDriverDecision"),
  },
  assignments: {
    getForLoad: notWired("assignments.getForLoad"),
    listForDriver: notWired("assignments.listForDriver"),
    engagementType: notWired("assignments.engagementType"),
  },
  documents: {
    attach: notWired("documents.attach"),
    extract: notWired("documents.extract"),
    requestVerification: notWired("documents.requestVerification"),
    reportCorrection: notWired("documents.reportCorrection"),
  },
  signals: { poll: notWired("signals.poll") },
  downstream: {
    emit: notWired("downstream.emit"),
    pending: notWired("downstream.pending"),
  },
  status: () => [],
};

export const integrations: IntegrationPorts =
  API_MODE === "http" ? httpIntegrationPorts : mockIntegrationPorts;

/** True while any port behind the boundary is a placeholder. */
export function integrationsAreMocked(): boolean {
  return API_MODE !== "http";
}

export * from "./ports";
export {
  injectInboundProposal, seedSignal, resetIntegrationMocks, withoutLatency,
} from "./mock/adapters";
export { externalRef, idempotencyKey, mockProvenance, MOCK_LABEL } from "./mock/support";

import type { AntcolosServices } from "./contracts";
import { API_MODE } from "./mode";
import { httpServices } from "./http";
import { mockAgreementsService } from "./mock/agreements";
import { mockAuditService } from "./mock/audit";
import { mockRiskService } from "./mock/risk";
import { mockComplianceService } from "./mock/compliance";
import { mockDocumentsService } from "./mock/documents";
import { mockDirectoryService, mockHomeService } from "./mock/home";
import { mockFuelService, mockIftaService } from "./mock/fuel";
import { mockFleetService } from "./mock/fleet-operations";
import { mockEldService } from "./mock/eld";
import { mockDriverWorkflowService } from "./mock/driver-workflow";
import { mockInvoicesService } from "./mock/invoices";
import { mockLoadsService } from "./mock/loads";
import { mockNeedsYouService } from "./mock/needs-you";
import { mockReportsService } from "./mock/reports";
import { mockResponsibilityService } from "./mock/responsibility";
import { mockSettlementsService } from "./mock/settlements";

/**
 * Service registry. Today every call resolves to the mock adapter; when Taqi
 * implements the HTTP adapter against the same contracts, this flag is the only
 * line that changes. No component imports an adapter directly.
 */
const mockServices: AntcolosServices = {
  needsYou: mockNeedsYouService,
  home: mockHomeService,
  directory: mockDirectoryService,
  loads: mockLoadsService,
  fuel: mockFuelService,
  ifta: mockIftaService,
  reports: mockReportsService,
  compliance: mockComplianceService,
  fleet: mockFleetService,
  eld: mockEldService,
  settlements: mockSettlementsService,
  driverWorkflow: mockDriverWorkflowService,
  invoices: mockInvoicesService,
  documents: mockDocumentsService,
  agreements: mockAgreementsService,
  audit: mockAuditService,
  risk: mockRiskService,
  responsibility: mockResponsibilityService,
};

export const services: AntcolosServices =
  API_MODE === "http" ? httpServices : mockServices;

export * from "./contracts";
export { API_MODE } from "./mode";

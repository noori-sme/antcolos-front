import type { AntcolosServices } from "./contracts";
import { httpServices } from "./http";
import { mockDocumentsService } from "./mock/documents";
import { mockDirectoryService, mockHomeService } from "./mock/home";
import { mockInvoicesService } from "./mock/invoices";
import { mockLoadsService } from "./mock/loads";
import { mockNeedsYouService } from "./mock/needs-you";

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
  invoices: mockInvoicesService,
  documents: mockDocumentsService,
};

export const API_MODE =
  process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

export const services: AntcolosServices =
  API_MODE === "http" ? httpServices : mockServices;

export * from "./contracts";

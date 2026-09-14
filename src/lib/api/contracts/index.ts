export * from "./context";
export type * from "./needs-you";
export type * from "./home";
export type * from "./directory";
export type * from "./loads";
export type * from "./driver-workflow";

import type { DirectoryService } from "./directory";
import type { DriverWorkflowService } from "./driver-workflow";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { NeedsYouService } from "./needs-you";

/** The seam Taqi implements against. The UI only ever sees this shape. */
export interface AntcolosServices {
  needsYou: NeedsYouService;
  home: HomeService;
  directory: DirectoryService;
  loads: LoadsService;
  /** Driver proposals, finalized load posts and the trip workflow. */
  driverWorkflow: DriverWorkflowService;
}

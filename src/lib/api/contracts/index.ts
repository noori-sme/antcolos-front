export * from "./context";
export type * from "./needs-you";
export type * from "./home";
export type * from "./directory";
export type * from "./loads";
export type * from "./reports";

import type { DirectoryService } from "./directory";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { NeedsYouService } from "./needs-you";
import type { ReportsService } from "./reports";

/** The seam Taqi implements against. The UI only ever sees this shape. */
export interface AntcolosServices {
  needsYou: NeedsYouService;
  home: HomeService;
  directory: DirectoryService;
  loads: LoadsService;
  reports: ReportsService;
}

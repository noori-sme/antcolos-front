export * from "./context";
export type * from "./needs-you";
export type * from "./home";
export type * from "./directory";
export type * from "./loads";
export type * from "./settlements";

import type { DirectoryService } from "./directory";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { SettlementsService } from "./settlements";
import type { NeedsYouService } from "./needs-you";

/** The seam Taqi implements against. The UI only ever sees this shape. */
export interface AntcolosServices {
  needsYou: NeedsYouService;
  home: HomeService;
  directory: DirectoryService;
  loads: LoadsService;
  settlements: SettlementsService;
}

export * from "./context";
export type * from "./needs-you";
export type * from "./home";
export type * from "./directory";
export type * from "./loads";
export type * from "./fleet";

import type { DirectoryService } from "./directory";
import type { FleetService } from "./fleet";
import type { HomeService } from "./home";
import type { LoadsService } from "./loads";
import type { NeedsYouService } from "./needs-you";

/** The seam Taqi implements against. The UI only ever sees this shape. */
export interface AntcolosServices {
  needsYou: NeedsYouService;
  home: HomeService;
  directory: DirectoryService;
  loads: LoadsService;
  /** The shared operational layer over trucks, trailers, drivers and leases. */
  fleet: FleetService;
}

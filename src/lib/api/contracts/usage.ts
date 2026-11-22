import type { UsageReport } from "@/types/usage";
import type { ServiceContext } from "./context";

/** Usage and estimated costs (backend plan 49). http-only. */
export interface UsageService {
  /** `usage.read`: this organization, `[from, to)`. */
  organization(ctx: ServiceContext, range: { from: string; to: string }): Promise<UsageReport>;
}

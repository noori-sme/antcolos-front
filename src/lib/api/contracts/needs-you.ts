import type { NeedsYouFilters, NeedsYouItem } from "@/types";
import type { ServiceContext } from "./context";

export interface SnoozeInput {
  hours: number;
  reason: string;
}

export interface EscalateInput {
  /** Membership to escalate to; omitted means "to an owner". */
  toMembershipId?: string;
  note: string;
}

export interface NeedsYouService {
  list(ctx: ServiceContext, filters?: NeedsYouFilters): Promise<NeedsYouItem[]>;
  get(ctx: ServiceContext, id: string): Promise<NeedsYouItem>;
  /** Open + escalated items the membership may actually see. Drives the nav badge. */
  openCount(ctx: ServiceContext): Promise<number>;
  assign(ctx: ServiceContext, id: string, membershipId: string): Promise<NeedsYouItem>;
  snooze(ctx: ServiceContext, id: string, input: SnoozeInput): Promise<NeedsYouItem>;
  unsnooze(ctx: ServiceContext, id: string): Promise<NeedsYouItem>;
  escalate(ctx: ServiceContext, id: string, input: EscalateInput): Promise<NeedsYouItem>;
  resolve(ctx: ServiceContext, id: string, note?: string): Promise<NeedsYouItem>;
  reopen(ctx: ServiceContext, id: string): Promise<NeedsYouItem>;
}

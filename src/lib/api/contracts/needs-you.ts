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

/**
 * One press, and the system resumes.
 *
 * The option ids are the ones the item's own automation record offered. A
 * caller never invents one, and the service never accepts one that item did not
 * carry — the decision has to be traceable to the options a person was actually
 * shown.
 */
export interface DecideInput {
  optionId: string;
  /** Optional: a person's own words, kept on the item's history. */
  note?: string;
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
  /**
   * Take the pre-analysed decision and run everything downstream of it.
   *
   * The whole point of the queue: the system has already done the gathering,
   * the pricing and the comparing, and this is the one call that says which
   * option a person chose. What happens after it is the service's, not the
   * screen's.
   */
  decide(ctx: ServiceContext, id: string, input: DecideInput): Promise<NeedsYouItem>;
  resolve(ctx: ServiceContext, id: string, note?: string): Promise<NeedsYouItem>;
  reopen(ctx: ServiceContext, id: string): Promise<NeedsYouItem>;
}

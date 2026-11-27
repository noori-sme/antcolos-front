import type { Paginated } from "@/types/common";
import type {
  TelegramAccount, TelegramLinkCode, TelegramLinkPurpose, TelegramTruckChat,
} from "@/types/telegram";
import type { ServiceContext } from "./context";

/** Telegram linking (telegram-api-contract §1, §5–§6; backend plan 52). http-only. */
export interface TelegramService {
  /** The caller's own link; no permission needed. */
  account(ctx: ServiceContext): Promise<TelegramAccount>;
  /** Disconnects the caller's Telegram for all their companies; no permission needed. */
  unlinkAccount(ctx: ServiceContext): Promise<void>;
  /** `load.respond` (and `truck.update` for TRUCK_CHAT). A new code on every call. */
  createLinkCode(ctx: ServiceContext, purpose: TelegramLinkPurpose, truckId?: string): Promise<TelegramLinkCode>;
  /** `truck.read`: this organization's truck groups, newest link first. */
  truckChats(ctx: ServiceContext, query: { page?: number; pageSize?: number }): Promise<Paginated<TelegramTruckChat>>;
  /** `truck.update`. Rejects with the backend's message (404 when there is no group). */
  unlinkTruckChat(ctx: ServiceContext, truckId: string): Promise<void>;
}

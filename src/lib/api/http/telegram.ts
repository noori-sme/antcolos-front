import { apiClient } from "../client";
import type { TelegramService } from "../contracts/telegram";
import { type Dto, nullableStr, obj, oneOf, queryParams, str, toPage } from "./dto";
import type { TelegramAccount, TelegramLinkCode, TelegramTruckChat } from "@/types/telegram";

/** telegram-api-contract §5 → `TelegramAccount`. */
export function toTelegramAccount(body: unknown): TelegramAccount {
  const dto = obj(body) ?? {};
  return {
    linked: dto.linked === true,
    username: nullableStr(dto.username) ?? null,
    linkedAt: nullableStr(dto.linkedAt) ?? null,
  };
}

/** telegram-api-contract §1 → `TelegramLinkCode`. */
export function toTelegramLinkCode(body: unknown): TelegramLinkCode {
  const dto = obj(body) ?? {};
  return {
    code: str(dto.code) ?? "",
    purpose: oneOf(["ACCOUNT", "TRUCK_CHAT"] as const, dto.purpose) ?? "ACCOUNT",
    expiresAt: str(dto.expiresAt) ?? "",
    deepLink: nullableStr(dto.deepLink) ?? null,
    instruction: str(dto.instruction) ?? "",
  };
}

/** telegram-api-contract §6 list item → `TelegramTruckChat`. */
export function toTelegramTruckChat(dto: Dto): TelegramTruckChat {
  const linkedBy = obj(dto.linkedBy);
  return {
    truckId: str(dto.truckId) ?? "",
    unitNumber: nullableStr(dto.unitNumber) ?? null,
    title: nullableStr(dto.title) ?? null,
    linkedAt: str(dto.linkedAt) ?? "",
    linkedBy: { id: str(linkedBy?.id) ?? "", name: nullableStr(linkedBy?.name) ?? null },
  };
}

export const httpTelegramService: TelegramService = {
  async account() {
    const res = await apiClient.get("/telegram/account");
    return toTelegramAccount(res.data);
  },
  async unlinkAccount() {
    await apiClient.delete("/telegram/account");
  },
  async createLinkCode(_ctx, purpose, truckId) {
    const res = await apiClient.post("/telegram/link-codes", truckId ? { purpose, truckId } : { purpose });
    return toTelegramLinkCode(res.data);
  },
  async truckChats(_ctx, query) {
    const res = await apiClient.get("/telegram/truck-chats", { params: queryParams({ ...query }) });
    return toPage(res.data, toTelegramTruckChat);
  },
  async unlinkTruckChat(_ctx, truckId) {
    await apiClient.delete(`/telegram/truck-chats/${encodeURIComponent(truckId)}`);
  },
};

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { fleetKeys, telegramKeys } from "@/lib/query/keys";
import { useCan } from "@/lib/session/hooks";
import type { TruckListFilters } from "@/types/fleet-truck";
import type { TelegramLinkPurpose } from "@/types/telegram";

/** Enough for a small carrier; the list says when there are more. */
const TRUCKS: TruckListFilters = { page: 1, pageSize: 100, sortBy: "unitNumber", sortOrder: "asc" };

/**
 * The person's own Telegram link (plan 29). While a code is on screen, `waiting` refetches every
 * few seconds and on focus, so the screen turns to "Connected" once they tap Start in Telegram.
 */
export function useTelegramAccount(waiting = false) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? telegramKeys.account(ctx.organizationId) : ["telegram", "no-context"],
    queryFn: () => services.telegram.account(ctx!),
    enabled: Boolean(ctx),
    refetchInterval: waiting ? 5000 : false,
    refetchOnWindowFocus: waiting,
  });
}

/** A new one-time code on every call (the contract does not make it idempotent). */
export function useCreateTelegramLinkCode() {
  const ctx = useServiceContext();
  return useMutation({
    mutationFn: (input: { purpose: TelegramLinkPurpose; truckId?: string }) => {
      if (!ctx) throw new Error("No organization selected");
      return services.telegram.createLinkCode(ctx, input.purpose, input.truckId);
    },
  });
}

export function useUnlinkTelegramAccount() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!ctx) throw new Error("No organization selected");
      return services.telegram.unlinkAccount(ctx);
    },
    onSuccess: () => {
      if (ctx) void queryClient.invalidateQueries({ queryKey: telegramKeys.account(ctx.organizationId) });
    },
  });
}

/** This organization's trucks, for the Integrations screen; only with `trucks:view`. */
export function useTelegramTrucks() {
  const ctx = useServiceContext();
  const allowed = useCan("trucks:view");
  return useQuery({
    queryKey: ctx ? fleetKeys.list(ctx.organizationId, TRUCKS) : ["trucks", "no-context"],
    queryFn: () => services.trucks.list(ctx!, TRUCKS),
    enabled: Boolean(ctx) && allowed,
  });
}

/**
 * This organization's truck groups; only with `trucks:view` (the route needs truck.read).
 * `waiting` polls while a group code is on screen, so the new link shows without a reload.
 */
export function useTelegramTruckChats(waiting = false) {
  const ctx = useServiceContext();
  const allowed = useCan("trucks:view");
  return useQuery({
    queryKey: ctx ? telegramKeys.truckChats(ctx.organizationId) : ["telegram", "no-context"],
    queryFn: () => services.telegram.truckChats(ctx!, { page: 1, pageSize: 100 }),
    enabled: Boolean(ctx) && allowed,
    refetchInterval: waiting ? 5000 : false,
    refetchOnWindowFocus: waiting,
  });
}

export function useUnlinkTelegramTruckChat() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (truckId: string) => {
      if (!ctx) throw new Error("No organization selected");
      return services.telegram.unlinkTruckChat(ctx, truckId);
    },
    onSuccess: () => {
      if (ctx) void queryClient.invalidateQueries({ queryKey: telegramKeys.truckChats(ctx.organizationId) });
    },
  });
}

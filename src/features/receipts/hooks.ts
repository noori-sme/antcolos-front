"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
import { READING_PATIENCE_MS, type Viewer } from "@/lib/receipts/receipt-rules";
import { useCan, useCanAny } from "@/lib/session/hooks";
import type { ConfirmReceiptInput, ReceiptFilters, UploadReceiptInput } from "@/types/receipt";

/** Receipts on the real API (F2.1, backend plan 50). http-only. */

export const receiptKeys = {
  all: (org: string) => [...orgKey(org), "receipts"] as const,
  list: (org: string, filters: ReceiptFilters) => [...orgKey(org), "receipts", "list", filters] as const,
  detail: (org: string, id: string) => [...orgKey(org), "receipts", "detail", id] as const,
};

/** While a receipt is being read, check again every 3 s, for as long as reading should take. */
const POLL_MS = 3_000;
const POLL_FOR_MS = READING_PATIENCE_MS;

export function useReceipts(filters: ReceiptFilters) {
  const ctx = useServiceContext();
  const allowed = useCanAny(["receipts:view", "receipts:own:view"]);
  return useQuery({
    queryKey: ctx ? receiptKeys.list(ctx.organizationId, filters) : [...orgKey("none"), "receipts", "no-context"],
    queryFn: () => services.receipts.list(ctx!, filters),
    enabled: Boolean(ctx) && allowed,
    placeholderData: keepPreviousData,
    // A receipt still being read in the list keeps the list fresh until it is decided.
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (r) => r.status === "EXTRACTING" && Date.now() - Date.parse(r.createdAt) < POLL_FOR_MS,
      )
        ? POLL_MS
        : false,
  });
}

export function useReceipt(id: string | null) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && id ? receiptKeys.detail(ctx.organizationId, id) : [...orgKey("none"), "receipts", "no-context", id],
    queryFn: () => services.receipts.get(ctx!, id!),
    enabled: Boolean(ctx) && Boolean(id),
    retry: false,
    refetchInterval: (query) => {
      const r = query.state.data;
      return r?.status === "EXTRACTING" && Date.now() - Date.parse(r.createdAt) < POLL_FOR_MS ? POLL_MS : false;
    },
  });
}

/** Who is looking, for the confirm/reject buttons; the backend decides again. */
export function useReceiptViewer(): Viewer {
  const ctx = useServiceContext();
  return {
    userId: ctx?.actor.userId ?? "",
    canReview: useCan("receipts:review"),
    canConfirmOwn: useCan("receipts:own:confirm"),
  };
}

/** One Idempotency-Key per intent, kept across re-renders and retries. */
export function useReceiptIntentKeys() {
  const [keys] = useState(() => createIntentKeys());
  return keys;
}

function useReceiptMutation<TVars, TResult>(
  run: (ctx: NonNullable<ReturnType<typeof useServiceContext>>, vars: TVars) => Promise<TResult>,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSettled: () => {
      if (ctx) void queryClient.invalidateQueries({ queryKey: receiptKeys.all(ctx.organizationId) });
    },
  });
}

export function useUploadReceipt() {
  return useReceiptMutation((ctx, vars: { input: UploadReceiptInput; idempotencyKey: string }) =>
    services.receipts.upload(ctx, vars.input, vars.idempotencyKey),
  );
}

export function useConfirmReceipt() {
  return useReceiptMutation((ctx, vars: { id: string; input: ConfirmReceiptInput; idempotencyKey: string }) =>
    services.receipts.confirm(ctx, vars.id, vars.input, vars.idempotencyKey),
  );
}

export function useRejectReceipt() {
  return useReceiptMutation((ctx, vars: { id: string; reason: string; idempotencyKey: string }) =>
    services.receipts.reject(ctx, vars.id, vars.reason, vars.idempotencyKey),
  );
}

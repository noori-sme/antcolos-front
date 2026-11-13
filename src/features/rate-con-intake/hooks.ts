"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services, type ServiceContext } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type { RateConDocument, ReviewDecision } from "@/types/rate-con-intake";

/**
 * Rate Con intake keys (plan 13), namespaced by organization. Every write
 * invalidates `rateConKeys.document(org, id)`: status, review, draft and file.
 */
export const rateConKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "rate-con"] as const,
  document: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId] as const,
  detail: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "detail"] as const,
  review: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "review"] as const,
  draft: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "load-draft"] as const,
  file: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "file"] as const,
};

/** Poll every 2.5 s while the extraction is queued or running (requirements §2). */
export const POLL_MS = 2_500;

export function isReading(document: RateConDocument | undefined): boolean {
  const status = document?.latestRun?.status;
  return status === "pending" || status === "running";
}

export function useRateConDocument(documentId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.detail(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.get(ctx!, documentId),
    enabled: Boolean(ctx),
    refetchInterval: (query) => (isReading(query.state.data) ? POLL_MS : false),
  });
}

export function useDocumentReview(documentId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.review(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.review(ctx!, documentId),
    enabled: Boolean(ctx) && enabled,
  });
}

export function useLoadDraft(documentId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.draft(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.loadDraft(ctx!, documentId),
    enabled: Boolean(ctx) && enabled,
  });
}

/**
 * The signed URL expires (15 min by default): refetch a minute before it does,
 * and never cache it past its life.
 */
export function useDocumentFileUrl(documentId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.file(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.fileUrl(ctx!, documentId),
    enabled: Boolean(ctx),
    staleTime: 10 * 60_000,
    refetchInterval: (query) => {
      const expiresAt = query.state.data ? Date.parse(query.state.data.expiresAt) : NaN;
      return Number.isFinite(expiresAt) ? Math.max(expiresAt - Date.now() - 60_000, 30_000) : false;
    },
    retry: false,
  });
}

function useRateConMutation<TVars, TResult>(
  documentId: string | null,
  run: (ctx: ServiceContext, vars: TVars) => Promise<TResult>,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    // A conflict (someone else decided a field) also leaves the cache stale.
    onSettled: async () => {
      if (!ctx || !documentId) return;
      await queryClient.invalidateQueries({
        queryKey: rateConKeys.document(ctx.organizationId, documentId),
      });
    },
  });
}

export function useUploadRateCon() {
  return useRateConMutation(null, (ctx, vars: { file: File; idempotencyKey: string }) =>
    services.rateConIntake.upload(ctx, vars.file, vars.idempotencyKey),
  );
}

export function useRetryExtraction(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.retryExtraction(ctx, documentId, vars.idempotencyKey),
  );
}

export function useDecideFields(documentId: string) {
  return useRateConMutation(
    documentId,
    (ctx, vars: { decisions: ReviewDecision[]; idempotencyKey: string }) =>
      services.rateConIntake.decide(ctx, documentId, vars.decisions, vars.idempotencyKey),
  );
}

export function useCompleteReview(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.completeReview(ctx, documentId, vars.idempotencyKey),
  );
}

export function useApproveRateCon(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.approve(ctx, documentId, vars.idempotencyKey),
  );
}

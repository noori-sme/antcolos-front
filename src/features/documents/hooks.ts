"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AddDocumentInput, DocumentFilters, DocumentView, LinkDocumentInput,
  ShareDocumentInput,
} from "@/lib/api/contracts/documents";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type { DocumentSubjectRef } from "@/types";

/**
 * Every key is namespaced by organization, like the rest of the app, so one
 * organization's documents can never be served from cache to a screen rendered
 * under another. The cache is cleared outright on an organization switch too.
 */
export const documentKeys = {
  list: (organizationId: string, filters: DocumentFilters) =>
    [...orgKey(organizationId), "documents", "list", filters] as const,
  detail: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "documents", "detail", documentId] as const,
  workspaceChecklist: (organizationId: string) =>
    [...orgKey(organizationId), "documents", "workspace-checklist"] as const,
  entityChecklist: (organizationId: string, subjectId: string) =>
    [...orgKey(organizationId), "documents", "entity-checklist", subjectId] as const,
  shares: (organizationId: string) =>
    [...orgKey(organizationId), "documents", "shares"] as const,
  upgradePlan: (organizationId: string) =>
    [...orgKey(organizationId), "documents", "upgrade-plan"] as const,
};

export function useDocumentList(filters: DocumentFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? documentKeys.list(ctx.organizationId, filters) : ["documents", "no-context"],
    queryFn: () => services.documents.list(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useDocument(documentId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? documentKeys.detail(ctx.organizationId, documentId)
      : ["documents", "no-context", documentId],
    queryFn: () => services.documents.get(ctx!, documentId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useWorkspaceChecklist() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? documentKeys.workspaceChecklist(ctx.organizationId) : ["documents", "no-context"],
    queryFn: () => services.documents.workspaceChecklist(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useEntityChecklist(
  subject: DocumentSubjectRef | null,
  hint?: { equipment?: string; engagement?: string },
) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && subject
      ? documentKeys.entityChecklist(ctx.organizationId, subject.id)
      : ["documents", "no-context", "entity"],
    queryFn: () => services.documents.entityChecklist(ctx!, subject!, hint),
    enabled: Boolean(ctx && subject),
  });
}

export function useDocumentShares() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? documentKeys.shares(ctx.organizationId) : ["documents", "no-context"],
    queryFn: () => services.documents.listShares(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useUpgradePlan(enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? documentKeys.upgradePlan(ctx.organizationId) : ["documents", "no-context"],
    queryFn: () => services.documents.upgradePlan(ctx!, "dispatch_organization"),
    enabled: Boolean(ctx) && enabled,
    retry: false,
  });
}

export type DocumentAction =
  | { kind: "add"; input: AddDocumentInput }
  | { kind: "replace"; documentId: string; file: { name: string; type: string; size: number }; expiresAt?: string }
  | { kind: "submit"; documentId: string }
  | { kind: "approve"; documentId: string }
  | { kind: "reject"; documentId: string; reason: string }
  | { kind: "expiry"; documentId: string; expiresAt: string }
  | { kind: "link"; input: LinkDocumentInput }
  | { kind: "share"; input: ShareDocumentInput }
  | { kind: "revoke"; shareId: string; reason: string };

export type DocumentMutation = UseMutationResult<unknown, Error, DocumentAction>;

/**
 * One mutation for every document action, so invalidation stays in one place.
 *
 * Everything organization-scoped is invalidated on success — the list, the
 * checklists, the Needs You queue and Home — because a document changing state
 * is precisely what those surfaces are reporting on.
 */
export function useDocumentAction(): DocumentMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, DocumentAction>({
    mutationFn: async (action) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "add": return services.documents.addDocument(ctx, action.input);
        case "replace": return services.documents.replaceDocument(ctx, action.documentId, {
          file: action.file, expiresAt: action.expiresAt,
        });
        case "submit": return services.documents.submitForReview(ctx, action.documentId);
        case "approve": return services.documents.approve(ctx, action.documentId);
        case "reject": return services.documents.reject(ctx, action.documentId, action.reason);
        case "expiry": return services.documents.setExpiry(ctx, action.documentId, action.expiresAt);
        case "link": return services.documents.link(ctx, action.input);
        case "share": return services.documents.share(ctx, action.input);
        case "revoke": return services.documents.revokeShare(ctx, action.shareId, action.reason);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: orgKey(ctx.organizationId) });
    },
  });
}

export type { DocumentView };

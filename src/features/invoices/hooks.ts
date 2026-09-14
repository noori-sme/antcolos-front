"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AddLineItemInput, CreateInvoiceInput, InvoiceFilters, InvoiceSort,
  OpenDisputeInput, RecordPaymentInput, SubmitInvoiceInput,
} from "@/lib/api/contracts/invoices";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type { Invoice } from "@/types";

export function useInvoiceList(filters: InvoiceFilters, sort: InvoiceSort) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.invoices(ctx.organizationId, ctx.membershipId, { filters, sort })
      : ["invoices", "no-context"],
    queryFn: () => services.invoices.list(ctx!, filters, sort, { limit: 100 }),
    enabled: Boolean(ctx),
  });
}

export function useInvoiceSummary() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.invoices(ctx.organizationId, ctx.membershipId, "summary")
      : ["invoices", "summary", "no-context"],
    queryFn: () => services.invoices.summary(ctx!),
    enabled: Boolean(ctx?.permissions.has("invoices:view")),
  });
}

export function useInvoice(invoiceId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.invoices(ctx.organizationId, ctx.membershipId, invoiceId)
      : ["invoice", "no-context"],
    queryFn: () => services.invoices.get(ctx!, invoiceId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useInvoiceReadiness(invoiceId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.invoices(ctx.organizationId, ctx.membershipId, [invoiceId, "readiness"])
      : ["invoice-readiness", "no-context"],
    queryFn: () => services.invoices.readiness(ctx!, invoiceId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

/** Delivered loads the Loads module says may be billed. */
export function useInvoiceableLoads(enabled = true) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.invoices(ctx.organizationId, ctx.membershipId, "invoiceable-loads")
      : ["invoiceable-loads", "no-context"],
    queryFn: () => services.invoices.invoiceableLoads(ctx!),
    enabled: enabled && Boolean(ctx?.permissions.has("invoices:create")),
  });
}

export type InvoiceAction =
  | { kind: "create"; input: CreateInvoiceInput }
  | { kind: "addLineItem"; input: AddLineItemInput }
  | { kind: "removeLineItem"; lineItemId: string }
  | { kind: "refreshDocuments" }
  | { kind: "issue" }
  | { kind: "recheck" }
  | { kind: "submit"; input: SubmitInvoiceInput }
  | { kind: "recordPayment"; input: RecordPaymentInput }
  | { kind: "openDispute"; input: OpenDisputeInput }
  | { kind: "resolveDispute"; resolution: string }
  | { kind: "void"; reason: string };

export type InvoiceMutation = UseMutationResult<
  Invoice,
  Error,
  { id?: string; action: InvoiceAction }
>;

/**
 * One mutation for every invoice action, so cache invalidation lives in one
 * place. Every one of these calls fails at the service if the membership does
 * not hold the permission — the buttons are a courtesy, not the boundary.
 */
export function useInvoiceAction(): InvoiceMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id?: string; action: InvoiceAction }) => {
      if (!ctx) throw new Error("No active organization");
      if (action.kind === "create") return services.invoices.create(ctx, action.input);
      if (!id) throw new Error("This action needs an invoice");

      switch (action.kind) {
        case "addLineItem": return services.invoices.addLineItem(ctx, id, action.input);
        case "removeLineItem": return services.invoices.removeLineItem(ctx, id, action.lineItemId);
        case "refreshDocuments": return services.invoices.refreshDocuments(ctx, id);
        case "issue": return services.invoices.issue(ctx, id);
        case "recheck": return services.invoices.recheck(ctx, id);
        case "submit": return services.invoices.submit(ctx, id, action.input);
        case "recordPayment": return services.invoices.recordPayment(ctx, id, action.input);
        case "openDispute": return services.invoices.openDispute(ctx, id, action.input);
        case "resolveDispute": return services.invoices.resolveDispute(ctx, id, action.resolution);
        case "void": return services.invoices.void(ctx, id, { reason: action.reason });
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      // Invoices, Needs You and Home all move when an invoice does.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

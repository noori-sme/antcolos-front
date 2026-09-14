"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useServiceContext } from "@/lib/api/use-service-context";
import { useActiveMembership } from "@/lib/session/hooks";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import {
  dispatchWorkspaceSummary, type WorkspaceContext,
} from "@/lib/api/mock/dispatch-workspace";
import type { Workspace } from "@/types";

/**
 * The workspace context: the service context, plus the organization and
 * membership the workspace shape is derived from.
 *
 * The two are passed through rather than looked up again inside the service, so
 * there is exactly one place — the session — that decides which organization
 * the caller is acting in.
 */
export function useWorkspaceContext(): WorkspaceContext | null {
  const base = useServiceContext();
  const { membership, organization } = useActiveMembership();

  return useMemo(() => {
    if (!base || !membership || !organization) return null;
    return { ...base, membership, organization };
  }, [base, membership, organization]);
}

/** What kind of place the active membership is working in. */
export function useWorkspace(): Workspace | null {
  const { membership, organization } = useActiveMembership();
  return useMemo(
    () => resolveWorkspace(organization, membership),
    [organization, membership],
  );
}

export function useDispatchWorkspaceSummary() {
  const ctx = useWorkspaceContext();
  return useQuery({
    // Keyed by organization AND membership: two people in one workspace get two
    // different dashboards, and neither may be served the other's cache.
    queryKey: ctx
      ? ["workspace", ctx.organizationId, ctx.membershipId, "dispatch"]
      : ["workspace", "no-context"],
    queryFn: () => dispatchWorkspaceSummary(ctx!),
    enabled: Boolean(ctx),
  });
}

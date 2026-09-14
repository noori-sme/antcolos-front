"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { useActiveMembership } from "@/lib/session/hooks";
import { DispatchWorkspaceScreen } from "@/features/workspace/dispatch-workspace-screen";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { HomeScreen } from "./home-screen";

/**
 * Home is not one dashboard — it is whichever dashboard belongs to the place
 * you are working in.
 *
 * A driver membership belongs in the driver portal, so /home hands off to
 * /driver/home. A dispatch workspace — one person or a whole organization —
 * gets the dispatch dashboard rendered right here, with no redirect, so the URL
 * stays put and switching organizations swaps the dashboard without a reload.
 * A carrier keeps the Home it has always had.
 */
export function HomeGate() {
  const { isDriverMembership } = useActiveMembership();
  const workspace = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (isDriverMembership) router.replace("/driver/home");
  }, [isDriverMembership, router]);

  if (isDriverMembership) return <LoadingSkeleton rows={4} />;
  if (workspace?.isDispatchWorkspace) return <DispatchWorkspaceScreen />;
  return <HomeScreen />;
}

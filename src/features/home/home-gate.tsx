"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { driverProfileSync } from "@/features/driver/mock-driver";
import { useActiveMembership } from "@/lib/session/hooks";
import { DispatchWorkspaceScreen } from "@/features/workspace/dispatch-workspace-screen";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { HomeScreen } from "./home-screen";

/**
 * Home is not one dashboard — it is whichever dashboard belongs to the place
 * you are working in.
 *
 * A driver membership belongs in the driver portal, so /home hands off to
 * /driver/home. So does a driver with no membership at all — somebody who
 * signed up for themselves and has not been invited anywhere; the portal is
 * their whole product, and there is no organization dashboard to send them to.
 * A dispatch workspace — one person or a whole organization — gets the dispatch
 * dashboard rendered right here, with no redirect, so the URL stays put and
 * switching organizations swaps the dashboard without a reload. A carrier keeps
 * the Home it has always had.
 *
 * Somebody with neither a membership nor a driver profile has not finished
 * setting up, so they go back to onboarding rather than to an empty dashboard.
 */
export function HomeGate() {
  const { isDriverMembership, membership } = useActiveMembership();
  const workspace = useWorkspace();
  const router = useRouter();

  const unattachedDriver = !membership && Boolean(driverProfileSync());
  const toDriverPortal = isDriverMembership || unattachedDriver;
  const unfinished = !membership && !unattachedDriver;

  useEffect(() => {
    if (toDriverPortal) router.replace("/driver/home");
    else if (unfinished) router.replace("/onboarding");
  }, [toDriverPortal, unfinished, router]);

  if (toDriverPortal || unfinished) return <LoadingSkeleton rows={4} />;
  if (workspace?.isDispatchWorkspace) return <DispatchWorkspaceScreen />;
  return <HomeScreen />;
}

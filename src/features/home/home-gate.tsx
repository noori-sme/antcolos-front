"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { useActiveMembership } from "@/lib/session/hooks";
import { HomeScreen } from "./home-screen";

/**
 * A driver membership belongs in the driver portal, so /home hands off to
 * /driver/home. Switching to a non-driver membership lands on the normal Home
 * without a reload.
 */
export function HomeGate() {
  const { isDriverMembership } = useActiveMembership();
  const router = useRouter();

  useEffect(() => {
    if (isDriverMembership) router.replace("/driver/home");
  }, [isDriverMembership, router]);

  if (isDriverMembership) return <LoadingSkeleton rows={4} />;
  return <HomeScreen />;
}

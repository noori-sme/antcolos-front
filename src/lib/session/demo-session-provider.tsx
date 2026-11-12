"use client";

import { useContext, useMemo, type ReactNode } from "react";
import { SessionContext } from "./provider";
import { buildDemoSession } from "./demo-session";

/**
 * Renders its children as the Northline demo company (plan 10). Every hook
 * below it (`useActiveMembership`, `usePermissions`, `useServiceContext`, `<Can>`)
 * reads the demo session; the shell around it keeps the real one.
 */
export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const real = useContext(SessionContext);
  const demo = useMemo(() => (real ? buildDemoSession(real) : null), [real]);
  if (!demo) return <>{children}</>;
  return <SessionContext.Provider value={demo}>{children}</SessionContext.Provider>;
}

import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RouteGuard } from "./route-guard";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <RouteGuard>{children}</RouteGuard>
    </AppShell>
  );
}

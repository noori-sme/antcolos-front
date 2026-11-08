"use client";

import { Construction } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Shown in http mode for a route whose backend isn't built yet (plan 08), so
 * a bookmark or a deep link never lands on an adapter error.
 */
export function NotAvailable() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-surface-sunken text-fg-subtle">
        <Construction aria-hidden className="size-6" />
      </div>
      <h1 className="text-[1.25rem] font-semibold text-fg">This area isn&apos;t available yet</h1>
      <p className="mt-2 max-w-md text-[0.875rem] text-fg-muted">
        It is still being connected to your live data. Everything in the sidebar works today.
      </p>
      <Button asChild variant="primary" className="mt-6">
        <Link href="/home">Back to home</Link>
      </Button>
    </div>
  );
}

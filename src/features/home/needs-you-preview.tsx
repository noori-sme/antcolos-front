"use client";

import { ArrowRight, CheckCircle2, Inbox } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DueLabel } from "@/features/needs-you/due-label";
import { SeverityBar } from "@/features/needs-you/severity";
import { CATEGORY_LABEL, type NeedsYouItem } from "@/types";

/**
 * Needs You leads Home. Urgent exceptions and decisions outrank analytics —
 * this block is always first, whatever else the membership can see.
 */
export function NeedsYouPreview({
  items, openCount, criticalCount,
}: {
  items: NeedsYouItem[];
  openCount: number;
  criticalCount: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            Needs You
            {criticalCount > 0 ? (
              <Badge tone="danger">{criticalCount} critical</Badge>
            ) : null}
          </CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {openCount === 0
              ? "Your queue is clear."
              : `${openCount} open, most urgent first.`}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/needs-you">
            Open queue
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {items.length === 0 ? (
          <div className="flex items-center gap-3 border-t border-border px-5 py-8">
            <CheckCircle2 aria-hidden className="size-5 shrink-0 text-st-success" />
            <p className="text-[0.875rem] text-fg-muted">
              Nothing needs a decision right now. Antcolos is watching loads,
              trucks, drivers and documents.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href="/needs-you"
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-hover"
                >
                  <SeverityBar severity={item.severity} className="min-h-9 self-stretch" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                      {CATEGORY_LABEL[item.category]}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.875rem] font-medium text-fg">
                      {item.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <DueLabel dueAt={item.dueAt} />
                      <span className="truncate text-[0.75rem] text-fg-subtle">
                        {item.entity.label}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {items.length > 0 ? (
        <div className="border-t border-border px-5 py-2.5">
          <Link
            href="/needs-you"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-primary hover:underline"
          >
            <Inbox aria-hidden className="size-3.5" />
            See all {openCount}
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

"use client";

import { ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/data/states";
import { DueLabel } from "@/features/needs-you/due-label";
import { SeverityBar } from "@/features/needs-you/severity";
import { useNeedsYouList } from "@/features/needs-you/hooks";
import { CATEGORY_LABEL } from "@/types";

/**
 * The invoice module's own slice of Needs You: missing documents, disputes and
 * overdue receivables. These are the SAME items the Needs You queue serves —
 * filtered to invoices, not a second list kept somewhere else — so acting on
 * one here and acting on it there are the same act.
 */
export function InvoiceNeedsYouPanel() {
  const query = useNeedsYouList({
    entityKind: ["invoice"],
    status: ["open", "escalated"],
  });

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Needs you</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingSkeleton rows={2} />
        </CardContent>
      </Card>
    );
  }

  // Nothing to act on is worth saying once, quietly, rather than with an empty
  // card that looks like something failed.
  if (query.isError || (query.data?.length ?? 0) === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Needs you</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2.5 pt-0 text-[0.8125rem] text-fg-muted">
          <Inbox aria-hidden className="size-4 shrink-0 text-fg-subtle" />
          {query.isError
            ? "Could not read the queue."
            : "No invoice is missing documents, disputed or past due."}
        </CardContent>
      </Card>
    );
  }

  const items = query.data;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Needs you</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Missing documents, disputes and money that is late.
          </p>
        </div>
        <Badge tone="outline">{items.length}</Badge>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="divide-y divide-border border-t border-border">
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="flex gap-3 px-5 py-3">
              <SeverityBar severity={item.severity} className="self-stretch" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{CATEGORY_LABEL[item.category]}</Badge>
                  <DueLabel dueAt={item.dueAt} />
                </div>
                <p className="mt-1 text-[0.875rem] font-medium text-fg">{item.title}</p>
                <p className="mt-0.5 text-[0.8125rem] leading-5 text-fg-muted">{item.reason}</p>
                {item.entity.href ? (
                  <Button asChild variant="link" size="sm" className="mt-1 -ml-2.5">
                    <Link href={item.entity.href}>
                      Open {item.entity.label.split(" · ")[0]}
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {items.length > 5 ? (
          <div className="border-t border-border px-5 py-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href="/needs-you">
                {items.length - 5} more in Needs You
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

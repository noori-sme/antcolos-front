"use client";

import { FileText, IdCard, Mail } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DriverProfile } from "@/types";

/**
 * Driver home for a driver who has no carrier.
 *
 * This is the same route and the same portal as every other driver's home — it
 * simply has nothing of anybody else's to show, and says so rather than
 * inventing a carrier, an assignment or an employer to fill the space. What it
 * does show is entirely the driver's own: their profile, and the documents they
 * can get ahead on before anyone asks.
 */
export function UnattachedDriverHome({
  firstName,
  profile,
}: {
  firstName: string;
  profile: DriverProfile;
}) {
  return (
    <div className="space-y-stack">
      <header>
        <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
          Hi {firstName}
        </h1>
        <p className="mt-0.5 text-[0.875rem] text-fg-muted">
          Your Antcolos driver profile is ready.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Not connected to a carrier yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[0.875rem] leading-relaxed text-fg-muted">
            You drive for nobody on Antcolos until a carrier invites you and you accept. When that
            happens, their loads, their paperwork and their dispatch appear here — and this profile
            is the one they connect to, so you are never asked for your licence twice.
          </p>

          <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
            <Mail className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            <p className="text-[0.75rem] leading-relaxed text-fg-muted">
              Carriers invite drivers by email. Give the carrier you drive for{" "}
              <span className="font-medium text-fg break-all">{profile.email}</span> — the address
              you just confirmed — and their invitation will find you here.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <Link href="/driver/documents">
                <FileText aria-hidden />
                My documents
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/driver/profile">
                <IdCard aria-hidden />
                My driver profile
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

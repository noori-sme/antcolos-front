import Link from "next/link";
import { AuditEventsScreen } from "@/features/audit/events-screen";

export const metadata = { title: "Audit log" };

/**
 * The access slice of the ONE ledger.
 *
 * This page has always been about who was given what. It is now a filtered view
 * of the organization-wide audit log rather than a second log of its own —
 * which is the whole point: there is one record, read through different lenses.
 */
export default function Page() {
  return (
    <AuditEventsScreen
      title="Audit log"
      description="Every access and permission change in this organization, with what moved on each one."
      fixedFilters={{ module: ["access", "organization", "banking"] }}
      lede={
        <p className="rounded-md border border-dashed border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          This is the access slice of the organization&rsquo;s single audit log, not a separate
          record. Everything else Antcolos recorded — loads, documents, fuel, compliance,
          settlements, invoices — is in the same log, under{" "}
          <Link href="/audit" className="text-primary hover:underline">
            Audit &amp; Risk
          </Link>
          .
        </p>
      }
    />
  );
}

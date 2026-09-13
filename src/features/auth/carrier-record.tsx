import type { FmcsaCarrier } from "./mock-backend";

/**
 * The register entry read back to the owner, so they can see we matched the
 * right company before a code is sent anywhere.
 */
export function CarrierRecord({ carrier }: { carrier: FmcsaCarrier }) {
  const rows: Array<[string, string]> = [
    ["Legal name", carrier.legalName],
    ...(carrier.dbaName ? ([["Doing business as", carrier.dbaName]] as Array<[string, string]>) : []),
    ["MC number", carrier.mc],
    ["DOT number", carrier.dot],
    ["Location", carrier.location],
    ["Operating status", carrier.operatingStatus],
  ];

  return (
    <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-sunken">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
          <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
          <dd className="text-[0.8125rem] font-medium text-fg tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

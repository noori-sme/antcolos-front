"use client";

import { Building2, CalendarRange, Check, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckIndicator, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  customRange, DEFAULT_PRESET_ID, RANGE_PRESETS, rangeFromPreset, rangeLabel,
} from "@/lib/reports/range";
import { cn } from "@/lib/utils";
import type { ReportFilters } from "@/types";

/**
 * Date range and organization filters.
 *
 * The same bar sits above every report and every view of it. A carrier
 * workspace has exactly one organization to report on and the control says so
 * rather than offering a choice that does not exist; a dispatch workspace can
 * only pick carriers that have shared their records, because the service will
 * not return anything else regardless of what is selected here.
 */
export function ReportFilterBar({
  filters,
  onChange,
  carriers,
  carrierFilterEnabled,
  organizationName,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  carriers: { id: string; name: string }[];
  carrierFilterEnabled: boolean;
  organizationName: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(filters.range.from.slice(0, 10));
  const [to, setTo] = useState(filters.range.to.slice(0, 10));
  const fromId = useId();
  const toId = useId();

  const selectedCarriers = filters.carrierOrganizationIds ?? [];
  const presetId = filters.range.presetId;

  const setPreset = (id: string) => {
    setCustomOpen(false);
    onChange({ ...filters, range: rangeFromPreset(id) });
  };

  const toggleCarrier = (id: string) => {
    const next = selectedCarriers.includes(id)
      ? selectedCarriers.filter((c) => c !== id)
      : [...selectedCarriers, id];
    onChange({ ...filters, carrierOrganizationIds: next.length ? next : undefined });
  };

  const dirty =
    presetId !== DEFAULT_PRESET_ID || selectedCarriers.length > 0 || !presetId;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Date range"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5"
        >
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={presetId === preset.id}
              onClick={() => setPreset(preset.id)}
              className={cn(
                "h-control-sm shrink-0 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
                presetId === preset.id
                  ? "bg-surface-hover text-fg ring-1 ring-border"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={!presetId}
            onClick={() => setCustomOpen((v) => !v)}
            className={cn(
              "h-control-sm inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
              !presetId
                ? "bg-surface-hover text-fg ring-1 ring-border"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            <CalendarRange aria-hidden className="size-3.5" />
            Custom
          </button>
        </div>

        {carrierFilterEnabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Building2 aria-hidden />
                {selectedCarriers.length === 0
                  ? "All shared carriers"
                  : `${selectedCarriers.length} carrier${selectedCarriers.length === 1 ? "" : "s"}`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Carriers sharing records</DropdownMenuLabel>
              {carriers.length === 0 ? (
                <DropdownMenuItem disabled>No carriers have shared records</DropdownMenuItem>
              ) : (
                carriers.map((carrier) => (
                  <DropdownMenuItem
                    key={carrier.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggleCarrier(carrier.id);
                    }}
                  >
                    {carrier.name}
                    <DropdownMenuCheckIndicator checked={selectedCarriers.includes(carrier.id)} />
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="inline-flex h-control-sm items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[0.8125rem] text-fg-muted">
            <Building2 aria-hidden className="size-3.5" />
            {organizationName}
          </span>
        )}

        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                range: rangeFromPreset(DEFAULT_PRESET_ID),
                carrierOrganizationIds: undefined,
              })
            }
          >
            <RotateCcw aria-hidden />
            Reset
          </Button>
        ) : null}

        <span className="ml-auto text-[0.75rem] text-fg-subtle">
          {rangeLabel(filters.range)}
        </span>
      </div>

      {customOpen ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-sunken/60 p-3">
          <div className="space-y-1">
            <label htmlFor={fromId} className="block text-[0.75rem] font-medium text-fg-muted">
              From
            </label>
            <Input
              id={fromId}
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-control-sm w-[10rem]"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={toId} className="block text-[0.75rem] font-medium text-fg-muted">
              To
            </label>
            <Input
              id={toId}
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="h-control-sm w-[10rem]"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!from || !to || from > to}
            onClick={() => onChange({ ...filters, range: customRange(from, to) })}
          >
            <Check aria-hidden />
            Apply
          </Button>
          <p className="w-full text-[0.75rem] text-fg-subtle">
            Both dates are included. A load belongs to the period its delivery falls in.
          </p>
        </div>
      ) : null}
    </div>
  );
}

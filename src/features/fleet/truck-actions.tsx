"use client";

import { ChevronDown, MoreHorizontal, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import { usePermissions } from "@/lib/session/hooks";
import { can } from "@/lib/permissions";
import { isOwnedByThisOrganization, truckActionsFor } from "@/lib/fleet/truck-actions-policy";
import type { FleetTruck, TruckOperationalStatus } from "@/types/fleet-truck";
import { useArchiveTruck, useEndOperating, useSetTruckStatus } from "./hooks";
import { TruckConfirmDialog } from "./truck-dialog-parts";
import { TruckEditDialog } from "./truck-edit-dialog";
import { TruckOwnershipDialog } from "./truck-ownership-dialog";

const STATUS_LABEL: Record<TruckOperationalStatus, string> = {
  AVAILABLE: "Mark available",
  UNAVAILABLE: "Mark unavailable",
  MAINTENANCE: "Put in maintenance",
};

type Open = "edit" | "ownership" | "leave" | "archive" | null;

/**
 * Header actions for one truck (contract §4–§6, §11, §12). Each needs
 * `trucks:edit` (archive: `trucks:delete`); identity edits, hand-off and
 * archive also need this organization to be the legal owner. The server
 * re-checks everything.
 */
export function TruckActions({ truck }: { truck: FleetTruck }) {
  const router = useRouter();
  const permissions = usePermissions();
  const [open, setOpen] = useState<Open>(null);
  const { keyFor } = useIdempotencyKey();
  const setStatus = useSetTruckStatus(truck.id);
  const leave = useEndOperating(truck.id);
  const archive = useArchiveTruck(truck.id);

  const operatingId = truck.operating?.operatingId;
  const status = truck.operating?.operationalStatus ?? truck.operationalStatus;
  const isLegalOwner = isOwnedByThisOrganization(truck);
  const actions = truckActionsFor(truck, {
    edit: can(permissions, "trucks:edit"),
    delete: can(permissions, "trucks:delete"),
  });
  if (!Object.values(actions).some((v) => v === true)) return null;

  const changeStatus = (next: TruckOperationalStatus) =>
    setStatus.mutate(
      { status: next, idempotencyKey: keyFor({ status: next }) },
      { onError: (error) => toast.error(error.message) },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.status && (
        <Can permission="trucks:edit">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" disabled={setStatus.isPending}>
                Status
                <ChevronDown className="ml-1.5 size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(STATUS_LABEL) as TruckOperationalStatus[])
                .filter((s) => s !== status)
                .map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => changeStatus(s)}>
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Can>
      )}
      {actions.edit && (
        <Can permission="trucks:edit">
          <Button variant="secondary" onClick={() => setOpen("edit")}>
            <Pencil className="mr-1.5 size-4" aria-hidden />
            Edit
          </Button>
        </Can>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label="More truck actions">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.handOff && (
            <DropdownMenuItem onSelect={() => setOpen("ownership")}>
              Hand off ownership…
            </DropdownMenuItem>
          )}
          {actions.leave && (
            <DropdownMenuItem onSelect={() => setOpen("leave")}>
              Remove from our fleet…
            </DropdownMenuItem>
          )}
          {actions.archive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setOpen("archive")}
                disabled={Boolean(actions.archiveBlockedReason)}
              >
                {actions.archiveBlockedReason
                  ? `Archive (${actions.archiveBlockedReason.toLowerCase()})`
                  : "Archive truck…"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {open === "edit" && (
        <TruckEditDialog
          truck={truck}
          isLegalOwner={isLegalOwner}
          open
          onOpenChange={(o) => !o && setOpen(null)}
        />
      )}
      {open === "ownership" && (
        <TruckOwnershipDialog truck={truck} open onOpenChange={(o) => !o && setOpen(null)} />
      )}
      <TruckConfirmDialog
        open={open === "leave"}
        onOpenChange={(o) => { if (!o) { leave.reset(); setOpen(null); } }}
        title="Remove this truck from your fleet?"
        description="Your unit number and its driver and dispatcher assignments end now. The truck itself, its owner and its history stay. You can add it again by VIN."
        confirmLabel="Remove from fleet"
        pending={leave.isPending}
        error={leave.error}
        onConfirm={() =>
          operatingId &&
          leave.mutate(
            { operatingId, idempotencyKey: keyFor({ leave: operatingId }) },
            { onSuccess: () => router.push("/fleet/trucks") },
          )
        }
      />
      <TruckConfirmDialog
        open={open === "archive"}
        onOpenChange={(o) => { if (!o) { archive.reset(); setOpen(null); } }}
        title="Archive this truck?"
        description="Archiving retires the truck for everyone: it ends its ownership, every carrier's fleet listing and all assignments. History is kept. This cannot be undone."
        confirmLabel="Archive truck"
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() =>
          archive.mutate(undefined, { onSuccess: () => router.push("/fleet/trucks") })
        }
      />
    </div>
  );
}

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
import { useServiceContext } from "@/lib/api/use-service-context";
import { usePermissions } from "@/lib/session/hooks";
import { can } from "@/lib/permissions";
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
  const ctx = useServiceContext();
  const permissions = usePermissions();
  const [open, setOpen] = useState<Open>(null);
  const statusKey = useIdempotencyKey();
  const leaveKey = useIdempotencyKey();
  const setStatus = useSetTruckStatus(truck.id);
  const leave = useEndOperating(truck.id);
  const archive = useArchiveTruck(truck.id);

  if (truck.archivedAt) return null;
  const operatingId = truck.operating?.operatingId;
  const status = truck.operating?.operationalStatus ?? truck.operationalStatus;
  const isLegalOwner =
    truck.legalOwner?.ownerType === "ORGANIZATION" &&
    Boolean(ctx) &&
    truck.legalOwner.ownerOrganizationId === ctx?.organizationId;
  const canEdit = can(permissions, "trucks:edit");
  const canArchive = isLegalOwner && can(permissions, "trucks:delete");
  if (!canEdit && !canArchive) return null;

  const changeStatus = (next: TruckOperationalStatus) =>
    setStatus.mutate(
      { status: next, idempotencyKey: statusKey.key },
      {
        onSuccess: () => statusKey.renew(),
        onError: (error) => toast.error(error.message),
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {operatingId && (
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
      {operatingId && (
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
          {isLegalOwner && canEdit && (
            <DropdownMenuItem onSelect={() => setOpen("ownership")}>
              Hand off ownership…
            </DropdownMenuItem>
          )}
          {operatingId && canEdit && (
            <DropdownMenuItem onSelect={() => { leaveKey.renew(); setOpen("leave"); }}>
              Remove from our fleet…
            </DropdownMenuItem>
          )}
          {canArchive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setOpen("archive")}
                disabled={status === "AVAILABLE"}
              >
                {status === "AVAILABLE" ? "Archive (mark unavailable first)" : "Archive truck…"}
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
            { operatingId, idempotencyKey: leaveKey.key },
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

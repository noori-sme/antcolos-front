"use client";

import { MoreHorizontal, Plus, User, Users } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import type { FleetTruck, TruckAssignment, TruckAssignmentType } from "@/types/fleet-truck";
import { useRemoveAssignment } from "./hooks";
import { TruckAssignDialog } from "./truck-assign-dialog";
import { TruckConfirmDialog } from "./truck-dialog-parts";

function formatDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

type Dialog =
  | { kind: "assign"; type: TruckAssignmentType }
  | { kind: "replace"; type: TruckAssignmentType; assignment: TruckAssignment }
  | { kind: "remove"; type: TruckAssignmentType; assignment: TruckAssignment }
  | null;

/**
 * Current driver and dispatchers, with assign / replace / remove (contract
 * §8–§10). Actions need `trucks:edit` and this organization's operating row on
 * a truck that is not archived.
 */
export function TruckAssignmentsPanel({ truck }: { truck: FleetTruck }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const { key, renew } = useIdempotencyKey();
  const remove = useRemoveAssignment(truck.id);
  const driver = truck.currentDriver ?? null;
  const dispatchers = truck.currentDispatchers ?? [];
  const canAct = Boolean(truck.operating?.operatingId) && !truck.archivedAt;

  const closeRemove = () => {
    remove.reset();
    setDialog(null);
  };

  const rowActions = (type: TruckAssignmentType, assignment: TruckAssignment) =>
    canAct ? (
      <Can permission="trucks:edit">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Actions for ${assignment.name}`}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog({ kind: "replace", type, assignment })}>
              Replace
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                renew(); // a new remove is a new intent: never reuse another one's key
                setDialog({ kind: "remove", type, assignment });
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Can>
    ) : null;

  const card = (type: TruckAssignmentType, a: TruckAssignment) => (
    <div className="rounded-md border border-border bg-surface-elevated p-3 text-[0.8125rem]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-fg">{a.name}</span>
        <span className="flex items-center gap-1">
          {a.coverage && (
            <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
              {a.coverage}
            </span>
          )}
          {rowActions(type, a)}
        </span>
      </div>
      {a.startAt && (
        <p className="mt-1 text-xs text-fg-muted">Assigned since {formatDate(a.startAt)}</p>
      )}
    </div>
  );

  const addButton = (type: TruckAssignmentType, label: string) =>
    canAct ? (
      <Can permission="trucks:edit">
        <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: "assign", type })}>
          <Plus className="mr-1 size-3.5" aria-hidden />
          {label}
        </Button>
      </Can>
    ) : null;

  const empty = (Icon: typeof User, text: string) => (
    <div className="rounded-md border border-dashed border-border py-4 text-center text-[0.8125rem]">
      <Icon className="mx-auto mb-1.5 size-5 text-fg-subtle opacity-40" aria-hidden />
      <p className="text-xs text-fg-subtle">{text}</p>
    </div>
  );

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <User className="size-4 text-primary" aria-hidden />
        <h2 className="text-[0.9375rem] font-semibold text-fg">Driver & Dispatcher Assignments</h2>
      </div>

      <div className="space-y-4 pt-3">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[0.8125rem] font-medium text-fg-muted">Assigned Driver</h3>
            {!driver && addButton("DRIVER", "Assign driver")}
          </div>
          {driver ? card("DRIVER", driver) : empty(User, "No active driver assigned to this unit.")}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[0.8125rem] font-medium text-fg-muted">Assigned Dispatchers</h3>
            {addButton("DISPATCHER", "Add dispatcher")}
          </div>
          {dispatchers.length > 0 ? (
            <ul className="space-y-2">
              {dispatchers.map((d) => (
                <li key={d.assignmentId}>{card("DISPATCHER", d)}</li>
              ))}
            </ul>
          ) : (
            empty(Users, "No dispatchers assigned to this unit.")
          )}
        </div>
      </div>

      {(dialog?.kind === "assign" || dialog?.kind === "replace") && (
        <TruckAssignDialog
          truckId={truck.id}
          type={dialog.type}
          replacing={dialog.kind === "replace" ? dialog.assignment : undefined}
          currentUserIds={
            dialog.type === "DRIVER"
              ? driver ? [driver.userId] : []
              : dialog.kind === "replace"
                ? [dialog.assignment.userId]
                : []
          }
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
      <TruckConfirmDialog
        open={dialog?.kind === "remove"}
        onOpenChange={(open) => !open && closeRemove()}
        title={dialog?.kind === "remove" ? `Remove ${dialog.assignment.name}?` : ""}
        description="The assignment ends now and stays in the truck's history. You can assign someone again later."
        confirmLabel="Remove"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (dialog?.kind !== "remove") return;
          remove.mutate(
            { assignmentId: dialog.assignment.assignmentId, idempotencyKey: key },
            { onSuccess: () => { renew(); closeRemove(); } },
          );
        }}
      />
    </section>
  );
}

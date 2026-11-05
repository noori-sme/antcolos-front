"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import type {
  TruckAssignment, TruckAssignmentType, TruckDispatcherCoverage,
} from "@/types/fleet-truck";
import { useAssignTruck, useReplaceAssignment } from "./hooks";
import { PeoplePicker } from "./people-picker";
import { DialogActions, DialogError, SELECT_CLASS } from "./truck-dialog-parts";

/**
 * Assign a driver or dispatcher (contract §8), or replace a current
 * assignment (§9). Drivers come from the driver list; dispatchers from the
 * dispatcher and admin lists (the contract accepts ADMIN as a dispatcher).
 */
export function TruckAssignDialog({
  truckId,
  type,
  replacing,
  currentUserIds,
  open,
  onOpenChange,
}: {
  truckId: string;
  type: TruckAssignmentType;
  /** The current assignment being replaced; omit to assign. */
  replacing?: TruckAssignment;
  /** Users already current in this role on this truck (not offered again). */
  currentUserIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const labelId = useId();
  const coverageId = useId();
  const [userId, setUserId] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<TruckDispatcherCoverage>(
    replacing?.coverage ?? "PRIMARY",
  );
  const { key, renew } = useIdempotencyKey();
  const assign = useAssignTruck(truckId);
  const replace = useReplaceAssignment(truckId);
  const mutation = replacing ? replace : assign;
  const isDispatcher = type === "DISPATCHER";
  const role = isDispatcher ? "dispatcher" : "driver";

  const close = () => {
    setUserId(null);
    assign.reset();
    replace.reset();
    onOpenChange(false);
  };

  const submit = () => {
    if (!userId) return;
    const done = { onSuccess: () => { renew(); close(); } };
    if (replacing) {
      replace.mutate(
        {
          assignmentId: replacing.assignmentId,
          input: isDispatcher ? { userId, coverage } : { userId },
          idempotencyKey: key,
        },
        done,
      );
    } else {
      assign.mutate(
        {
          input: isDispatcher ? { userId, type, coverage } : { userId, type },
          idempotencyKey: key,
        },
        done,
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={replacing ? `Replace ${replacing.name}` : `Assign a ${role}`}
        description={
          replacing
            ? `The current ${role} is ended and the new one starts now. History keeps both.`
            : isDispatcher
              ? "A truck can have more than one dispatcher."
              : "A truck has one current driver, and a driver drives one truck at a time."
        }
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <p id={labelId} className="text-[0.8125rem] font-medium text-fg">
              {isDispatcher ? "Dispatcher" : "Driver"}
            </p>
            <PeoplePicker
              labelId={labelId}
              families={isDispatcher ? ["dispatchers", "admins"] : ["drivers"]}
              value={userId}
              onChange={(person) => setUserId(person.userId)}
              excludeUserIds={currentUserIds}
            />
          </div>
          {isDispatcher && (
            <div className="space-y-1.5">
              <label htmlFor={coverageId} className="text-[0.8125rem] font-medium text-fg">
                Coverage
              </label>
              <select
                id={coverageId}
                value={coverage}
                onChange={(e) => setCoverage(e.target.value as TruckDispatcherCoverage)}
                className={SELECT_CLASS}
              >
                <option value="PRIMARY">Primary</option>
                <option value="TEMPORARY">Temporary (covering)</option>
              </select>
            </div>
          )}
        </div>
        <DialogError error={mutation.error} />
        <DialogActions
          onCancel={close}
          submitLabel={replacing ? "Replace" : "Assign"}
          pending={mutation.isPending}
          disabled={!userId}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

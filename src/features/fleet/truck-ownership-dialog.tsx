"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import type { FleetTruck, TruckOwnershipType } from "@/types/fleet-truck";
import { useReplaceOwnership } from "./hooks";
import { PeoplePicker } from "./people-picker";
import { DialogActions, DialogError, SELECT_CLASS } from "./truck-dialog-parts";

const OWNERSHIP_OPTIONS: { value: TruckOwnershipType; label: string }[] = [
  { value: "OWNER_OPERATOR", label: "Owner-operator" },
  { value: "LEASED", label: "Leased" },
  { value: "COMPANY", label: "Company" },
];

/**
 * Hand legal ownership to a member of this organization (contract §12).
 * Handing off to another carrier needs its organization id and there is no
 * organization search yet (plan 02, backend ask), so only members are offered.
 */
export function TruckOwnershipDialog({
  truck,
  open,
  onOpenChange,
}: {
  truck: FleetTruck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const labelId = useId();
  const typeId = useId();
  const [userId, setUserId] = useState<string | null>(null);
  const [ownershipType, setOwnershipType] = useState<TruckOwnershipType>("OWNER_OPERATOR");
  const { keyFor } = useIdempotencyKey();
  const handoff = useReplaceOwnership(truck.id);
  const ownershipId = truck.legalOwner?.ownershipId;

  const close = () => {
    setUserId(null);
    handoff.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title="Hand off ownership"
        description="The new owner becomes the truck's legal owner (unverified) and your organization stops being it. Your fleet list and assignments do not change."
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <p id={labelId} className="text-[0.8125rem] font-medium text-fg">New owner</p>
            <PeoplePicker
              labelId={labelId}
              families={["drivers", "dispatchers", "admins"]}
              value={userId}
              onChange={(person) => setUserId(person.userId)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={typeId} className="text-[0.8125rem] font-medium text-fg">
              Ownership type
            </label>
            <select
              id={typeId}
              value={ownershipType}
              onChange={(e) => setOwnershipType(e.target.value as TruckOwnershipType)}
              className={SELECT_CLASS}
            >
              {OWNERSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogError error={handoff.error} />
        <DialogActions
          onCancel={close}
          submitLabel="Hand off"
          pending={handoff.isPending}
          disabled={!userId || !ownershipId}
          onSubmit={() => {
            if (!userId || !ownershipId) return;
            const input = { ownerType: "USER" as const, ownerUserId: userId, ownershipType };
            handoff.mutate(
              { ownershipId, input, idempotencyKey: keyFor({ ownershipId, input }) },
              { onSuccess: close },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

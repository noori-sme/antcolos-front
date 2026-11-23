"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import type { FleetTruck, TruckOwnershipType } from "@/types/fleet-truck";
import { useReplaceOwnership } from "./hooks";
import { PeoplePicker } from "./people-picker";
import { CarrierPicker } from "./carrier-picker";
import { Chip } from "@/components/ui/chip";
import { DialogActions, DialogError, SELECT_CLASS } from "./truck-dialog-parts";

const OWNERSHIP_OPTIONS: { value: TruckOwnershipType; label: string }[] = [
  { value: "OWNER_OPERATOR", label: "Owner-operator" },
  { value: "LEASED", label: "Leased" },
  { value: "COMPANY", label: "Company" },
];

/**
 * Hand legal ownership to a member of this organization, or to another carrier
 * found through the carrier directory search (contract §12; plan 25).
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
  const [to, setTo] = useState<"member" | "carrier">("member");
  const [userId, setUserId] = useState<string | null>(null);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [ownershipType, setOwnershipType] = useState<TruckOwnershipType>("OWNER_OPERATOR");
  const { keyFor } = useIdempotencyKey();
  const handoff = useReplaceOwnership(truck.id);
  const ownershipId = truck.legalOwner?.ownershipId;

  const close = () => {
    setUserId(null);
    setCarrierId(null);
    setTo("member");
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
            <div className="flex gap-1.5" role="group" aria-label="Who gets the truck">
              <Chip label="A member" selected={to === "member"} onToggle={() => setTo("member")} />
              <Chip label="Another carrier" selected={to === "carrier"} onToggle={() => setTo("carrier")} />
            </div>
            {to === "member" ? (
              <PeoplePicker
                labelId={labelId}
                families={["drivers", "dispatchers", "admins"]}
                value={userId}
                onChange={(person) => setUserId(person.userId)}
              />
            ) : (
              <CarrierPicker labelId={labelId} value={carrierId} onChange={(c) => setCarrierId(c.organizationId)} />
            )}
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
          disabled={!(to === "member" ? userId : carrierId) || !ownershipId}
          onSubmit={() => {
            if (!ownershipId) return;
            const input =
              to === "member"
                ? userId && { ownerType: "USER" as const, ownerUserId: userId, ownershipType }
                : carrierId && { ownerType: "ORGANIZATION" as const, ownerOrganizationId: carrierId, ownershipType };
            if (!input) return;
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

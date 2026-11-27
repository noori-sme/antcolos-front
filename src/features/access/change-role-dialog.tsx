"use client";

import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { assignableRoles } from "@/lib/permissions/invite-selection";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { OrgMember } from "@/types/org-members";
import { useChangeMemberRole, useOrgRoles } from "./hooks";

/**
 * Members → Change role (plan 29): pick a built-in or custom role the caller can grant in full;
 * the member gets exactly that role's permissions. The backend checks the same rule and keeps
 * the last admin.
 */
export function ChangeRoleDialog({ member }: { member: OrgMember }) {
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState(member.roleId);
  const roles = useOrgRoles();
  const change = useChangeMemberRole();
  const granter = usePermissions();
  const { membership } = useActiveMembership();
  const options = assignableRoles(roles.data ?? [], granter, membership?.isOwner ?? false);

  const save = () =>
    change.mutate(
      { membershipId: member.membershipId, roleId },
      { onSuccess: () => setOpen(false) },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRoleId(member.roleId);
          change.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!member.membershipId}>
          Change role
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Change ${member.name}'s role`}
        description="They get exactly the permissions of the role you pick. You can only pick roles whose permissions you have yourself."
      >
        {roles.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : roles.isError ? (
          <ErrorState title="Couldn't load roles" description={roles.error.message} onRetry={() => void roles.refetch()} />
        ) : (
          <fieldset className="space-y-1.5">
            <legend className="sr-only">Role</legend>
            {options.map((role) => (
              <label
                key={role.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-surface-sunken"
              >
                <input
                  type="radio"
                  name="role"
                  value={role.id}
                  checked={roleId === role.id}
                  onChange={() => setRoleId(role.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[0.875rem] font-medium text-fg">
                    {role.name}
                    {role.id === member.roleId ? (
                      <span className="ml-1.5 text-[0.75rem] font-normal text-fg-subtle">(current)</span>
                    ) : null}
                  </span>
                  {role.description ? (
                    <span className="block text-[0.8125rem] text-fg-muted">{role.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {change.isError ? (
          <p role="alert" className="text-[0.8125rem] text-st-danger">
            {change.error.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={save}
            disabled={change.isPending || roleId === member.roleId || !roles.data}
          >
            {change.isPending ? "Saving…" : "Save role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

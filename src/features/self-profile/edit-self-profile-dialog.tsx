"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  selfProfileFormSchema, toFormValues, toPatch, type SelfProfileFormValues,
} from "@/lib/profile/self-profile-form";
import type { SelfProfile } from "@/types/self-profile";
import { useUpdateSelfProfile } from "./hooks";

/** Name, phone, headline and "about me" (`PATCH /users/me`). Email can't be changed here. */
export function EditSelfProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: SelfProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const update = useUpdateSelfProfile();
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<SelfProfileFormValues>({
    resolver: zodResolver(selfProfileFormSchema),
    values: toFormValues(profile),
    // A background refetch must not wipe what the person is typing.
    resetOptions: { keepDirtyValues: true },
  });

  const close = () => {
    reset(toFormValues(profile));
    update.reset();
    onOpenChange(false);
  };

  const onSubmit = (values: SelfProfileFormValues) => {
    const patch = toPatch(profile, values);
    if (!patch) return close();
    update.mutate(patch, { onSuccess: close });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title="Edit your profile"
        description="This is your own record. It's the same in every organization you work with."
        className="max-w-lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor={`${id}-first`} error={errors.firstName?.message}>
              <Input id={`${id}-first`} autoComplete="given-name" {...register("firstName")} />
            </Field>
            <Field label="Last name" htmlFor={`${id}-last`} error={errors.lastName?.message}>
              <Input id={`${id}-last`} autoComplete="family-name" {...register("lastName")} />
            </Field>
          </div>
          <Field
            label="Phone"
            htmlFor={`${id}-phone`}
            error={errors.phone?.message}
            hint="A US number. Leave it empty to remove it."
          >
            <Input id={`${id}-phone`} type="tel" autoComplete="tel" {...register("phone")} />
          </Field>
          <Field
            label="Headline"
            htmlFor={`${id}-headline`}
            error={errors.headline?.message}
            hint="One line, up to 120 characters."
          >
            <Input
              id={`${id}-headline`}
              placeholder="Owner-operator based in Dallas"
              {...register("headline")}
            />
          </Field>
          <Field
            label="About me"
            htmlFor={`${id}-about`}
            error={errors.aboutMe?.message}
            hint="Up to 2,000 characters."
          >
            <Textarea id={`${id}-about`} rows={4} {...register("aboutMe")} />
          </Field>

          {update.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{update.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={update.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={update.isPending}
              aria-busy={update.isPending || undefined}
            >
              {update.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

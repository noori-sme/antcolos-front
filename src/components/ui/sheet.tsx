"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Side panel on desktop, bottom sheet on phones — the inline context drawer
 * pattern, so acting on an item never loses the queue behind it.
 */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title: string;
    description?: string;
  }
>(({ className, children, title, description, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col border-border bg-surface shadow-e3 outline-none",
        // phone: bottom sheet
        "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl border-t",
        // tablet and up: right-hand panel
        "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[32rem] sm:rounded-none sm:border-t-0 sm:border-l",
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="sr-only">
          {description}
        </DialogPrimitive.Description>
      ) : null}
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetCloseButton() {
  return (
    <SheetClose
      className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      aria-label="Close panel"
    >
      <X aria-hidden className="size-4" />
    </SheetClose>
  );
}

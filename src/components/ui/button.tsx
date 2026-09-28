"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-fg disabled:text-white hover:bg-primary-hover shadow-e1",

        secondary:
          "border border-border-strong bg-surface text-fg hover:bg-surface-hover shadow-e1",

        outline:
          "border border-border-strong bg-transparent text-fg hover:bg-surface-hover shadow-e1",

        ghost:
          "text-fg-muted hover:bg-surface-hover hover:text-fg",

        subtle:
          "bg-surface-sunken text-fg hover:bg-surface-hover",

        danger:
          "bg-st-danger text-white hover:opacity-90 shadow-e1",

        link:
          "text-primary underline-offset-4 hover:underline",
      },

      size: {
        sm: "h-control-sm px-2.5 text-[0.8125rem] [&_svg]:size-3.5",

        md: "h-control px-3.5 text-[0.875rem] [&_svg]:size-4",

        lg: "h-control-lg px-5 text-[0.9375rem] [&_svg]:size-[1.125rem]",

        iconSm: "h-control-sm w-control-sm [&_svg]:size-4",

        icon: "h-control w-control [&_svg]:size-[1.125rem]",
      },
    },

    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { buttonVariants };
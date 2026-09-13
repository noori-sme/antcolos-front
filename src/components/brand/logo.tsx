import Image from "next/image";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * TEMPORARY typographic wordmark + replaceable placeholder mark.
 * Every brand value comes from src/config/brand.ts and src/styles/globals.css,
 * so swapping in the final logo is a two-file change.
 */

const markSize = { sm: 20, md: 26, lg: 34 } as const;

export function LogoMark({
  size = "md",
  className,
}: {
  size?: keyof typeof markSize;
  className?: string;
}) {
  const px = markSize[size];
  return (
    <Image
      src={brand.markSrc}
      alt=""
      width={px}
      height={px}
      priority
      className={cn("shrink-0 text-primary", className)}
    />
  );
}

export function Wordmark({
  size = "md",
  className,
}: {
  size?: keyof typeof markSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "select-none font-sans leading-none text-fg",
        size === "sm" && "text-[0.9375rem] tracking-[-0.015em]",
        size === "md" && "text-[1.0625rem] tracking-[-0.018em]",
        size === "lg" && "text-[1.375rem] tracking-[-0.022em]",
        className,
      )}
    >
      <span className="font-semibold">{brand.wordmark.lead}</span>
      <span className="font-normal text-fg-muted">{brand.wordmark.trail}</span>
    </span>
  );
}

export function Logo({
  size = "md",
  showWordmark = true,
  className,
}: {
  size?: keyof typeof markSize;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showWordmark ? <Wordmark size={size} /> : null}
      <span className="sr-only">{brand.name}</span>
    </span>
  );
}

"use client";

import type { DocumentBlock, RateConDocument } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The rate confirmation, drawn on a page, with one box lit up.
 *
 * Everything is positioned in percentages, so the page scales from a desktop
 * column to a phone without the highlight drifting off the value it is pointing
 * at. That matters more than it sounds: the whole promise of this screen is
 * "this number, here, on their document" — a highlight that lands two lines
 * away breaks the only thing it is for.
 *
 * The page keeps a paper aspect ratio rather than filling its container, for
 * the same reason a real one would be shown that way: a dispatcher is checking
 * a document they will have to talk to a broker about, and it should look like
 * the thing in their inbox.
 */
export function DocumentView({
  document, highlightBlockId, onBlockClick, label,
}: {
  document: RateConDocument;
  /** The block to light up. Usually the field being reviewed. */
  highlightBlockId?: string;
  onBlockClick?: (blockId: string) => void;
  label: string;
}) {
  return (
    <figure className="m-0">
      <div
        className="relative w-full overflow-hidden rounded-md border border-border bg-white shadow-e1"
        style={{ aspectRatio: "8.5 / 11" }}
        role="img"
        aria-label={`${label}: ${document.fileName}`}
      >
        {document.blocks.map((block) => (
          <Block
            key={block.id}
            block={block}
            highlighted={block.id === highlightBlockId}
            onClick={onBlockClick ? () => onBlockClick(block.id) : undefined}
          />
        ))}
      </div>
      <figcaption className="mt-1.5 text-[0.6875rem] leading-relaxed text-fg-subtle">
        {document.fileName} · {document.mockNotice}
      </figcaption>
    </figure>
  );
}

function Block({
  block, highlighted, onClick,
}: {
  block: DocumentBlock;
  highlighted: boolean;
  onClick?: () => void;
}) {
  const { region } = block;
  const style = {
    left: `${region.xPct}%`,
    top: `${region.yPct}%`,
    width: `${region.wPct}%`,
    minHeight: `${region.hPct}%`,
  };

  if (block.style === "rule") {
    return (
      <span
        aria-hidden
        className="absolute border-t border-neutral-300"
        style={{ ...style, minHeight: 0 }}
      />
    );
  }

  const text = (
    <span
      className={cn(
        "block leading-tight",
        block.alignRight && "text-right",
        block.style === "title" && "text-[clamp(0.7rem,1.55cqw,1.05rem)] font-bold tracking-tight text-neutral-900",
        block.style === "heading" && "text-[clamp(0.55rem,1.15cqw,0.8rem)] font-semibold tracking-wide text-neutral-800",
        block.style === "label" && "text-[clamp(0.4rem,0.78cqw,0.56rem)] font-semibold uppercase tracking-[0.08em] text-neutral-500",
        block.style === "value" && "text-[clamp(0.48rem,0.98cqw,0.72rem)] font-medium text-neutral-900",
        block.style === "body" && "text-[clamp(0.44rem,0.88cqw,0.66rem)] text-neutral-700",
        block.style === "small" && "text-[clamp(0.4rem,0.76cqw,0.58rem)] text-neutral-500",
        block.style === "signature" && "text-[clamp(0.6rem,1.25cqw,0.9rem)] font-[cursive] italic text-neutral-900",
      )}
    >
      {block.text}
    </span>
  );

  const box = cn(
    "absolute rounded-[3px] px-[2px] transition-colors",
    highlighted && "bg-amber-200/80 ring-2 ring-amber-500",
    !highlighted && onClick && "hover:bg-sky-100/70",
  );

  if (!onClick) {
    return <span className={box} style={style}>{text}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={cn(box, "text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring")} style={style}>
      {text}
    </button>
  );
}

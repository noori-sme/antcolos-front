import Image from "next/image";
import type { LandingMedia } from "./content";

/**
 * The image or video a section was given, if it was given one.
 *
 * One component for both so a section never has to branch on media type, and
 * so swapping a still for a clip stays an edit in `content.ts`.
 */
export function SectionMedia({ media, className }: { media: LandingMedia; className?: string }) {
  if (media.type === "image") {
    return (
      <Image
        src={media.src}
        alt={media.alt}
        width={media.width}
        height={media.height}
        className={className}
      />
    );
  }

  return (
    // Muted, looping and inline: a landing video is decoration, and decoration
    // that starts talking or takes over the screen is a bug. `controls` is left
    // off for the same reason — nothing here is worth pausing.
    <video
      src={media.src}
      poster={media.poster}
      aria-label={media.label}
      autoPlay
      loop
      muted
      playsInline
      className={className}
    />
  );
}

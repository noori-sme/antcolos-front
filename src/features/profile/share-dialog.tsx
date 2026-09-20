"use client";

import { Check, Copy, Link2, LoaderCircle, Lock, Mail, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert } from "@/features/auth/form-alert";
import { EXTERNAL_SHARE_TARGETS, shareUrl } from "@/lib/profile/share";
import { SHARE_TARGET_LABEL, type ShareTarget, type UserProfile } from "@/types";
import { cn } from "@/lib/utils";
import { useShareCard } from "./hooks";
import { ShareCardArt } from "./share-card-art";

/** Lucide has no brand marks, so each network gets a plain, honest glyph. */
const TARGET_ICON: Record<ShareTarget, typeof Link2> = {
  link: Link2,
  linkedin: Share2,
  x: Share2,
  whatsapp: Send,
  telegram: Send,
  email: Mail,
};

/** How long the copy button stays in its confirmed state. */
const COPIED_MS = 2000;

/**
 * Sharing a profile, or one achievement from it.
 *
 * ★ THE PREVIEW IS THE STRANGER'S VIEW ★
 * The card shown here is fetched from the service, which builds it as somebody
 * with no session would see it. So a person who hid their figures sees a card
 * without figures, before they post it — rather than approving a card with
 * their revenue on it and discovering later that the public one was different.
 *
 * ★ A NON-PUBLIC PROFILE IS SAID OUT LOUD ★
 * A link preview in a group chat is not a signed-in reader, so a profile set to
 * "signed-in only" or "private" renders no card at all. That is stated here,
 * with the way to change it, rather than silently producing a bare link.
 */
export function ShareProfileDialog({
  profile,
  achievementKey,
  trigger,
}: {
  profile: UserProfile;
  /** Absent shares the profile; a badge key shares that achievement. */
  achievementKey?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: card, isPending } = useShareCard(
    profile.username,
    achievementKey ?? null,
    open,
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const isPublic = profile.visibility === "public";

  async function copyLink() {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The link is on screen and
      // selectable, so there is nothing to recover from and nothing to say.
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={achievementKey ? "Share this achievement" : "Share your profile"}
        description="This is exactly what somebody outside Antcolos will see."
        className="max-w-lg"
      >
        <div className="mt-4 space-y-4">
          {!isPublic ? (
            <FormAlert tone="warning" title="Your profile is not public">
              A link preview is not a signed-in reader, so no card is generated and most people
              following the link will see nothing. Set your profile to public in
              <span className="font-medium text-fg"> Profile visibility</span> to share it.
            </FormAlert>
          ) : isPending ? (
            <div className="flex aspect-[1200/630] items-center justify-center rounded-lg border border-dashed border-border">
              <LoaderCircle aria-hidden className="size-5 animate-spin text-fg-subtle" />
            </div>
          ) : card ? (
            <ShareCardArt card={card} />
          ) : (
            <FormAlert tone="info" title="Nothing to share here">
              This achievement is not on the profile any more, so there is no card to generate.
            </FormAlert>
          )}

          {card ? (
            <>
              <div className="flex items-center gap-2">
                <p
                  className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-[0.75rem] text-fg-muted"
                  title={card.url}
                >
                  {card.url}
                </p>
                <Button type="button" variant="secondary" onClick={() => void copyLink()}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {/* One live region, so a screen reader hears the copy once. */}
              <p aria-live="polite" className="sr-only">
                {copied ? "Link copied to the clipboard." : ""}
              </p>

              <div className="flex flex-wrap gap-2">
                {EXTERNAL_SHARE_TARGETS.map((target) => {
                  const Icon = TARGET_ICON[target];
                  return (
                    <Button
                      key={target}
                      asChild
                      variant="secondary"
                      size="sm"
                    >
                      <a
                        href={shareUrl(target, card)}
                        target="_blank"
                        // noreferrer as well as noopener: the composer does not
                        // need to know which page somebody shared from.
                        rel="noopener noreferrer"
                      >
                        <Icon aria-hidden />
                        {SHARE_TARGET_LABEL[target]}
                      </a>
                    </Button>
                  );
                })}
              </div>
            </>
          ) : null}

          <p className={cn("flex items-start gap-2 text-[0.75rem] leading-relaxed text-fg-subtle")}>
            <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
            Only the sections you publish appear on the card. Nothing about the companies you
            work with is shared beyond the names already on your profile.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

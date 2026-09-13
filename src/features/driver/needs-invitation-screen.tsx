"use client";

import { Link2, MailQuestion } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/form-alert";
import { BackLink, SubmitButton } from "@/features/auth/controls";
import { extractInvitationCode } from "@/features/auth/mock-backend";
import { mockLookUpTeamInvitation } from "@/features/access/mock-access";
import { cn } from "@/lib/utils";

/**
 * What a driver sees when they pick "Driver" without a carrier invitation.
 *
 * Choosing the word "driver" is not the same as being hired, so nothing is
 * created here and nothing claims to be finished. A driver joins a carrier only
 * through that carrier's invitation — there is deliberately no carrier
 * directory and no joining by name.
 */
export function DriverNeedsInvitationScreen({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [raw, setRaw] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (checking) return;
    const code = extractInvitationCode(raw);
    if (!code) {
      setError("Paste the invitation link your carrier sent you.");
      return;
    }
    setError(null);
    setChecking(true);
    const found = await mockLookUpTeamInvitation(code, { returningFromAuth: false });
    setChecking(false);
    if (found.status === "not-found") {
      setError("We don't recognise that link. Check it, or ask your carrier to send it again.");
      return;
    }
    router.push(`/invitation/${encodeURIComponent(code)}`);
  }

  return (
    <div className="space-y-4">
      <FormAlert tone="info" role="none" title="To join a carrier, open the invitation link sent by your carrier.">
        Carriers add drivers by invitation. Until you open one, there is nothing to set up — your
        Antcolos account is ready and waiting.
      </FormAlert>

      <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
        <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
          <MailQuestion className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          No invitation yet?
        </p>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
          Ask the carrier you drive for to invite you from their Drivers page. They will need the
          email address you used here. Carriers are not listed publicly and cannot be joined by
          name.
        </p>
      </div>

      <form onSubmit={open} noValidate className="space-y-3">
        <Field
          label="Have a link already?"
          htmlFor={`${uid}-link`}
          hint={error ? undefined : "Paste the whole link, or just the code at the end of it."}
          error={error ?? undefined}
        >
          <Input
            id={`${uid}-link`}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://antcolos.com/invitation/…"
            spellCheck={false}
            autoCapitalize="none"
            disabled={checking}
            aria-invalid={error ? true : undefined}
            className={cn(error && "border-st-danger")}
          />
        </Field>
        <SubmitButton pending={checking} pendingLabel="Opening…">
          <Link2 aria-hidden />
          Open my invitation
        </SubmitButton>
      </form>

      <Button variant="secondary" size="lg" className="w-full" asChild>
        <Link href="/sign-in">Sign in to a different driver account</Link>
      </Button>

      <div className="pt-1">
        <BackLink onClick={onBack} label="Choose a different role" />
      </div>
    </div>
  );
}

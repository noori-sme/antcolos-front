"use client";

import { Building2 } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "./controls";
import { FormAlert } from "./form-alert";
import { mockAcceptInvitation, mockLookUpInvitation } from "./mock-backend";
import { cn } from "@/lib/utils";

type Status = "idle" | "checking" | "invalid" | "expired" | "valid" | "joining";

interface ResolvedInvitation {
  code: string;
  organization: string;
  role: string;
}

/**
 * Paste-an-invitation panel.
 *
 * KEPT DELIBERATELY, though onboarding no longer renders it. Onboarding used to
 * offer "join a dispatch organization" and now offers "work as an individual
 * dispatcher" instead, but nothing about invitations was removed: the flow at
 * /invite/[code] and /invitation/[token] still works end to end, and this panel
 * is the piece that accepts a pasted link or bare code. It is here ready to be
 * dropped back into any screen that needs it. Do not delete it as dead code.
 *
 * An invitation is the ONLY way into an existing dispatch organization. There is
 * deliberately no directory to browse and no join-by-name box: the link carries
 * the authorization, and without one there is nothing this screen can do.
 *
 * A full URL or a bare code are both accepted, because people paste whichever
 * one they happen to have.
 */
export function InvitationPanel({ onJoined }: { onJoined: () => void }) {
  const uid = useId();
  const inputId = `${uid}-invitation`;

  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [invitation, setInvitation] = useState<ResolvedInvitation | null>(null);
  const [expiredOrganization, setExpiredOrganization] = useState<string | null>(null);

  async function handleLookUp(event: React.FormEvent) {
    event.preventDefault();
    if (status === "checking" || status === "joining") return;
    if (!raw.trim()) {
      setStatus("invalid");
      setInvitation(null);
      return;
    }

    setStatus("checking");
    setInvitation(null);
    setExpiredOrganization(null);

    const result = await mockLookUpInvitation(raw);
    if (result.status === "valid") {
      setInvitation({ code: result.code, organization: result.organization, role: result.role });
      setStatus("valid");
    } else if (result.status === "expired") {
      setExpiredOrganization(result.organization);
      setStatus("expired");
    } else {
      setStatus("invalid");
    }
  }

  async function handleAccept() {
    if (!invitation || status === "joining") return;
    setStatus("joining");
    await mockAcceptInvitation(invitation.code);
    onJoined();
  }

  const showFieldError = status === "invalid";

  return (
    <div className="space-y-4">
      <form onSubmit={handleLookUp} noValidate className="space-y-4">
        <Field
          label="Invitation link"
          htmlFor={inputId}
          hint={
            showFieldError
              ? undefined
              : "Paste the whole link from your invitation email, or just the code at the end of it."
          }
          error={
            showFieldError
              ? "We don't recognise that invitation. Check the link, or ask for a new one."
              : undefined
          }
        >
          <Input
            id={inputId}
            type="text"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              if (status !== "idle" && status !== "joining") setStatus("idle");
            }}
            placeholder="https://antcolos.com/invite/…"
            spellCheck={false}
            autoCapitalize="none"
            disabled={status === "checking" || status === "joining"}
            aria-invalid={showFieldError || undefined}
            className={cn(showFieldError && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>

        {status !== "valid" ? (
          <SubmitButton pending={status === "checking"} pendingLabel="Checking invitation…">
            Check invitation
          </SubmitButton>
        ) : null}
      </form>

      {status === "expired" ? (
        <FormAlert tone="warning" title="This invitation has expired.">
          {expiredOrganization
            ? `Ask an administrator at ${expiredOrganization} to send you a new one.`
            : "Ask an administrator to send you a new one."}
        </FormAlert>
      ) : null}

      {invitation ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
            >
              <Building2 className="size-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-fg">{invitation.organization}</p>
              <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                You have been invited as{" "}
                <span className="font-medium text-fg">{invitation.role}</span>.
              </p>
            </div>
          </div>
          <SubmitButton
            type="button"
            pending={status === "joining"}
            pendingLabel="Joining…"
            onClick={handleAccept}
          >
            Join {invitation.organization}
          </SubmitButton>
        </div>
      ) : null}
    </div>
  );
}

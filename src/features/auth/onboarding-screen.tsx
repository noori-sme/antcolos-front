"use client";

import { Building2, CircleCheck, Link2, Plus, Truck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell } from "./shell";
import { BackLink, ChoiceCard, SubmitButton } from "./controls";
import { FormAlert } from "./form-alert";
import { InvitationPanel } from "./invitation-panel";
import { mockCreateOrganization } from "./mock-backend";
import { validateOrgName } from "./rules";
import { cn } from "@/lib/utils";

type Stage = "role" | "dispatch-fork" | "create-org" | "join" | "done";
type Role = "carrier-owner" | "driver" | "dispatch";

const DONE_COPY: Record<string, { title: string; description: string }> = {
  "carrier-owner": {
    title: "You're set up as a carrier owner",
    description:
      "Your carrier workspace is where your loads, drivers, trucks and settlements live. You can invite your team once you are inside.",
  },
  driver: {
    title: "You're set up as a driver",
    description:
      "You'll see the loads assigned to you, your documents and anything that needs your attention. Your carrier connects your account to their fleet.",
  },
  "dispatch-created": {
    title: "Your dispatch organization is ready",
    description:
      "You are the owner. You can invite dispatchers, connect the carriers you dispatch for, and set what each person is allowed to see.",
  },
  "dispatch-joined": {
    title: "You've joined the dispatch organization",
    description:
      "Your access follows the role your administrator gave you, so you will only see the carriers and loads that role covers.",
  },
};

/**
 * Onboarding — asked once, right after the account is created.
 *
 * A returning user never lands here: Sign In goes straight to the product,
 * because their role and organization were settled the first time.
 */
export function OnboardingScreen() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  const [stage, setStage] = useState<Stage>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<keyof typeof DONE_COPY | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  function chooseRole(next: Role) {
    setRole(next);
    if (next === "dispatch") {
      setStage("dispatch-fork");
      return;
    }
    setOutcome(next);
    setStage("done");
  }

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    role: {
      title: "How will you use Antcolos?",
      description:
        "This sets up your workspace and decides what you see first. You only answer this once.",
    },
    "dispatch-fork": {
      title: "Dispatch organization",
      description: "Are you starting a new dispatch organization, or joining one that already exists?",
    },
    "create-org": {
      title: "Name your dispatch organization",
      description: "This is the name carriers and drivers will see when they work with you.",
    },
    join: {
      title: "Join a dispatch organization",
      description: "Joining is by invitation only.",
    },
    done: {
      title: outcome ? DONE_COPY[outcome].title : "You're all set",
      description: outcome ? DONE_COPY[outcome].description : null,
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {stage === "role" ? (
        <div className="space-y-2.5">
          <ChoiceCard
            icon={Truck}
            title="Carrier owner"
            description="I run a trucking company with my own authority, trucks and drivers."
            onSelect={() => chooseRole("carrier-owner")}
            selected={role === "carrier-owner"}
          />
          <ChoiceCard
            icon={UserRound}
            title="Driver"
            description="I drive for a carrier and want to see my loads, documents and pay."
            onSelect={() => chooseRole("driver")}
            selected={role === "driver"}
          />
          <ChoiceCard
            icon={Building2}
            title="Dispatch organization"
            description="I dispatch loads on behalf of carriers, either on my own or with a team."
            onSelect={() => chooseRole("dispatch")}
            selected={role === "dispatch"}
          />
        </div>
      ) : null}

      {stage === "dispatch-fork" ? (
        <div className="space-y-2.5">
          <ChoiceCard
            icon={Plus}
            title="Create your dispatch organization"
            description="Start a new organization. You become its owner and invite your dispatchers."
            onSelect={() => setStage("create-org")}
          />
          <ChoiceCard
            icon={Link2}
            title="Join a dispatch organization"
            description="Use the invitation link an administrator sent you. Invitation required."
            onSelect={() => setStage("join")}
          />
          <div className="pt-1.5">
            <BackLink onClick={() => setStage("role")} />
          </div>
        </div>
      ) : null}

      {stage === "create-org" ? (
        <CreateOrganizationForm
          onCreated={() => {
            setOutcome("dispatch-created");
            setStage("done");
          }}
          onBack={() => setStage("dispatch-fork")}
        />
      ) : null}

      {stage === "join" ? (
        <div className="space-y-4">
          <FormAlert tone="info" title="You need an invitation to join." role="none">
            Ask an administrator of the dispatch organization to send you an invitation link.
            Organizations are not listed publicly and cannot be joined by name.
          </FormAlert>
          <InvitationPanel
            onJoined={() => {
              setOutcome("dispatch-joined");
              setStage("done");
            }}
          />
          <div className="pt-1">
            <BackLink onClick={() => setStage("dispatch-fork")} />
          </div>
        </div>
      ) : null}

      {stage === "done" ? (
        <div className="space-y-5">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5",
            )}
          >
            <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
            <p className="text-[0.8125rem] font-medium text-fg">Your account is ready to use.</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => router.push("/home")}
          >
            Go to Antcolos
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}

/** The one field needed to stand up a dispatch organization. */
function CreateOrganizationForm({
  onCreated,
  onBack,
}: {
  onCreated: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const nameId = `${uid}-org-name`;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const nextError = validateOrgName(name);
    setError(nextError);
    if (nextError) return;

    setPending(true);
    await mockCreateOrganization(name.trim());
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Organization name"
        htmlFor={nameId}
        hint={error ? undefined : "You can change this later in settings."}
        error={error ?? undefined}
      >
        <Input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Meridian Dispatch"
          disabled={pending}
          maxLength={60}
          aria-invalid={error ? true : undefined}
          className={cn(error && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <SubmitButton pending={pending} pendingLabel="Creating organization…">
        Create organization
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

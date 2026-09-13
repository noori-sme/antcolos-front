"use client";

import { Building2, CircleCheck, Link2, Plus, Truck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./shell";
import { BackLink, ChoiceCard } from "./controls";
import { CarrierVerification } from "./carrier-verification";
import { DispatchCreation } from "./dispatch-creation";
import { FormAlert } from "./form-alert";
import { InvitationPanel } from "./invitation-panel";
import { DriverNeedsInvitationScreen } from "@/features/driver/needs-invitation-screen";
import { useStageFocus } from "./use-stage-focus";

type Stage = "role" | "carrier" | "driver" | "dispatch-fork" | "create-org" | "join" | "done";
type Role = "carrier-owner" | "driver" | "dispatch";
type Outcome = "dispatch-joined";

const DONE_COPY: Record<Outcome, { title: string; description: string }> = {
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
 *
 * Two of the three paths are more than a choice, so they own their own screens:
 * a carrier owner has to prove the carrier is theirs, and a new dispatch
 * organization has to confirm the address carriers will hear from. Driver and
 * "join by invitation" finish here.
 */
export function OnboardingScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  const enterWorkspace = () => router.push("/home");

  function chooseRole(next: Role) {
    setRole(next);
    if (next === "carrier-owner") {
      setStage("carrier");
      return;
    }
    if (next === "dispatch") {
      setStage("dispatch-fork");
      return;
    }
    // Picking "Driver" is not the same as being hired. No carrier relationship
    // exists until a carrier's invitation is accepted, so nothing is created
    // here and nothing claims to be finished.
    setStage("driver");
  }

  // These two run their own multi-step screens, headings and progress.
  if (stage === "carrier") {
    return (
      <CarrierVerification onEnterWorkspace={enterWorkspace} onBack={() => setStage("role")} />
    );
  }
  if (stage === "create-org") {
    return (
      <DispatchCreation
        onEnterWorkspace={enterWorkspace}
        onBack={() => setStage("dispatch-fork")}
      />
    );
  }

  const heading: Record<string, { title: string; description: React.ReactNode }> = {
    role: {
      title: "How will you use Antcolos?",
      description:
        "This sets up your workspace and decides what you see first. You only answer this once.",
    },
    driver: {
      title: "Joining as a driver",
      description: "Drivers join a carrier through the carrier's invitation.",
    },
    "dispatch-fork": {
      title: "Dispatch organization",
      description: "Are you starting a new dispatch organization, or joining one that already exists?",
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

      {stage === "driver" ? (
        <DriverNeedsInvitationScreen onBack={() => setStage("role")} />
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
          <div className="flex items-center gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
            <p className="text-[0.8125rem] font-medium text-fg">Your account is ready to use.</p>
          </div>
          <Button variant="primary" size="lg" className="w-full" onClick={enterWorkspace}>
            Go to Antcolos
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}

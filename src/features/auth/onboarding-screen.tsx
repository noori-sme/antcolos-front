"use client";

import { Building2, Headset, Plus, Truck, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { AuthShell } from "./shell";
import { AccountFlowProgress, BackLink, ChoiceCard } from "./controls";
import { CarrierVerification } from "./carrier-verification";
import { DispatchCreation } from "./dispatch-creation";
import { IndividualDispatcherSetup } from "./individual-dispatcher";
import { DriverSelfOnboarding } from "@/features/driver/self-onboarding-screen";
import { useStageFocus } from "./use-stage-focus";

type Stage = "role" | "carrier" | "driver" | "dispatch-fork" | "create-org" | "individual";
type Role = "carrier-owner" | "driver" | "dispatch";

export function OnboardingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStage = (searchParams?.get("step") as Stage) || "role";
  const [stage, setStage] = useState<Stage>(initialStage);
  const [role, setRole] = useState<Role | null>(null);
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
    // Picking "Driver" is not the same as being hired: the driver path creates
    // a driver profile and only that. No carrier relationship exists until a
    // carrier's invitation is accepted.
    setStage("driver");
  }

  // Each of these runs its own multi-step screen, heading and progress.
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
  if (stage === "driver") {
    return (
      <DriverSelfOnboarding
        onBack={() => setStage("role")}
        // The driver portal they now belong in. It is the dashboard that
        // already exists; nothing about it was built for this flow.
        onEnterDriverPortal={() => router.push("/driver/home")}
      />
    );
  }
  if (stage === "individual") {
    return (
      <IndividualDispatcherSetup
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
    "dispatch-fork": {
      title: "How do you dispatch?",
      description: "On your own, or as an organization with a team of dispatchers.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {stage === "role" ? <AccountFlowProgress stage={3} /> : null}

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
            icon={Headset}
            title="Work as an individual dispatcher"
            description="I dispatch on my own. Confirm a work email and start straight away."
            onSelect={() => setStage("individual")}
          />
          <ChoiceCard
            icon={Plus}
            title="Create your dispatch organization"
            description="Start a new organization. You become its owner and invite your dispatchers."
            onSelect={() => setStage("create-org")}
          />
          <div className="pt-1.5">
            <BackLink onClick={() => setStage("role")} />
          </div>
        </div>
      ) : null}
    </AuthShell>
  );
}

"use client";

import { Building2, Headset, Plus, Truck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "./shell";
import { BackLink, ChoiceCard } from "./controls";
import { CarrierVerification } from "./carrier-verification";
import { DispatchCreation } from "./dispatch-creation";
import { IndividualDispatcherSetup } from "./individual-dispatcher";
import { DriverNeedsInvitationScreen } from "@/features/driver/needs-invitation-screen";
import { useStageFocus } from "./use-stage-focus";

type Stage = "role" | "carrier" | "driver" | "dispatch-fork" | "create-org" | "individual";
type Role = "carrier-owner" | "driver" | "dispatch";

/**
 * Onboarding — asked once, right after the account is created.
 *
 * A returning user never lands here: Sign In goes straight to the product,
 * because their role and organization were settled the first time.
 *
 * Three of the paths are more than a choice, so they own their own screens: a
 * carrier owner has to prove the carrier is theirs, a new dispatch organization
 * has to confirm the address carriers will hear from, and an individual
 * dispatcher has to confirm their work address. Only the driver path finishes
 * here, and it finishes by saying an invitation is needed rather than by
 * claiming anything is set up.
 *
 * Joining an existing dispatch organization is not offered here any more. It
 * was never something this screen could do on its own — an invitation link
 * carries the authorization — so it lives entirely in the invitation flow at
 * /invite/[code], which is unchanged and still works.
 */
export function OnboardingScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("role");
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
    driver: {
      title: "Joining as a driver",
      description: "Drivers join a carrier through the carrier's invitation.",
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

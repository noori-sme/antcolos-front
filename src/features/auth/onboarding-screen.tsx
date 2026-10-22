"use client";

import { Building2, Headset, Plus, Truck, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { fetchAndStoreUserPermissions } from "@/lib/session/permissions-sync";
import { toast } from "sonner";
import { AuthShell } from "./shell";
import { AccountFlowProgress, BackLink, ChoiceCard, SubmitButton } from "./controls";
import { CarrierVerification } from "./carrier-verification";
import { DispatchCreation } from "./dispatch-creation";
import { IndividualDispatcherSetup } from "./individual-dispatcher";
import { DriverSelfOnboarding } from "@/features/driver/self-onboarding-screen";
import { useStageFocus } from "./use-stage-focus";
import Cookies from "js-cookie";

type Stage = "role" | "carrier" | "verify-carrier" | "driver" | "dispatch-fork" | "create-org" | "individual";
type Role = "carrier-owner" | "driver" | "dispatch" | "individual-dispatcher" | "dispatch-company";

function MultipleHeadsetsIcon(props: React.ComponentProps<"svg">) {
  const maskId = useId();

  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 27 27"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <mask id={maskId}>
          <rect width="29" height="29" fill="white" />
          <g
            transform="translate(2, 4.5) scale(0.93)"
            stroke="black"
            strokeWidth="4.8"
            fill="black"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
            <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
          </g>
        </mask>
      </defs>

      {/* 2 flanking background headsets */}
      <g mask={`url(#${maskId})`} opacity="0.8">
        <g transform="translate(-2, 1) scale(0.7)">
          <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
          <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
        </g>
        <g transform="translate(10.5, 1) scale(0.7)">
          <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
          <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
        </g>
      </g>

      {/* 1 center foreground headset */}
      <g transform="translate(2, 4.5) scale(0.93)">
        <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
        <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
      </g>
    </svg>
  );
}

export function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const nextStepCookie = typeof window !== "undefined" ? Cookies.get("antcolos_next_step") : null;
  const stepParam = searchParams?.get("step") as Stage;

  const initialStage: Stage =
    stepParam ||
    (nextStepCookie === "verify-carrier"
      ? "verify-carrier"
      : nextStepCookie === "carrier-onboarding"
      ? "carrier"
      : nextStepCookie === "company-details"
      ? "create-org"
      : "role");

  const [stage, setStage] = useState<Stage>(initialStage);
  const [role, setRole] = useState<Role | null>(null);
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  useEffect(() => {
    const nextCookie = Cookies.get("antcolos_next_step");
    const step = searchParams?.get("step") as Stage;
    if (step && step !== stage) {
      setStage(step);
    } else if (!step && nextCookie) {
      if (nextCookie === "verify-carrier") {
        setStage("verify-carrier");
      } else if (nextCookie === "carrier-onboarding") {
        setStage("carrier");
      } else if (nextCookie === "company-details") {
        setStage("create-org");
      }
    }
  }, [searchParams, stage]);

  const updateStage = (newStage: Stage) => {
    setStage(newStage);
    router.push(`/onboarding?step=${newStage}`);
  };

  const enterWorkspace = () => {
    fetchAndStoreUserPermissions(queryClient);
    router.push("/home");
  };

  const selectRoleMutation = useMutation({
    mutationFn: async (selectedRole: Role) => {
      let accountType = "";
      if (selectedRole === "carrier-owner") accountType = "CARRIER";
      if (selectedRole === "driver") accountType = "DRIVER";
      if (selectedRole === "individual-dispatcher") accountType = "DISPATCHER";
      if (selectedRole === "dispatch-company") accountType = "DISPATCHING_COMPANY";

      const { data } = await apiClient.post("/auth/select-role", { accountType });
      return data;
    },
    onSuccess: (data, selectedRole) => {
      const friendlyMessages: Record<Role, string> = {
        "carrier-owner": "Role selected! Let's set up your carrier details.",
        "dispatch-company": "Role selected! Let's create your dispatch organization.",
        "individual-dispatcher": "You're all set! Welcome to Antcolos as an individual dispatcher.",
        "driver": "You're all set! Welcome to Antcolos as a driver.",
        "dispatch": "Role selected! Choose how you dispatch.",
      };

      const message = data?.message || friendlyMessages[selectedRole] || "Role selected successfully!";
      toast.success(message);

      if (selectedRole === "carrier-owner") {
        updateStage("carrier");
        return;
      }
      if (selectedRole === "dispatch-company") {
        updateStage("create-org");
        return;
      }
      if (selectedRole === "individual-dispatcher") {
        Cookies.remove("antcolos_next_step", { path: "/" });
        fetchAndStoreUserPermissions(queryClient);
        router.push("/home");
        return;
      }

      // Driver path: Skip additional onboarding and go straight to driver portal
      Cookies.remove("antcolos_next_step", { path: "/" });
      fetchAndStoreUserPermissions(queryClient);
      router.push("/driver/home");
    },
    onError: (error) => {
      // If we already successfully transitioned the token, ignore token scope errors from accidental double-clicks
      if (error.message?.includes("Onboarding-scoped token required") && selectRoleMutation.isSuccess) {
        return;
      }
      toast.error(error.message || "Failed to set role. Please try again.");
    }
  });

  function handleSubmitRole(e: React.FormEvent) {
    e.preventDefault();
    if (role === "dispatch") {
      updateStage("dispatch-fork");
      return;
    }
    if (role && !selectRoleMutation.isPending) {
      selectRoleMutation.mutate(role);
    }
  }

  // Each of these runs its own multi-step screen, heading and progress.
  if (stage === "carrier" || stage === "verify-carrier") {
    return (
      <CarrierVerification
        initialStage="details"
        onEnterWorkspace={enterWorkspace}
        onBack={() => updateStage("role")}
      />
    );
  }
  if (stage === "create-org") {
    return (
      <DispatchCreation
        onEnterWorkspace={enterWorkspace}
        onBack={() => updateStage("dispatch-fork")}
      />
    );
  }
  if (stage === "driver") {
    return (
      <DriverSelfOnboarding
        onBack={() => updateStage("role")}
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
        onBack={() => updateStage("dispatch-fork")}
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
        <form onSubmit={handleSubmitRole} className="space-y-4">
          <div className="space-y-2.5">
            <ChoiceCard
              icon={Truck}
              title="Carrier owner"
              description="I run a trucking company with my own authority, trucks and drivers."
              onSelect={() => setRole("carrier-owner")}
              selected={role === "carrier-owner"}
            />
            <ChoiceCard
              icon={UserRound}
              title="Driver"
              description="I drive for a carrier and want to see my loads, documents and pay."
              onSelect={() => setRole("driver")}
              selected={role === "driver"}
            />
            <ChoiceCard
              icon={Building2}
              title="Dispatch organization"
              description="I dispatch loads on behalf of carriers, either on my own or with a team."
              onSelect={() => setRole("dispatch")}
              selected={role === "dispatch"}
            />
          </div>
          <div className="pt-2">
            <SubmitButton
              pending={selectRoleMutation.isPending}
              pendingLabel="Continuing…"
              disabled={!role || selectRoleMutation.isSuccess}
            >
              Continue
            </SubmitButton>
          </div>
        </form>
      ) : null}

      {stage === "dispatch-fork" ? (
        <div className="space-y-2.5">
          <ChoiceCard
            icon={Headset}
            title="Work as an individual dispatcher"
            description="I dispatch on my own. Confirm a work email and start straight away."
            onSelect={() => {
              if (!selectRoleMutation.isPending) {
                selectRoleMutation.mutate("individual-dispatcher");
              }
            }}
            selected={selectRoleMutation.isPending && selectRoleMutation.variables === "individual-dispatcher"}
          />
          <ChoiceCard
            icon={MultipleHeadsetsIcon}
            title="Create your dispatch organization"
            description="Start a new organization. You become its owner and invite your dispatchers."
            onSelect={() => {
              if (!selectRoleMutation.isPending) {
                selectRoleMutation.mutate("dispatch-company");
              }
            }}
            selected={selectRoleMutation.isPending && selectRoleMutation.variables === "dispatch-company"}
          />
          <div className="pt-1.5">
            <BackLink onClick={() => updateStage("role")} />
          </div>
        </div>
      ) : null}
    </AuthShell>
  );
}

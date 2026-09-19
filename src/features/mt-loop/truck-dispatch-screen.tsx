"use client";

import {
  AlertTriangle, ArrowLeft, Building2, Check, ChevronDown, CircleCheck, Clock3,
  ArrowUpRight, Container, FileText, Lock, Phone, Mail, RefreshCw, Truck as TruckIcon, User,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AUTHORITY_STATUS_LABEL, CONTACT_ROLE_LABEL, CARRIER_DOCUMENT_LABEL,
  ASSIGNMENT_SOURCE_LABEL, DRIVER_AVAILABILITY_LABEL, MT_LOOP_ACTION_LABEL, MT_LOOP_STATUS_LABEL,
  type CarrierView, type DriverView, type MtLoopBlocker, type MtLoopCard,
} from "@/types";
import type {
  PlannedSection, TruckDispatchWorkspace,
} from "@/lib/api/mock/truck-dispatch-workspace";
import { cn, useNow } from "@/lib/utils";
import { SearchPanel } from "@/features/opportunities/search-panel";
import { OpportunitiesPanel } from "@/features/opportunities/opportunities-panel";
import { useTruckOpportunities } from "@/features/opportunities/use-opportunities";
import { useOpportunityRefresh } from "@/features/opportunities/use-opportunity-refresh";
import { NegotiationPanel } from "@/features/opportunities/negotiation-panel";
import { CommunicationsPanel } from "@/features/communications/communications-panel";
import { DriverReviewPanel } from "@/features/driver-review/driver-review-panel";
import { RateConAwaiting, RateConSummary } from "@/features/rate-confirmations/ratecon-panel";
import { useMtLoopBoard, useMtLoopContext } from "./use-mt-loop";
import { useTruckDispatchWorkspace } from "./use-truck-dispatch";
// The board's own cards and marks, so the rail beside this page and the board
// it was opened from cannot say different things about the same truck.
import { Dwell, ServiceChip, TruckMark, progressTone } from "./loop-cards";
import { MiniMap } from "./mini-map";
import { InfoTip, Metric, Tip } from "./tip";
import { TruckRail } from "./truck-rail";
import {
  cycleStages, openStageOf,
  type CycleStage, type CycleStageKey,
} from "./cycle-stages";

/**
 * One truck's dispatch workspace.
 *
 * Opened by clicking a truck on the MT Loop board. It answers the question a
 * dispatcher actually has at that moment — "what am I working with, and what is
 * stopping me?" — for a person who may be running several carriers at once and
 * should not have to remember which one this truck belongs to.
 *
 * The carrier context is established by the service from the dispatcher's live
 * relationship with that carrier. There is no organization to switch, no second
 * account, and no second login. What the page CANNOT do is show anything the
 * relationship does not entitle the person to: every panel renders only what
 * the service handed it, and the service asked each registry in turn.
 *
 * Blockers lead, because a truck that cannot legally move is not a truck you
 * should be finding a load for.
 */
export function TruckDispatchScreen({ truckId }: { truckId: string }) {
  const query = useTruckDispatchWorkspace(truckId);
  const ctx = useMtLoopContext();
  // The board, for the rail. The same query the board screen uses, so opening
  // a truck does not cost a second read and the list beside it is the list
  // that was clicked.
  const board = useMtLoopBoard();
  // The cycle id is the MT Loop's own id — the roadmap's dispatchCycleId. One
  // id from the truck going empty to the load being delivered and released.
  const dispatchCycleId = query.data?.loop?.loopId;
  const opportunities = useTruckOpportunities(dispatchCycleId);

  const refreshWorkspace = useOpportunityRefresh();
  /** Which stage the reader has opened, overriding the one the work is at. */
  const [chosenStage, setChosenStage] = useState<CycleStageKey | null>(null);
  const [rigOpen, setRigOpen] = useState(false);

  function refreshEverything() {
    void query.refetch();
    void opportunities.refetch();
    void board.refetch();
    // And every other screen that reads the same store: the Inbox, the board
    // and the Needs You queue all change when a search runs here.
    refreshWorkspace();
  }

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-72" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="Could not open this truck"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="This truck is not yours to dispatch"
          description="It either does not exist or no carrier has given this workspace access to it. Those two look the same here on purpose."
        />
      </div>
    );
  }

  const w = query.data;
  const card = w.loopCard;

  /*
   * ★ THE CYCLE, READ OFF THE RECORDS — NOT A WIZARD ★
   * Every stage state comes from the module that owns it, and the blockers are
   * the one list every screen shows. Stages run together and some never run:
   * a carrier that does not ask its drivers skips that stage, always, and the
   * card says whose rule that is rather than leaving a gap.
   */
  const stages = cycleStages({
    card,
    blockers: w.blockers,
    opportunities: opportunities.data,
    driverConsentRequired: w.carrier
      ? w.carrier.rules.some((r) => r.kind === "driver_consent_required")
      : undefined,
    carrierName: w.carrier?.displayName,
    driverConsentRule: w.carrier?.rules.find((r) => r.kind === "driver_consent_required")?.detail,
  });
  const openStage = chosenStage ?? openStageOf(stages);

  /** What each stage opens to. The modules are unchanged; the frame is new. */
  function stageBody(key: CycleStageKey): React.ReactNode {
    if (!dispatchCycleId) return null;
    switch (key) {
      case "search":
        return (
          <SearchPanel
            dispatchCycleId={dispatchCycleId}
            session={opportunities.data?.session}
            // So a finished search leads somewhere without leaving the stage.
            top={opportunities.data?.top ?? []}
            ctx={ctx}
            onChanged={refreshEverything}
          />
        );
      case "shortlist":
        return (
          <OpportunitiesPanel
            top={opportunities.data?.top ?? []}
            rest={opportunities.data?.rest ?? []}
            drafts={opportunities.data?.drafts ?? []}
            ctx={ctx}
            onChanged={refreshEverything}
          />
        );
      case "driver":
        return (
          <DriverReviewPanel
            reviews={opportunities.data?.driverReviews ?? []}
            policies={opportunities.data?.driverVisibility ?? []}
            carrierOrganizationId={w.carrier?.organizationId}
            carrierName={w.carrier?.displayName}
            ctx={ctx}
            onChanged={refreshEverything}
          />
        );
      case "brokers":
        return (
          <div className="space-y-3">
            <NegotiationPanel
              negotiations={opportunities.data?.negotiations ?? []}
              ctx={ctx}
              onChanged={refreshEverything}
              // So a booked load whose paper is back is not told its paper is
              // missing, two stages above the one that says it is signed.
              rateConStatus={opportunities.data?.rateCon?.status}
            />
            {/* The messages belong to the conversation they are about, so they
                open with it rather than as a panel of their own halfway down
                a page nobody scrolled to. */}
            {opportunities.data?.communications ? (
              <CommunicationsPanel
                dispatchCycleId={dispatchCycleId}
                communications={opportunities.data.communications}
                ctx={ctx}
                onChanged={refreshEverything}
              />
            ) : null}
          </div>
        );
      case "book":
        /*
         * ★ NO BOOK BUTTON HERE, AND THAT IS NOT AN OVERSIGHT ★
         * A load is booked from the conversation that agreed its price, where
         * the floor, the deadhead and the driver's answer are on screen beside
         * it. A second booking control here would be a commitment made without
         * the things it has to be made against.
         */
        return (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3.5 py-2 text-[0.8125rem] text-fg-muted">
            Booked from the agreed conversation
            <InfoTip text="The rate, the deadhead and the driver's answer are all on screen there when the truck is committed, and every blocker is re-checked at that moment — not from this page." />
          </p>
        );
      case "ratecon":
        if (opportunities.data?.rateCon) {
          return <RateConSummary rateCon={opportunities.data.rateCon} />;
        }
        if (opportunities.data?.booking) {
          return (
            <RateConAwaiting
              booking={opportunities.data.booking}
              ctx={ctx}
              onChanged={refreshEverything}
            />
          );
        }
        /*
         * ★ A STAGE A PERSON OPENED NEVER RENDERS NOTHING ★
         * A truck can be carrying a load this workspace did not book through
         * Antcolos — the load is on the cycle, the booking record is not. The
         * rate confirmation for it is somebody's filing cabinet, not ours, and
         * saying so is the answer. Drawing an empty panel was the bug: the
         * stage looked broken rather than out of scope.
         */
        return (
          <p className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3.5 py-2 text-[0.8125rem] text-fg-muted">
            {card?.loadReference
              ? `${card?.loadReference} was not booked here`
              : "Not booked here"}
            <InfoTip text="This truck is on a load that did not come through Antcolos, so there is no booking for a rate confirmation to hang off. Nothing about the paperwork for it is known here." />
          </p>
        );
    }
  }

  return (
    /*
     * ★ TWO COLUMNS, TWO SCROLLBARS ★
     *
     * The rail is a list you work down and the panel is a cycle you read down,
     * and they are different lengths. Sharing one page scrollbar meant scrolling
     * the truck you are reading off the screen to see the truck you might switch
     * to — so each column gets its own, and the page itself does not scroll.
     *
     * The height is the viewport less the sticky topbar (3.5rem) and the page's
     * own vertical padding, read from the same custom property the shell uses so
     * this stays right when the density setting changes it.
     *
     * Only from `xl`, where the rail exists. Below that there is one column, a
     * phone scrolls a page rather than a pane, and pinning the height would trap
     * the content in a box inside a page that could not scroll either.
     */
    <div className="flex gap-5 xl:h-[calc(100dvh-3.5rem-2*var(--page-py))] xl:overflow-hidden">
      <TruckRail board={board.data} activeTruckId={truckId} />

      <div className="min-w-0 min-h-0 flex-1 space-y-4 xl:overflow-y-auto xl:pr-1 xl:pb-4">
        {/* The rail is the way back where there is room for it. */}
        <div className="xl:hidden">
          <BackLink />
        </div>

        <TruckHeader w={w} card={card} />

        <RigStrip
          w={w}
          card={card}
          open={rigOpen}
          onToggle={() => setRigOpen((v) => !v)}
        />
        {rigOpen ? (
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <TruckPanel w={w} />
              <TrailerPanel w={w} />
              <DriverPanel driver={w.driver} problems={w.driverDocumentProblems} />
            </div>
            <div className="space-y-4">
              <CarrierPanel carrier={w.carrier} withheld={w.carrierWithheld} />
              <LoopPanel w={w} />
            </div>
          </div>
        ) : null}

        {/*
          ★ THE BLOCKER IS NEVER BEHIND A DISCLOSURE ★
          Everything else on this page can be collapsed. This cannot: a truck
          that may not legally move is not a truck anybody should be finding a
          load for, and the stage below says the same thing again where the
          work would have started.
        */}
        {w.blockers.length > 0 ? <BlockerPanel blockers={w.blockers} /> : null}

        {dispatchCycleId ? (
          <StageSpine
            stages={stages}
            openStage={openStage}
            onOpen={(key) => setChosenStage(key === openStage ? null : key)}
            body={stageBody}
            planned={w.planned}
          />
        ) : (
          <LoopPanel w={w} />
        )}

        <RecordsChips w={w} onWhy={() => setRigOpen(true)} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BackLink() {
  return (
    <Link
      href="/home"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Back to MT Loop
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* The truck, at the top                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Who this page is about, and where its cycle has got to.
 *
 * ★ A CONCLUSION, NOT A SPECIFICATION ★
 * It used to read "2019 Freightliner Cascadia · tractor" — three facts the
 * truck's own record owns and none of them a reason to do anything. What a
 * dispatcher needs in the first second is which truck, whose it is, how long
 * it has been costing money, where it is, and whose turn it is. The
 * specification is one click away under The rig, and one more click away on
 * the truck's permanent record.
 */
function TruckHeader({
  w, card,
}: {
  w: TruckDispatchWorkspace;
  card?: MtLoopCard;
}) {
  const now = useNow();
  return (
    /*
     * Stacked on a phone, one row where there is width.
     *
     * Squeezed into a single row at 412px the unit number broke across two
     * lines and the subtitle wrapped one word at a time — the most important
     * thing on the page, unreadable. The clock, the badge and the map go
     * underneath instead, where they keep their own line.
     */
    <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-e1 sm:flex-row sm:items-start sm:gap-4">
      <TruckMark />
      <div className="min-w-0 flex-1">
        <h1 className="font-mono text-[1.25rem] leading-tight font-semibold text-fg">
          Unit {w.fleetTruck.unit}
        </h1>
        {/* Equipment, carrier, holder — three facts, not a clause each. */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] leading-snug text-fg-muted">
          <span>{w.fleetTruck.equipment.replace(/_/g, " ")}</span>
          <span aria-hidden className="text-border-strong">·</span>
          <span>{w.carrier?.displayName ?? "No carrier"}</span>
          {card ? (
            <>
              <span aria-hidden className="text-border-strong">·</span>
              <span className={card.claimed ? undefined : "text-st-warning"}>
                {card.claimed
                  ? card.claimed.isMine ? "yours" : card.claimed.displayName
                  : "unclaimed"}
              </span>
            </>
          ) : null}
          {card && cycleAge(card.openedAt, now) ? (
            <>
              <span aria-hidden className="text-border-strong">·</span>
              <span className="tabular-nums">{cycleAge(card.openedAt, now)}</span>
            </>
          ) : null}
        </p>
      </div>

      {card ? (
        <div className="flex shrink-0 items-center gap-3 sm:items-start">
          <Badge tone={progressTone(card.progress)}>{card.progress.label}</Badge>
          <span className="flex flex-1 items-center justify-end gap-3 sm:flex-col sm:items-end sm:gap-1">
            <Dwell card={card} />
            {card.position ? <MiniMap position={card.position} width={80} height={48} /> : null}
          </span>
        </div>
      ) : (
        <Badge tone="neutral">No open cycle</Badge>
      )}
    </header>
  );
}

/**
 * How long this cycle has been open.
 *
 * A different number from the empty clock beside it, and deliberately so: a
 * loop opens when the truck is EXPECTED to go empty, so it can be hours old
 * before the truck has stopped earning. A dispatcher planning a re-load needs
 * the first; one explaining a bad week needs the second.
 */
function cycleAge(openedAt: string, now: number | null): string {
  if (now === null) return "";
  const hours = Math.max(0, Math.floor((now - Date.parse(openedAt)) / 3_600_000));
  if (hours >= 24) return `${Math.floor(hours / 24)}d open`;
  if (hours >= 1) return `${hours}h open`;
  /*
   * Under an hour, say nothing.
   *
   * "Cycle just opened" beside "19h empty" reads as a contradiction, and the
   * reader has no way to know it is not one: the cycle's age and the truck's
   * are genuinely different clocks, and the smaller of the two is never the
   * interesting number. The empty clock is right there and is the one that
   * costs money.
   */
  return "";
}

/* -------------------------------------------------------------------------- */
/* The rig                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The truck, the trailer, the driver and the carrier — as four dots.
 *
 * ★ WHY FOUR DOTS AND NOT FOUR PANELS ★
 * These four were four full-width panels scattered down the page, and a
 * dispatcher asking "is this rig ready?" had to read all of them and hold the
 * answer in their head. The question has a one-glance answer: four things,
 * each either in order or not. The panels still exist, unchanged, one click
 * away under "The rig" — what changed is that the ANSWER is on the page and
 * the reference material is behind it.
 *
 * ★ THE DOTS ARE READ OFF THE BLOCKER LIST ★
 * Not off the records a second time. `blockersFor` is the one thing in
 * Antcolos that decides whether something is in the way, and a strip that
 * made its own judgement would be a second engine disagreeing with the first
 * — which is the exact bug this module was cleaned of.
 */
function RigStrip({
  w, card, open, onToggle,
}: {
  w: TruckDispatchWorkspace;
  card?: MtLoopCard;
  open: boolean;
  onToggle: () => void;
}) {
  const has = (prefix: string) => w.blockers.find((b) => b.key.startsWith(prefix));

  const truckProblem = has("truck_document");
  const carrierProblem = has("carrier_authority") ?? has("carrier_document");
  const driverProblem = has("no_driver") ?? has("driver_document") ?? has("driver_inactive");
  const trailerNeeded = w.fleetTruck.equipment === "tractor";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3.5 py-2">
      {/*
        ★ FOUR DOTS, FOUR WORDS ★
        These read "Truck 133 · in order", "Northline Freight · authority
        active" — a sentence per dot, four sentences to answer one yes/no
        question. The dot carries the answer; the label carries the name; the
        problem, when there is one, carries its own words in the tip.
      */}
      <RigDot
        icon={TruckIcon}
        tone={truckProblem ? "bad" : "good"}
        label={w.fleetTruck.unit}
        detail={truckProblem?.detail ?? "Paperwork in order."}
      />
      <RigDot
        icon={Container}
        tone={w.trailer ? "good" : trailerNeeded ? "bad" : "none"}
        label={w.trailer?.unit ?? "No trailer"}
        detail={w.trailer
          ? `Trailer ${w.trailer.unit} is hooked up.`
          : trailerNeeded
            ? "This is a tractor and has no trailer on it. It cannot be dispatched."
            : `A ${w.fleetTruck.equipment.replace(/_/g, " ")} does not need one.`}
      />
      <RigDot
        icon={User}
        tone={driverProblem ? "bad" : "good"}
        label={w.driver?.legalName ?? "No driver"}
        detail={driverProblem?.detail ?? "Available, and their paperwork is in order."}
      />
      <RigDot
        icon={Building2}
        tone={carrierProblem ? "bad" : w.carrierWithheld ? "unknown" : "good"}
        label={w.carrier?.displayName ?? (w.carrierWithheld ? "Withheld" : "Not established")}
        detail={carrierProblem?.detail
          ?? (w.carrier
            ? "Operating authority is active."
            : w.carrierWithheld
              ? "This workspace has no relationship that entitles it to the carrier's record."
              : "The canonical records name no carrier for this cycle.")}
      />

      {card?.service ? <ServiceChip card={card} /> : null}

      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
        Detail
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </Button>
    </div>
  );
}

/**
 * One thing, and whether it is in order.
 *
 * `none` is its own tone and not a quiet `good` — a cargo van with no trailer
 * is not a van whose trailer checks out — and `unknown` is not a quiet `bad`:
 * a carrier this workspace may not read is a permission outcome, not a
 * carrier with a problem.
 */
function RigDot({
  tone, label, detail, icon: Icon,
}: {
  tone: "good" | "bad" | "none" | "unknown";
  label: string;
  detail: string;
  icon: typeof TruckIcon;
}) {
  return (
    <Tip text={detail} className="no-underline">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[0.75rem]",
          tone === "bad" ? "font-medium text-st-danger"
            : tone === "unknown" ? "text-st-warning"
              : tone === "none" ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "bad" ? "text-st-danger"
              : tone === "unknown" ? "text-st-warning"
                : tone === "none" ? "text-border-strong" : "text-st-success",
          )}
          aria-hidden
        />
        {label}
      </span>
    </Tip>
  );
}

/* -------------------------------------------------------------------------- */
/* The spine                                                                   */
/* -------------------------------------------------------------------------- */

const STAGE_TONE: Record<CycleStage["state"], "success" | "info" | "warning" | "neutral" | "danger"> = {
  done: "success",
  active: "info",
  waiting: "warning",
  upcoming: "neutral",
  skipped: "neutral",
  stopped: "danger",
};

/**
 * The cycle, drawn as a connected run of stages.
 *
 * ★ THE SHAPE IS THE ANSWER ★
 * Behind you, a line each. Where you are, open. Ahead, a line each. Somebody
 * arriving at this page mid-cycle reads their position from the layout before
 * they read a word of it — which is what seven identical full-width panels
 * could never do.
 *
 * ★ CONCURRENT AND SKIPPED, BOTH DRAWN HONESTLY ★
 * The connector between two stages is solid only where the earlier one is
 * finished. A skipped stage keeps its place in the line with a dashed node
 * and its reason, so the run reads as "this did not have to happen" rather
 * than "this is missing". More than one stage can be live at once, because
 * brokers answer while a driver is still looking.
 */
function StageSpine({
  stages, openStage, onOpen, body, planned,
}: {
  stages: CycleStage[];
  openStage?: CycleStageKey;
  onOpen: (key: CycleStageKey) => void;
  body: (key: CycleStageKey) => React.ReactNode;
  planned: PlannedSection[];
}) {
  return (
    <section aria-label="This truck's cycle" className="flex flex-col">
      {stages.map((stage, i) => {
        const isOpen = stage.key === openStage;
        const last = i === stages.length - 1;
        return (
          <div key={stage.key} className="flex gap-3">
            <StageNode stage={stage} continues={!last} />
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-2")}>
              <StageCard
                stage={stage}
                open={isOpen}
                onToggle={() => onOpen(stage.key)}
                body={isOpen ? body(stage.key) : null}
              />
            </div>
          </div>
        );
      })}

      {/*
        ★ WHAT IS NOT BUILT, NAMED RATHER THAN MOCKED UP ★
        The cycle does not end at the rate confirmation — it ends when the load
        has run and the truck is empty again. Four milestones of that are not
        built. A spine that simply stopped would imply the cycle does too, and
        a greyed-out button would imply it nearly works.
      */}
      <div className="flex gap-3">
        <span className="flex w-6 shrink-0 flex-col items-center">
          <span className="flex size-6 items-center justify-center rounded-full border-2 border-dashed border-border-strong">
            <RefreshCw className="size-3 text-fg-subtle" aria-hidden />
          </span>
        </span>
        <div className="min-w-0 flex-1 rounded-md border border-dashed border-border bg-surface-sunken px-3.5 py-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="neutral">Not built</Badge>
            <span className="text-[0.75rem] text-fg-muted">
              {planned.length} more {planned.length === 1 ? "stage" : "stages"}
            </span>
            <InfoTip
              text={`${planned.map((p) => p.title).join(" · ")}. Milestones ${planned[0]?.milestone ?? 9}–${planned[planned.length - 1]?.milestone ?? 12}, each hanging off the cycle id already on this page. When they run, this cycle closes and a new loop opens for the same truck with its own id.`}
            />
          </p>
        </div>
      </div>
    </section>
  );
}

/** The node and the connector under it. */
function StageNode({ stage, continues }: { stage: CycleStage; continues: boolean }) {
  const done = stage.state === "done";
  const stopped = stage.state === "stopped";
  const skipped = stage.state === "skipped";
  const live = stage.state === "active" || stage.state === "waiting";

  return (
    <span className="flex w-6 shrink-0 flex-col items-center">
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold",
          done && "bg-st-success text-white",
          stopped && "bg-st-danger text-white",
          skipped && "border-2 border-dashed border-border-strong text-fg-subtle",
          live && "border-2 border-st-info bg-surface text-st-info",
          stage.state === "upcoming" && "border-2 border-border-strong bg-surface",
        )}
      >
        {done ? <Check className="size-3.5" /> : null}
        {stopped ? "!" : null}
        {skipped ? "–" : null}
        {live && stage.count !== undefined ? stage.count : null}
        {/* A live stage with nothing to count still has to look live: an empty
            ring is what `upcoming` looks like, and the two mean opposite
            things to somebody scanning the column. */}
        {live && stage.count === undefined ? (
          <span aria-hidden className="size-2 rounded-full bg-st-info" />
        ) : null}
      </span>
      {continues ? (
        <span
          aria-hidden
          className={cn(
            "w-0.5 flex-1",
            // Solid only where the stage behind it is actually finished. A
            // solid line out of an unfinished stage would draw progress that
            // has not happened.
            done ? "bg-st-success/50" : "bg-border",
          )}
        />
      ) : null}
    </span>
  );
}

/** One stage: always a summary, and its module when it is the one open. */
function StageCard({
  stage, open, onToggle, body,
}: {
  stage: CycleStage;
  open: boolean;
  onToggle: () => void;
  body: React.ReactNode;
}) {
  const stopped = stage.state === "stopped";
  return (
    <div
      data-stage={stage.key}
      data-stage-state={stage.state}
      className={cn(
        "rounded-md border",
        stopped ? "border-st-danger/45 bg-st-danger-bg/30"
          : open ? "border-border-strong bg-surface shadow-e1"
            : stage.state === "skipped" ? "border-dashed border-border bg-surface-sunken"
              : "border-border bg-surface-sunken",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1">
          {/* Title, state, and the numbers — one line where there is room. */}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className={cn(
                "text-[0.8125rem] font-semibold",
                stage.state === "upcoming" || stage.state === "skipped"
                  ? "text-fg-muted"
                  : "text-fg",
              )}
            >
              {stage.title}
            </span>
            <Badge tone={STAGE_TONE[stage.state]}>{stage.summary}</Badge>
            {stage.metrics?.map((m) => (
              <Metric key={m.label} label={m.label} value={m.value} tone={m.tone} title={m.title} />
            ))}
            {/*
              ★ WHAT STAYS ON THE PAGE, AND WHAT MOVES TO A HOVER ★
              A refusal's cause and a carrier's rule are the two notes a reader
              has to act on, so they stay visible. Everything else — what is
              not connected, what is never emailed, when the blockers are
              re-checked — is an explanation of something already on screen,
              and lives in the tip.
            */}
            {stage.note && !stage.noteVisible ? <InfoTip text={stage.note} /> : null}
          </span>
          {stage.note && stage.noteVisible ? (
            <span
              className={cn(
                "mt-1 block text-[0.75rem] leading-snug",
                stopped ? "text-st-danger" : "text-fg-subtle",
              )}
            >
              {stage.note}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && body ? <div className="border-t border-border px-3 py-3">{body}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The records                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where the facts actually live.
 *
 * ★ LINKS, NOT COPIES ★
 * This page reads the truck, the driver, the trailer, the carrier and the
 * tracking feed and shows what they MEAN. It does not restate them, because a
 * restated fact is a fact that can go stale while the record it came from is
 * corrected. These are the way to the records themselves.
 */
function RecordsChips({
  w, onWhy,
}: {
  w: TruckDispatchWorkspace;
  onWhy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <RecordChip href={`/fleet/trucks/${w.truck.truckId}`}>
        Truck {w.fleetTruck.unit}
      </RecordChip>
      {w.trailer ? (
        <RecordChip href={`/fleet/trailers/${w.trailer.trailerId}`}>
          Trailer {w.trailer.unit}
        </RecordChip>
      ) : null}
      {w.driver ? (
        <RecordChip href={`/people/drivers/${w.driver.driverProfileId}`}>
          {w.driver.legalName}
        </RecordChip>
      ) : null}
      {w.carrier ? (
        <RecordChip href={`/carriers/${w.carrier.organizationId}`}>
          {w.carrier.displayName}
        </RecordChip>
      ) : null}
      {w.loop?.loadId ? (
        <RecordChip href={`/dispatch/tracking/${w.loop.loadId}`}>Tracking</RecordChip>
      ) : null}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onWhy}>
        Why?
      </Button>
    </div>
  );
}

function RecordChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[0.75rem] text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}

function Panel({
  title, icon: Icon, description, count, action, children,
}: {
  title: string;
  icon?: typeof TruckIcon;
  description?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            {Icon ? <Icon className="size-4 text-fg-subtle" aria-hidden /> : null}
            {title}
            {count !== undefined ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label above, value below. The page is mostly these. */
function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[0.8125rem] text-fg", mono && "font-mono text-[0.75rem]")}>
        {value ?? <span className="text-fg-subtle">Not recorded</span>}
      </dd>
    </div>
  );
}

/** The handful of permissions a driver is ever given, in plain words. */
const DRIVER_PERMISSION_LABEL: Record<string, string> = {
  "loads:view": "See their loads",
  "loads:status:update": "Update load status",
  "documents:view": "See documents",
  "documents:upload": "Upload documents",
  "settlements:view": "See their pay",
};

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-muted">
    {children}
  </p>
);

/* -------------------------------------------------------------------------- */
/* Blockers                                                                    */
/* -------------------------------------------------------------------------- */

/** Whose it is to clear. Two words — the row has no room for a sentence. */
const OWNER_LABEL: Record<MtLoopBlocker["owner"], string> = {
  carrier: "carrier",
  driver: "driver",
  dispatcher: "yours",
};

/**
 * Everything unresolved, in two groups that mean different things.
 *
 * ★ WHY TWO AND NOT ONE ★
 * This panel used to lead every list with "every one of these means a load
 * should not be booked on this truck until it is sorted out" — and then list
 * a proof of delivery the load still owes for invoicing, and a cycle nobody
 * had put their hand up for. Neither stops a booking. A panel that cries wolf
 * about paperwork is a panel a dispatcher learns to scroll past, and the one
 * time it names an expired medical card they will scroll past that too.
 *
 * So: what STOPS a dispatch is said in those words and leads. What is merely
 * unresolved is listed underneath, in its own words, and is never dressed up.
 * `stopsDispatch` is the blocker's own flag — this reads it rather than
 * inferring urgency from severity, which orders the list and nothing more.
 */
function BlockerPanel({ blockers }: { blockers: MtLoopBlocker[] }) {
  const stopping = blockers.filter((b) => b.stopsDispatch);
  const other = blockers.filter((b) => !b.stopsDispatch);

  if (blockers.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-st-success/40 bg-st-success-bg/40 px-3.5 py-2 text-[0.8125rem] font-medium text-fg">
        <CircleCheck className="size-4 shrink-0 text-st-success" aria-hidden />
        Clear to dispatch
        <InfoTip text="Authority, paperwork, driver and equipment all check out for this truck right now." />
      </p>
    );
  }

  return (
    <section
      aria-labelledby="blockers-heading"
      className={cn(
        "rounded-lg border px-3.5 py-2.5",
        stopping.length > 0
          ? "border-st-danger/45 bg-st-danger-bg/35"
          : "border-border bg-surface-sunken",
      )}
    >
      <h2
        id="blockers-heading"
        className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg"
      >
        {stopping.length > 0 ? (
          <AlertTriangle className="size-4 shrink-0 text-st-danger" aria-hidden />
        ) : null}
        {stopping.length > 0
          ? `${stopping.length} blocking`
          : `${other.length} open`}
        {other.length > 0 && stopping.length > 0 ? (
          <span className="font-normal text-fg-muted">· {other.length} non-blocking</span>
        ) : null}
        <InfoTip
          text={stopping.length > 0
            ? "No load may be booked on this truck until every blocking item is cleared. The rest are open work and do not stop a dispatch."
            : "None of these stops a dispatch. They still belong to somebody."}
        />
      </h2>

      {/*
        ★ ONE ROW EACH, AND THE BLOCKER ITSELF NEVER MOVES ★
        Each row used to carry a label, a badge, a sentence and an owner line —
        four lines for a fact whose whole content is "no trailer, yours". The
        label, the colour and the owner stay on the page; the SENTENCE moved to
        the tip. What stops a dispatch is still visible without hovering, which
        is the rule this panel exists to keep.
      */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {[...stopping, ...other].map((b) => (
          <li key={b.key} className="flex items-center gap-1.5 text-[0.75rem]">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                b.stopsDispatch ? "bg-st-danger" : "bg-border-strong",
              )}
            />
            <Tip text={b.detail}>
              <span className={b.stopsDispatch ? "font-medium text-st-danger" : "text-fg-muted"}>
                {b.label}
              </span>
            </Tip>
            <span className="text-fg-subtle">{OWNER_LABEL[b.owner]}</span>
            {b.href ? (
              <Link
                href={b.href}
                className="text-primary underline-offset-4 hover:underline"
                aria-label={`Open ${b.label}`}
              >
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The loop                                                                    */
/* -------------------------------------------------------------------------- */

function LoopPanel({ w }: { w: TruckDispatchWorkspace }) {
  if (!w.loop || !w.loopCard) {
    return (
      <Panel title="MT Loop" icon={RefreshCw} description="The cycle this truck is in.">
        <EmptyNote>
          This truck has no open cycle. One opens by itself the moment it becomes available or is
          expected to go empty.
        </EmptyNote>
      </Panel>
    );
  }

  const loop = w.loop;
  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");

  return (
    <Panel
      title="MT Loop"
      icon={RefreshCw}
      description="The same cycle, and the same id, from the moment this truck went empty until its next load is delivered and released."
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Status" value={MT_LOOP_STATUS_LABEL[loop.status]} />
        {/*
          Two fields, because they are two facts. "Responsible" is the
          Responsibility Engine's answer, carried on the card — the same one
          My work, Needs You and Home show. "Claimed" is whether anybody has
          accepted the cycle, which this module does own.
        */}
        <Field
          label="Responsible"
          value={
            w.loopCard.responsible
              ? `${w.loopCard.responsible.displayName} — ${ASSIGNMENT_SOURCE_LABEL[w.loopCard.responsible.source].toLowerCase()}`
              : <span className="text-st-warning">Could not be read</span>
          }
        />
        <Field
          label="Claimed"
          value={
            w.loopCard.claimed
              ? w.loopCard.claimed.displayName
              : <span className="text-fg-subtle">Nobody has accepted it yet</span>
          }
        />
        <Field label="Empty at" value={where || undefined} />
        <Field
          label="Empty time"
          value={loop.expectedEmptyAt
            ? new Date(loop.expectedEmptyAt).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })
            : undefined}
        />
        <Field label="Load on it" value={loop.loadReference} />
        <Field
          label="Opened"
          value={new Date(loop.openedAt).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          })}
        />
        <div className="col-span-2">
          <Field label="Loop id" value={loop.loopId} mono />
          <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
            Permanent. It does not change when the loop is handed over, paused, blocked or covered —
            and every later step of the cycle will hang off it.
          </p>
        </div>
      </dl>

      {w.handoffs.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">Who has had it</h3>
          <ol className="mt-2 space-y-2">
            {w.handoffs.map((a) => (
              <li key={a.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="text-[0.8125rem] text-fg">
                  {a.assigneeName}
                  {a.endedAt ? null : <span className="ml-2 text-[0.75rem] text-st-success">Now</span>}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {new Date(a.assignedAt).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                  {a.assignedByName && a.assignedByMembershipId !== a.membershipId
                    ? ` · given by ${a.assignedByName}`
                    : " · took it themselves"}
                </p>
                {a.endReason ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">{a.endReason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {loop.history.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">What has happened to it</h3>
          <ol className="mt-2 space-y-1.5">
            {[...loop.history].reverse().slice(0, 10).map((e) => (
              <li key={e.id} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] text-fg">
                    {MT_LOOP_ACTION_LABEL[e.action]}
                    {e.note ? <span className="text-fg-muted"> · {e.note}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {new Date(e.at).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {` · ${e.actorName}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Truck and trailer                                                           */
/* -------------------------------------------------------------------------- */

function TruckPanel({ w }: { w: TruckDispatchWorkspace }) {
  const t = w.truck;
  const f = w.fleetTruck;
  const specs = t.specs;
  // True only when this workspace is the carrier that actually operates it.
  const ownParameters = w.accessReason === "operating_carrier";

  return (
    <Panel title="The truck" icon={TruckIcon} description="What it is, where it is, and what it can carry.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Unit" value={f.unit} />
        <Field label="Status" value={f.status.replace(/_/g, " ")} />
        <Field label="Plate" value={`${t.registration.plateNumber} · ${t.registration.plateState}`} />
        <Field
          label="Location"
          value={[f.currentCity, f.currentState].filter(Boolean).join(", ") || undefined}
        />
        <Field label="Payload" value={specs.maxPayloadLbs ? `${specs.maxPayloadLbs.toLocaleString()} lb` : undefined} />
        <Field label="Can tow" value={specs.maxTowableWeightLbs ? `${specs.maxTowableWeightLbs.toLocaleString()} lb` : undefined} />
        {/* These are the OPERATING CARRIER's parameters for this truck, and they
            live on that carrier's relationship. A dispatch workspace does not
            hold one, so showing the fallback would read as the carrier's real
            number — their minimum rate is in the carrier panel instead. */}
        {ownParameters ? (
          <>
            <Field label="Minimum rate" value={`$${(f.minimumRatePerMileCents / 100).toFixed(2)}/mi`} />
            <Field label="Maximum deadhead" value={`${f.maxDeadheadMiles} mi`} />
          </>
        ) : null}
      </dl>

      {ownParameters ? null : (
        <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
          The rate and deadhead limits for this truck belong to the carrier that operates it. Theirs
          are under their rules, alongside.
        </p>
      )}

      <div className="mt-4">
        <h3 className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg">
          <FileText className="size-3.5 text-fg-subtle" aria-hidden />
          Its paperwork
        </h3>
        {w.truckDocuments.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nothing is on file for this truck.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {w.truckDocuments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                <span>{d.kind.replace(/_/g, " ")}</span>
                <Badge
                  tone={
                    d.status === "approved" ? "success"
                      : d.status === "expiring_soon" || d.status === "pending_review" ? "warning"
                        : d.status === "expired" || d.status === "rejected" || d.status === "missing" ? "danger"
                          : "neutral"
                  }
                >
                  {d.status.replace(/_/g, " ")}
                </Badge>
                {d.expiresAt ? (
                  <span className="text-[0.75rem] text-fg-subtle">
                    {new Date(d.expiresAt).toLocaleDateString()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {w.truckDocumentProblems.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-fg-muted">It is all in order.</p>
        ) : null}
      </div>
    </Panel>
  );
}

function TrailerPanel({ w }: { w: TruckDispatchWorkspace }) {
  if (!w.trailerMissing && !w.trailer) {
    return (
      <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
        <EmptyNote>
          This is a {w.fleetTruck.equipment.replace(/_/g, " ")}. It does not take a trailer, so there
          is nothing to show here.
        </EmptyNote>
      </Panel>
    );
  }

  if (!w.trailer) {
    return (
      <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
        <EmptyNote>
          Nothing is hooked up. This is a tractor, so it needs a trailer before it can take a load.
        </EmptyNote>
      </Panel>
    );
  }

  const tr = w.trailer;
  return (
    <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Unit" value={tr.unit} />
        <Field label="Type" value={tr.trailerType.replace(/_/g, " ")} />
        <Field label="Status" value={tr.status.replace(/_/g, " ")} />
        <Field
          label="Location"
          value={[tr.currentCity, tr.currentState].filter(Boolean).join(", ") || undefined}
        />
      </dl>
      {tr.documentWarnings > 0 ? (
        <p className="mt-3 text-[0.75rem] text-st-warning">
          {tr.documentWarnings} document {tr.documentWarnings === 1 ? "problem" : "problems"} on this
          trailer.
        </p>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Carrier                                                                     */
/* -------------------------------------------------------------------------- */

function CarrierPanel({ carrier, withheld }: { carrier?: CarrierView; withheld: boolean }) {
  if (!carrier) {
    return (
      <Panel title="The carrier" icon={Building2}>
        <EmptyNote>
          {withheld
            ? "This workspace has no relationship that entitles it to the carrier's record, so none of it is shown."
            : "No carrier record."}
        </EmptyNote>
      </Panel>
    );
  }

  const a = carrier.authority;

  return (
    <Panel
      title="The carrier"
      icon={Building2}
      description="Opened automatically from your relationship with them. You did not have to switch to anything."
      action={
        <Badge tone={carrier.canHaul ? "success" : "danger"}>
          {carrier.canHaul ? <CircleCheck aria-hidden className="size-3" /> : <Lock aria-hidden className="size-3" />}
          {carrier.canHaul ? "Can haul" : "Cannot haul"}
        </Badge>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Legal name" value={carrier.legalName} />
        <Field label="Authority" value={`${AUTHORITY_STATUS_LABEL[a.status]}${a.kind ? ` · ${a.kind}` : ""}`} />
        <Field label="MC number" value={carrier.mcNumber} />
        <Field label="DOT number" value={carrier.dotNumber} />
        <Field
          label="Last checked"
          value={a.verifiedAt ? new Date(a.verifiedAt).toLocaleDateString() : undefined}
        />
        <Field label="Trucks you dispatch" value={String(carrier.truckCount)} />
      </dl>

      {a.note ? (
        <p className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
          {a.note}
        </p>
      ) : null}

      {carrier.dispatchNotes ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">What they have asked you to know</h3>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{carrier.dispatchNotes}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Who to call</h3>
        {carrier.contacts.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nobody is recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {carrier.contacts.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {c.name}
                  <Badge tone={c.isPrimary ? "info" : "outline"}>{CONTACT_ROLE_LABEL[c.role]}</Badge>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
                  {c.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" aria-hidden />
                      {c.phone}
                    </span>
                  ) : null}
                  {c.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3" aria-hidden />
                      {c.email}
                    </span>
                  ) : null}
                  {c.hours ? <span>{c.hours}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Their rules</h3>
        {carrier.rules.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">They have not set any.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {carrier.rules.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {r.label}
                  {r.blocking ? null : <Badge tone="outline">Ask first</Badge>}
                </p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Every load found for this truck is checked against these. A rule that fails is named on
          the load, in these words.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Their paperwork</h3>
        <ul className="mt-2 space-y-1.5">
          {carrier.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
              <span>{CARRIER_DOCUMENT_LABEL[d.kind]}</span>
              <Badge
                tone={
                  d.status === "approved" ? "success"
                    : d.status === "expiring_soon" ? "warning"
                      : d.status === "expired" || d.status === "rejected" || d.status === "missing" ? "danger"
                        : "neutral"
                }
              >
                {d.status === "missing" ? "not provided" : d.status.replace(/_/g, " ")}
              </Badge>
              {d.expiresAt ? (
                <span className="text-[0.75rem] text-fg-subtle">
                  {new Date(d.expiresAt).toLocaleDateString()}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

function DriverPanel({
  driver, problems,
}: {
  driver?: DriverView;
  problems: TruckDispatchWorkspace["driverDocumentProblems"];
}) {
  if (!driver) {
    return (
      <Panel title="The driver" icon={User}>
        <EmptyNote>
          Nobody is assigned to this truck. A load cannot be dispatched until somebody is.
        </EmptyNote>
      </Panel>
    );
  }

  const p = driver.preferences;
  const av = driver.availability;

  return (
    <Panel
      title="The driver"
      icon={User}
      description={`Through ${driver.carrierName}, as ${driver.engagementType === "owner_operator" ? "an owner-operator" : "a company driver"}.`}
      action={
        <Badge tone={av.status === "available" ? "success" : av.status === "inactive" ? "danger" : "neutral"}>
          {DRIVER_AVAILABILITY_LABEL[av.status]}
        </Badge>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name" value={driver.legalName} />
        <Field label="Phone" value={driver.phone} />
        <Field label="Licence" value={`${driver.cdlState} · expires ${new Date(driver.cdlExpiresAt).toLocaleDateString()}`} />
        <Field
          label="Medical card"
          value={
            driver.medicalCardExpiresAt
              ? `Expires ${new Date(driver.medicalCardExpiresAt).toLocaleDateString()}`
              : driver.medicalCardShared
                ? undefined
                // Said precisely: the driver has one, they simply did not give
                // it to this carrier. "Not recorded" would be a different, and
                // wrong, statement about the person.
                : <span className="text-fg-subtle">Not shared with {driver.carrierName}</span>
          }
        />
        <Field
          label="Where they are"
          value={[av.currentCity, av.currentState].filter(Boolean).join(", ") || undefined}
        />
        <Field label="Home terminal" value={av.homeTerminal} />
      </dl>

      {driver.cdlNumber === undefined ? (
        <p className="mt-3 flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
          The licence number stays with {driver.carrierName}. Dispatch needs to know the licence is
          current and where it is from, never the number itself.
        </p>
      ) : null}

      {av.hoursNote ? (
        <p className="mt-3 inline-flex items-start gap-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          <Clock3 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          {av.hoursNote}
        </p>
      ) : null}

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">What they have asked for</h3>
        {p.preferredStates || p.avoidStates || p.maxDaysOut || p.homeBy || p.endorsements || p.notes ? (
          <ul className="mt-2 space-y-1 text-[0.8125rem] text-fg-muted">
            {p.preferredStates?.length ? <li>Prefers {p.preferredStates.join(", ")}</li> : null}
            {p.avoidStates?.length ? <li>Would rather not run {p.avoidStates.join(", ")}</li> : null}
            {p.maxDaysOut ? <li>Up to {p.maxDaysOut} days out</li> : null}
            {p.homeBy ? <li>{p.homeBy}</li> : null}
            {p.endorsements?.length ? <li>Endorsements: {p.endorsements.join(", ")}</li> : null}
            {p.notes ? <li>{p.notes}</li> : null}
          </ul>
        ) : (
          <p className="mt-1 text-[0.75rem] text-fg-muted">They have not asked for anything.</p>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Preferences are not rules. A carrier rule stops a load; these are what to know before you
          pick up the phone.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">What they can do themselves</h3>
        {driver.permissions.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">
            Nothing. Everything has to be done for them.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {driver.permissions.map((key) => (
              <li key={key}>
                <Badge tone="outline">{DRIVER_PERMISSION_LABEL[key] ?? key}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Given by {driver.carrierName} when they were taken on. It is what to expect of them — who
          marks a stop arrived, and who has to upload the proof of delivery.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg">
          <FileText className="size-3.5 text-fg-subtle" aria-hidden />
          Their paperwork
        </h3>
        {driver.documents.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">
            They have not shared any documents with {driver.carrierName}.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {driver.documents.map((d) => {
              const req = driver.requirements.find((r) => r.key === d.requirementKey);
              return (
                <li key={d.requirementKey} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  <span>{req?.label ?? d.requirementKey}</span>
                  <Badge
                    tone={
                      d.status === "approved" ? "success"
                        : d.status === "expiring_soon" ? "warning"
                          : d.status === "expired" || d.status === "rejected" ? "danger"
                            : "neutral"
                    }
                  >
                    {d.status.replace(/_/g, " ")}
                  </Badge>
                  {d.expiresAt ? (
                    <span className="text-[0.75rem] text-fg-subtle">
                      {new Date(d.expiresAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Only what the driver agreed to share with {driver.carrierName}. Anything they held back is
          not shown, and is not counted as missing.
        </p>
        {problems.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {problems.map((pr) => (
              <li key={pr.requirementKey} className="text-[0.75rem] text-st-danger">
                {pr.label}: {pr.rejectionReason ?? pr.status.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* What comes next                                                             */

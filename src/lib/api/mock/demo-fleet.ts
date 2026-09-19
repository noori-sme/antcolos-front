import type { MtLoopContext } from "./mt-loop";
import { syncMtLoops } from "./mt-loop";
import { DEMO_ORG, walkCycle, type CycleStop } from "./demo-cycle";
import { TRUCK_IDS, setTruckStatus, truckContextFrom } from "./truck-registry";
import { withoutMockLatency } from "./latency";
import { recordLoadDelay, recordLoadMilestone } from "./load-commands";
import { mockFuelService } from "./fuel";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Ten trucks, ten states, on one board.
 *
 * ★ WHY THE STATES ARE WALKED AND NOT WRITTEN ★
 * The obvious way to demonstrate "a truck waiting on a broker's reply" is to
 * write down a Negotiation with a counter on it. That produces a board that
 * looks exactly right and proves nothing at all: it would survive a bug that
 * made `recordBrokerRound` refuse every real reply, and the first person to
 * click into the truck would find a conversation no module had agreed to.
 *
 * So every one of these is the SAME walk through the real services, stopped at
 * a different point. `demo-cycle.ts` owns the walk; this file owns nothing but
 * the list of where each truck stops and what happens to it afterwards. If a
 * gate starts refusing what a dispatcher does, these trucks stop short and the
 * board shows exactly where — which is the behaviour worth having.
 *
 * ★ AND WHY THE ROLLING FIVE ARE DIFFERENT ★
 * A truck that is under way has done everything above AND has left the yard.
 * "Left the yard" is execution, which is load-module business: each of the five
 * is dispatched, arrives, departs, and then has one thing happen to it — it
 * stops for fuel, it runs out of hours, it gets stuck, or it sits on a dock.
 * None of those is a flag on the truck. Each is a record in the module that
 * owns it, and the board reads it back.
 */

/** What each truck is for. The whole configuration of this seeder. */
interface FleetScenario {
  truckId: string;
  unit: string;
  stop: CycleStop;
  /** What happens after the desk work, for a truck that has left the yard. */
  road?: "rolling" | "off_duty" | "fuelling" | "delayed" | "at_receiver";
}

/*
 * ★ THE ORDER IS PART OF THE FIXTURE ★
 * Ten cycles rank one sample market, and each one that books takes a load out
 * of it. The scarce equipment therefore goes first: there are three sprinter
 * lanes out of the midwest and five for vans, so a van left until last finds
 * the market picked over and stalls at "Searching" — which is realistic, and
 * not what this seeder is for. Grouped by what each truck is demonstrating in
 * the comments; ordered by what it needs to find.
 */
const SCENARIOS: FleetScenario[] = [
  /* ---- Vans and sprinters first: the thinnest part of the market --------- */
  // The walkthrough truck, already taken from empty to signed by
  // `demo-cycle.ts`. It has never left the yard, though, so it sat in the
  // Rolling lane with nothing to say about what it was doing. One more step,
  // through the same load commands as the rest, and the lane means what it says.
  { truckId: TRUCK_IDS.nl133, unit: "133", stop: "signed", road: "rolling" },
  { truckId: TRUCK_IDS.nl154, unit: "154", stop: "signed", road: "at_receiver" },
  { truckId: TRUCK_IDS.nl143, unit: "143", stop: "ratecon_received" },
  { truckId: TRUCK_IDS.nl150, unit: "150", stop: "signed", road: "rolling" },
  { truckId: TRUCK_IDS.nl152, unit: "152", stop: "signed", road: "fuelling" },

  /* ---- Then the box trucks and the hotshot ------------------------------- */
  { truckId: TRUCK_IDS.nl151, unit: "151", stop: "signed", road: "off_duty" },
  { truckId: TRUCK_IDS.nl153, unit: "153", stop: "signed", road: "delayed" },
  { truckId: TRUCK_IDS.nl140, unit: "140", stop: "searched" },
  { truckId: TRUCK_IDS.nl141, unit: "141", stop: "broker_replied" },
  { truckId: TRUCK_IDS.nl142, unit: "142", stop: "driver_accepted" },
  { truckId: TRUCK_IDS.nl144, unit: "144", stop: "asked_broker" },
];

/**
 * Once per store lifetime, like every other seeder here.
 *
 * A promise rather than a boolean so two screens mounting at once await the
 * same run instead of racing to walk ten cycles twice.
 */
let running: Promise<void> | null = null;

export function resetDemoFleet() {
  running = null;
}

export function ensureDemoFleet(ctx: MtLoopContext): Promise<void> {
  // The same gate the single walkthrough uses: only the workspace that
  // dispatches these trucks, and only somebody entitled to do the work. A demo
  // is never a reason to walk past a permission.
  if (ctx.organizationId !== DEMO_ORG) return Promise.resolve();
  if (!ctx.permissions.has("loads:view") || ctx.scope.loads === "assigned") {
    return Promise.resolve();
  }
  running ??= withoutMockLatency(() => walkFleet(ctx)).catch(() => {
    // Swallowed on purpose: a seeder must never be able to stop the board from
    // rendering. An incomplete demo is bad; an app that will not load is worse.
  });
  return running;
}

/* -------------------------------------------------------------------------- */

async function walkFleet(ctx: MtLoopContext): Promise<void> {
  // Shared across the whole run, so no two demo trucks chase the same load and
  // stand each other's work down. See `walkCycle`.
  const taken = new Set<string>();
  for (const scenario of SCENARIOS) {
    // One at a time. They share a market: two cycles racing for the same
    // listing would have one of them lose it, which is realistic and useless
    // for a demo that is supposed to show ten different states.
    const { loadId } = await walkCycle(scenario.truckId, scenario.stop, ctx, taken);
    if (!scenario.road || !loadId) continue;
    await putOnTheRoad(scenario, loadId, ctx);
  }
  syncMtLoops(ctx);
}

/**
 * Everything that happens after the paperwork: the truck actually leaves.
 *
 * Each step is a load command, in the order a driver reports them, and the
 * truck's own status is changed through the fleet service — so `syncMtLoops`
 * sees a loaded truck and moves the cycle to `running` on its own, exactly as
 * it would if a real ELD had said so.
 */
async function putOnTheRoad(
  scenario: FleetScenario,
  loadId: string,
  ctx: MtLoopContext,
): Promise<void> {
  const org = ctx.organizationId;
  const actor = ctx.actor;
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  const step = (milestone: Parameters<typeof recordLoadMilestone>[0]["milestone"], at: string, note?: string) => {
    try {
      recordLoadMilestone({ organizationId: org, actor, loadId, milestone, at, note });
    } catch {
      // See the header. A seeder gives up quietly rather than taking the board
      // down with it.
    }
  };

  step("dispatched", ago(9), "Given to the driver.");
  step("at_pickup", ago(8), "On site at the shipper.");
  step("departed_pickup", ago(7), "Loaded and away.");

  switch (scenario.road) {
    case "rolling":
      break;

    case "off_duty":
      /*
       * ★ NOTHING IS RECORDED HERE, AND THAT IS THE POINT ★
       * Antcolos holds no record of duty status. What it has is the DRIVER's
       * own statement of their hours, on their availability — which the fixture
       * for this truck's driver carries, in their words. The board reads that
       * and says the driver is off duty; it does not compute a 34-hour reset,
       * because nothing here is entitled to.
       */
      break;

    case "fuelling":
      await mockFuelService.recordTransaction(fuelContext(ctx), {
        truckId: scenario.truckId,
        loadId,
        purchasedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
        location: {
          jurisdiction: "IA",
          address: { line1: "2975 Iowa 80 Rd", city: "Walcott", state: "IA", postalCode: "52773", country: "US" },
          merchantName: "Iowa 80 Truckstop",
        },
        fuelType: "diesel",
        gallonsThousandths: 78_400,
        pricePerGallonMills: 3_849,
        totalCostCents: 30_176,
        notes: "Card transaction, recorded from the fuel feed.",
      }).catch(() => null);
      break;

    case "delayed":
      recordLoadDelay({
        organizationId: org,
        actor,
        loadId,
        at: ago(0.4),
        note: "Stopped on I-80 eastbound at the Indiana line. Traffic back four miles.",
        newEtaAt: new Date(Date.now() + 2.5 * 3_600_000).toISOString(),
      });
      break;

    case "at_receiver":
      step("at_delivery", ago(2.6), "On site at the receiver.");
      break;
  }

  /*
   * ★ THE TRUCK'S STATUS IS THE LAST THING, NOT THE FIRST ★
   * `syncMtLoops` moves a cycle to `running` when the truck it is on reads
   * loaded. Setting that before the load existed would have produced a running
   * cycle with nothing under it for as long as the seeder took.
   */
  await setTruckStatus(scenario.truckId, "loaded", truckContextFrom(ctx)).catch(() => null);
}

/**
 * The fuel service takes its own context shape.
 *
 * Narrowed here rather than widened there: Fuel is a different module with its
 * own permissions, and a seeder that handed it a dispatch context would be
 * asserting they are interchangeable.
 */
function fuelContext(ctx: MtLoopContext) {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actor: ctx.actor,
    permissions: ctx.permissions,
    scope: ctx.scope,
  } as Parameters<typeof mockFuelService.recordTransaction>[0];
}

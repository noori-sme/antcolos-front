import type {
  EldBindingEndReason, EldConnection, EldConnectionCounts, EldConnectionState,
  EldDashboard, EldDeviceDetail, EldDeviceView, EldDriverBinding, EldIngestionResult,
  EldProvider, EldPublishedSignal, EldRawPayload, EldShare, EldSignalClass,
  EldVehicleBinding, EquipmentTelemetrySnapshot, NeedsYouItem, PermissionKey,
  TelemetryEvent, TelemetrySignalKind,
} from "@/types";
import { SIGNAL_CLASS_OF } from "@/types";
import {
  MOCK_ELD_PROVIDERS, ODOMETER_CONFLICT_MILES, buildSnapshot, deriveConnectionState,
  findProvider, providerName, providerSupports, snapshotIsStale,
} from "@/lib/eld";
import { NotFoundError, PermissionDeniedError, type ServiceContext } from "../contracts/context";
import type {
  BindDeviceInput, BindDriverInput, ConnectProviderInput, EldEventQuery, EldService,
  GrantShareInput, IngestDeliveryInput, RegisterDeviceInput,
} from "../contracts/eld";
import { driversForWorkspaceSync } from "./driver-registry";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { eldNeedsYouItems, type OdometerConflict } from "./eld-needs-you";
import {
  bindDeviceToTruck, bindDriverToDevice, deviceStateOf,
  disconnectConnection, endDriverBinding, endVehicleBinding, findRawPayload, grantShare,
  ingestDelivery, listBindingHistory, listConnections, listDevices, listDriverBindings,
  listEvents, listRawPayloads, listShares, listSignals, listVehicleBindings,
  registerConnection, registerDevice, retireDevice, revokeShare, sharedClassesFor,
} from "./eld-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOT CONNECTED TO ANYTHING ███
 *
 * The ELD & Telematics service. This is where access is decided, and it is the
 * only place: no screen, no hook and no component in `features/` imports the
 * registry, so there is no path to a device or an event that does not come
 * through one of these methods with a ServiceContext in hand.
 *
 * Six rules are enforced here, and each has a test:
 *
 *  1. PERMISSION. `eld:view` opens the module. Precise position, engine
 *     diagnostics, a driver's clock and the raw provider payloads each need
 *     their own key on top, because they are four different intrusions.
 *  2. RELATIONSHIP SCOPE. Which equipment exists for you at all is answered by
 *     the fleet layer, which already reconciles ownership, the carrier
 *     relationship and dispatch grants. This module asks it and never
 *     second-guesses it with a weaker rule of its own.
 *  3. ACTIVE OPERATING AUTHORITY. A truck held under another carrier's lease is
 *     not yours to read telemetry from, whatever your relationship to the
 *     truck. The fleet layer settles that too, and it is respected here.
 *  4. DRIVER PRIVACY. A driver membership sees the truck it is on. Another
 *     driver's hours of service are never returned to it, by any path.
 *  5. SENSITIVE LOCATION. Exact coordinates are a separate permission from
 *     seeing that a truck is near Joliet, and the snapshot returns the reduced
 *     form — marked `precise: false` — rather than an empty field.
 *  6. CROSS-ORGANIZATION ISOLATION. Every registry read is keyed by
 *     organization. A dispatch workspace holds no partition of its own and sees
 *     exactly what a carrier explicitly shared, for the trucks it named, in the
 *     classes it chose.
 */

const LATENCY_MS = 180;
const wait = (ms = LATENCY_MS) => new Promise<void>((r) => setTimeout(r, ms));
const HOUR_MS = 3_600_000;

function must(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new PermissionDeniedError(missing);
}

const isDispatchWorkspace = (ctx: ServiceContext) =>
  ctx.workspaceKind !== "carrier_organization";

const isDriverMembership = (ctx: ServiceContext) =>
  ctx.scope.loads === "assigned" && Boolean(ctx.driverProfileId);

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One truck the caller may read telemetry about, and how much of it.
 *
 * `ownerOrganizationId` is the carrier whose partition the data lives in. For a
 * carrier that is always itself; for a dispatch workspace it is the carrier
 * that granted the share, and it comes from the share record — never from a
 * route parameter, a filter or anything a screen could supply.
 */
interface TruckScope {
  truckId: string;
  unit: string;
  ownerOrganizationId: string;
  classes: readonly EldSignalClass[];
}

const ALL_CLASSES: readonly EldSignalClass[] = ["position", "meters", "diagnostics", "hos"];

/**
 * What the caller may see, assembled from the fleet layer and the share records.
 *
 * The fleet layer is asked first and is authoritative about EXISTENCE: it has
 * already applied ownership, the carrier relationship, the operating-authority
 * lease and the driver's own narrowing. A truck it does not return is a truck
 * this module will not speak about, share record or no share record — which is
 * what stops a stale grant from outliving the relationship it was made under.
 */
function truckScopes(ctx: ServiceContext): TruckScope[] {
  // The truck registry, not the fleet dashboard.
  //
  // It is the record that actually settles existence — ownership, the carrier
  // relationship, dispatch grants, the operating-authority lease and a driver's
  // narrowing to the truck they are on — and it needs only `trucks:view`. Going
  // through the fleet layer instead would make `fleet:view` a prerequisite for
  // a driver reading the device on their own truck, which is a permission they
  // have no other reason to hold.
  const trucks = fleetSync(truckContextFrom(ctx));

  if (!isDispatchWorkspace(ctx)) {
    return trucks
      // A truck another carrier currently holds under its own operating
      // authority is not this organization's to read a position from, even
      // though the relationship is real and the truck is listed.
      .filter((t) => !t.lockedByAnotherCarrier)
      .map((t) => ({
        truckId: t.truckId,
        unit: t.unit,
        ownerOrganizationId: ctx.organizationId,
        classes: ALL_CLASSES,
      }));
  }

  const visible = new Map(trucks.map((t) => [t.truckId, t.unit]));
  const scopes: TruckScope[] = [];
  for (const share of listShares({ viewerOrganizationId: ctx.organizationId })) {
    const unit = visible.get(share.truckId);
    if (!unit) continue;
    const classes = sharedClassesFor(ctx.organizationId, share.truckId);
    if (!classes.length) continue;
    scopes.push({
      truckId: share.truckId,
      unit,
      ownerOrganizationId: share.ownerOrganizationId,
      classes,
    });
  }
  return scopes;
}

/**
 * The signal classes this caller may read for this truck.
 *
 * Two filters, and both apply: what the carrier shared (for a dispatch
 * workspace), and what this membership's permissions allow. Holding
 * `eld:diagnostics:view` does not conjure a share, and being shared diagnostics
 * does not substitute for the permission.
 */
function permittedClasses(ctx: ServiceContext, scope: TruckScope): Set<EldSignalClass> {
  const allowed = new Set<EldSignalClass>();
  for (const c of scope.classes) {
    if (c === "diagnostics" && !ctx.permissions.has("eld:diagnostics:view")) continue;
    if (c === "hos" && !ctx.permissions.has("eld:hos:view")) continue;
    allowed.add(c);
  }
  return allowed;
}

/**
 * Whether this caller may read one driver's hours of service.
 *
 * A driver membership may read its own clock and nobody else's — not the driver
 * on the next truck, not the one who had this device last month. This is the
 * single narrowest rule in the module and it is checked on every path that can
 * return an HOS value: the snapshot, the event list and the published signals.
 */
function mayReadHosOf(ctx: ServiceContext, driverProfileId?: string): boolean {
  if (!ctx.permissions.has("eld:hos:view")) return false;
  if (!isDriverMembership(ctx)) return true;
  return Boolean(driverProfileId) && driverProfileId === ctx.driverProfileId;
}

const mayReadPrecise = (ctx: ServiceContext) =>
  ctx.permissions.has("eld:location:precise:view");

/* -------------------------------------------------------------------------- */
/* Event filtering                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Narrow a partition's events to what this caller may actually read.
 *
 * Applied after every registry read rather than being trusted to the query, so
 * that a caller who passes no filter and a caller who passes a hostile one land
 * in exactly the same place.
 */
function visibleEvents(
  ctx: ServiceContext,
  events: readonly TelemetryEvent[],
  scopes: readonly TruckScope[],
): TelemetryEvent[] {
  const byTruck = new Map(scopes.map((s) => [s.truckId, s]));
  return events.filter((event) => {
    const truckId = event.attribution.truckId;
    // An event attributed to no truck belongs to the carrier that received it,
    // and is never shown to a dispatch workspace: there is no share to hang it
    // on and no way for the viewer to know what it is about.
    if (!truckId) return !isDispatchWorkspace(ctx) && !isDriverMembership(ctx);
    const scope = byTruck.get(truckId);
    if (!scope) return false;
    const allowed = permittedClasses(ctx, scope);
    if (!allowed.has(SIGNAL_CLASS_OF[event.kind])) return false;
    if (event.kind === "hos_summary") {
      return mayReadHosOf(ctx, event.attribution.driverProfileId);
    }
    return true;
  }).map((event) => redactEvent(ctx, event));
}

/**
 * Strip an event down to what this caller may hold.
 *
 * The event itself is never modified — this returns a copy. The store is
 * append-only, and a redaction that mutated a row would make one viewer's
 * permissions permanently change what everybody else sees.
 */
function redactEvent(ctx: ServiceContext, event: TelemetryEvent): TelemetryEvent {
  if (event.value.kind !== "location" || mayReadPrecise(ctx)) return { ...event };
  return {
    ...event,
    value: {
      kind: "location",
      // Reduced to the geocode the provider supplied. Zeroed coordinates would
      // read as a position; absent ones would read as a provider that sent
      // nothing. Neither is true, so neither is used — the value that survives
      // is the city, which is the part an operator needs anyway.
      latitude: 0,
      longitude: 0,
      city: event.value.city,
      state: event.value.state,
      description: event.value.description,
    },
    accuracyMeters: undefined,
    ingestionNote: [
      event.ingestionNote,
      "Exact coordinates are withheld: this membership does not hold eld:location:precise:view.",
    ].filter(Boolean).join(" "),
  };
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

function connectionFor(organizationId: string, connectionId: string): EldConnection | undefined {
  return listConnections(organizationId).find((c) => c.id === connectionId);
}

/**
 * A connection as a screen may hold it: its DERIVED state, not its stored one.
 *
 * The stored value is what the link last recorded about itself, and a link that
 * went quiet at four in the morning did not update itself to say so. Returning
 * the raw value would put a row reading "Connected" next to a dashboard count
 * that says "offline", which is precisely the disagreement this module exists
 * to prevent — so the raw value never leaves this file.
 */
function liveConnection(connection: EldConnection): EldConnection {
  const derived = deriveConnectionState(connection, Date.now());
  return { ...connection, state: derived.state, stateReason: derived.reason };
}

function deviceViews(ctx: ServiceContext, scopes: readonly TruckScope[]): EldDeviceView[] {
  // A dispatch workspace holds no devices. It was shared a truck's telemetry,
  // not a carrier's hardware inventory, and listing the units would say who the
  // carrier buys from and how many it runs.
  if (isDispatchWorkspace(ctx)) return [];

  // Every device view carries the unit number of the truck it is bound to, so
  // a device list is a fleet list with extra steps. `eld:view` on its own is
  // not a way around `trucks:view`.
  if (!ctx.permissions.has("trucks:view")) return [];

  const connections = listConnections(ctx.organizationId);
  const scopeIds = new Set(scopes.map((s) => s.truckId));
  const sinceIso = new Date(Date.now() - 24 * HOUR_MS).toISOString();

  return listDevices(ctx.organizationId)
    .map((device) => {
      const connection = connections.find((c) => c.id === device.connectionId);
      const vehicleBinding = listVehicleBindings(ctx.organizationId, device.id)
        .find((b) => !b.effectiveTo);
      const driverBinding = listDriverBindings(ctx.organizationId, device.id)
        .find((b) => !b.effectiveTo);
      const state = deviceStateOf(device, connection);
      // Every signal, not only the accepted ones. A device that is bound to
      // nothing produces exclusively flagged rows, and counting only accepted
      // ones would make the busiest misconfigured unit on the account read as
      // silent — which is the opposite of what somebody needs to see.
      const recent = listEvents(ctx.organizationId, {
        deviceId: device.id, sinceIso, limit: 1000,
      });
      // Who is bound to a device is an assignment fact, not an hours-of-service
      // one, so it is gated on `drivers:view` rather than on `eld:hos:view`.
      // A driver membership sees itself and nobody else — including the person
      // who had this device last week.
      const mayNameDriver = Boolean(driverBinding) && (
        isDriverMembership(ctx)
          ? driverBinding!.driverProfileId === ctx.driverProfileId
          : ctx.permissions.has("drivers:view")
      );
      return {
        device: { ...device, state: state.state, stateReason: state.reason },
        providerName: providerName(device.providerId),
        connectionLabel: connection?.label ?? "Unknown connection",
        connectionState: state.state,
        connectionTransport: connection?.transport ?? "poll",
        vehicleBinding,
        truckUnit: vehicleBinding?.truckUnitSnapshot,
        driverBinding: mayNameDriver ? driverBinding : undefined,
        driverName: mayNameDriver ? driverBinding!.driverNameSnapshot : undefined,
        lastEventAt: device.lastEventAt,
        eventsLast24h: recent.length,
      } satisfies EldDeviceView;
    })
    // A driver sees devices on the truck they are actually on. An unbound
    // device in a drawer is the carrier's business, not theirs.
    .filter((view) => {
      if (!isDriverMembership(ctx)) return true;
      return Boolean(view.vehicleBinding && scopeIds.has(view.vehicleBinding.truckId));
    });
}

function snapshotFor(
  ctx: ServiceContext, scope: TruckScope,
): EquipmentTelemetrySnapshot {
  const allowed = permittedClasses(ctx, scope);
  const owner = scope.ownerOrganizationId;
  const events = listEvents(owner, { truckId: scope.truckId, limit: 2000 });

  // A truck can legitimately carry more than one device — a gateway on the
  // diagnostic port and a driver app that also reports mileage. The card names
  // the one actually reporting, so a nightly-import unit does not make a truck
  // read as stale while its live gateway is posting every few minutes.
  const devices = listDevices(owner);
  const liveBindings = listVehicleBindings(owner)
    .filter((b) => b.truckId === scope.truckId && !b.effectiveTo);
  const binding = liveBindings
    .map((b) => ({ binding: b, device: devices.find((d) => d.id === b.deviceId) }))
    .sort((a, b) => (b.device?.lastEventAt ?? "").localeCompare(a.device?.lastEventAt ?? ""))[0]
    ?.binding;
  const device = binding ? devices.find((d) => d.id === binding.deviceId) : undefined;
  const connection = device ? connectionFor(owner, device.connectionId) : undefined;
  const driverBinding = device
    ? listDriverBindings(owner, device.id).find((b) => !b.effectiveTo)
    : undefined;


  const mayHos = allowed.has("hos") && mayReadHosOf(ctx, driverBinding?.driverProfileId);
  // A dispatch workspace is never told who is driving. It was shared where the
  // truck is; a person's name is not part of that and was never granted.
  const namesAllowed = !isDispatchWorkspace(ctx);

  const snapshot = buildSnapshot({
    organizationId: ctx.organizationId,
    truckId: scope.truckId,
    truckUnit: scope.unit,
    events: allowed.has("position") || allowed.has("meters") || allowed.has("diagnostics")
      || allowed.has("hos")
      ? events.filter((e) => allowed.has(SIGNAL_CLASS_OF[e.kind]))
      : [],
    deviceId: namesAllowed ? device?.id : undefined,
    deviceSerial: namesAllowed ? device?.serialNumber : undefined,
    connectionState: device && connection
      ? deviceStateOf(device, connection).state
      : "offline",
    freshnessExpectationMinutes: connection?.freshnessExpectationMinutes ?? 60,
    driverProfileId: namesAllowed ? driverBinding?.driverProfileId : undefined,
    driverName: namesAllowed ? driverBinding?.driverNameSnapshot : undefined,
    providerNameOf: providerName,
    includeHos: mayHos,
    includeDiagnostics: allowed.has("diagnostics"),
    includePreciseLocation: mayReadPrecise(ctx),
    nowMs: Date.now(),
  });
  if (!namesAllowed && device) snapshot.deviceWithheld = true;
  return snapshot;
}

function emptyCounts(): EldConnectionCounts {
  return {
    connected: 0, syncing: 0, stale: 0, offline: 0,
    disconnected: 0, error: 0, unsupported: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockEldService: EldService = {
  async dashboard(ctx) {
    must(ctx, "eld:view");
    await wait();
    const scopes = truckScopes(ctx);
    const connections = isDispatchWorkspace(ctx)
      ? []
      : listConnections(ctx.organizationId).map(liveConnection);
    const devices = deviceViews(ctx, scopes);
    const snapshots = scopes.map((s) => snapshotFor(ctx, s));

    const counts = emptyCounts();
    for (const connection of connections) counts[connection.state] += 1;

    // Counted for every workspace, including a dispatch one: it can read the
    // shared trucks' signal stream, and a dashboard reporting zero next to a
    // stream full of rows is the disagreement this module exists to prevent.
    const sinceIso = new Date(Date.now() - 24 * HOUR_MS).toISOString();
    const recent = isDispatchWorkspace(ctx)
      ? scopes.flatMap((scope) => visibleEvents(
        ctx,
        listEvents(scope.ownerOrganizationId, { sinceIso, truckId: scope.truckId, limit: 5000 }),
        [scope],
      ))
      : visibleEvents(ctx, listEvents(ctx.organizationId, { sinceIso, limit: 5000 }), scopes);

    const boundTrucks = new Set(
      devices.map((d) => d.vehicleBinding?.truckId).filter(Boolean) as string[],
    );

    const dashboard: EldDashboard = {
      organizationId: ctx.organizationId,
      generatedAt: new Date().toISOString(),
      summary: {
        devices: devices.length,
        connections: connections.length,
        connectionCounts: counts,
        unboundDevices: devices.filter((d) => !d.vehicleBinding).length,
        trucksWithoutDevice: scopes.filter((s) => !boundTrucks.has(s.truckId)).length,
        eventsLast24h: recent.filter((e) => e.ingestion === "accepted").length,
        flaggedLast24h: recent.filter((e) => e.ingestion === "flagged").length,
        rejectedLast24h: recent.filter((e) => e.ingestion === "rejected").length,
        staleSnapshots: snapshots.filter(snapshotIsStale).length,
        activeCriticalDiagnostics: snapshots.reduce(
          (n, s) => n + s.diagnostics.filter((d) => d.severity === "critical").length, 0,
        ),
      },
      connections,
      devices,
      snapshots,
      publishedSignals: await this.signals(ctx, 60),
      providers: [...MOCK_ELD_PROVIDERS],
      allProvidersAreMock: true,
    };
    return dashboard;
  },

  async providers(ctx) {
    must(ctx, "eld:view");
    await wait(40);
    return [...MOCK_ELD_PROVIDERS] as EldProvider[];
  },

  async connections(ctx) {
    must(ctx, "eld:view");
    await wait(40);
    // Deliberately empty for a dispatch workspace: it holds no links of its own,
    // and a carrier's provider accounts are not part of any share.
    if (isDispatchWorkspace(ctx)) return [];
    return listConnections(ctx.organizationId).map(liveConnection);
  },

  async devices(ctx) {
    must(ctx, "eld:view");
    await wait();
    return deviceViews(ctx, truckScopes(ctx));
  },

  async device(ctx, deviceId) {
    must(ctx, "eld:view");
    await wait();
    const scopes = truckScopes(ctx);
    const view = deviceViews(ctx, scopes).find((d) => d.device.id === deviceId);
    // Unknown and forbidden are the same answer. Anything else turns this id
    // field into a directory of other carriers' hardware.
    if (!view) throw new NotFoundError("Device");

    const vehicleBindings = listVehicleBindings(ctx.organizationId, deviceId);
    // The device's driver history, narrowed the same way the live binding is:
    // a driver membership gets its own intervals and nobody else's, and a
    // membership without `drivers:view` gets none at all.
    const driverBindings = isDriverMembership(ctx)
      ? listDriverBindings(ctx.organizationId, deviceId)
        .filter((b) => b.driverProfileId === ctx.driverProfileId)
      : ctx.permissions.has("drivers:view")
        ? listDriverBindings(ctx.organizationId, deviceId)
        : [];

    const bindingIds = [...vehicleBindings, ...driverBindings].map((b) => b.id);
    const recentEvents = visibleEvents(
      ctx, listEvents(ctx.organizationId, { deviceId, limit: 120 }), scopes,
    );
    const scope = view.vehicleBinding
      ? scopes.find((s) => s.truckId === view.vehicleBinding!.truckId)
      : undefined;

    const detail: EldDeviceDetail = {
      view,
      vehicleBindings,
      driverBindings,
      bindingHistory: listBindingHistory(ctx.organizationId, bindingIds),
      recentEvents,
      snapshot: scope ? snapshotFor(ctx, scope) : undefined,
    };
    return detail;
  },

  async snapshots(ctx) {
    must(ctx, "eld:view");
    await wait();
    return (truckScopes(ctx)).map((s) => snapshotFor(ctx, s));
  },

  async snapshot(ctx, truckId) {
    must(ctx, "eld:view");
    await wait();
    const scope = (truckScopes(ctx)).find((s) => s.truckId === truckId);
    if (!scope) throw new NotFoundError("Equipment telemetry");
    return snapshotFor(ctx, scope);
  },

  async events(ctx, query: EldEventQuery = {}) {
    must(ctx, "eld:view");
    await wait(80);
    const scopes = truckScopes(ctx);
    if (isDispatchWorkspace(ctx)) {
      // Read each owner's partition separately, and only for the trucks that
      // owner actually shared. There is no query that crosses the two.
      const out: TelemetryEvent[] = [];
      for (const scope of scopes) {
        out.push(...visibleEvents(
          ctx,
          listEvents(scope.ownerOrganizationId, { ...query, truckId: scope.truckId }),
          [scope],
        ));
      }
      return out
        .sort((a, b) => b.sourceAt.localeCompare(a.sourceAt))
        .slice(0, query.limit ?? 200);
    }
    return visibleEvents(ctx, listEvents(ctx.organizationId, query), scopes);
  },

  async rawPayloads(ctx, limit = 50) {
    // The raw payloads are the evidence, and they are not redacted — a position
    // inside one is as precise as the provider sent it. So they need their own
    // key, and a dispatch workspace never sees them at all.
    must(ctx, "eld:view", "eld:raw:view");
    await wait(60);
    if (isDispatchWorkspace(ctx) || isDriverMembership(ctx)) return [];
    return listRawPayloads(ctx.organizationId, limit);
  },

  async rawPayload(ctx, rawPayloadId) {
    must(ctx, "eld:view", "eld:raw:view");
    await wait(60);
    if (isDispatchWorkspace(ctx) || isDriverMembership(ctx)) {
      throw new NotFoundError("Provider payload");
    }
    const row = findRawPayload(ctx.organizationId, rawPayloadId);
    if (!row) throw new NotFoundError("Provider payload");
    return row satisfies EldRawPayload;
  },

  async signals(ctx, limit = 100) {
    must(ctx, "eld:view");
    await wait(60);
    const scopes = truckScopes(ctx);
    const byTruck = new Map(scopes.map((s) => [s.truckId, s]));
    const partitions = isDispatchWorkspace(ctx)
      ? [...new Set(scopes.map((s) => s.ownerOrganizationId))]
      : [ctx.organizationId];

    const out: EldPublishedSignal[] = [];
    for (const partition of partitions) {
      for (const signal of listSignals(partition, 1000)) {
        const truckId = signal.attribution.truckId;
        if (!truckId) {
          if (isDispatchWorkspace(ctx) || isDriverMembership(ctx)) continue;
          out.push(signal);
          continue;
        }
        const scope = byTruck.get(truckId);
        if (!scope) continue;
        const allowed = permittedClasses(ctx, scope);
        if (signal.target === "hos") {
          if (!allowed.has("hos")) continue;
          if (!mayReadHosOf(ctx, signal.attribution.driverProfileId)) continue;
        }
        if (signal.operation === "maintenance.diagnostic_reported" && !allowed.has("diagnostics")) {
          continue;
        }
        out.push(signal);
      }
    }
    return out
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  },

  /* ---- Writes ---------------------------------------------------------- */

  async connect(ctx, input: ConnectProviderInput) {
    must(ctx, "eld:view", "eld:devices:manage");
    await wait();
    const provider = findProvider(input.providerId);
    if (!provider) throw new NotFoundError("Provider");
    if (!provider.transports.includes(input.transport)) {
      throw new Error(
        `${provider.name} does not deliver over ${input.transport}. `
        + `It supports: ${provider.transports.join(", ")}.`,
      );
    }
    // A link asked for something its provider cannot give is `unsupported`, not
    // broken — and it says which signals, rather than leaving somebody to work
    // out why a column is empty.
    const unsupported = (input.requestedSignals ?? []).filter(
      (kind) => !providerSupports(input.providerId, kind),
    );
    const connection = registerConnection({
      organizationId: ctx.organizationId,
      providerId: input.providerId,
      label: input.label,
      transport: input.transport,
      freshnessExpectationMinutes: input.freshnessExpectationMinutes,
      unsupportedSignals: unsupported.length ? unsupported : undefined,
    });
    return connection;
  },

  async disconnect(ctx, connectionId, reason) {
    must(ctx, "eld:view", "eld:devices:manage");
    await wait();
    const connection = disconnectConnection(connectionId, ctx.organizationId, reason);
    if (!connection) throw new NotFoundError("Connection");
    return connection;
  },

  async registerDevice(ctx, input: RegisterDeviceInput) {
    must(ctx, "eld:view", "eld:devices:manage");
    await wait();
    const device = registerDevice({ organizationId: ctx.organizationId, ...input });
    const view = deviceViews(ctx, truckScopes(ctx)).find((d) => d.device.id === device.id);
    if (!view) throw new NotFoundError("Device");
    return view;
  },

  async retireDevice(ctx, deviceId) {
    must(ctx, "eld:view", "eld:devices:manage");
    await wait();
    const device = retireDevice(deviceId, ctx.organizationId, {
      membershipId: ctx.membershipId, name: ctx.actor.displayNameSnapshot,
    });
    if (!device) throw new NotFoundError("Device");
    const view = deviceViews(ctx, truckScopes(ctx)).find((d) => d.device.id === deviceId);
    if (!view) throw new NotFoundError("Device");
    return view;
  },

  async bindDeviceToTruck(ctx, input: BindDeviceInput) {
    must(ctx, "eld:view", "eld:bindings:manage");
    await wait();
    // The unit label is read from the fleet layer and SNAPSHOTTED onto the
    // binding, so a truck renamed next year does not silently relabel every
    // event this binding has ever explained.
    const scope = (truckScopes(ctx)).find((s) => s.truckId === input.truckId);
    if (!scope) throw new NotFoundError("Truck");
    return bindDeviceToTruck({
      organizationId: ctx.organizationId,
      deviceId: input.deviceId,
      truckId: input.truckId,
      truckUnit: scope.unit,
      effectiveFrom: input.effectiveFrom,
      note: input.note,
    }, { membershipId: ctx.membershipId, name: ctx.actor.displayNameSnapshot });
  },

  async endVehicleBinding(ctx, bindingId, reason: EldBindingEndReason) {
    must(ctx, "eld:view", "eld:bindings:manage");
    await wait();
    const binding = endVehicleBinding(bindingId, ctx.organizationId, reason, {
      membershipId: ctx.membershipId, name: ctx.actor.displayNameSnapshot,
    });
    if (!binding) throw new NotFoundError("Binding");
    return binding satisfies EldVehicleBinding;
  },

  async bindDriverToDevice(ctx, input: BindDriverInput) {
    must(ctx, "eld:view", "eld:bindings:manage", "drivers:view");
    await wait();
    // The driver registry decides which people this workspace may see at all,
    // and the name is SNAPSHOTTED onto the binding from it — so a driver who
    // later leaves the carrier does not become an unreadable id on every event
    // they ever produced.
    const driver = driversForWorkspaceSync(truckContextFrom(ctx))
      .find((d) => d.driverProfileId === input.driverProfileId);
    if (!driver) throw new NotFoundError("Driver");
    return bindDriverToDevice({
      organizationId: ctx.organizationId,
      deviceId: input.deviceId,
      driverProfileId: input.driverProfileId,
      driverName: driver.legalName,
      effectiveFrom: input.effectiveFrom,
      note: input.note,
    }, { membershipId: ctx.membershipId, name: ctx.actor.displayNameSnapshot });
  },

  async endDriverBinding(ctx, bindingId, reason: EldBindingEndReason) {
    must(ctx, "eld:view", "eld:bindings:manage");
    await wait();
    const binding = endDriverBinding(bindingId, ctx.organizationId, reason, {
      membershipId: ctx.membershipId, name: ctx.actor.displayNameSnapshot,
    });
    if (!binding) throw new NotFoundError("Binding");
    return binding satisfies EldDriverBinding;
  },

  async ingest(ctx, input: IngestDeliveryInput) {
    must(ctx, "eld:view", "eld:ingest");
    await wait(120);
    const result = ingestDelivery({
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      connectionId: input.connectionId,
      transport: input.transport,
      body: input.body,
      externalId: input.externalId,
      secret: input.secret,
    });
    const out: EldIngestionResult = {
      rawPayloadId: result.raw.id,
      organizationId: ctx.organizationId,
      connectionId: input.connectionId,
      receivedAt: result.raw.receivedAt,
      accepted: result.events.filter((e) => e.ingestion === "accepted").length,
      flagged: result.events.filter((e) => e.ingestion === "flagged").length,
      rejected: result.outcomes.filter((o) => o.state === "rejected").length,
      outcomes: result.outcomes,
      published: result.published,
      deliveryRejectedReason: result.deliveryRejectedReason,
    };
    return out;
  },

  /* ---- Sharing --------------------------------------------------------- */

  async shares(ctx) {
    must(ctx, "eld:view");
    await wait(40);
    return isDispatchWorkspace(ctx)
      ? listShares({ viewerOrganizationId: ctx.organizationId })
      : listShares({ ownerOrganizationId: ctx.organizationId });
  },

  async grantShare(ctx, input: GrantShareInput) {
    // Only a carrier can share its own telemetry, and only for a truck it can
    // actually see. A dispatch workspace cannot re-share what it was given.
    must(ctx, "eld:view", "eld:devices:manage");
    if (isDispatchWorkspace(ctx)) {
      throw new PermissionDeniedError(["eld:devices:manage"]);
    }
    await wait();
    const scope = (truckScopes(ctx)).find((s) => s.truckId === input.truckId);
    if (!scope) throw new NotFoundError("Truck");
    return grantShare({
      ownerOrganizationId: ctx.organizationId,
      viewerOrganizationId: input.viewerOrganizationId,
      truckId: input.truckId,
      signalClasses: input.signalClasses,
      grantedByMembershipId: ctx.membershipId,
      note: input.note,
    }) satisfies EldShare;
  },

  async revokeShare(ctx, shareId) {
    must(ctx, "eld:view", "eld:devices:manage");
    await wait();
    const share = revokeShare(shareId, ctx.organizationId);
    if (!share) throw new NotFoundError("Share");
    return share;
  },

  async needsYou(ctx) {
    must(ctx, "eld:view");
    await wait(60);
    return deriveNeedsYou(ctx);
  },
};

/**
 * Two honest sources disagreeing about one truck's odometer.
 *
 * Genuinely common: a tractor with a gateway on the diagnostic port and a
 * driver app that also reports mileage will drift apart, and after a device
 * swap they can be hundreds of miles apart. Antcolos does not pick a winner —
 * it says they disagree, keeps both, and leaves the decision to the person who
 * knows which device was actually on the truck.
 */
function odometerConflicts(ctx: ServiceContext, scopes: readonly TruckScope[]): OdometerConflict[] {
  const out: OdometerConflict[] = [];
  for (const scope of scopes) {
    if (!permittedClasses(ctx, scope).has("meters")) continue;
    const events = listEvents(scope.ownerOrganizationId, {
      truckId: scope.truckId, kinds: ["odometer"], ingestion: ["accepted"], limit: 2000,
    });
    // The newest accepted reading from each device, so two devices are compared
    // at their best rather than one device compared against its own history.
    const newestPerDevice = new Map<string, typeof events[number]>();
    for (const event of events) {
      const current = newestPerDevice.get(event.deviceId);
      if (!current || event.sourceAt > current.sourceAt) newestPerDevice.set(event.deviceId, event);
    }
    if (newestPerDevice.size < 2) continue;

    const devices = listDevices(scope.ownerOrganizationId);
    const readings = [...newestPerDevice.values()]
      .filter((e) => e.value.kind === "odometer")
      .map((e) => ({
        deviceId: e.deviceId,
        deviceSerial: devices.find((d) => d.id === e.deviceId)?.serialNumber ?? e.deviceId,
        providerName: providerName(e.providerId),
        miles: e.value.kind === "odometer" ? e.value.miles : 0,
        sourceAt: e.sourceAt,
      }));
    if (readings.length < 2) continue;

    const miles = readings.map((r) => r.miles);
    const difference = Math.max(...miles) - Math.min(...miles);
    if (difference < ODOMETER_CONFLICT_MILES) continue;
    out.push({
      truckId: scope.truckId,
      truckUnit: scope.unit,
      readings: readings.sort((a, b) => b.miles - a.miles),
      differenceMiles: difference,
    });
  }
  return out;
}

function deriveNeedsYou(ctx: ServiceContext): NeedsYouItem[] {
  const scopes = truckScopes(ctx);
  return eldNeedsYouItems({
    organizationId: ctx.organizationId,
    devices: deviceViews(ctx, scopes),
    connections: isDispatchWorkspace(ctx)
      ? []
      : listConnections(ctx.organizationId).map(liveConnection),
    snapshots: scopes.map((s) => snapshotFor(ctx, s)),
    odometerConflicts: odometerConflicts(ctx, scopes),
    visibleTruckIds: new Set(scopes.map((s) => s.truckId)),
  });
}

/**
 * The exceptions this module contributes to the Needs You queue, for the queue
 * itself to fold in. Kept separate from the service method so the queue can
 * call it without paying the simulated latency on every read.
 *
 * Failing silently is deliberate and matches the fleet bridge: a telemetry rule
 * that cannot run is not a reason to withhold somebody's whole queue, and the
 * same exceptions are still on the ELD dashboard in full.
 */
export async function eldNeedsYouFor(ctx: ServiceContext): Promise<NeedsYouItem[]> {
  if (!ctx.permissions.has("eld:view")) return [];
  try {
    return deriveNeedsYou(ctx);
  } catch {
    return [];
  }
}

/** Exposed for the Needs You bridge and for tests. Never called by a screen. */
export function eldScopesFor(ctx: ServiceContext) {
  return truckScopes(ctx);
}

export type { EldConnectionState, EldDeviceView, EldVehicleBinding, TelemetrySignalKind };

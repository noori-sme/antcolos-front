"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { maintenanceKeys } from "@/lib/query/keys";
import { useCan } from "@/lib/session/hooks";
import type {
  CompleteTaskInput, MaintenanceTaskFilters, ReadingInput, ScheduleInput,
} from "@/types/maintenance-live";

type Ctx = NonNullable<ReturnType<typeof useServiceContext>>;

/** A truck's maintenance; only fetched for a caller who may read it. */
export function useTruckMaintenance(truckId: string) {
  const ctx = useServiceContext();
  const allowed = useCan("maintenance:view");
  return useQuery({
    queryKey: ctx ? maintenanceKeys.truck(ctx.organizationId, truckId) : ["maintenance", "no-context"],
    queryFn: () => services.maintenance.forTruck(ctx!, truckId),
    enabled: Boolean(ctx) && Boolean(truckId) && allowed,
  });
}

export function useMaintenanceTasks(filters: MaintenanceTaskFilters) {
  const ctx = useServiceContext();
  const allowed = useCan("maintenance:view");
  return useQuery({
    queryKey: ctx ? maintenanceKeys.tasks(ctx.organizationId, filters) : ["maintenance", "no-context"],
    queryFn: () => services.maintenance.listTasks(ctx!, filters),
    enabled: Boolean(ctx) && allowed,
    placeholderData: keepPreviousData,
  });
}

/** The driver's current truck; `null` data when they drive no truck here. */
export function useMyTruckMaintenance() {
  const ctx = useServiceContext();
  const allowed = useCan("maintenance:own:view");
  return useQuery({
    queryKey: ctx ? maintenanceKeys.mine(ctx.organizationId) : ["maintenance", "no-context"],
    queryFn: () => services.maintenance.myTruck(ctx!),
    enabled: Boolean(ctx) && allowed,
  });
}

/**
 * Every maintenance write refreshes the truck's maintenance, the fleet task
 * list and the driver's own view: a reading or a completion moves all three.
 */
function useMaintenanceMutation<TVars, TResult>(
  run: (ctx: Ctx, vars: TVars) => Promise<TResult>,
  truckId?: string,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSuccess: async () => {
      if (!ctx) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: truckId
            ? maintenanceKeys.truck(ctx.organizationId, truckId)
            : maintenanceKeys.trucksAll(ctx.organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: maintenanceKeys.tasksAll(ctx.organizationId) }),
        queryClient.invalidateQueries({ queryKey: maintenanceKeys.mine(ctx.organizationId) }),
      ]);
    },
  });
}

export function useCreateSchedule(truckId: string) {
  return useMaintenanceMutation(
    (ctx, vars: { input: ScheduleInput; idempotencyKey: string }) =>
      services.maintenance.createSchedule(ctx, truckId, vars.input, vars.idempotencyKey),
    truckId,
  );
}

export function useUpdateSchedule(truckId: string) {
  return useMaintenanceMutation(
    (ctx, vars: { scheduleId: string; input: ScheduleInput }) =>
      services.maintenance.updateSchedule(ctx, vars.scheduleId, vars.input),
    truckId,
  );
}

export function useArchiveSchedule(truckId: string) {
  return useMaintenanceMutation(
    (ctx, vars: { scheduleId: string; idempotencyKey: string }) =>
      services.maintenance.archiveSchedule(ctx, vars.scheduleId, vars.idempotencyKey),
    truckId,
  );
}

export function useRecordReading(truckId: string) {
  return useMaintenanceMutation(
    (ctx, vars: { input: ReadingInput; idempotencyKey: string }) =>
      services.maintenance.recordReading(ctx, truckId, vars.input, vars.idempotencyKey),
    truckId,
  );
}

/** Task actions; `truckId` when known (the profile), else every truck's maintenance refreshes. */
export function useAcknowledgeTask(truckId?: string) {
  return useMaintenanceMutation(
    (ctx, vars: { taskId: string; idempotencyKey: string }) =>
      services.maintenance.acknowledgeTask(ctx, vars.taskId, vars.idempotencyKey),
    truckId,
  );
}

export function useDeferTask(truckId?: string) {
  return useMaintenanceMutation(
    (ctx, vars: { taskId: string; reason: string; deferredUntil: string; idempotencyKey: string }) =>
      services.maintenance.deferTask(
        ctx, vars.taskId, { reason: vars.reason, deferredUntil: vars.deferredUntil }, vars.idempotencyKey,
      ),
    truckId,
  );
}

export function useCompleteTask(truckId?: string) {
  return useMaintenanceMutation(
    (ctx, vars: { taskId: string; input: CompleteTaskInput; idempotencyKey: string }) =>
      services.maintenance.completeTask(ctx, vars.taskId, vars.input, vars.idempotencyKey),
    truckId,
  );
}

export function useRecordMyReading() {
  return useMaintenanceMutation((ctx, vars: { input: ReadingInput; idempotencyKey: string }) =>
    services.maintenance.recordMyReading(ctx, vars.input, vars.idempotencyKey),
  );
}

export function useAcknowledgeMyTask() {
  return useMaintenanceMutation((ctx, vars: { taskId: string; idempotencyKey: string }) =>
    services.maintenance.acknowledgeMyTask(ctx, vars.taskId, vars.idempotencyKey),
  );
}

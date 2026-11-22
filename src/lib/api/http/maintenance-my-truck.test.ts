import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../client", () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));

import { httpMaintenanceService } from "./maintenance";

const ctx = { organizationId: "org-1" } as never;

describe("myTruck", () => {
  beforeEach(() => get.mockReset());

  it("is null when the caller drives no truck here", async () => {
    get.mockResolvedValue({ status: 404, data: { error: "NO_CURRENT_TRUCK", message: "You are not the current driver of a truck here" } });
    await expect(httpMaintenanceService.myTruck(ctx)).resolves.toBeNull();
  });

  it("is an error for any other 404", async () => {
    get.mockResolvedValue({ status: 404, data: { message: "Cannot GET /api/v1/maintenance/my-truck" } });
    await expect(httpMaintenanceService.myTruck(ctx)).rejects.toThrow(/Cannot GET/);
  });

  it("maps the truck otherwise", async () => {
    get.mockResolvedValue({ status: 200, data: { truckId: "t-1", unitNumber: "104", latestReading: {}, schedules: [], openTasks: [] } });
    await expect(httpMaintenanceService.myTruck(ctx)).resolves.toMatchObject({ truckId: "t-1", unitNumber: "104" });
  });
});

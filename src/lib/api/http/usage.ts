import { apiClient } from "../client";
import type { UsageService } from "../contracts/usage";
import { type Dto, num, obj, objects, str, strings } from "./dto";
import type { OrganizationUsage, UsageReport } from "@/types/usage";

const n = (v: unknown) => num(v) ?? 0;

function toUsage(dto: Dto | undefined): OrganizationUsage {
  const ai = obj(dto?.ai);
  const storage = obj(dto?.storage);
  const email = obj(dto?.email);
  const telegram = obj(dto?.telegram);
  return {
    ai: { calls: n(ai?.calls), inputTokens: n(ai?.inputTokens), outputTokens: n(ai?.outputTokens), costUsd: n(ai?.costUsd) },
    storage: { files: n(storage?.files), bytes: n(storage?.bytes), estimatedMonthlyUsd: n(storage?.estimatedMonthlyUsd) },
    email: { sent: n(email?.sent), failed: n(email?.failed), estimatedUsd: n(email?.estimatedUsd) },
    telegram: { sent: n(telegram?.sent), failed: n(telegram?.failed) },
    estimatedTotalUsd: n(dto?.estimatedTotalUsd),
  };
}

/** Contract §Report → `UsageReport`; the organization route's totals are its own usage. */
export function toUsageReport(body: unknown): UsageReport {
  const dto = obj(body) ?? {};
  const rates = obj(dto.rates);
  return {
    from: str(dto.from) ?? "",
    to: str(dto.to) ?? "",
    rates: { storageUsdPerGbMonth: n(rates?.storageUsdPerGbMonth), emailUsdPerMessage: n(rates?.emailUsdPerMessage) },
    totals: toUsage(obj(dto.totals)),
    aiDaily: objects(dto.aiDaily).map((d) => ({ day: str(d.day) ?? "", calls: n(d.calls), costUsd: n(d.costUsd) })),
    notMetered: strings(dto.notMetered),
  };
}

export const httpUsageService: UsageService = {
  async organization(_ctx, range) {
    const res = await apiClient.get("/organizations/usage", { params: range });
    return toUsageReport(res.data);
  },
};

/** Usage and estimated costs (backend plan 49, usage-api-contract.md). */
export interface OrganizationUsage {
  ai: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  storage: { files: number; bytes: number; estimatedMonthlyUsd: number };
  email: { sent: number; failed: number; estimatedUsd: number };
  telegram: { sent: number; failed: number };
  estimatedTotalUsd: number;
}

export interface UsageReport {
  from: string;
  to: string;
  rates: { storageUsdPerGbMonth: number; emailUsdPerMessage: number };
  totals: OrganizationUsage;
  aiDaily: { day: string; calls: number; costUsd: number }[];
  notMetered: string[];
}

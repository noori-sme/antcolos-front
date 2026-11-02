import type { Paginated } from "@/types/common";

/**
 * Helpers for reading raw API JSON in the http adapters. Every field is checked
 * before it is trusted; nothing is cast.
 */
export type Dto = Record<string, unknown>;

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const nullableStr = (v: unknown): string | null | undefined =>
  v === null ? null : str(v);

export const obj = (v: unknown): Dto | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Dto) : undefined;

/** The object items of an array field, skipping anything else. */
export const objects = (v: unknown): Dto[] =>
  Array.isArray(v) ? v.map(obj).filter((o): o is Dto => Boolean(o)) : [];

/** The string items of an array field, skipping anything else. */
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length > 0) : [];

/** An enum value the contract lists, or undefined. Never a cast. */
export function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** `{ data, meta }` → `Paginated<T>`, with safe defaults for a missing meta. */
export function toPage<T>(body: unknown, toItem: (dto: Dto) => T): Paginated<T> {
  const root = obj(body) ?? {};
  const data = objects(root.data).map(toItem);
  const meta = obj(root.meta) ?? {};
  return {
    data,
    meta: {
      page: num(meta.page) ?? 1,
      pageSize: num(meta.pageSize) ?? data.length,
      totalItems: num(meta.totalItems) ?? data.length,
      totalPages: num(meta.totalPages) ?? 1,
    },
  };
}

/** Drop unset values so the API applies its own defaults. */
export function queryParams(
  query: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params[key] = value;
  }
  return params;
}

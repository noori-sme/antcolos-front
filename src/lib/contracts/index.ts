/**
 * The Contracts domain layer.
 *
 * Pure: nothing here reads a store, calls a service or knows what a React
 * component is. The service layer composes these rules; the screens read the
 * labels. The one thing this layer refuses to contain is a function that changes
 * a relationship — see `relationships.ts`.
 */
export * from "./catalog";
export * from "./status";
export * from "./versions";
export * from "./signatures";
export * from "./requirements";
export * from "./terms";
export * from "./relationships";
export * from "./labels";
export * from "./extension-points";

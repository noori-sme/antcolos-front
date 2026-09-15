/**
 * ELD & Telematics — the pure layer.
 *
 * Everything in this folder is a function of its arguments: no store, no clock
 * of its own, no network, no React. The mock registry in `lib/api/mock` holds
 * the data and the service layer holds the permissions; this is the part that
 * can be reasoned about and tested on its own, which is why the rules that
 * matter most — idempotency, timestamp sanity, impossible movement, snapshot
 * derivation, what may be published to whom — all live here.
 */
export * from "./providers";
export * from "./adapters";
export * from "./validation";
export * from "./connection-state";
export * from "./snapshot";
export * from "./signals";
export * from "./mock-console";

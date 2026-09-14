/**
 * The channel-independent Driver Load Decision and Trip Workflow engine.
 *
 * Everything in this folder is pure TypeScript: no React, no fetch, no store,
 * no adapter. The driver dashboard imports it, the service adapter imports it,
 * and the Telegram bot will import exactly the same thing — which is the only
 * way "same commands, same rules, same history" survives contact with a second
 * channel.
 */
export * from "./catalog";
export * from "./commands";
export * from "./errors";
export * from "./policy";
export * from "./proposal-machine";
export * from "./trip-machine";

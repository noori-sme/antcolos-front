/**
 * Which adapters the app resolves to, in its own module so that both the
 * service registry and the integration boundary can read it without importing
 * each other. They otherwise form a cycle: the mock services call the
 * integration ports, and the ports need to know which mode they are in.
 */
export const API_MODE =
  process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

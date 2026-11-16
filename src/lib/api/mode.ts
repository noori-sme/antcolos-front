/**
 * Which adapters the app resolves to, in its own module so that both the
 * service registry and the integration boundary can read it without importing
 * each other. They otherwise form a cycle: the mock services call the
 * integration ports, and the ports need to know which mode they are in.
 */
export const API_MODE =
  process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

/**
 * Demo areas (plan 10): in http mode, the areas with no backend yet still show,
 * running on the in-memory mocks with the Northline demo data and a "Demo
 * data" banner. On by default; set `NEXT_PUBLIC_DEMO_AREAS=off` to hide those
 * areas again (plan 08 behaviour). Build-time, like every NEXT_PUBLIC_ value.
 */
export const DEMO_AREAS =
  API_MODE === "http" && process.env.NEXT_PUBLIC_DEMO_AREAS !== "off";

/**
 * Mock mode, set explicitly (`NEXT_PUBLIC_API_MODE=mock`): the app runs on
 * the in-memory fixtures and is signed in as their demo user, with no backend
 * session. The browser suite runs this way. Unset is not enough, so a build
 * that forgot the variable never skips sign-in. Build-time.
 */
export const SIGNED_IN_AS_DEMO = process.env.NEXT_PUBLIC_API_MODE === "mock";

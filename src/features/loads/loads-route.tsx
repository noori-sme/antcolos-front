import { API_MODE } from "@/lib/api/mode";
import { LiveLoadDetail } from "./live-load-detail";
import { LiveLoadsScreen } from "./live-loads-screen";
import { LoadDetail } from "./load-detail";
import { LoadsScreen } from "./loads-screen";

/**
 * /loads in http mode is the real API (F1.2, plan 14); mock mode keeps the
 * richer mock screens, whose areas (drivers, exceptions) the backend has not
 * built yet. The mode is fixed at build time, so this is a plain choice.
 */
export function LoadsRoute() {
  return API_MODE === "http" ? <LiveLoadsScreen /> : <LoadsScreen />;
}

export function LoadRoute({ loadId }: { loadId: string }) {
  return API_MODE === "http" ? <LiveLoadDetail loadId={loadId} /> : <LoadDetail loadId={loadId} />;
}

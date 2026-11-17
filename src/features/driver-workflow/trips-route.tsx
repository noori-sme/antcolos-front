import { TripScreen } from "./trip-screen";
import { TripsScreen } from "./trips-screen";
import { API_MODE } from "@/lib/api/mode";
import { DriverLoadScreen } from "./live-trip-screen";
import { DriverLoadsScreen } from "./live-trips-screen";

/**
 * /driver/loads in http mode is the real API (F1.4, plan 16); mock mode keeps
 * the mock driver workflow screens. The mode is fixed at build time.
 */
export function DriverLoadsRoute() {
  return API_MODE === "http" ? <DriverLoadsScreen /> : <TripsScreen />;
}

export function DriverLoadRoute({ loadId }: { loadId: string }) {
  return API_MODE === "http" ? <DriverLoadScreen loadId={loadId} /> : <TripScreen loadId={loadId} />;
}

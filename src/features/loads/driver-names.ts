/**
 * Display names for driver records referenced by loads.
 *
 * Temporary: a load carries `assignment.driverId`, and the real backend will
 * either embed a driver summary on the load or expose a batch driver lookup.
 * That choice belongs to Taqi's model, so nothing here guesses at an endpoint.
 */
export const DRIVER_NAMES: Record<string, string> = {
  drv_nl_01: "Dmitri Kovalenko",
  drv_nl_02: "Marisol Ortiz",
  drv_nl_03: "Ray Bell",
  drv_nl_04: "Amir Haddad",
  drv_nl_05: "Tomas Reyes",
  drv_nl_06: "Kelsey Nguyen",
  drv_md_01: "Serge Petrov",
  drv_md_02: "Hannah Boyd",
  drv_md_03: "Luis Carrera",
  drv_md_04: "Grace Lindqvist",
  drv_cascade_0192: "Sam Murtaza",
  drv_cs_02: "Owen Fitz",
};

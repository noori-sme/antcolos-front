/** Fixtures are generated relative to load time so due times stay believable. */
const BASE = Date.now();

export const nowIso = () => new Date().toISOString();
export const hoursFromNow = (h: number) => new Date(BASE + h * 3_600_000).toISOString();
export const daysFromNow = (d: number) => hoursFromNow(d * 24);
export const minutesFromNow = (m: number) => new Date(BASE + m * 60_000).toISOString();

/** "Good morning" / "Good afternoon" / "Good evening" for a 0–23 hour. */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

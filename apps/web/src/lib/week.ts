/** The seven ISO dates ("YYYY-MM-DD") of a vault week period such as "2026-10-05/2026-10-11". */
export function weekDays(period: string): string[] {
  const [start] = period.split("/");
  return Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
}

/** Format an ISO date (as UTC, so the day never shifts). */
export const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`));

/** An ISO date shifted by whole days (as UTC, so the day never shifts). */
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The Sunday that starts the ISO date's calendar week (Sunday to Saturday). */
export function sundayOf(iso: string): string {
  return addDays(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay()); // getUTCDay: 0 = Sunday
}

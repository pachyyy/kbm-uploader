import { format, startOfWeek } from "date-fns";

/**
 * Formats a Date as the yyyy-MM-dd string SIDIA's `tanggal` field expects,
 * using the LOCAL calendar day.
 *
 * Never use toISOString() for this. It converts to UTC first, so for a user
 * in WIB (UTC+7) any date before 07:00 local rolls back to the previous day
 * — which would file the report under the wrong Sunday.
 */
export function toYmd(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * The Sunday that starts `date`'s week — i.e. the most recent Sunday on or
 * before it. On a Sunday this returns that same day, since the class has just
 * happened and is what gets uploaded.
 */
export function sundayOfWeek(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 0 });
}

/** Human-readable form for the picker trigger, e.g. "Sunday, 9 August 2026". */
export function formatLongDate(date: Date): string {
  return format(date, "EEEE, d MMMM yyyy");
}

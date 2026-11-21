// Timestamps are stored as ISO 8601 UTC and shown in Europe/Istanbul.

export const SHOP_TIME_ZONE = "Europe/Istanbul";

const dateTimeFormat = new Intl.DateTimeFormat("tr-TR", {
  timeZone: SHOP_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});
const timeFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: SHOP_TIME_ZONE, timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

/** "YYYY-MM-DD" of the given moment in Istanbul. */
export function istanbulDay(date = new Date()): string {
  return dayFormat.format(date);
}

/** UTC ISO range [start, end) that covers one Istanbul calendar day. */
export function istanbulDayRange(day: string): [string, string] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Geçersiz tarih: ${day}`);
  // Turkey uses UTC+3 all year (no daylight saving time since 2016).
  const start = new Date(`${day}T00:00:00+03:00`);
  if (Number.isNaN(start.getTime())) throw new Error(`Geçersiz tarih: ${day}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

/** "YYYYMMDD-HHmmss" in Istanbul time, for backup file names. */
export function backupStamp(date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

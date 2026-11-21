// Report periods and buckets in Istanbul time. Dates are "YYYY-MM-DD" calendar days in Istanbul.
// Turkey uses UTC+3 all year (no daylight saving time since 2016).

export type PeriodKind = "day" | "week" | "month" | "year";

export interface Period {
  kind: PeriodKind;
  /** First day, inclusive. */
  start: string;
  /** Day after the last day, exclusive. */
  end: string;
  label: string;
}

export interface BucketDef {
  key: string;
  label: string;
}

export const PERIOD_LABELS: Record<PeriodKind, string> = { day: "Gün", week: "Hafta", month: "Ay", year: "Yıl" };

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const OFFSET_MS = 3 * 60 * 60 * 1000;

const isDate = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(Date.parse(`${ymd}T00:00:00Z`));

function parts(ymd: string): [number, number, number] {
  if (!isDate(ymd)) throw new Error(`Geçersiz tarih: ${ymd}`);
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = parts(ymd);
  return fromUtc(new Date(Date.UTC(y, m - 1, d + days)));
}

function addMonths(ymd: string, months: number): string {
  const [y, m] = parts(ymd);
  return fromUtc(new Date(Date.UTC(y, m - 1 + months, 1)));
}

/** 0 = Monday ... 6 = Sunday. */
function weekday(ymd: string): number {
  const [y, m, d] = parts(ymd);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

const dayLabel = (ymd: string) => {
  const [y, m, d] = parts(ymd);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** The day, week (Monday to Sunday), month or year that contains the date. */
export function periodFor(kind: PeriodKind, ymd: string): Period {
  const [y, m] = parts(ymd);
  if (kind === "day") return { kind, start: ymd, end: addDays(ymd, 1), label: dayLabel(ymd) };
  if (kind === "week") {
    const start = addDays(ymd, -weekday(ymd));
    const last = addDays(start, 6);
    return { kind, start, end: addDays(start, 7), label: `${dayLabel(start)} – ${dayLabel(last)}` };
  }
  if (kind === "month") {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    return { kind, start, end: addMonths(start, 1), label: `${MONTHS[m - 1]} ${y}` };
  }
  return { kind, start: `${y}-01-01`, end: `${y + 1}-01-01`, label: String(y) };
}

/** The period just before (step -1) or after (step 1) this one. */
export function shiftPeriod(p: Period, step: -1 | 1): Period {
  return periodFor(p.kind, step < 0 ? addDays(p.start, -1) : p.end);
}

/** UTC ISO time of midnight (00:00) in Istanbul on that day. */
export function istanbulMidnightUtc(ymd: string): string {
  parts(ymd);
  return new Date(`${ymd}T00:00:00+03:00`).toISOString();
}

/** Istanbul local "YYYY-MM-DDTHH" of a UTC ISO timestamp. */
function localStamp(iso: string): string {
  return new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 13);
}

/** Rows of the breakdown table: hours of a day, days of a week or month, months of a year. */
export function bucketsFor(p: Period): BucketDef[] {
  if (p.kind === "day") {
    return Array.from({ length: 24 }, (_, h) => {
      const hh = String(h).padStart(2, "0");
      return { key: hh, label: `${hh}:00` };
    });
  }
  if (p.kind === "year") {
    const y = p.start.slice(0, 4);
    return MONTHS.map((name, i) => ({ key: `${y}-${String(i + 1).padStart(2, "0")}`, label: name }));
  }
  const out: BucketDef[] = [];
  for (let d = p.start; d < p.end; d = addDays(d, 1)) {
    const [, m, day] = parts(d);
    out.push({ key: d, label: p.kind === "week" ? `${WEEKDAYS[weekday(d)]} ${day} ${MONTHS[m - 1]!.slice(0, 3)}` : `${day} ${MONTHS[m - 1]!.slice(0, 3)}` });
  }
  return out;
}

/** The bucket key of a sale time (UTC ISO) in a period of this kind. */
export function bucketKey(kind: PeriodKind, iso: string): string {
  const local = localStamp(iso);
  if (kind === "day") return local.slice(11, 13);
  if (kind === "year") return local.slice(0, 7);
  return local.slice(0, 10);
}

/** Change from the previous value in percent, or null when the previous value is 0. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

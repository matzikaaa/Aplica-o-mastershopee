import type { DateRange, DateRangePreset } from "./types";

/**
 * Resolves a date-range preset into concrete from/to dates, in the given
 * IANA timezone (workspace.timezone — §63). Uses Intl instead of a heavy
 * date library to keep this package dependency-light.
 */
export function resolveDateRange(preset: DateRangePreset, timezone: string, now = new Date()): DateRange {
  const zoned = zonedNow(timezone, now);
  const startOfToday = new Date(zoned);
  startOfToday.setHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return { from: startOfToday, to: endOf(startOfToday) };
    case "yesterday": {
      const from = addDays(startOfToday, -1);
      return { from, to: endOf(from) };
    }
    case "last_7_days":
      return { from: addDays(startOfToday, -6), to: endOf(startOfToday) };
    case "last_30_days":
      return { from: addDays(startOfToday, -29), to: endOf(startOfToday) };
    case "this_month": {
      const from = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
      return { from, to: endOf(startOfToday) };
    }
    case "last_month": {
      const from = new Date(startOfToday.getFullYear(), startOfToday.getMonth() - 1, 1);
      const to = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 0);
      return { from, to: endOf(to) };
    }
    case "all_time":
      // Deliberately a fixed floor rather than "the oldest order in the
      // database": this function is pure and has no data access, and a
      // marketplace seller's history cannot predate the marketplaces.
      return { from: new Date(2000, 0, 1), to: endOf(startOfToday) };
    case "custom":
    default:
      return { from: startOfToday, to: endOf(startOfToday) };
  }
}

/**
 * Returns the immediately preceding period of equal length, for comparison
 * deltas (§48). Returns null for a range that reaches back to the beginning:
 * there is nothing before "everything", and comparing against an empty window
 * would render a meaningless +100%.
 */
export function previousPeriod(range: DateRange): DateRange | null {
  const lengthMs = range.to.getTime() - range.from.getTime();
  if (range.from.getFullYear() <= 2000) return null;
  return {
    from: new Date(range.from.getTime() - lengthMs - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function endOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function zonedNow(timezone: string, now: Date): Date {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => formatted.find((p) => p.type === type)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
}

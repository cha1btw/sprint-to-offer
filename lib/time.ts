// Everything the owner sees is Europe/Kyiv local time (UTC+2 in winter,
// UTC+3 in summer). Plans are built in "minutes since local midnight" and
// stored as UTC instants, so the switch to winter time (25 Oct 2026) and back
// does not shift any block.
export const KYIV_TZ = "Europe/Kyiv";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: KYIV_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

type KyivParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function kyivDateParts(date: Date): KyivParts {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(date).map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

// Offset of Kyiv from UTC at the given instant, in milliseconds.
function kyivOffsetMs(utcMs: number): number {
  const p = kyivDateParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60_000) * 60_000;
}

// Converts a wall-clock time in Kyiv to the UTC instant.
// Returns null for impossible input and for times that do not exist because
// clocks jump forward. For the repeated hour in autumn the later occurrence is returned.
export function kyivLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wanted)) return null;

  let utcMs = wanted - kyivOffsetMs(wanted);
  const adjusted = wanted - kyivOffsetMs(utcMs);
  if (adjusted !== utcMs) utcMs = adjusted;

  const back = kyivDateParts(new Date(utcMs));
  if (
    back.year !== year ||
    back.month !== month ||
    back.day !== day ||
    back.hour !== hour ||
    back.minute !== minute
  ) {
    return null;
  }
  return new Date(utcMs);
}

const pad = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" of the Kyiv calendar day at the given instant.
export function kyivDate(now: Date = new Date()): string {
  const p = kyivDateParts(now);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Minutes since Kyiv midnight at the given instant.
export function kyivMinutes(now: Date = new Date()): number {
  const p = kyivDateParts(now);
  return p.hour * 60 + p.minute;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

// ISO weekday: 1 = Monday ... 7 = Sunday.
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

// UTC instant of "date + minutes since midnight". Minutes may pass 24:00
// (sleep at 00:30 is 1470). A time skipped by the spring clock change moves
// one hour later.
export function minuteToUtc(date: string, minutes: number): Date {
  const dayShift = Math.floor(minutes / 1440);
  const local = ((minutes % 1440) + 1440) % 1440;
  const [y, m, d] = addDays(date, dayShift).split("-").map(Number);
  const hour = Math.floor(local / 60);
  const minute = local % 60;
  return (
    kyivLocalToUtc(y, m, d, hour, minute) ??
    kyivLocalToUtc(y, m, d, hour + 1, minute) ??
    new Date(Date.UTC(y, m - 1, d, hour, minute))
  );
}

// "07:05" from minutes since midnight (wraps past 24:00).
export function formatHm(minutes: number): string {
  const local = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(local / 60))}:${pad(local % 60)}`;
}

// Minutes since midnight from "HH:MM"; null when the input is not a time.
export function parseHm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

// "понедельник, 19 октября" for a "YYYY-MM-DD" date.
export function formatDayRu(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

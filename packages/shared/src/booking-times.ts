// Booking start times and task lengths (R1), and converting business-local times to UTC (R9).
// Times are stored and compared in UTC; the business time zone is only for the times
// customers pick and see.

const MINUTE_MS = 60 * 1000;

// R1: every start and end falls on :00 or :30
export const SLOT_MS = 30 * MINUTE_MS;
// R1: a task lasts at least 30 min and at most 9h
export const MIN_TASK_MS = SLOT_MS;
export const MAX_TASK_MS = 9 * 60 * MINUTE_MS;

// R1: task time is always rounded up to the next 30 min
export function roundUpToSlot(ms: number) {
  return Math.ceil(ms / SLOT_MS) * SLOT_MS;
}

// HH:MM on the :00/:30 grid, e.g. "08:00", "19:30"
export function isSlotTime(time: string) {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

// Every start time customers can pick on a day: 00:00, 00:30 … 23:30
export const SLOT_TIMES = Array.from({ length: 48 }, (_, i) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(i / 2))}:${i % 2 === 0 ? "00" : "30"}`;
});

// One formatter per time zone: building them is slow, and this runs for every slot
const formatters = new Map<string, Intl.DateTimeFormat>();

// How far the time zone's clock is ahead of UTC at that instant, in ms
function offsetMs(instant: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]),
  );
  const wallClockAsUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

// The UTC instant of a wall-clock time (YYYY-MM-DD, HH:MM) in a time zone.
// Done twice so a day with a clock change uses the offset in force at that time.
export function zonedTimeToUtc(day: string, time: string, timeZone: string) {
  const wallClock = Date.parse(`${day}T${time}:00Z`);
  const guess = wallClock - offsetMs(wallClock, timeZone);
  return new Date(wallClock - offsetMs(guess, timeZone));
}

// The day after a YYYY-MM-DD day, as YYYY-MM-DD
export function nextDay(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * MINUTE_MS).toISOString().slice(0, 10);
}

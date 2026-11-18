import { and, asc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { bookings, bookingsAreOpen, db, users } from "@lemmido/db";
import {
  BUSINESS_TIMEZONE,
  checkSchedule,
  MIN_NOTICE_HOURS,
  nextDay,
  SLOT_TIMES,
  WEEKLY_WINDOW_MS,
  zonedTimeToUtc,
  type Task,
  type Violation,
} from "@lemmido/shared";

// The database, or a transaction inside it, so assignment can run the check
// in the same transaction that saves the helper (R8)
type Executor = Pick<typeof db, "select">;

// How far either side of the candidate a helper's tasks can matter: 7 days, as R6 asks.
// The R5 40h cap looks furthest: 7 days back from the candidate's end, and the
// 7-day windows ending at tasks up to 7 days after it. R2–R4 and the R5 24h break
// need less (1h, 24h, 20h and 6 days).
const LOOKAROUND_MS = WEEKLY_WINDOW_MS;
const DAY_MS = 24 * 60 * 60 * 1000;

// Active helpers, lowest user id first
async function loadHelpers(executor: Executor) {
  return executor
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "employee"), isNull(users.deactivatedAt)))
    .orderBy(asc(users.id));
}

// The helpers' open bookings that reach into [from, to], as tasks sorted by start, by helper
async function loadTasks(
  executor: Executor,
  helperIds: string[],
  from: Date,
  to: Date,
  excludeBookingId?: string,
) {
  const tasksByHelper = new Map<string, Task[]>(helperIds.map((id) => [id, []]));
  if (helperIds.length === 0) return tasksByHelper;

  const rows = await executor
    .select({
      helperId: bookings.helperId,
      bookingId: bookings.bookingId,
      start: bookings.jobStartsAt,
      end: bookings.endsAt,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.helperId, helperIds),
        inArray(bookings.approvalStatus, [...bookingsAreOpen]),
        // Only bookings reaching into the range: starting before it ends, ending after it starts
        lt(bookings.jobStartsAt, to),
        gt(bookings.endsAt, from),
        // The booking being rescheduled or reassigned doesn't clash with itself
        excludeBookingId === undefined ? undefined : ne(bookings.bookingId, excludeBookingId),
      ),
    )
    .orderBy(asc(bookings.jobStartsAt));

  for (const row of rows) {
    if (row.helperId === null) continue;
    tasksByHelper.get(row.helperId)?.push({ bookingId: row.bookingId, start: row.start, end: row.end });
  }
  return tasksByHelper;
}

// Why this helper can't take the candidate task. Empty = they can.
export async function checkHelperAvailability(
  helperId: string,
  candidate: Task,
  executor: Executor = db,
): Promise<Violation[]> {
  const tasksByHelper = await loadTasks(
    executor,
    [helperId],
    new Date(candidate.start.getTime() - LOOKAROUND_MS),
    new Date(candidate.end.getTime() + LOOKAROUND_MS),
    candidate.bookingId,
  );
  return checkSchedule(candidate, tasksByHelper.get(helperId) ?? []);
}

// The active helpers who can take the candidate task, lowest user id first
export async function findAvailableHelpers(candidate: Task, executor: Executor = db) {
  const helpers = await loadHelpers(executor);
  const tasksByHelper = await loadTasks(
    executor,
    helpers.map((helper) => helper.id),
    new Date(candidate.start.getTime() - LOOKAROUND_MS),
    new Date(candidate.end.getTime() + LOOKAROUND_MS),
    candidate.bookingId,
  );
  return helpers.filter(
    (helper) => checkSchedule(candidate, tasksByHelper.get(helper.id) ?? []).length === 0,
  );
}

// Business-local start times (HH:MM) on each day from `fromDay` to `toDay` (YYYY-MM-DD,
// both included) when at least one helper could take a task of `taskMs`. Times inside
// the notice period are left out. With `firstOnly`, stops at each day's first free time,
// which is all the calendar needs to know a day can be picked.
// Showing a time doesn't hold a helper: submit and assignment check again.
export async function freeStartTimes(
  fromDay: string,
  toDay: string,
  taskMs: number,
  { firstOnly = false, executor = db }: { firstOnly?: boolean; executor?: Executor } = {},
) {
  const rangeStart = zonedTimeToUtc(fromDay, "00:00", BUSINESS_TIMEZONE).getTime();
  const rangeEnd = zonedTimeToUtc(nextDay(toDay), "00:00", BUSINESS_TIMEZONE).getTime();
  const helpers = await loadHelpers(executor);
  // One query for the whole range, rather than one per time
  const tasksByHelper = await loadTasks(
    executor,
    helpers.map((helper) => helper.id),
    new Date(rangeStart - LOOKAROUND_MS),
    new Date(rangeEnd + taskMs + LOOKAROUND_MS),
  );
  const earliestStart = Date.now() + MIN_NOTICE_HOURS * 60 * 60 * 1000;

  const freeTimes = new Map<string, string[]>();
  for (let day = fromDay; day <= toDay; day = nextDay(day)) {
    const dayStart = zonedTimeToUtc(day, "00:00", BUSINESS_TIMEZONE).getTime();
    // Each helper's tasks that can matter on this day, so each time checks a short list.
    // Extra tasks never change the result; missing ones would.
    const nearby = [...tasksByHelper.values()].map((tasks) =>
      tasks.filter(
        (task) =>
          task.end.getTime() > dayStart - LOOKAROUND_MS &&
          task.start.getTime() < dayStart + DAY_MS + taskMs + LOOKAROUND_MS,
      ),
    );

    const times: string[] = [];
    for (const time of SLOT_TIMES) {
      const start = zonedTimeToUtc(day, time, BUSINESS_TIMEZONE);
      if (start.getTime() < earliestStart) continue;
      const candidate = { start, end: new Date(start.getTime() + taskMs) };
      if (nearby.some((tasks) => checkSchedule(candidate, tasks).length === 0)) {
        times.push(time);
        if (firstOnly) break;
      }
    }
    freeTimes.set(day, times);
  }
  return freeTimes;
}

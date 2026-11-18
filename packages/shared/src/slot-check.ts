// Helper scheduling rules from slot_check.md, as pure functions with no database access.
// R1 (the slot grid) isn't checked here: the date picker only offers times on it.
// All times are compared as UTC epoch milliseconds (R9).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// R2: rest between any two tasks of the same helper
export const MIN_GAP_MS = HOUR_MS;

// R3: most work any 24h period can hold
export const DAILY_WINDOW_MS = DAY_MS;
export const DAILY_CAP_MS = 9 * HOUR_MS;

// R4: a gap this long ends a shift; a shorter one keeps the next task in it
export const SHIFT_BREAK_MS = 8 * HOUR_MS;
// R4: longest a shift can run, from its first start to its last end
export const MAX_SHIFT_SPAN_MS = 12 * HOUR_MS;

// R5: most work any 7-day period can hold
export const WEEKLY_WINDOW_MS = 7 * DAY_MS;
export const WEEKLY_CAP_MS = 40 * HOUR_MS;
// R5: every 7-day period has a break this long with no tasks. That's the same as:
// from the end of one such break to the start of the next is at most 5 days
// (a 7-day window can only miss both breaks if the work between them is longer
// than 7d − 24h − 24h), so it's checked like R4's shifts.
export const WEEKLY_BREAK_MS = 24 * HOUR_MS;
export const MAX_WORK_STRETCH_MS = 5 * DAY_MS;

// A block of a helper's time: job_starts_at → ends_at of a booking (travel included)
export type Task = {
  // The booking it belongs to. The candidate has none until it's saved
  bookingId?: string;
  start: Date;
  end: Date;
};

export type Violation = {
  rule: "R2" | "R3" | "R4" | "R5";
  // The helper's existing booking that clashes with the candidate.
  // For R3 and the R5 40h cap, the booking whose end closes the window that's over
  // the cap; undefined = the candidate's.
  // For R4 and the R5 24h break, undefined: the problem is the candidate's whole stretch
  bookingId: string | undefined;
  message: string;
};

// The other tasks, without the candidate's own old slot when it's being rescheduled or reassigned
function othersThan(candidate: Task, tasks: Task[]) {
  return candidate.bookingId === undefined
    ? tasks
    : tasks.filter((task) => task.bookingId !== candidate.bookingId);
}

// How much of the task falls inside [from, to]
function overlapMs(task: Task, from: number, to: number) {
  return Math.max(0, Math.min(task.end.getTime(), to) - Math.max(task.start.getTime(), from));
}

function hours(ms: number) {
  return `${Math.round((ms / HOUR_MS) * 10) / 10}h`;
}

// R2: the candidate must start at least 1h after every earlier task ends
// and end at least 1h before every later task starts. An overlap is a gap below 0,
// so it fails too. A task with the candidate's own bookingId is skipped, so a
// booking being rescheduled or reassigned isn't checked against its old self.
export function checkGap(candidate: Task, tasks: Task[]): Violation[] {
  const start = candidate.start.getTime();
  const end = candidate.end.getTime();
  const violations: Violation[] = [];

  for (const task of othersThan(candidate, tasks)) {
    // Two tasks are too close when each starts less than 1h after the other ends
    if (task.start.getTime() < end + MIN_GAP_MS && task.end.getTime() > start - MIN_GAP_MS) {
      violations.push({
        rule: "R2",
        bookingId: task.bookingId,
        message: `Less than 1 hour from booking ${task.bookingId ?? "(unsaved)"}, ${task.start.toISOString()} to ${task.end.toISOString()}`,
      });
    }
  }

  return violations;
}

// R3 and the R5 40h cap: no window of `windowMs` may hold more than `capMs` of work.
// Windows checked, counting only the part of each task inside:
//   [candidate.end − window, candidate.end]
//   [task.end − window, task.end] for each task ending in the window after candidate.end
// The second kind catches work booked later: windows ending before candidate.end
// can't change, since the candidate adds nothing new to them.
function checkRollingCap(
  candidate: Task,
  tasks: Task[],
  rule: "R3" | "R5",
  windowMs: number,
  capMs: number,
  windowName: string,
): Violation[] {
  const others = othersThan(candidate, tasks);
  const all = [...others, candidate];
  const candidateEnd = candidate.end.getTime();
  const windowEnds: { end: number; bookingId: string | undefined }[] = [
    { end: candidateEnd, bookingId: undefined },
  ];
  for (const task of others) {
    const end = task.end.getTime();
    if (end > candidateEnd && end < candidateEnd + windowMs) {
      windowEnds.push({ end, bookingId: task.bookingId });
    }
  }

  const violations: Violation[] = [];
  for (const { end, bookingId } of windowEnds) {
    const from = end - windowMs;
    const work = all.reduce((sum, task) => sum + overlapMs(task, from, end), 0);
    if (work > capMs) {
      violations.push({
        rule,
        bookingId,
        message: `${hours(work)} of work in the ${windowName} ending ${new Date(end).toISOString()}, more than ${hours(capMs)}`,
      });
    }
  }
  return violations;
}

// The run of tasks the candidate lands in, where no gap between two tasks is
// `breakMs` or longer. Adding the candidate can join the runs either side of it,
// but leaves every other run as it was, so only this one needs checking.
function stretchAround(candidate: Task, tasks: Task[], breakMs: number) {
  const sorted = [...othersThan(candidate, tasks), candidate].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  let start = 0;
  let end = -Infinity;
  let hasCandidate = false;

  for (const task of sorted) {
    if (task.start.getTime() - end >= breakMs) {
      // A long enough gap: the run so far is over
      if (hasCandidate) break;
      start = task.start.getTime();
    }
    // max, in case tasks overlap: the run lasts until its latest end
    end = Math.max(end, task.end.getTime());
    if (task === candidate) hasCandidate = true;
  }

  return { start, end, span: end - start };
}

// R3: no 24h period may hold more than 9h of work. Pass the candidate's latest
// possible end (task time rounded up), so the check covers the longest it can run.
export function checkDailyCap(candidate: Task, tasks: Task[]): Violation[] {
  return checkRollingCap(candidate, tasks, "R3", DAILY_WINDOW_MS, DAILY_CAP_MS, "24h");
}

// R4: the shift the candidate lands in may run at most 12h from its first start to
// its last end. A task starting less than 8h after the previous one ends is in the
// same shift, so this also gives every shift at least 8h of rest before it.
export function checkShiftSpan(candidate: Task, tasks: Task[]): Violation[] {
  const shift = stretchAround(candidate, tasks, SHIFT_BREAK_MS);
  if (shift.span <= MAX_SHIFT_SPAN_MS) return [];
  return [
    {
      rule: "R4",
      bookingId: undefined,
      message: `Shift from ${new Date(shift.start).toISOString()} to ${new Date(shift.end).toISOString()} runs ${hours(shift.span)}, more than ${hours(MAX_SHIFT_SPAN_MS)}`,
    },
  ];
}

// R5: no 7-day period may hold more than 40h of work
export function checkWeeklyCap(candidate: Task, tasks: Task[]): Violation[] {
  return checkRollingCap(candidate, tasks, "R5", WEEKLY_WINDOW_MS, WEEKLY_CAP_MS, "7 days");
}

// R5: every 7-day period has 24h with no tasks, i.e. the work the candidate lands in
// (tasks with no 24h gap between them) runs at most 5 days from first start to last end
export function checkWeeklyRest(candidate: Task, tasks: Task[]): Violation[] {
  const stretch = stretchAround(candidate, tasks, WEEKLY_BREAK_MS);
  if (stretch.span <= MAX_WORK_STRETCH_MS) return [];
  return [
    {
      rule: "R5",
      bookingId: undefined,
      message: `No 24h break from ${new Date(stretch.start).toISOString()} to ${new Date(stretch.end).toISOString()} (${hours(stretch.span)}), so some 7-day period has none. At most ${MAX_WORK_STRETCH_MS / DAY_MS} days between 24h breaks`,
    },
  ];
}

// Every rule from R2 to R5. R1 is the date picker's job.
export function checkSchedule(candidate: Task, tasks: Task[]): Violation[] {
  return [
    ...checkGap(candidate, tasks),
    ...checkDailyCap(candidate, tasks),
    ...checkShiftSpan(candidate, tasks),
    ...checkWeeklyCap(candidate, tasks),
    ...checkWeeklyRest(candidate, tasks),
  ];
}

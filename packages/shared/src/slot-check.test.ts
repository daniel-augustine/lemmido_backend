import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDailyCap,
  checkGap,
  checkSchedule,
  checkShiftSpan,
  checkWeeklyCap,
  checkWeeklyRest,
  type Task,
} from "./slot-check.ts";

// A task on 1 Dec 2026 from one UTC time to another, e.g. task("b1", "10:00", "12:00")
function task(bookingId: string | undefined, start: string, end: string): Task {
  return {
    ...(bookingId === undefined ? {} : { bookingId }),
    start: new Date(`2026-12-01T${start}:00Z`),
    end: new Date(`2026-12-01T${end}:00Z`),
  };
}

const existing = [task("b1", "08:00", "10:00"), task("b2", "16:00", "18:00")];

test("passes with exactly 1h before and after", () => {
  assert.deepEqual(checkGap(task(undefined, "11:00", "15:00"), existing), []);
});

test("passes with no other tasks", () => {
  assert.deepEqual(checkGap(task(undefined, "09:00", "10:00"), []), []);
});

test("fails when it starts less than 1h after the previous task", () => {
  const violations = checkGap(task(undefined, "10:30", "12:00"), existing);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R2", "b1"]]);
});

test("fails when it ends less than 1h before the next task", () => {
  const violations = checkGap(task(undefined, "13:00", "15:30"), existing);
  assert.deepEqual(violations.map((v) => v.bookingId), ["b2"]);
});

test("fails when it overlaps a task", () => {
  const violations = checkGap(task(undefined, "09:00", "11:00"), existing);
  assert.deepEqual(violations.map((v) => v.bookingId), ["b1"]);
});

test("fails when it sits inside a task", () => {
  const violations = checkGap(task(undefined, "16:30", "17:30"), existing);
  assert.deepEqual(violations.map((v) => v.bookingId), ["b2"]);
});

test("lists every task it's too close to", () => {
  const violations = checkGap(task(undefined, "10:30", "15:30"), existing);
  assert.deepEqual(violations.map((v) => v.bookingId), ["b1", "b2"]);
});

test("ignores the booking's own old slot when rescheduling", () => {
  assert.deepEqual(checkGap(task("b1", "08:30", "10:00"), existing), []);
});

test("compares real elapsed time across time zones", () => {
  // 11:00 UTC written as 16:30 India time: still exactly 1h after b1 ends
  const candidate = {
    start: new Date("2026-12-01T16:30:00+05:30"),
    end: new Date("2026-12-01T20:30:00+05:30"),
  };
  assert.deepEqual(checkGap(candidate, existing), []);
});

// R3

// A task between two UTC times written as "DD HH:MM" in December 2026, e.g. at("b1", "01 08:00", "01 12:00")
function at(bookingId: string | undefined, start: string, end: string): Task {
  const time = (value: string) => new Date(`2026-12-${value.replace(" ", "T")}:00Z`);
  return { ...(bookingId === undefined ? {} : { bookingId }), start: time(start), end: time(end) };
}

test("passes with exactly 9h in the 24h before it ends", () => {
  const tasks = [at("b1", "01 08:00", "01 12:00")];
  assert.deepEqual(checkDailyCap(at(undefined, "01 13:00", "01 18:00"), tasks), []);
});

test("passes with a single 9h task", () => {
  assert.deepEqual(checkDailyCap(at(undefined, "01 08:00", "01 17:00"), []), []);
});

test("fails with more than 9h in the 24h before it ends", () => {
  const tasks = [at("b1", "01 08:00", "01 12:00")];
  const violations = checkDailyCap(at(undefined, "01 13:00", "01 18:30"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R3", undefined]]);
  assert.match(violations[0]?.message ?? "", /9\.5h/);
});

test("counts only the part of a task inside the window", () => {
  // b1 is 4h, but only its last 2h (16:00–18:00 on the 1st) fall in the 24h before 16:00 on the 2nd
  const tasks = [at("b1", "01 14:00", "01 18:00")];
  assert.deepEqual(checkDailyCap(at(undefined, "02 09:00", "02 16:00"), tasks), []);
  // Ending 30 min later moves the window too: 1.5h of b1 + 7.5h = 9h, still allowed
  assert.equal(checkDailyCap(at(undefined, "02 09:00", "02 16:30"), tasks).length, 0);
  // Starting 30 min earlier: 2h of b1 + 7.5h = 9.5h
  assert.equal(checkDailyCap(at(undefined, "02 08:30", "02 16:00"), tasks).length, 1);
});

test("fails when a task booked later in the day goes over the cap", () => {
  // The 24h before 12:00 holds 4h, but the 24h before 20:00 holds 4h + 6h
  const tasks = [at("b2", "01 14:00", "01 20:00")];
  const violations = checkDailyCap(at(undefined, "01 08:00", "01 12:00"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R3", "b2"]]);
});

test("ignores tasks ending 24h or more after it", () => {
  const tasks = [at("b2", "02 06:00", "02 12:00")];
  assert.deepEqual(checkDailyCap(at(undefined, "01 08:00", "01 12:00"), tasks), []);
});

test("doesn't count the booking's own old slot when rescheduling", () => {
  const tasks = [at("b1", "01 08:00", "01 14:00")];
  assert.deepEqual(checkDailyCap(at("b1", "01 09:00", "01 17:00"), tasks), []);
});

test("checkSchedule reports R2 and R3 together", () => {
  const tasks = [at("b1", "01 08:00", "01 14:00")];
  const violations = checkSchedule(at(undefined, "01 14:30", "01 19:00"), tasks);
  assert.deepEqual(violations.map((v) => v.rule), ["R2", "R3"]);
});

// R4 (the numbered cases from the R4 examples; times are UTC here, R4 doesn't care about the time of day)

function rulesBroken(candidate: Task, tasks: Task[]) {
  return checkSchedule(candidate, tasks).map((v) => v.rule);
}

test("1: a single 9h task is a 9h shift", () => {
  assert.deepEqual(checkShiftSpan(at(undefined, "01 08:00", "01 17:00"), []), []);
});

test("2: two tasks 1h apart are one 9h shift", () => {
  const tasks = [at("b1", "01 08:00", "01 12:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 13:00", "01 17:00"), tasks), []);
});

test("3: passes at exactly 12h span", () => {
  const tasks = [at("b1", "01 08:00", "01 11:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 17:00", "01 20:00"), tasks), []);
});

test("4: a gap of exactly 8h starts a new shift", () => {
  const tasks = [at("b1", "01 06:00", "01 10:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 18:00", "01 23:00"), tasks), []);
});

test("5: a shift can run past midnight", () => {
  const tasks = [at("b1", "01 18:00", "01 22:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 23:00", "02 03:00"), tasks), []);
});

test("6: a night job then a job 8h later", () => {
  const tasks = [at("b1", "01 22:00", "02 04:00")];
  assert.deepEqual(rulesBroken(at(undefined, "02 12:00", "02 14:00"), tasks), []);
});

test("7: fails 30 min over 12h", () => {
  const tasks = [at("b1", "01 08:00", "01 11:00")];
  const violations = checkShiftSpan(at(undefined, "01 17:30", "01 20:30"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R4", undefined]]);
  assert.match(violations[0]?.message ?? "", /12\.5h/);
  assert.deepEqual(rulesBroken(at(undefined, "01 17:30", "01 20:30"), tasks), ["R4"]);
});

test("7, moved later: 8h after the last task is a new shift", () => {
  const tasks = [at("b1", "01 08:00", "01 11:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 19:00", "01 22:00"), tasks), []);
});

test("8: a gap just under 8h keeps the task in the shift", () => {
  const tasks = [at("b1", "01 06:00", "01 10:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 17:30", "01 22:30"), tasks), ["R4"]);
});

test("9: a night job then a morning job 6h later", () => {
  const tasks = [at("b1", "01 19:00", "02 02:00")];
  assert.deepEqual(rulesBroken(at(undefined, "02 08:00", "02 10:00"), tasks), ["R4"]);
});

test("10: a night job then a noon job 7h later", () => {
  const tasks = [at("b1", "01 22:00", "02 05:00")];
  assert.deepEqual(rulesBroken(at(undefined, "02 12:00", "02 14:00"), tasks), ["R4"]);
});

test("a new task between two shifts joins them into one", () => {
  const tasks = [at("b1", "01 06:00", "01 09:00"), at("b2", "01 19:00", "01 22:00")];
  assert.deepEqual(rulesBroken(at(undefined, "01 13:00", "01 14:00"), tasks), ["R4"]);
});

test("an overrun that closes the gap joins two shifts", () => {
  // b1 booked 08:00–11:00, now running to 12:00: the 19:30 job is re-checked against it
  const tasks = [at("b1", "01 08:00", "01 12:00")];
  assert.deepEqual(rulesBroken(at("b2", "01 19:30", "01 22:00"), tasks), ["R4"]);
  // As booked, the gap was 8.5h
  assert.deepEqual(rulesBroken(at("b2", "01 19:30", "01 22:00"), [at("b1", "01 08:00", "01 11:00")]), []);
});

test("11: 12h span and 9h of work, both at the limit", () => {
  const tasks = [
    at("b1", "01 07:00", "01 09:00"),
    at("b2", "01 10:00", "01 12:00"),
    at("b3", "01 13:00", "01 15:00"),
  ];
  assert.deepEqual(rulesBroken(at(undefined, "01 16:00", "01 19:00"), tasks), []);
});

test("12: one more hour breaks R3 and R4", () => {
  const tasks = [
    at("b1", "01 07:00", "01 09:00"),
    at("b2", "01 10:00", "01 12:00"),
    at("b3", "01 13:00", "01 15:00"),
    at("b4", "01 16:00", "01 19:00"),
  ];
  assert.deepEqual(rulesBroken(at(undefined, "01 20:00", "01 21:00"), tasks), ["R3", "R4"]);
});

test("other shifts don't affect the candidate's", () => {
  // The previous day's shift is already too long; the candidate is 8h+ after it
  const tasks = [at("b1", "01 06:00", "01 10:00"), at("b2", "01 13:00", "01 20:00")];
  assert.deepEqual(checkShiftSpan(at(undefined, "02 08:00", "02 12:00"), tasks), []);
});

// R5

// The same hours on each of the given December days, e.g. daily(["01", "02"], "08:00", "12:00")
function daily(days: string[], start: string, end: string): Task[] {
  return days.map((day) => at(`b${day}`, `${day} ${start}`, `${day} ${end}`));
}

test("R5 cap: passes at exactly 40h in 7 days", () => {
  // 9h a day on the 1st–4th, a day off, then 4h on the 6th
  const tasks = daily(["01", "02", "03", "04"], "08:00", "17:00");
  assert.deepEqual(rulesBroken(at(undefined, "06 08:00", "06 12:00"), tasks), []);
});

test("R5 cap: fails over 40h in 7 days", () => {
  const tasks = daily(["01", "02", "03", "04"], "08:00", "17:00");
  const violations = checkWeeklyCap(at(undefined, "06 08:00", "06 12:30"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R5", undefined]]);
  assert.match(violations[0]?.message ?? "", /40\.5h of work in the 7 days/);
  assert.deepEqual(rulesBroken(at(undefined, "06 08:00", "06 12:30"), tasks), ["R5"]);
});

test("R5 cap: counts only the part of a task inside the window", () => {
  // The 7 days before 12:00 on the 8th start at 12:00 on the 1st, so only 5h of the 1st's job counts:
  // 5h + 9h × 3 + 8h = 40h
  const tasks = daily(["01", "02", "03", "04"], "08:00", "17:00");
  assert.deepEqual(checkWeeklyCap(at(undefined, "08 04:00", "08 12:00"), tasks), []);
  // Ending 30 min later: 4.5h + 27h + 8.5h = 40h, still allowed
  assert.deepEqual(checkWeeklyCap(at(undefined, "08 04:00", "08 12:30"), tasks), []);
  // Starting 30 min earlier: 5h + 27h + 8.5h = 40.5h
  assert.equal(checkWeeklyCap(at(undefined, "08 03:30", "08 12:00"), tasks).length, 1);
});

test("R5 cap: fails when tasks booked later in the week go over", () => {
  // 36h already booked on the 2nd–4th and 6th; 5h on the 1st makes the 7 days before the 6th's end 41h
  const tasks = daily(["02", "03", "04", "06"], "08:00", "17:00");
  const violations = checkWeeklyCap(at(undefined, "01 08:00", "01 13:00"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R5", "b06"]]);
  assert.deepEqual(rulesBroken(at(undefined, "01 08:00", "01 13:00"), tasks), ["R5"]);
});

test("R5 break: passes with exactly 5 days between 24h breaks", () => {
  // 4h a day from the 1st to the 5th, then 04:00–08:00 on the 6th: 08:00 on the 1st to 08:00 on the 6th
  const tasks = daily(["01", "02", "03", "04", "05"], "08:00", "12:00");
  assert.deepEqual(rulesBroken(at(undefined, "06 04:00", "06 08:00"), tasks), []);
});

test("R5 break: fails 30 min over 5 days", () => {
  const tasks = daily(["01", "02", "03", "04", "05"], "08:00", "12:00");
  const violations = checkWeeklyRest(at(undefined, "06 04:30", "06 08:30"), tasks);
  assert.deepEqual(violations.map((v) => [v.rule, v.bookingId]), [["R5", undefined]]);
  assert.match(violations[0]?.message ?? "", /120\.5h/);
  assert.deepEqual(rulesBroken(at(undefined, "06 04:30", "06 08:30"), tasks), ["R5"]);
});

test("R5 break: a gap of exactly 24h counts as the break", () => {
  const tasks = daily(["01", "02", "03", "04", "05"], "08:00", "12:00");
  assert.deepEqual(rulesBroken(at(undefined, "06 12:00", "06 16:00"), tasks), []);
  // 23.5h isn't enough: the work now runs from the 1st 08:00 to the 6th 15:30
  assert.deepEqual(rulesBroken(at(undefined, "06 11:30", "06 15:30"), tasks), ["R5"]);
});

test("R5 break: a new task in the only day off joins two runs of work", () => {
  const tasks = daily(["01", "02", "03", "05", "06", "07"], "08:00", "12:00");
  assert.deepEqual(rulesBroken(at(undefined, "04 08:00", "04 12:00"), tasks), ["R5"]);
});

test("R5 break: other runs of work don't affect the candidate's", () => {
  // The 1st–7th already has no day off; the candidate is 24h+ after it
  const tasks = daily(["01", "02", "03", "04", "05", "06", "07"], "08:00", "12:00");
  assert.deepEqual(checkWeeklyRest(at(undefined, "09 08:00", "09 12:00"), tasks), []);
});

test("R5: a sixth 8h day breaks the cap and the break", () => {
  const tasks = daily(["01", "02", "03", "04", "05"], "08:00", "16:00");
  assert.deepEqual(rulesBroken(at(undefined, "06 08:00", "06 16:00"), tasks), ["R5", "R5"]);
});

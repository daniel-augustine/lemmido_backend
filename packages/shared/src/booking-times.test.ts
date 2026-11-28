import assert from "node:assert/strict";
import { test } from "node:test";
import { isSlotTime, nextDay, roundUpToSlot, SLOT_TIMES, zonedTimeToUtc } from "./booking-times.ts";

const MINUTE_MS = 60 * 1000;

test("rounds task time up to the next 30 min", () => {
  assert.equal(roundUpToSlot(1 * MINUTE_MS), 30 * MINUTE_MS);
  assert.equal(roundUpToSlot(30 * MINUTE_MS), 30 * MINUTE_MS);
  assert.equal(roundUpToSlot(31 * MINUTE_MS), 60 * MINUTE_MS);
  assert.equal(roundUpToSlot(150 * MINUTE_MS), 150 * MINUTE_MS);
});

test("start times are on :00 and :30 only", () => {
  assert.ok(isSlotTime("00:00"));
  assert.ok(isSlotTime("08:30"));
  assert.ok(isSlotTime("23:30"));
  assert.ok(!isSlotTime("08:15"));
  assert.ok(!isSlotTime("24:00"));
  assert.ok(!isSlotTime("8:00"));
});

test("a day has 24 start times, one hour apart", () => {
  assert.equal(SLOT_TIMES.length, 24);
  assert.equal(SLOT_TIMES[0], "00:00");
  assert.equal(SLOT_TIMES[8], "08:00");
  assert.equal(SLOT_TIMES[23], "23:00");
});

test("India time is UTC+05:30", () => {
  assert.equal(zonedTimeToUtc("2026-12-01", "08:00", "Asia/Kolkata").toISOString(), "2026-12-01T02:30:00.000Z");
  // Before 05:30 India time it's still the previous day in UTC
  assert.equal(zonedTimeToUtc("2026-12-01", "02:00", "Asia/Kolkata").toISOString(), "2026-11-30T20:30:00.000Z");
});

test("uses the offset in force on daylight-saving days", () => {
  // London: GMT in winter, BST (UTC+1) in summer; clocks went forward at 01:00 UTC on 29 Mar 2026
  assert.equal(zonedTimeToUtc("2026-01-15", "09:00", "Europe/London").toISOString(), "2026-01-15T09:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-07-15", "09:00", "Europe/London").toISOString(), "2026-07-15T08:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-03-29", "00:30", "Europe/London").toISOString(), "2026-03-29T00:30:00.000Z");
  assert.equal(zonedTimeToUtc("2026-03-29", "09:00", "Europe/London").toISOString(), "2026-03-29T08:00:00.000Z");
});

test("next day rolls over months and years", () => {
  assert.equal(nextDay("2026-11-30"), "2026-12-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

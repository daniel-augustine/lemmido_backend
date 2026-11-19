import assert from "node:assert/strict";
import { test } from "node:test";
import { priceBooking } from "./pricing.ts";
import { bookingTimes, hasOnSiteTime, isRoundTrip, tripFromLegs } from "./trip.ts";

// Thiruvalla base → Chengannur (pickup) → Kottayam → back to Thiruvalla
const LEGS = [
  { distanceMeters: 11_200, durationSeconds: 20 * 60 },
  { distanceMeters: 38_500, durationSeconds: 65 * 60 },
  { distanceMeters: 27_300, durationSeconds: 47 * 60 },
];

test("adds up all three legs", () => {
  const trip = tripFromLegs(LEGS, 60);
  assert.equal(trip.distanceKm, 77);
  assert.equal(trip.driveMinutes, 132);
  assert.equal(trip.leaveBaseMinutes, 20);
  assert.equal(trip.taskMinutes, 192);
});

// Round trip: … → Kottayam → back to Chengannur → Thiruvalla
const ROUND_TRIP_LEGS = [
  LEGS[0]!,
  LEGS[1]!,
  { distanceMeters: 38_500, durationSeconds: 65 * 60 },
  { distanceMeters: 11_200, durationSeconds: 20 * 60 },
];

test("adds up all four legs of a round trip", () => {
  const trip = tripFromLegs(ROUND_TRIP_LEGS, 60);
  assert.equal(trip.distanceKm, 99.4);
  assert.equal(trip.driveMinutes, 170);
  assert.equal(trip.leaveBaseMinutes, 20);
  assert.equal(trip.taskMinutes, 230);
});

test("needs three or four legs", () => {
  assert.throws(() => tripFromLegs(LEGS.slice(0, 2), 0));
  assert.throws(() => tripFromLegs([...ROUND_TRIP_LEGS, LEGS[0]!], 0));
});

test("a driver in the customer's vehicle always makes a round trip", () => {
  assert.equal(isRoundTrip("driver", "customer", false), true);
  assert.equal(isRoundTrip("driver", "customer", true), true);
});

test("a driver in our vehicle makes a round trip only when it's booked", () => {
  assert.equal(isRoundTrip("driver", "ours", false), false);
  assert.equal(isRoundTrip("driver", "ours", true), true);
});

test("a companion's trip has no return leg", () => {
  assert.equal(isRoundTrip("companion", "ours", true), false);
  assert.equal(isRoundTrip("companion", "customer", false), false);
});

test("a one-way driver doesn't wait; a round-trip driver and a companion do", () => {
  assert.equal(hasOnSiteTime("driver", false), false);
  assert.equal(hasOnSiteTime("driver", true), true);
  assert.equal(hasOnSiteTime("companion", false), true);
});

test("customer's vehicle: every leg's drive time, rounded once, at the drive hour rate", () => {
  // 132 min of driving → 2.5 h × ₹100 = ₹250; 60 min waiting → 1 h × ₹20 = ₹20
  const trip = tripFromLegs(LEGS, 60);
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "customer",
    distanceKm: trip.distanceKm,
    driveMinutes: trip.driveMinutes,
    onSiteMinutes: 60,
    rates: { per_km: 2500, drive_hour: 10000, waiting_hour: 2000 },
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.billedDriveHrs, 2.5);
  assert.equal(quote.amount, 27000);
});

test("our vehicle: every leg's km at the per km rate", () => {
  // 77 km × ₹25 = ₹1925
  const trip = tripFromLegs(LEGS, 0);
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "ours",
    distanceKm: trip.distanceKm,
    driveMinutes: trip.driveMinutes,
    onSiteMinutes: 0,
    rates: { per_km: 2500, drive_hour: 10000, waiting_hour: 2000 },
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.billedKm, 77);
  assert.equal(quote.amount, 192500);
});

test("our vehicle, round trip: all four legs' km plus waiting", () => {
  // 99.4 km → 100 km × ₹25 = ₹2500; 60 min waiting → 1 h × ₹20 = ₹20
  const trip = tripFromLegs(ROUND_TRIP_LEGS, 60);
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "ours",
    distanceKm: trip.distanceKm,
    driveMinutes: trip.driveMinutes,
    onSiteMinutes: 60,
    rates: { per_km: 2500, drive_hour: 10000, waiting_hour: 2000 },
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.billedKm, 100);
  assert.equal(quote.amount, 252000);
});

test("customer's vehicle, round trip: all four legs' drive time plus waiting", () => {
  // 170 min of driving → 3 h × ₹100 = ₹300; 60 min waiting → 1 h × ₹20 = ₹20
  const trip = tripFromLegs(ROUND_TRIP_LEGS, 60);
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "customer",
    distanceKm: trip.distanceKm,
    driveMinutes: trip.driveMinutes,
    onSiteMinutes: 60,
    rates: { per_km: 2500, drive_hour: 10000, waiting_hour: 2000 },
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.billedDriveHrs, 3);
  assert.equal(quote.amount, 32000);
});

test("booking times: leave base before the start, back at base after the last leg, on the grid", () => {
  // Picked 10:00 India time = 04:30 UTC. Leaves 20 min earlier (09:40 → 09:30),
  // back after 65 + 60 + 47 min = 12:52 → 13:00
  const times = bookingTimes(new Date("2026-12-01T04:30:00Z"), tripFromLegs(LEGS, 60), 60);
  assert.equal(times.jobStartsAt.toISOString(), "2026-12-01T04:00:00.000Z");
  assert.equal(times.endsAt.toISOString(), "2026-12-01T07:30:00.000Z");
  assert.equal(times.effortHrs, 3.5);
  assert.equal(times.blockedUntil.toISOString(), times.endsAt.toISOString());
  assert.equal(times.confirmBy.toISOString(), "2026-11-29T04:30:00.000Z");
});

test("booking times: over 9 h, the helper gets an 8 h break", () => {
  const times = bookingTimes(new Date("2026-12-01T04:30:00Z"), tripFromLegs(LEGS, 480), 480);
  assert.ok(times.effortHrs > 9);
  assert.equal(times.blockedUntil.getTime() - times.endsAt.getTime(), 8 * 60 * 60 * 1000);
});

test("booking times: a round trip is back at base after the drive back to the pickup", () => {
  // Picked 10:00 India time = 04:30 UTC. Leaves 20 min earlier (09:40 → 09:30),
  // back after 65 + 60 + 65 + 20 min = 13:30
  const times = bookingTimes(new Date("2026-12-01T04:30:00Z"), tripFromLegs(ROUND_TRIP_LEGS, 60), 60);
  assert.equal(times.jobStartsAt.toISOString(), "2026-12-01T04:00:00.000Z");
  assert.equal(times.endsAt.toISOString(), "2026-12-01T08:00:00.000Z");
  assert.equal(times.effortHrs, 4);
});

test("booking times: a job over several days ends on its last day", () => {
  // 3 days: the one-day end (13:00 India, 07:30 UTC) moved 2 days on
  const times = bookingTimes(new Date("2026-12-01T04:30:00Z"), tripFromLegs(LEGS, 60), 60, 3);
  assert.equal(times.jobStartsAt.toISOString(), "2026-12-01T04:00:00.000Z");
  assert.equal(times.endsAt.toISOString(), "2026-12-03T07:30:00.000Z");
  assert.equal(times.effortHrs, 51.5);
  assert.equal(times.blockedUntil.getTime() - times.endsAt.getTime(), 8 * 60 * 60 * 1000);
});

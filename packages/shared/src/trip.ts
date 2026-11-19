// A job's trip. The helper leaves our base, drives to the pickup and on to the
// destination, then either straight back to base (Base → From → To → Base) or, on a
// round trip, back to the pickup first (Base → From → To → From → Base). Every leg
// is part of the job.

import type { VehicleSource } from "./pricing.ts";

// One driving leg, as the route lookup returns it
export type Leg = { distanceMeters: number; durationSeconds: number };

export type Trip = {
  legs: Leg[];
  // All legs together, unrounded: pricing does its own rounding
  distanceKm: number;
  driveMinutes: number;
  // How long before the picked start time the helper leaves base (leg 1)
  leaveBaseMinutes: number;
  // Driving plus the time at the destination: what the helper's availability
  // is checked for (the backend rounds it up to 30 min, R1)
  taskMinutes: number;
};

// Whether the helper brings the customer back to the pickup. A driver in the
// customer's vehicle always does (the car goes home); in our vehicle only when the
// customer books the return. A companion's trip has no return leg.
export function isRoundTrip(serviceType: string, vehicleSource: VehicleSource, roundTrip: boolean) {
  return serviceType === "driver" && (vehicleSource === "customer" || roundTrip);
}

// Whether the time at the destination is charged and counted. A one-way driver
// drops the customer off and leaves, so there's no waiting.
export function hasOnSiteTime(serviceType: string, roundTrip: boolean) {
  return serviceType !== "driver" || roundTrip;
}

// The trip for a job's legs (3 one way, 4 on a round trip) and the time spent at
// the destination (the driver's waiting time or the companion's service time)
export function tripFromLegs(legs: Leg[], onSiteMinutes: number): Trip {
  if (legs.length !== 3 && legs.length !== 4) {
    throw new Error(`A trip has 3 legs (base → from → to → base) or 4 (… → to → from → base), got ${legs.length}`);
  }
  const distanceKm = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) / 1000;
  const driveMinutes = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) / 60;
  return {
    legs,
    distanceKm,
    driveMinutes,
    leaveBaseMinutes: legs[0]!.durationSeconds / 60,
    taskMinutes: driveMinutes + onSiteMinutes,
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// The slot grid (R1): every start and end falls on :00 or :30. India is UTC+05:30,
// so the half hours line up in UTC too.
const SLOT_MS = 30 * MINUTE_MS;
// Jobs longer than this get an 8 h break before the helper's next one
const LONG_JOB_MS = 9 * HOUR_MS;
const BREAK_AFTER_LONG_JOB_MS = 8 * HOUR_MS;
// A booking has to be paid this long before it starts (D17)
const CONFIRM_BEFORE_MS = 48 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

// Longest job, in days. bookings.effort_hrs holds at most 999.9 h, so a span
// much over 40 days couldn't be saved.
export const MAX_TRIP_DAYS = 30;

export type BookingTimes = {
  // When the helper leaves base: the picked start less leg 1, on the grid
  jobStartsAt: Date;
  // When the helper is back at base, on the grid
  endsAt: Date;
  effortHrs: number;
  // When the helper is free again: after an 8 h break if the job was over 9 h
  blockedUntil: Date;
  // The last moment the booking can be paid
  confirmBy: Date;
};

// The times a booking is saved with. `start` is the time the customer picked:
// when the helper is at the pickup. They leave base leg 1 earlier, and get back
// after the time at the destination and every later leg (on a round trip, that
// includes the drive back to the pickup).
// A job over several days ends on its last day, at the time a one-day job would
// end (India has no clock changes, so a day is always 24 h). It's a placeholder
// the admin replaces when scheduling, but it makes the booking take a slot on
// every day it covers.
export function bookingTimes(start: Date, trip: Trip, onSiteMinutes: number, days = 1): BookingTimes {
  const [toPickup, ...rest] = trip.legs.map((leg) => leg.durationSeconds * 1000);
  const leave = start.getTime() - toPickup!;
  const back = start.getTime() + rest.reduce((sum, ms) => sum + ms, 0) + onSiteMinutes * MINUTE_MS;
  const jobStartsAt = Math.floor(leave / SLOT_MS) * SLOT_MS;
  const endsAt = Math.ceil(back / SLOT_MS) * SLOT_MS + (days - 1) * DAY_MS;
  const effortMs = endsAt - jobStartsAt;
  return {
    jobStartsAt: new Date(jobStartsAt),
    endsAt: new Date(endsAt),
    effortHrs: effortMs / HOUR_MS,
    blockedUntil: new Date(effortMs > LONG_JOB_MS ? endsAt + BREAK_AFTER_LONG_JOB_MS : endsAt),
    confirmBy: new Date(start.getTime() - CONFIRM_BEFORE_MS),
  };
}

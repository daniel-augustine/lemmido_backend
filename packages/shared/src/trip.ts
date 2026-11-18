// A job's trip: Base → From → To → Base. The helper leaves our base, drives to the
// pickup, on to the destination, and back to base, so every leg is part of the job.

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

// The trip for the three legs of a job and the time spent at the destination
// (the driver's waiting time or the companion's service time)
export function tripFromLegs(legs: Leg[], onSiteMinutes: number): Trip {
  if (legs.length !== 3) throw new Error(`A trip has 3 legs (base → from → to → base), got ${legs.length}`);
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
// after leg 2, the time at the destination, and leg 3.
export function bookingTimes(start: Date, trip: Trip, onSiteMinutes: number): BookingTimes {
  const [toPickup, toDestination, toBase] = trip.legs.map((leg) => leg.durationSeconds * 1000);
  const leave = start.getTime() - toPickup!;
  const back = start.getTime() + toDestination! + onSiteMinutes * MINUTE_MS + toBase!;
  const jobStartsAt = Math.floor(leave / SLOT_MS) * SLOT_MS;
  const endsAt = Math.ceil(back / SLOT_MS) * SLOT_MS;
  const effortMs = endsAt - jobStartsAt;
  return {
    jobStartsAt: new Date(jobStartsAt),
    endsAt: new Date(endsAt),
    effortHrs: effortMs / HOUR_MS,
    blockedUntil: new Date(effortMs > LONG_JOB_MS ? endsAt + BREAK_AFTER_LONG_JOB_MS : endsAt),
    confirmBy: new Date(start.getTime() - CONFIRM_BEFORE_MS),
  };
}

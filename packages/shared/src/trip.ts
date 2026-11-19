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

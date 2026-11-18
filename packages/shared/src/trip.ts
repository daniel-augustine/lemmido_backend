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

import { pgEnum } from "drizzle-orm/pg-core";

// The enums below mirror the value sets defined in datamodel.md.
// Native Postgres enums are the cleanest way to constrain these columns.

export const approvalMode = pgEnum("approval_mode", ["auto", "admin"]);

export const bookingStatus = pgEnum("booking_status", [
  "awaiting_payment",
  "pending_approval",
  "quoted",
  "accepted",
  "confirmed",
  "denied",
  "declined",
  "expired",
  "cancelled",
]);

export const paymentStatus = pgEnum("payment_status", [
  "unpaid",
  "paid",
  "late",
]);

export const helperSource = pgEnum("helper_source", ["auto", "admin"]);

export const jobStatus = pgEnum("job_status", [
  "scheduled",
  "in_progress",
  "running_over",
  "completed",
]);

export const overrunStatus = pgEnum("overrun_status", [
  "none",
  "due",
  "paid",
  "waived",
]);

export const dashboardSection = pgEnum("dashboard_section", [
  "approved",
  "pending",
  "denied",
  "cancelled",
]);

export const alertKind = pgEnum("alert_kind", [
  "running_over",
  "break_due",
  "next_at_risk",
]);

export const alertResolution = pgEnum("alert_resolution", [
  "new_helper",
  "cancelled",
  "job_finished",
  "dismissed",
]);

// What a service rate is charged per (service_rates.kind)
export const rateKind = pgEnum("rate_kind", [
  "per_km", // distance driven in our vehicle
  "drive_hour", // driving the customer's own vehicle
  "waiting_hour", // driver waiting at the destination
  "service_hour", // companion time with the customer
  "per_person", // tour packages, per traveller
  "per_night", // staycations, per night's stay
]);

// Where a companion goes with the customer (bookings.companion_purpose)
export const companionPurpose = pgEnum("companion_purpose", ["hospital", "bank", "office", "other"]);

// Whose vehicle the helper drives (bookings.vehicle_source): ours is charged
// per km, the customer's per hour of driving
export const vehicleSource = pgEnum("vehicle_source", ["ours", "customer"]);

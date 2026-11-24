// Pricing a driver or companion booking from its service's rates (service_rates).
// Amounts are integer minor units (paise for INR), all in the booking's currency.

import { MAX_TASK_MS, roundUpToSlot } from "./booking-times.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type RateKind = "per_km" | "drive_hour" | "waiting_hour" | "service_hour";

// Whose vehicle the helper drives: ours is charged per km, the customer's per hour of driving
export type VehicleSource = "ours" | "customer";

// A service's rates in one currency. Kinds the service doesn't have are left out.
export type Rates = Partial<Record<RateKind, number>>;

export type PriceRequest = {
  serviceType: string;
  vehicleSource: VehicleSource;
  // The route the helper drives, from the travel time lookup: every leg, base to base
  distanceKm: number;
  driveMinutes: number;
  // Time at the destination: the driver's waiting time or the companion's service time
  onSiteMinutes: number;
  rates: Rates;
};

// What quoteBooking also needs to decide whether it can price the booking itself
export type QuoteRequest = PriceRequest & {
  autoPriced: boolean;
  // How many days the job runs over: more than one is priced by an admin
  days: number;
};

export type Quote =
  | {
      approvalMode: "auto";
      amount: number;
      travelAmount: number;
      onSiteAmount: number;
      // What was billed: whole km in our vehicle, else hours of driving (on the 30 min grid)
      billedKm: number | null;
      billedDriveHrs: number | null;
      billedOnSiteHrs: number;
      // Charged per extra hour when the job runs over: the on-site rate
      overrunRate: number;
    }
  | { approvalMode: "admin"; reason: string };

// The rate charged for time at the destination, per service type
const ON_SITE_KIND: Record<string, RateKind> = {
  driver: "waiting_hour",
  companion: "service_hour",
};

// Hours billed for a stretch of minutes: rounded up to the next 30 min, like task time (R1)
export function billedHours(minutes: number) {
  return roundUpToSlot(minutes * MINUTE_MS) / HOUR_MS;
}

// Prices the booking, or says an admin has to quote it (path B) when the
// service has no rule or is missing a rate it needs
export function priceBooking(request: PriceRequest): Quote {
  const { serviceType, vehicleSource, distanceKm, driveMinutes, onSiteMinutes, rates } = request;

  const onSiteKind = ON_SITE_KIND[serviceType];
  if (!onSiteKind) return { approvalMode: "admin", reason: `No pricing rule for ${serviceType}` };
  const travelKind: RateKind = vehicleSource === "ours" ? "per_km" : "drive_hour";

  const travelRate = rates[travelKind];
  const onSiteRate = rates[onSiteKind];
  if (travelRate === undefined || onSiteRate === undefined) {
    const missing = [travelRate === undefined && travelKind, onSiteRate === undefined && onSiteKind].filter(Boolean);
    return { approvalMode: "admin", reason: `Missing rate: ${missing.join(", ")}` };
  }

  // Part km are charged as a whole km
  const billedKm = vehicleSource === "ours" ? Math.ceil(distanceKm) : null;
  const billedDriveHrs = vehicleSource === "customer" ? billedHours(driveMinutes) : null;
  const travelAmount = Math.round((billedKm ?? billedDriveHrs ?? 0) * travelRate);

  const billedOnSiteHrs = billedHours(onSiteMinutes);
  const onSiteAmount = Math.round(billedOnSiteHrs * onSiteRate);

  return {
    approvalMode: "auto",
    amount: travelAmount + onSiteAmount,
    travelAmount,
    onSiteAmount,
    billedKm,
    billedDriveHrs,
    billedOnSiteHrs,
    overrunRate: onSiteRate,
  };
}

// Whether the backend can approve and price the booking itself (path A), and the
// price if so. Path A needs all four; anything else goes to an admin (path B):
//   1. the service is auto-priced (services.auto_priced)
//   2. the job is on one day
//   3. the helper's whole effort, base to base, is 9 h or less
//   4. the pricing rules can price it (a rule for the service and every rate it needs)
export function quoteBooking(request: QuoteRequest): Quote {
  if (!request.autoPriced) return { approvalMode: "admin", reason: "This service is priced by an admin" };
  if (request.days > 1) return { approvalMode: "admin", reason: "Trips over more than one day are priced by an admin" };
  const effortMs = roundUpToSlot((request.driveMinutes + request.onSiteMinutes) * MINUTE_MS);
  if (effortMs > MAX_TASK_MS) {
    return { approvalMode: "admin", reason: `The job takes more than ${MAX_TASK_MS / HOUR_MS} hours` };
  }
  return priceBooking(request);
}

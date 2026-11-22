import assert from "node:assert/strict";
import { test } from "node:test";
import { billedHours, priceBooking, quoteBooking, type Rates } from "./pricing.ts";

// The seeded INR rates, in paise
const DRIVER: Rates = { per_km: 2500, drive_hour: 10000, waiting_hour: 2000 };
const COMPANION: Rates = { per_km: 2500, drive_hour: 10000, service_hour: 10000 };

test("billed hours round up to the next 30 min", () => {
  assert.equal(billedHours(0), 0);
  assert.equal(billedHours(1), 0.5);
  assert.equal(billedHours(30), 0.5);
  assert.equal(billedHours(40), 1);
  assert.equal(billedHours(70), 1.5);
});

test("driver in our vehicle: per km plus waiting", () => {
  // 42.3 km → 43 km × ₹25 = ₹1075; 50 min waiting → 1 h × ₹20 = ₹20
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "ours",
    distanceKm: 42.3,
    driveMinutes: 75,
    onSiteMinutes: 50,
    rates: DRIVER,
  });
  assert.deepEqual(quote, {
    approvalMode: "auto",
    amount: 109500,
    travelAmount: 107500,
    onSiteAmount: 2000,
    billedKm: 43,
    billedDriveHrs: null,
    billedOnSiteHrs: 1,
    overrunRate: 2000,
  });
});

test("driver in the customer's vehicle: drive hours plus waiting", () => {
  // 75 min driving → 1.5 h × ₹100 = ₹150; no waiting
  const quote = priceBooking({
    serviceType: "driver",
    vehicleSource: "customer",
    distanceKm: 42.3,
    driveMinutes: 75,
    onSiteMinutes: 0,
    rates: DRIVER,
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.billedKm, null);
  assert.equal(quote.billedDriveHrs, 1.5);
  assert.equal(quote.travelAmount, 15000);
  assert.equal(quote.onSiteAmount, 0);
  assert.equal(quote.amount, 15000);
});

test("companion: travel plus service hours", () => {
  // 10 km × ₹25 = ₹250; 3 h × ₹100 = ₹300
  const quote = priceBooking({
    serviceType: "companion",
    vehicleSource: "ours",
    distanceKm: 10,
    driveMinutes: 20,
    onSiteMinutes: 180,
    rates: COMPANION,
  });
  assert.equal(quote.approvalMode, "auto");
  if (quote.approvalMode !== "auto") return;
  assert.equal(quote.amount, 55000);
  assert.equal(quote.overrunRate, 10000);
});

test("a missing rate goes to an admin", () => {
  const quote = priceBooking({
    serviceType: "companion",
    vehicleSource: "customer",
    distanceKm: 10,
    driveMinutes: 20,
    onSiteMinutes: 60,
    rates: { per_km: 2500, service_hour: 10000 },
  });
  assert.deepEqual(quote, { approvalMode: "admin", reason: "Missing rate: drive_hour" });
});

test("a service with no pricing rule goes to an admin", () => {
  const quote = priceBooking({
    serviceType: "property",
    vehicleSource: "ours",
    distanceKm: 10,
    driveMinutes: 20,
    onSiteMinutes: 60,
    rates: {},
  });
  assert.equal(quote.approvalMode, "admin");
});

const SHORT_DRIVE = {
  serviceType: "driver",
  vehicleSource: "ours" as const,
  distanceKm: 40,
  driveMinutes: 90,
  onSiteMinutes: 60,
  rates: DRIVER,
};

test("auto-approved: auto-priced service, 9 h or less, every rate there", () => {
  const quote = quoteBooking({ ...SHORT_DRIVE, autoPriced: true, days: 1 });
  assert.equal(quote.approvalMode, "auto");
  assert.deepEqual(quote, priceBooking(SHORT_DRIVE));
});

test("a service that isn't auto-priced goes to an admin", () => {
  assert.deepEqual(quoteBooking({ ...SHORT_DRIVE, autoPriced: false, days: 1 }), {
    approvalMode: "admin",
    reason: "This service is priced by an admin",
  });
});

test("more than 9 h of effort, base to base, goes to an admin", () => {
  // Exactly 9 h is still auto; 8 h 31 min of waiting plus 30 min driving rounds to 9.5 h
  assert.equal(quoteBooking({ ...SHORT_DRIVE, driveMinutes: 90, onSiteMinutes: 450, autoPriced: true, days: 1 }).approvalMode, "auto");
  assert.deepEqual(quoteBooking({ ...SHORT_DRIVE, driveMinutes: 30, onSiteMinutes: 511, autoPriced: true, days: 1 }), {
    approvalMode: "admin",
    reason: "The job takes more than 9 hours",
  });
});

test("a trip over more than one day goes to an admin, without a price", () => {
  assert.deepEqual(quoteBooking({ ...SHORT_DRIVE, autoPriced: true, days: 2 }), {
    approvalMode: "admin",
    reason: "Trips over more than one day are priced by an admin",
  });
});

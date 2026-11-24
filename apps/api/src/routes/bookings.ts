import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { bookings, bookingsAreOpen, dashboard, db, serviceRates, services, users } from "@lemmido/db";
import {
  bookingTimes,
  BUSINESS_TIMEZONE,
  hasOnSiteTime,
  isRoundTrip,
  isSlotTime,
  MAX_BOOKINGS_PER_DAY,
  MAX_TASK_MS,
  MAX_TRIP_DAYS,
  MIN_NOTICE_HOURS,
  quoteBooking,
  roundUpToSlot,
  tripFromLegs,
  zonedTimeToUtc,
  type Rates,
} from "@lemmido/shared";
import { signedInUserId, trackingToken } from "../auth.ts";
import { fetchTripLegs, type LatLng } from "../google-routes.ts";
import { findAvailableHelpers, freeStartTimes } from "../helper-availability.ts";

// Longest range one request can ask for: a year, with room for the partial months at each end
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Path A: the customer has this long from submitting to pay (or until confirm_by, if sooner)
const PAY_WITHIN_MS = 48 * HOUR_MS;
const COMPANION_PURPOSES = ["hospital", "bank", "office", "other"] as const;
type CompanionPurpose = (typeof COMPANION_PURPOSES)[number];

// A real calendar day written as YYYY-MM-DD, as a UTC timestamp, or null
function parseDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March, so check it round-trips
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}

// Task time in ms from a taskMinutes value (service + travel), rounded up to the next
// 30 min (R1), or an error message
function parseTaskMinutes(value: unknown): number | string {
  const minutes = typeof value === "string" ? Number(value) : value;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return "taskMinutes must be a number of minutes above 0";
  }
  const taskMs = roundUpToSlot(minutes * 60 * 1000);
  if (taskMs > MAX_TASK_MS) return `A task can last at most ${MAX_TASK_MS / 3_600_000} hours`;
  return taskMs;
}

// Checks a from/to range of YYYY-MM-DD days: their timestamps, or an error message
function parseRange(from: string | undefined, to: string | undefined) {
  const fromTime = parseDay(from);
  const toTime = parseDay(to);
  if (fromTime === null || toTime === null) return "from and to must be dates written as YYYY-MM-DD";
  if (toTime < fromTime) return "to can't be before from";
  if ((toTime - fromTime) / DAY_MS > MAX_RANGE_DAYS) return `The range can be at most ${MAX_RANGE_DAYS} days`;
  return { fromTime, toTime };
}

// A { lat, lng } point from a request body, or null
function parseLatLng(value: unknown): LatLng | null {
  const { lat, lng } = (value ?? {}) as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Prices are in INR until bookings follow the customer's site currency (D21)
const CURRENCY = "INR";

export const bookingRoutes = new Hono();

// GET /bookings/full-dates?from=YYYY-MM-DD&to=YYYY-MM-DD
// → { fullDates: ["2026-11-20", ...] }: the days in that range (both ends included)
// that already have MAX_BOOKINGS_PER_DAY open bookings. A booking takes a slot on
// every day from its date_time to its ends_at, so a 3-day stay fills 3 days.
bookingRoutes.get("/full-dates", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const range = parseRange(from, to);
  if (typeof range === "string") return c.json({ error: range }, 400);

  const { rows } = await db.execute<{ day: string }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day
    FROM ${bookings}
    CROSS JOIN LATERAL generate_series(
      (${bookings.dateTime} AT TIME ZONE ${BUSINESS_TIMEZONE})::date,
      (${bookings.endsAt} AT TIME ZONE ${BUSINESS_TIMEZONE})::date,
      interval '1 day'
    ) AS day
    WHERE ${inArray(bookings.approvalStatus, [...bookingsAreOpen])}
      -- Only bookings that overlap the range: starting before it ends, ending after it starts
      AND ${bookings.dateTime} < (${to}::date + 1)::timestamp AT TIME ZONE ${BUSINESS_TIMEZONE}
      AND ${bookings.endsAt} >= ${from}::date::timestamp AT TIME ZONE ${BUSINESS_TIMEZONE}
      AND day::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY day
    HAVING COUNT(*) >= ${MAX_BOOKINGS_PER_DAY}
    ORDER BY day
  `);

  return c.json({ fullDates: rows.map((row) => row.day) });
});

// GET /bookings/unavailable-dates?from=YYYY-MM-DD&to=YYYY-MM-DD&taskMinutes=150
// → { unavailableDates: ["2026-11-20", ...] }: the days in that range (both ends included)
// with no start time when any helper could take a task this long under the scheduling
// rules (slot_check.md R2–R5), counting the notice period. Days are India time.
bookingRoutes.get("/unavailable-dates", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const range = parseRange(from, to);
  if (typeof range === "string") return c.json({ error: range }, 400);
  const taskMs = parseTaskMinutes(c.req.query("taskMinutes"));
  if (typeof taskMs === "string") return c.json({ error: taskMs }, 400);

  const freeTimes = await freeStartTimes(from!, to!, taskMs, { firstOnly: true });
  const unavailableDates = [...freeTimes].filter(([, times]) => times.length === 0).map(([day]) => day);
  return c.json({ unavailableDates });
});

// GET /bookings/available-times?date=YYYY-MM-DD&taskMinutes=150
// → { times: ["08:00", "08:30", ...] }: India-time start times on that day, on the
// :00/:30 grid (R1), when at least one helper could take a task this long.
bookingRoutes.get("/available-times", async (c) => {
  const date = c.req.query("date");
  if (parseDay(date) === null) return c.json({ error: "date must be a date written as YYYY-MM-DD" }, 400);
  const taskMs = parseTaskMinutes(c.req.query("taskMinutes"));
  if (typeof taskMs === "string") return c.json({ error: taskMs }, 400);

  const freeTimes = await freeStartTimes(date!, date!, taskMs);
  return c.json({ times: freeTimes.get(date!) ?? [] });
});

// POST /bookings/check-availability  { date: "YYYY-MM-DD", time: "HH:MM", taskMinutes: 150 }
// → { available: true } when at least one helper can take it now. Run on submit,
// since the last free helper may have been taken after the time was shown.
// It doesn't hold the helper: assignment checks again in its own transaction (R8).
bookingRoutes.post("/check-availability", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { date, time, taskMinutes } = (body ?? {}) as Record<string, unknown>;
  if (typeof date !== "string" || parseDay(date) === null) {
    return c.json({ error: "date must be a date written as YYYY-MM-DD" }, 400);
  }
  // R1: the date picker only offers the grid, but the request may not come from it
  if (typeof time !== "string" || !isSlotTime(time)) {
    return c.json({ error: "time must be HH:MM on the hour or half hour" }, 400);
  }
  const taskMs = parseTaskMinutes(taskMinutes);
  if (typeof taskMs === "string") return c.json({ error: taskMs }, 400);

  const start = zonedTimeToUtc(date, time, BUSINESS_TIMEZONE);
  if (start.getTime() - Date.now() < MIN_NOTICE_HOURS * 60 * 60 * 1000) {
    return c.json({ error: `Bookings have to start at least ${MIN_NOTICE_HOURS} hours from now` }, 400);
  }

  const helpers = await findAvailableHelpers({ start, end: new Date(start.getTime() + taskMs) });
  return c.json({ available: helpers.length > 0 });
});

// The details a trip and its price are worked out from, or an error message.
// onSiteMinutes is the driver's waiting time or the companion's service time.
// roundTrip (default false) asks a driver in our vehicle to bring the customer back
// to the pickup; days (default 1) is how many days the job runs over.
function parseTripRequest(fields: Record<string, unknown>) {
  const { serviceId, vehicleSource, onSiteMinutes, roundTrip = false, days = 1 } = fields;
  const from = parseLatLng(fields.from);
  const to = parseLatLng(fields.to);
  if (!from || !to) return "from and to must be { lat, lng }";
  if (vehicleSource !== "ours" && vehicleSource !== "customer") return 'vehicleSource must be "ours" or "customer"';
  if (typeof onSiteMinutes !== "number" || !Number.isFinite(onSiteMinutes) || onSiteMinutes < 0) {
    return "onSiteMinutes must be a number of minutes, 0 or more";
  }
  if (typeof roundTrip !== "boolean") return "roundTrip must be true or false";
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_TRIP_DAYS) {
    return `days must be a whole number from 1 to ${MAX_TRIP_DAYS}`;
  }
  if (typeof serviceId !== "string" || !serviceId) return "serviceId is required";
  return { serviceId, vehicleSource, from, to, onSiteMinutes, roundTrip, days } as const;
}

type TripRequest = Exclude<ReturnType<typeof parseTripRequest>, string>;

// The job's legs from Google (Base → From → To → Base, with To → From before the
// last leg on a round trip), and whether it's auto-approved (path A) with its price,
// or goes to an admin (path B). An error message and HTTP status when the service
// doesn't exist or no route is found.
async function workOutTrip({ serviceId, vehicleSource, from, to, roundTrip, days, ...request }: TripRequest) {
  const [service] = await db
    .select({ serviceType: services.serviceType, autoPriced: services.autoPriced })
    .from(services)
    .where(eq(services.serviceId, serviceId));
  if (!service) return { error: `No service ${serviceId}`, status: 400 as const };

  // A one-way driver doesn't wait, so any waiting time sent is ignored
  const isRound = isRoundTrip(service.serviceType, vehicleSource, roundTrip);
  const onSiteMinutes = hasOnSiteTime(service.serviceType, isRound) ? request.onSiteMinutes : 0;

  let legs;
  try {
    legs = await fetchTripLegs(from, to, isRound);
  } catch (error) {
    console.error("Couldn't work out the route:", error);
    return { error: "Couldn't work out the route. Please try again.", status: 502 as const };
  }
  const trip = tripFromLegs(legs, onSiteMinutes);

  const rateRows = await db
    .select({ kind: serviceRates.kind, amount: serviceRates.amount })
    .from(serviceRates)
    .where(and(eq(serviceRates.serviceId, serviceId), eq(serviceRates.currency, CURRENCY)));
  const rates: Rates = Object.fromEntries(rateRows.map((row) => [row.kind, row.amount]));

  const quote = quoteBooking({
    serviceType: service.serviceType,
    autoPriced: service.autoPriced,
    days,
    vehicleSource,
    distanceKm: trip.distanceKm,
    driveMinutes: trip.driveMinutes,
    onSiteMinutes,
    rates,
  });
  return { trip: { ...trip, roundTrip: isRound, onSiteMinutes }, quote, serviceType: service.serviceType };
}

// POST /bookings/trip
//   { serviceId: "ser_01", vehicleSource: "ours" | "customer",
//     from: { lat, lng }, to: { lat, lng }, onSiteMinutes: 60, roundTrip?: true, days?: 1 }
// → { legs, distanceKm, driveMinutes, leaveBaseMinutes, taskMinutes, roundTrip,
//     onSiteMinutes, currency, quote }
// The job's legs, the task length to check availability for, and the quote.
// roundTrip and onSiteMinutes say what was actually priced: a driver in the
// customer's vehicle is always a round trip, and a one-way driver doesn't wait.
// A quote with approvalMode "admin" means an admin prices it.
bookingRoutes.post("/trip", async (c) => {
  const body = await c.req.json().catch(() => null);
  const request = parseTripRequest((body ?? {}) as Record<string, unknown>);
  if (typeof request === "string") return c.json({ error: request }, 400);

  const result = await workOutTrip(request);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({ ...result.trip, currency: CURRENCY, quote: result.quote });
});

// GET /bookings/price?serviceId=ser_01&vehicleSource=ours&fromLat=9.31&fromLng=76.61
//                    &toLat=9.59&toLng=76.52&onSiteMinutes=60&roundTrip=true&days=1
// → { approvalMode: "auto", currency: "INR", amount: 194500, travelAmount, onSiteAmount,
//     billedKm, billedDriveHrs, billedOnSiteHrs, overrunRate }   (amounts in paise)
//   or { approvalMode: "admin", reason }: not auto-approved, so an admin sends the price.
// The price of an auto-approved booking (path A), checked by quoteBooking: an
// auto-priced service, one day, 9 h or less base to base, and every rate it needs.
bookingRoutes.get("/price", async (c) => {
  const number = (name: string) => {
    const value = c.req.query(name);
    return value === undefined || value === "" ? undefined : Number(value);
  };
  const request = parseTripRequest({
    serviceId: c.req.query("serviceId"),
    vehicleSource: c.req.query("vehicleSource"),
    from: { lat: number("fromLat"), lng: number("fromLng") },
    to: { lat: number("toLat"), lng: number("toLng") },
    onSiteMinutes: number("onSiteMinutes"),
    roundTrip: c.req.query("roundTrip") === undefined ? undefined : c.req.query("roundTrip") === "true",
    days: number("days"),
  });
  if (typeof request === "string") return c.json({ error: request }, 400);

  const result = await workOutTrip(request);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { quote } = result;
  if (quote.approvalMode === "admin") return c.json(quote);
  return c.json({ ...quote, currency: CURRENCY });
});

// The YYYY-MM-DD day n days after another
function addDays(day: string, n: number) {
  return new Date(parseDay(day)! + n * DAY_MS).toISOString().slice(0, 10);
}

// The first day from `from` to `to` (YYYY-MM-DD, India time, both included) that
// already has MAX_BOOKINGS_PER_DAY open bookings, or null when none is full
async function firstFullDay(from: string, to: string) {
  const { rows } = await db.execute<{ day: string }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS day
    CROSS JOIN ${bookings}
    WHERE ${inArray(bookings.approvalStatus, [...bookingsAreOpen])}
      AND day::date BETWEEN (${bookings.dateTime} AT TIME ZONE ${BUSINESS_TIMEZONE})::date
                        AND (${bookings.endsAt} AT TIME ZONE ${BUSINESS_TIMEZONE})::date
    GROUP BY day
    HAVING COUNT(*) >= ${MAX_BOOKINGS_PER_DAY}
    ORDER BY day
    LIMIT 1
  `);
  return rows[0]?.day ?? null;
}

// GET /bookings/mine   (Authorization: Bearer <token from the web app's /api/rt-token>)
// → { bookings: [{ bookingId, serviceType, pickup, destination, dateTime, endsAt, ... }] }
// The signed-in customer's own bookings for their dashboard, latest start first.
// Amounts are minor units (paise for INR).
const MY_BOOKINGS_LIMIT = 100;

bookingRoutes.get("/mine", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "Please sign in to see your bookings" }, 401);

  const rows = await db
    .select({
      bookingId: bookings.bookingId,
      serviceType: services.serviceType,
      companionPurpose: bookings.companionPurpose,
      vehicleSource: bookings.vehicleSource,
      pickup: bookings.pickup,
      destination: bookings.destination,
      dateTime: bookings.dateTime,
      endsAt: bookings.endsAt,
      serviceHrs: bookings.serviceHrs,
      approvalMode: bookings.approvalMode,
      approvalStatus: bookings.approvalStatus,
      quoteAmount: bookings.quoteAmount,
      currency: bookings.currency,
      payBy: bookings.payBy,
      paymentStatus: bookings.paymentStatus,
      jobStatus: bookings.jobStatus,
      helperAssigned: sql<boolean>`${bookings.helperId} is not null`,
      denialReason: bookings.denialReason,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(services, eq(services.serviceId, bookings.serviceId))
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.dateTime))
    .limit(MY_BOOKINGS_LIMIT);

  return c.json({ bookings: rows });
});

// Statuses where a booking won't go ahead, so there's nothing to track
const CLOSED_STATUSES = ["denied", "declined", "expired", "cancelled"];

// GET /bookings/mine/:bookingId   (Authorization: Bearer <token from the web app's /api/rt-token>)
// → { booking: {...}, helper: { name, phoneNumber } | null, tracking: { token } | null }
// One of the signed-in customer's bookings, with everything the booking page shows.
// tracking.token lets the realtime service (apps/realtime) send them the helper's live
// location; it's only given while a helper is assigned and the job isn't over.
bookingRoutes.get("/mine/:bookingId", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "Please sign in to see your bookings" }, 401);

  const [row] = await db
    .select({
      booking: {
        bookingId: bookings.bookingId,
        serviceType: services.serviceType,
        companionPurpose: bookings.companionPurpose,
        vehicleSource: bookings.vehicleSource,
        description: bookings.description,
        pickup: bookings.pickup,
        destination: bookings.destination,
        dateTime: bookings.dateTime,
        jobStartsAt: bookings.jobStartsAt,
        endsAt: bookings.endsAt,
        serviceHrs: bookings.serviceHrs,
        effortHrs: bookings.effortHrs,
        jobStatus: bookings.jobStatus,
        expectedEndAt: bookings.expectedEndAt,
        completedAt: bookings.completedAt,
        overrunRate: bookings.overrunRate,
        overrunHrs: bookings.overrunHrs,
        overrunAmount: bookings.overrunAmount,
        overrunStatus: bookings.overrunStatus,
        approvalMode: bookings.approvalMode,
        approvalStatus: bookings.approvalStatus,
        quoteAmount: bookings.quoteAmount,
        currency: bookings.currency,
        payBy: bookings.payBy,
        paymentStatus: bookings.paymentStatus,
        denialReason: bookings.denialReason,
        cancellationReason: bookings.cancellationReason,
        createdAt: bookings.createdAt,
      },
      helperId: bookings.helperId,
      helperName: users.name,
      helperPhone: users.phoneNumber,
    })
    .from(bookings)
    .innerJoin(services, eq(services.serviceId, bookings.serviceId))
    .leftJoin(users, eq(users.id, bookings.helperId))
    // Someone else's booking id answers like a missing one
    .where(and(eq(bookings.bookingId, c.req.param("bookingId")), eq(bookings.userId, userId)))
    .limit(1);
  if (!row) return c.json({ error: "Booking not found" }, 404);

  const { booking, helperId, helperName, helperPhone } = row;
  const trackable =
    helperId !== null && booking.jobStatus !== "completed" && !CLOSED_STATUSES.includes(booking.approvalStatus);
  return c.json({
    booking,
    helper: helperId ? { name: helperName, phoneNumber: helperPhone } : null,
    tracking: trackable ? { token: await trackingToken(userId, helperId, booking.bookingId) } : null,
  });
});

// POST /bookings   (Authorization: Bearer <token from the web app's /api/rt-token>)
//   { serviceId, vehicleSource, from: { lat, lng, address }, to: { lat, lng, address },
//     onSiteMinutes, date: "YYYY-MM-DD", time: "HH:MM", roundTrip?, days?, endDate?,
//     companionPurpose?, description? }
// → 201 { bookingId, approvalMode, approvalStatus, quoteAmount, currency, payBy, ... }
// A job over several days sends days and endDate, its last day (date + days − 1).
// It goes to an admin, and takes a slot on every day from date to endDate.
// Saves the signed-in customer's booking. The trip and price are worked out again
// here, never taken from the browser. Path A (auto) waits for payment, and a helper
// is assigned once it's paid; path B (admin) waits for an admin's quote.
bookingRoutes.post("/", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "Please sign in to book" }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const fields = body ?? {};
  const request = parseTripRequest(fields);
  if (typeof request === "string") return c.json({ error: request }, 400);
  const { date, time, endDate, companionPurpose, description } = fields;
  const pickup = (fields.from as Record<string, unknown>).address;
  const destination = (fields.to as Record<string, unknown>).address;
  if (typeof pickup !== "string" || !pickup.trim() || typeof destination !== "string" || !destination.trim()) {
    return c.json({ error: "from and to need an address" }, 400);
  }
  if (typeof date !== "string" || parseDay(date) === null) {
    return c.json({ error: "date must be a date written as YYYY-MM-DD" }, 400);
  }
  if (typeof time !== "string" || !isSlotTime(time)) {
    return c.json({ error: "time must be HH:MM on the hour or half hour" }, 400);
  }
  // The last day has to agree with the number of days, so the two can't disagree
  const lastDay = addDays(date, request.days - 1);
  if (request.days > 1 && endDate !== lastDay) {
    return c.json({ error: `endDate must be ${lastDay}, the last of the ${request.days} days from date` }, 400);
  }
  if (request.days === 1 && endDate !== undefined && endDate !== date) {
    return c.json({ error: "endDate must be the same as date for a one-day booking (or left out)" }, 400);
  }
  if (description !== undefined && typeof description !== "string") {
    return c.json({ error: "description must be text" }, 400);
  }

  const start = zonedTimeToUtc(date, time, BUSINESS_TIMEZONE);
  if (start.getTime() - Date.now() < MIN_NOTICE_HOURS * HOUR_MS) {
    return c.json({ error: `Bookings have to start at least ${MIN_NOTICE_HOURS} hours from now` }, 400);
  }

  const result = await workOutTrip(request);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { trip, quote, serviceType } = result;

  // Only a companion booking says where the companion goes
  let purpose: CompanionPurpose | null = null;
  if (serviceType === "companion") {
    if (!COMPANION_PURPOSES.includes(companionPurpose as CompanionPurpose)) {
      return c.json({ error: `companionPurpose must be one of ${COMPANION_PURPOSES.join(", ")}` }, 400);
    }
    purpose = companionPurpose as CompanionPurpose;
  } else if (companionPurpose !== undefined) {
    return c.json({ error: "Only a companion booking has a companionPurpose" }, 400);
  }

  const times = bookingTimes(start, trip, trip.onSiteMinutes, request.days);
  const fullDay = await firstFullDay(date, lastDay);
  if (fullDay) {
    return c.json(
      { error: request.days > 1 ? `${fullDay} is fully booked. Please pick other days.` : "That day is fully booked. Please pick another day." },
      409,
    );
  }
  // Path A: a helper must be free for the whole job, base to base, before the customer
  // pays. This doesn't hold one: payment checks again and assigns them (R8). Path B's
  // helper is picked by the admin when approving.
  if (quote.approvalMode === "auto") {
    const helpers = await findAvailableHelpers({ start: times.jobStartsAt, end: times.endsAt });
    if (helpers.length === 0) {
      return c.json({ error: "No helper is free for that time any more. Please pick another one." }, 409);
    }
  }

  const auto = quote.approvalMode === "auto";
  const bookingId = `bk_${randomBytes(8).toString("hex")}`;
  const payBy = auto ? new Date(Math.min(Date.now() + PAY_WITHIN_MS, times.confirmBy.getTime())) : null;

  await db.transaction(async (tx) => {
    await tx.insert(bookings).values({
      bookingId,
      userId,
      serviceId: request.serviceId,
      companionPurpose: purpose,
      vehicleSource: request.vehicleSource,
      description: typeof description === "string" && description.trim() ? description.trim() : null,
      pickup: pickup.trim(),
      destination: destination.trim(),
      dateTime: start,
      // The driver's waiting time or the companion's service time
      serviceHrs: (trip.onSiteMinutes / 60).toFixed(1),
      jobStartsAt: times.jobStartsAt,
      endsAt: times.endsAt,
      plannedEndsAt: times.endsAt,
      effortHrs: times.effortHrs.toFixed(1),
      blockedUntil: times.blockedUntil,
      // Path B: the admin sets the price, and this rate, with the quote
      overrunRate: auto ? quote.overrunRate : 0,
      approvalMode: quote.approvalMode,
      approvalStatus: auto ? "awaiting_payment" : "pending_approval",
      quoteAmount: auto ? quote.amount : null,
      currency: CURRENCY,
      confirmBy: times.confirmBy,
      payBy,
      paymentStatus: "unpaid",
    });
    await tx.insert(dashboard).values({
      dashId: `dash_${bookingId}`,
      userId,
      bookingId,
      // Path A is approved by the backend on submit; path B waits for an admin
      bookAccept: auto,
      helperAccept: false,
      section: "pending",
    });
  });

  return c.json(
    {
      bookingId,
      approvalMode: quote.approvalMode,
      approvalStatus: auto ? "awaiting_payment" : "pending_approval",
      quoteAmount: auto ? quote.amount : null,
      currency: CURRENCY,
      payBy,
      dateTime: start,
      jobStartsAt: times.jobStartsAt,
      endsAt: times.endsAt,
      ...(auto ? {} : { reason: quote.reason }),
    },
    201,
  );
});

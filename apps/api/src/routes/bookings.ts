import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { bookings, bookingsAreOpen, db, serviceRates, services } from "@lemmido/db";
import {
  BUSINESS_TIMEZONE,
  hasOnSiteTime,
  isRoundTrip,
  isSlotTime,
  MAX_BOOKINGS_PER_DAY,
  MAX_TASK_MS,
  MIN_NOTICE_HOURS,
  quoteBooking,
  roundUpToSlot,
  tripFromLegs,
  zonedTimeToUtc,
  type Rates,
} from "@lemmido/shared";
import { fetchTripLegs, type LatLng } from "../google-routes.ts";
import { findAvailableHelpers, freeStartTimes } from "../helper-availability.ts";

// Longest range one request can ask for: a year, with room for the partial months at each end
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1) return "days must be a whole number, 1 or more";
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
  return { trip: { ...trip, roundTrip: isRound, onSiteMinutes }, quote };
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

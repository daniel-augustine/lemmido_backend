import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { bookings, bookingsAreOpen, db, serviceRates, services } from "@lemmido/db";
import {
  BUSINESS_TIMEZONE,
  isSlotTime,
  MAX_BOOKINGS_PER_DAY,
  MAX_TASK_MS,
  MIN_NOTICE_HOURS,
  priceBooking,
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

// POST /bookings/trip
//   { serviceId: "ser_01", vehicleSource: "ours" | "customer",
//     from: { lat, lng }, to: { lat, lng }, onSiteMinutes: 60 }
// → { legs, distanceKm, driveMinutes, leaveBaseMinutes, taskMinutes, currency, quote }
// The job's three legs (Base → From → To → Base) from Google, the task length to check
// availability for, and the price. onSiteMinutes is the driver's waiting time or the
// companion's service time. A quote with approvalMode "admin" means an admin prices it.
bookingRoutes.post("/trip", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { serviceId, vehicleSource, onSiteMinutes, ...points } = (body ?? {}) as Record<string, unknown>;
  const from = parseLatLng(points.from);
  const to = parseLatLng(points.to);
  if (!from || !to) return c.json({ error: "from and to must be { lat, lng }" }, 400);
  if (vehicleSource !== "ours" && vehicleSource !== "customer") {
    return c.json({ error: 'vehicleSource must be "ours" or "customer"' }, 400);
  }
  if (typeof onSiteMinutes !== "number" || !Number.isFinite(onSiteMinutes) || onSiteMinutes < 0) {
    return c.json({ error: "onSiteMinutes must be a number of minutes, 0 or more" }, 400);
  }
  if (typeof serviceId !== "string") return c.json({ error: "serviceId is required" }, 400);

  const [service] = await db
    .select({ serviceType: services.serviceType, autoPriced: services.autoPriced })
    .from(services)
    .where(eq(services.serviceId, serviceId));
  if (!service) return c.json({ error: `No service ${serviceId}` }, 400);

  let legs;
  try {
    legs = await fetchTripLegs(from, to);
  } catch (error) {
    console.error("Couldn't work out the route:", error);
    return c.json({ error: "Couldn't work out the route. Please try again." }, 502);
  }
  const trip = tripFromLegs(legs, onSiteMinutes);

  const rateRows = await db
    .select({ kind: serviceRates.kind, amount: serviceRates.amount })
    .from(serviceRates)
    .where(and(eq(serviceRates.serviceId, serviceId), eq(serviceRates.currency, CURRENCY)));
  const rates: Rates = Object.fromEntries(rateRows.map((row) => [row.kind, row.amount]));

  const quote = service.autoPriced
    ? priceBooking({
        serviceType: service.serviceType,
        vehicleSource,
        distanceKm: trip.distanceKm,
        driveMinutes: trip.driveMinutes,
        onSiteMinutes,
        rates,
      })
    : { approvalMode: "admin" as const, reason: "This service is priced by an admin" };

  return c.json({ ...trip, currency: CURRENCY, quote });
});

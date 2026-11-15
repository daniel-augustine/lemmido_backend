import { Hono } from "hono";
import { inArray, sql } from "drizzle-orm";
import { bookings, bookingsAreOpen, db } from "@lemmido/db";
import { BUSINESS_TIMEZONE, MAX_BOOKINGS_PER_DAY } from "@lemmido/shared";

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

export const bookingRoutes = new Hono();

// GET /bookings/full-dates?from=YYYY-MM-DD&to=YYYY-MM-DD
// → { fullDates: ["2026-11-20", ...] }: the days in that range (both ends included)
// that already have MAX_BOOKINGS_PER_DAY open bookings. A booking takes a slot on
// every day from its date_time to its ends_at, so a 3-day stay fills 3 days.
bookingRoutes.get("/full-dates", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const fromTime = parseDay(from);
  const toTime = parseDay(to);

  if (fromTime === null || toTime === null) {
    return c.json({ error: "from and to must be dates written as YYYY-MM-DD" }, 400);
  }
  if (toTime < fromTime) {
    return c.json({ error: "to can't be before from" }, 400);
  }
  if ((toTime - fromTime) / DAY_MS > MAX_RANGE_DAYS) {
    return c.json({ error: `The range can be at most ${MAX_RANGE_DAYS} days` }, 400);
  }

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

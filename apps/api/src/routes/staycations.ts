import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db, serviceRates, staycations } from "@lemmido/db";

// The staycations shown on the guided tours page. They come from
// packages/db/config/staycations.json via `pnpm db:sync-staycations`.
export const staycationRoutes = new Hono();

// Active staycations in page order, with the price per night in paise
staycationRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: staycations.serviceId,
      slug: staycations.slug,
      title: staycations.title,
      summary: staycations.summary,
      location: staycations.location,
      maxGuests: staycations.maxGuests,
      minNights: staycations.minNights,
      image: staycations.image,
      amenities: staycations.amenities,
      inclusions: staycations.inclusions,
      exclusions: staycations.exclusions,
      pricePerNight: serviceRates.amount,
      currency: serviceRates.currency,
    })
    .from(staycations)
    .leftJoin(
      serviceRates,
      and(eq(serviceRates.serviceId, staycations.serviceId), eq(serviceRates.kind, "per_night"), eq(serviceRates.currency, "INR")),
    )
    .where(eq(staycations.active, true))
    .orderBy(asc(staycations.sortOrder));

  return c.json({ staycations: rows });
});

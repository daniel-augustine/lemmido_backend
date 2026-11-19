import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db, serviceRates, tourPackages } from "@lemmido/db";

// The tour packages shown on the guided tours page. They come from
// packages/db/config/tour-packages.json via `pnpm db:sync-tours`.
export const tourPackageRoutes = new Hono();

// Active packages in page order, with the price per person in paise
tourPackageRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: tourPackages.serviceId,
      slug: tourPackages.slug,
      title: tourPackages.title,
      summary: tourPackages.summary,
      days: tourPackages.days,
      nights: tourPackages.nights,
      maxPeople: tourPackages.maxPeople,
      image: tourPackages.image,
      itinerary: tourPackages.itinerary,
      inclusions: tourPackages.inclusions,
      exclusions: tourPackages.exclusions,
      pricePerPerson: serviceRates.amount,
      currency: serviceRates.currency,
    })
    .from(tourPackages)
    .leftJoin(
      serviceRates,
      and(eq(serviceRates.serviceId, tourPackages.serviceId), eq(serviceRates.kind, "per_person"), eq(serviceRates.currency, "INR")),
    )
    .where(eq(tourPackages.active, true))
    .orderBy(asc(tourPackages.sortOrder));

  return c.json({ packages: rows });
});

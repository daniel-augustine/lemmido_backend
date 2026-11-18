import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { services } from "./services.ts";

export type ItineraryDay = { day: number; title: string; stops: string[] };

// The page content of a tour package. Each package is also a services row
// (service_type "tour_package") so bookings can point at it, and its price is
// a per_person row in service_rates. Written only by `pnpm db:sync-tours`
// from config/tour-packages.json: edit the JSON, not the table.
export const tourPackages = pgTable(
  "tour_packages",
  {
    serviceId: varchar("service_id", { length: 10 })
      .primaryKey()
      .references(() => services.serviceId),
    // Unique among active packages, so a hidden package's slug can be reused
    slug: varchar("slug", { length: 60 }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    days: integer("days").notNull(),
    nights: integer("nights").notNull(),
    maxPeople: integer("max_people").notNull(),
    image: text("image"),
    itinerary: jsonb("itinerary").$type<ItineraryDay[]>().notNull(),
    inclusions: jsonb("inclusions").$type<string[]>().notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().notNull(),
    // Display order on the packages page
    sortOrder: integer("sort_order").notNull(),
    // A package removed from the config is hidden, not deleted: old bookings still point at it
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("tour_packages_active_slug").on(t.slug).where(sql`${t.active}`),
    check("tour_packages_days_positive", sql`${t.days} >= 1`),
    check("tour_packages_nights_valid", sql`${t.nights} >= 0 AND ${t.nights} < ${t.days}`),
    check("tour_packages_max_people_positive", sql`${t.maxPeople} >= 1`),
  ],
);

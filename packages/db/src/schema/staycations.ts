import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { services } from "./services.ts";

// The page content of a staycation. Each staycation is also a services row
// (service_type "staycation") so bookings can point at it, and its price is
// a per_night row in service_rates. Written only by `pnpm db:sync-staycations`
// from config/staycations.json: edit the JSON, not the table.
export const staycations = pgTable(
  "staycations",
  {
    serviceId: varchar("service_id", { length: 10 })
      .primaryKey()
      .references(() => services.serviceId),
    // Unique among active staycations, so a hidden staycation's slug can be reused
    slug: varchar("slug", { length: 60 }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    location: text("location").notNull(),
    maxGuests: integer("max_guests").notNull(),
    minNights: integer("min_nights").notNull(),
    image: text("image"),
    amenities: jsonb("amenities").$type<string[]>().notNull(),
    inclusions: jsonb("inclusions").$type<string[]>().notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().notNull(),
    // Display order on the staycations page
    sortOrder: integer("sort_order").notNull(),
    // A staycation removed from the config is hidden, not deleted: old bookings still point at it
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("staycations_active_slug").on(t.slug).where(sql`${t.active}`),
    check("staycations_max_guests_positive", sql`${t.maxGuests} >= 1`),
    check("staycations_min_nights_positive", sql`${t.minNights} >= 1`),
  ],
);

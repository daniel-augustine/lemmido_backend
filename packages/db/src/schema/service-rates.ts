import { sql } from "drizzle-orm";
import { char, check, integer, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";
import { rateKind } from "./enums.ts";
import { services } from "./services.ts";

// The prices a service is charged at, one row per kind and currency. A service has
// only the kinds it uses (driver: per_km, drive_hour, waiting_hour; companion: per_km,
// drive_hour, service_hour). A service missing a rate it needs is quoted by an admin.
export const serviceRates = pgTable(
  "service_rates",
  {
    serviceId: varchar("service_id", { length: 10 })
      .notNull()
      .references(() => services.serviceId),
    kind: rateKind("kind").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    // Minor units (paise for INR) per km or per hour
    amount: integer("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.kind, t.currency] }),
    check("service_rates_amount_positive", sql`${t.amount} >= 0`),
  ],
);

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";
import { bookings } from "./bookings.ts";
import { alertKind, alertResolution } from "./enums.ts";

export const adminAlerts = pgTable(
  "admin_alerts",
  {
    alertId: uuid("alert_id").primaryKey().defaultRandom(),
    kind: alertKind("kind").notNull(),
    bookingId: varchar("booking_id", { length: 20 })
      .notNull()
      .references(() => bookings.bookingId),
    nextBookingId: varchar("next_booking_id", { length: 20 }).references(
      () => bookings.bookingId,
    ),
    helperId: text("helper_id")
      .notNull()
      .references(() => users.id),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id),
    resolution: alertResolution("resolution"),
  },
  (table) => [
    // "Unique while open" from datamodel.md section 4.
    // Note: Postgres treats NULLs as distinct, so this alone does not
    // dedupe alerts whose next_booking_id is NULL (running_over / break_due).
    uniqueIndex("admin_alerts_open_unique_idx")
      .on(table.kind, table.bookingId, table.nextBookingId)
      .where(sql`${table.resolvedAt} IS NULL`),
  ],
);

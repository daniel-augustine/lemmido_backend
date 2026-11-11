import { pgTable, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { bookings } from "./bookings.js";
import { dashboardSection } from "./enums.js";

export const dashboard = pgTable("dashboard", {
  dashId: varchar("dash_id", { length: 25 }).primaryKey(),
  userId: varchar("user_id", { length: 10 })
    .notNull()
    .references(() => users.userId),
  bookingId: varchar("booking_id", { length: 20 })
    .notNull()
    .unique()
    .references(() => bookings.bookingId),
  bookAccept: boolean("book_accept").notNull(),
  helperAccept: boolean("helper_accept").notNull(),
  section: dashboardSection("section").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { bookings } from "./bookings.js";
import { dashboardSection } from "./enums.js";

export const dashboard = pgTable("dashboard", {
  dashId: varchar("dash_id", { length: 25 }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bookingId: varchar("booking_id", { length: 20 })
    .notNull()
    .unique()
    .references(() => bookings.bookingId),
  bookAccept: boolean("book_accept").notNull(),
  helperAccept: boolean("helper_accept").notNull(),
  section: dashboardSection("section").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

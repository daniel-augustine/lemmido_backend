import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["customer", "admin", "employee"]);

// Customers, admins and employees (helpers). Also better-auth's user table,
// so the property names (emailVerified, image, createdAt…) must stay as they are.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    // E.164, e.g. +919876543210
    phoneNumber: varchar("phone_number", { length: 20 }).unique(),
    phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),
    image: text("image"),
    role: roleEnum("role").notNull().default("customer"),
    // ISO country of the customer's site (IN, GB, CA, US); the booking currency follows it
    country: char("country", { length: 2 }),
    // IANA time zone, e.g. Europe/London, for showing times to the user
    timezone: varchar("timezone", { length: 64 }),
    // Set instead of deleting, so past bookings keep their helper
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("users_phone_e164", sql`${t.phoneNumber} ~ '^\\+[1-9][0-9]{6,14}$'`),
    // Helpers must be reachable by phone when a job runs over
    check("users_employee_phone", sql`${t.role} <> 'employee' OR ${t.phoneNumber} IS NOT NULL`),
    // Lookup for the "available helpers" query
    index("users_active_employees")
      .on(t.id)
      .where(sql`${t.role} = 'employee' AND ${t.deactivatedAt} IS NULL`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

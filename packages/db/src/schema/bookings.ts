import {
  pgTable,
  varchar,
  char,
  numeric,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { services } from "./services.js";
import {
  approvalMode,
  bookingStatus,
  paymentStatus,
  helperSource,
  jobStatus,
  overrunStatus,
} from "./enums.js";

export const bookings = pgTable(
  "bookings",
  {
    bookingId: varchar("booking_id", { length: 20 }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    serviceId: varchar("service_id", { length: 10 })
      .notNull()
      .references(() => services.serviceId),

    // Route / timing
    pickup: text("pickup"),
    destination: text("destination").notNull(),
    dateTime: timestamp("date_time", { withTimezone: true }).notNull(),
    serviceHrs: numeric("service_hrs", { precision: 4, scale: 1 }),
    jobStartsAt: timestamp("job_starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    effortHrs: numeric("effort_hrs", { precision: 4, scale: 1 }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),

    // Job lifecycle (set by the helper)
    jobStatus: jobStatus("job_status").notNull().default("scheduled"),
    expectedEndAt: timestamp("expected_end_at", { withTimezone: true }),
    plannedEndsAt: timestamp("planned_ends_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Overrun / extra bill
    overrunRate: integer("overrun_rate").notNull(),
    overrunHrs: numeric("overrun_hrs", { precision: 4, scale: 1 }),
    overrunAmount: integer("overrun_amount"),
    overrunStatus: overrunStatus("overrun_status").notNull().default("none"),
    overrunPaymentRef: varchar("overrun_payment_ref", { length: 100 }).unique(),

    // Approval / quote
    approvalStatus: bookingStatus("approval_status").notNull(),
    approvalMode: approvalMode("approval_mode").notNull(),
    quoteAmount: integer("quote_amount"),
    currency: char("currency", { length: 3 }).notNull(),
    quotedBy: text("quoted_by").references(() => users.id),
    confirmBy: timestamp("confirm_by", { withTimezone: true }).notNull(),
    payBy: timestamp("pay_by", { withTimezone: true }),

    // Payment
    paymentStatus: paymentStatus("payment_status").notNull(),
    paymentRef: varchar("payment_ref", { length: 100 }).unique(),

    // Assignment
    helperId: text("helper_id").references(() => users.id),
    helperSource: helperSource("helper_source"),

    // Denial / cancellation
    denialReason: text("denial_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id),
    cancellationReason: text("cancellation_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Availability query from datamodel.md section 7
    index("bookings_helper_id_job_starts_at_idx").on(
      table.helperId,
      table.jobStartsAt,
    ),
    index("bookings_user_id_idx").on(table.userId),
    index("bookings_approval_status_idx").on(table.approvalStatus),
  ],
);

export const bookingsAreOpen = [
  "awaiting_payment",
  "pending_approval",
  "quoted",
  "accepted",
  "confirmed",
] as const;

import { Hono } from "hono";
import { count, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { adminAlerts, bookings, db, services, users } from "@lemmido/db";

// Admin dashboard reads. Auth middleware (role = admin) is a separate step
// (admin-api-plan.md §6.1) and not wired in yet.

const customer = alias(users, "customer");
const helper = alias(users, "helper");

export const adminRoutes = new Hono();

// GET /admin/dashboard → every dashboard section plus the open-alert count.
// Sections are derived from bookings.approval_status / overrun_status, so no
// separate dashboard table is needed.
adminRoutes.get("/dashboard", async (c) => {
  const rows = await db
    .select({
      bookingId: bookings.bookingId,
      serviceType: services.serviceType,
      dateTime: bookings.dateTime,
      destination: bookings.destination,
      approvalStatus: bookings.approvalStatus,
      jobStatus: bookings.jobStatus,
      overrunStatus: bookings.overrunStatus,
      quoteAmount: bookings.quoteAmount,
      currency: bookings.currency,
      customerName: customer.name,
      customerPhone: customer.phoneNumber,
      helperName: helper.name,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.serviceId))
    .leftJoin(customer, eq(bookings.userId, customer.id))
    .leftJoin(helper, eq(bookings.helperId, helper.id))
    .orderBy(desc(bookings.createdAt));

  const [alerts] = await db
    .select({ open: count() })
    .from(adminAlerts)
    .where(isNull(adminAlerts.resolvedAt));

  const summary = (row: (typeof rows)[number]) => ({
    bookingId: row.bookingId,
    serviceType: row.serviceType,
    dateTime: row.dateTime,
    destination: row.destination,
    approvalStatus: row.approvalStatus,
    jobStatus: row.jobStatus,
    overrunStatus: row.overrunStatus,
    quoteAmount: row.quoteAmount,
    currency: row.currency,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    helperName: row.helperName,
  });

  return c.json({
    approved: rows.filter((row) => row.approvalStatus === "confirmed").map(summary),
    toBeApproved: rows.filter((row) => row.approvalStatus === "pending_approval").map(summary),
    cancelled: rows.filter((row) => row.approvalStatus === "cancelled").map(summary),
    extraBills: rows.filter((row) => row.overrunStatus === "due").map(summary),
    openAlertCount: Number(alerts?.open ?? 0),
  });
});

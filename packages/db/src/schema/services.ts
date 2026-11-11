import { pgTable, varchar, numeric, text, boolean, integer } from "drizzle-orm/pg-core";

export const services = pgTable("services", {
  serviceId: varchar("service_id", { length: 10 }).primaryKey(),
  serviceType: varchar("service_type", { length: 30 }).notNull(),
  serviceHrs: numeric("service_hrs", { precision: 4, scale: 1 }),
  description: text("description").notNull(),
  autoPriced: boolean("auto_priced").notNull(),
  overrunRate: integer("overrun_rate"),
});

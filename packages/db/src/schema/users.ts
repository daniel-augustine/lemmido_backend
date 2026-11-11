import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core";
import { userRole } from "./enums.js";

export const users = pgTable("users", {
  userId: varchar("user_id", { length: 10 }).primaryKey(),
  role: userRole("role").notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  email: varchar("email", { length: 255 }).unique(),
  phone: varchar("phone", { length: 20 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

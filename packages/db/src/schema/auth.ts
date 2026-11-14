import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

// better-auth tables. better-auth looks columns up by these property names,
// so keep them as they are; the SQL column names are ours to choose.

const ts = (name: string) => timestamp(name, { withTimezone: true });

// One row per way a user signs in (e.g. provider "cognito", accountId = Cognito sub)
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    // Only for better-auth's own email + password sign-in; empty for Cognito
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("account_provider_account").on(t.providerId, t.accountId),
    index("account_user_id").on(t.userId),
  ],
);

// One row per signed-in device
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("session_user_id").on(t.userId)],
);

// Short-lived values: OAuth state, PKCE verifier, email/phone codes
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);

export type Account = typeof account.$inferSelect;
export type Session = typeof session.$inferSelect;

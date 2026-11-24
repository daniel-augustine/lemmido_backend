import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./client.ts";
import { services, users } from "./schema/index.ts";

// Example rows from datamodel.md, plus a few users so the
// availability queries have helpers to work with. Safe to re-run.
async function seed() {
  await db
    .insert(services)
    .values([
      {
        serviceId: "ser_01",
        serviceType: "driver",
        serviceHrs: "2.0",
        description: "Two-way drive to a location",
        autoPriced: true,
      },
      {
        serviceId: "ser_03",
        serviceType: "companion",
        description: "Companion",
        autoPriced: true,
      },
      {
        serviceId: "ser_04",
        serviceType: "property",
        description: "Property management",
        autoPriced: false,
      },
    ])
    // Re-running keeps whether each service is auto-priced in line with this file, so a
    // service seeded before it was switched to auto-pricing doesn't stay admin-priced
    .onConflictDoUpdate({ target: services.serviceId, set: { autoPriced: sql`excluded.auto_priced` } });

  // Driver and companion rates come from config/service-rates.json (pnpm db:sync-rates)

  await db
    .insert(users)
    .values([
      { id: "11111111-1111-4111-8111-111111111111", role: "customer", name: "Anu Thomas", email: "anu@example.com", phoneNumber: "+919000000001" },
      { id: "22222222-2222-4222-8222-222222222222", role: "customer", name: "Binu George", email: "binu@example.com", phoneNumber: "+919000000002" },
      { id: "33333333-3333-4333-8333-333333333333", role: "admin", name: "Admin", email: "admin@example.com", phoneNumber: "+919000000003" },
      { id: "44444444-4444-4444-8444-444444444444", role: "employee", name: "Helper One", email: "helper1@example.com", phoneNumber: "+919000000004" },
      { id: "55555555-5555-4555-8555-555555555555", role: "employee", name: "Helper Two", email: "helper2@example.com", phoneNumber: "+919000000005" },
      { id: "66666666-6666-4666-8666-666666666666", role: "employee", name: "Helper Three", email: "helper3@example.com", phoneNumber: "+919000000006" },
      { id: "77777777-7777-4777-8777-777777777777", role: "employee", name: "Helper Four", email: "helper4@example.com", phoneNumber: "+919000000007" },
      { id: "88888888-8888-4888-8888-888888888888", role: "employee", name: "Helper Five", email: "helper5@example.com", phoneNumber: "+919000000008" },
    ])
    .onConflictDoNothing();

  console.log("Seed complete");
}

seed().catch((err) => {
  console.error("Seed failed", err);
  process.exit(1);
});

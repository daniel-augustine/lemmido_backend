import "dotenv/config";
import { db } from "./client.js";
import { services, users } from "./schema/index.js";

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
        overrunRate: 100,
      },
      {
        serviceId: "ser_02",
        serviceType: "hospital_visit",
        description: "Hospital visit (e.g. Ernakulam hospital)",
        autoPriced: true,
        overrunRate: 500,
      },
      {
        serviceId: "ser_03",
        serviceType: "companion",
        description: "Companion",
        autoPriced: false,
      },
      {
        serviceId: "ser_04",
        serviceType: "property",
        description: "Property management",
        autoPriced: false,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      { id: "11111111-1111-4111-8111-111111111111", role: "customer", name: "Anu Thomas", email: "anu@example.com", phoneNumber: "+919000000001" },
      { id: "22222222-2222-4222-8222-222222222222", role: "customer", name: "Binu George", email: "binu@example.com", phoneNumber: "+919000000002" },
      { id: "33333333-3333-4333-8333-333333333333", role: "admin", name: "Admin", email: "admin@example.com", phoneNumber: "+919000000003" },
      { id: "44444444-4444-4444-8444-444444444444", role: "employee", name: "Helper One", email: "helper1@example.com", phoneNumber: "+919000000004" },
      { id: "55555555-5555-4555-8555-555555555555", role: "employee", name: "Helper Two", email: "helper2@example.com", phoneNumber: "+919000000005" },
    ])
    .onConflictDoNothing();

  console.log("Seed complete");
}

seed().catch((err) => {
  console.error("Seed failed", err);
  process.exit(1);
});

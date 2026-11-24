import "dotenv/config";
import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "./client.ts";
import { serviceRates, services } from "./schema/index.ts";

// Writes the per km and per hour rates in config/service-rates.json into the database:
//   pnpm db:sync-rates            apply the config
//   pnpm db:sync-rates --dry-run  validate and show what would change
// Services are matched by id and must already exist (pnpm db:seed). A rate taken out
// of the config is deleted, so that service's bookings go to an admin to price (path B).
// Tour and staycation rates (per_person, per_night) have their own config files.

const CONFIG_PATH = new URL("../config/service-rates.json", import.meta.url);

// The rate kinds this file owns
const KINDS = ["per_km", "drive_hour", "waiting_hour", "service_hour"] as const;
type Kind = (typeof KINDS)[number];

const serviceSchema = z
  .object({
    id: z.string().min(1).max(10),
    // Must match services.service_type, so a rate can't land on the wrong service
    service: z.string().min(1),
    // Whole rupees per km or per hour; stored in paise
    ratesInr: z.partialRecord(z.enum(KINDS), z.int().min(0)),
  })
  .strict();

const configSchema = z
  .object({ services: z.array(serviceSchema) })
  .strict()
  .superRefine(({ services }, ctx) => {
    const seen = new Set<string>();
    services.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate id "${s.id}"`, path: ["services", i, "id"] });
      seen.add(s.id);
    });
  });

async function loadConfig() {
  const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Invalid ${CONFIG_PATH.pathname}:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data.services;
}

const key = (serviceId: string, kind: string) => `${serviceId} ${kind}`;
const rupees = (paise: number) => `₹${paise / 100}`;

async function sync(dryRun: boolean) {
  const config = await loadConfig();

  // Every service in the file has to exist and be the type the file says
  const serviceRows = await db.select({ id: services.serviceId, type: services.serviceType }).from(services);
  const typeById = new Map(serviceRows.map((r) => [r.id, r.type]));
  const problems = config.flatMap((s) => {
    const type = typeById.get(s.id);
    if (type === undefined) return [`${s.id}: no such service (run pnpm db:seed first)`];
    if (type !== s.service) return [`${s.id}: is a ${type} service, not ${s.service}`];
    return [];
  });
  if (problems.length) {
    console.error(`Invalid ${CONFIG_PATH.pathname}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }

  const wanted = new Map<string, { serviceId: string; kind: Kind; amount: number }>();
  for (const s of config) {
    for (const [kind, inr] of Object.entries(s.ratesInr) as [Kind, number][]) {
      wanted.set(key(s.id, kind), { serviceId: s.id, kind, amount: inr * 100 });
    }
  }

  const existing = await db
    .select({ serviceId: serviceRates.serviceId, kind: serviceRates.kind, amount: serviceRates.amount })
    .from(serviceRates)
    .where(and(eq(serviceRates.currency, "INR"), inArray(serviceRates.kind, [...KINDS])));
  const existingByKey = new Map(existing.map((r) => [key(r.serviceId, r.kind), r]));

  const added = [...wanted].filter(([k]) => !existingByKey.has(k));
  const changed = [...wanted].filter(([k, r]) => existingByKey.has(k) && existingByKey.get(k)!.amount !== r.amount);
  const removed = existing.filter((r) => !wanted.has(key(r.serviceId, r.kind)));

  console.log(`Add: ${added.map(([k, r]) => `${k} ${rupees(r.amount)}`).join(", ") || "none"}`);
  console.log(
    `Change: ${changed.map(([k, r]) => `${k} ${rupees(existingByKey.get(k)!.amount)} → ${rupees(r.amount)}`).join(", ") || "none"}`,
  );
  console.log(`Delete (removed from config): ${removed.map((r) => key(r.serviceId, r.kind)).join(", ") || "none"}`);
  if (dryRun) {
    console.log("Dry run: nothing written");
    return;
  }

  await db.transaction(async (tx) => {
    for (const r of removed) {
      await tx
        .delete(serviceRates)
        .where(
          and(eq(serviceRates.serviceId, r.serviceId), eq(serviceRates.kind, r.kind), eq(serviceRates.currency, "INR")),
        );
    }
    for (const r of wanted.values()) {
      await tx
        .insert(serviceRates)
        .values({ ...r, currency: "INR" })
        .onConflictDoUpdate({
          target: [serviceRates.serviceId, serviceRates.kind, serviceRates.currency],
          set: { amount: r.amount },
        });
    }
  });

  console.log(`Synced ${wanted.size} rates for ${config.length} services`);
}

sync(process.argv.includes("--dry-run"))
  .catch((err) => {
    console.error("Rate sync failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

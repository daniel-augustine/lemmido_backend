import "dotenv/config";
import { readFile } from "node:fs/promises";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "./client.ts";
import { serviceRates, services, tourPackages } from "./schema/index.ts";

// Writes config/tour-packages.json into the database:
//   pnpm db:sync-tours            apply the config
//   pnpm db:sync-tours --dry-run  validate and show what would change
// Packages are matched by id. A package taken out of the config is hidden
// (active = false), never deleted, because bookings may still point at it.

const CONFIG_PATH = new URL("../config/tour-packages.json", import.meta.url);

const packageSchema = z
  .object({
    // Also the services.service_id, so at most 10 characters
    id: z.string().regex(/^tp_[a-z0-9_]{1,7}$/, "must look like tp_xxx (at most 10 characters)"),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase words joined by hyphens").max(60),
    title: z.string().min(1),
    summary: z.string().min(1),
    days: z.int().min(1),
    nights: z.int().min(0),
    // Whole rupees; stored in paise
    pricePerPersonInr: z.int().min(0),
    maxPeople: z.int().min(1),
    image: z.string().min(1).optional(),
    itinerary: z.array(z.object({ day: z.int().min(1), title: z.string().min(1), stops: z.array(z.string().min(1)) })).min(1),
    inclusions: z.array(z.string().min(1)),
    exclusions: z.array(z.string().min(1)),
  })
  .strict()
  .refine((p) => p.nights < p.days, { message: "nights must be less than days", path: ["nights"] })
  .refine((p) => p.itinerary.every((d) => d.day <= p.days), { message: "an itinerary day is past the last day", path: ["itinerary"] });

const configSchema = z
  .object({ packages: z.array(packageSchema) })
  .strict()
  .superRefine(({ packages }, ctx) => {
    for (const key of ["id", "slug"] as const) {
      const seen = new Set<string>();
      packages.forEach((p, i) => {
        if (seen.has(p[key])) ctx.addIssue({ code: "custom", message: `duplicate ${key} "${p[key]}"`, path: ["packages", i, key] });
        seen.add(p[key]);
      });
    }
  });

async function loadConfig() {
  const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Invalid ${CONFIG_PATH.pathname}:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data.packages;
}

async function sync(dryRun: boolean) {
  const packages = await loadConfig();
  const ids = packages.map((p) => p.id);

  const existing = await db.select({ id: tourPackages.serviceId, active: tourPackages.active }).from(tourPackages);
  const existingIds = new Set(existing.map((r) => r.id));
  const added = ids.filter((id) => !existingIds.has(id));
  const updated = ids.filter((id) => existingIds.has(id));
  const hidden = existing.filter((r) => r.active && !ids.includes(r.id)).map((r) => r.id);

  console.log(`Add: ${added.join(", ") || "none"}`);
  console.log(`Update: ${updated.join(", ") || "none"}`);
  console.log(`Hide (removed from config): ${hidden.join(", ") || "none"}`);
  if (dryRun) {
    console.log("Dry run: nothing written");
    return;
  }

  await db.transaction(async (tx) => {
    // Hide first so a new package can take a removed package's slug
    await tx
      .update(tourPackages)
      .set({ active: false })
      .where(ids.length ? and(eq(tourPackages.active, true), notInArray(tourPackages.serviceId, ids)) : eq(tourPackages.active, true));

    for (const [index, p] of packages.entries()) {
      const service = { serviceType: "tour_package", description: p.title, autoPriced: true };
      await tx
        .insert(services)
        .values({ serviceId: p.id, ...service })
        .onConflictDoUpdate({ target: services.serviceId, set: service });

      const page = {
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        days: p.days,
        nights: p.nights,
        maxPeople: p.maxPeople,
        image: p.image ?? null,
        itinerary: p.itinerary,
        inclusions: p.inclusions,
        exclusions: p.exclusions,
        sortOrder: index,
        active: true,
      };
      await tx
        .insert(tourPackages)
        .values({ serviceId: p.id, ...page })
        .onConflictDoUpdate({ target: tourPackages.serviceId, set: page });

      const amount = p.pricePerPersonInr * 100;
      await tx
        .insert(serviceRates)
        .values({ serviceId: p.id, kind: "per_person", currency: "INR", amount })
        .onConflictDoUpdate({
          target: [serviceRates.serviceId, serviceRates.kind, serviceRates.currency],
          set: { amount },
        });
    }
  });

  console.log(`Synced ${packages.length} tour packages`);
}

sync(process.argv.includes("--dry-run"))
  .catch((err) => {
    console.error("Tour package sync failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

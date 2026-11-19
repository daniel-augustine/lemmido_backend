import "dotenv/config";
import { readFile } from "node:fs/promises";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "./client.ts";
import { serviceRates, services, staycations } from "./schema/index.ts";

// Writes config/staycations.json into the database:
//   pnpm db:sync-staycations            apply the config
//   pnpm db:sync-staycations --dry-run  validate and show what would change
// Staycations are matched by id. One taken out of the config is hidden
// (active = false), never deleted, because bookings may still point at it.

const CONFIG_PATH = new URL("../config/staycations.json", import.meta.url);

const staycationSchema = z
  .object({
    // Also the services.service_id, so at most 10 characters
    id: z.string().regex(/^st_[a-z0-9_]{1,7}$/, "must look like st_xxx (at most 10 characters)"),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase words joined by hyphens").max(60),
    title: z.string().min(1),
    summary: z.string().min(1),
    location: z.string().min(1),
    // Whole rupees; stored in paise
    pricePerNightInr: z.int().min(0),
    maxGuests: z.int().min(1),
    minNights: z.int().min(1),
    image: z.string().min(1).optional(),
    amenities: z.array(z.string().min(1)),
    inclusions: z.array(z.string().min(1)),
    exclusions: z.array(z.string().min(1)),
  })
  .strict();

const configSchema = z
  .object({ staycations: z.array(staycationSchema) })
  .strict()
  .superRefine(({ staycations }, ctx) => {
    for (const key of ["id", "slug"] as const) {
      const seen = new Set<string>();
      staycations.forEach((s, i) => {
        if (seen.has(s[key])) ctx.addIssue({ code: "custom", message: `duplicate ${key} "${s[key]}"`, path: ["staycations", i, key] });
        seen.add(s[key]);
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
  return result.data.staycations;
}

async function sync(dryRun: boolean) {
  const stays = await loadConfig();
  const ids = stays.map((s) => s.id);

  const existing = await db.select({ id: staycations.serviceId, active: staycations.active }).from(staycations);
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
    // Hide first so a new staycation can take a removed one's slug
    await tx
      .update(staycations)
      .set({ active: false })
      .where(ids.length ? and(eq(staycations.active, true), notInArray(staycations.serviceId, ids)) : eq(staycations.active, true));

    for (const [index, s] of stays.entries()) {
      const service = { serviceType: "staycation", description: s.title, autoPriced: true };
      await tx
        .insert(services)
        .values({ serviceId: s.id, ...service })
        .onConflictDoUpdate({ target: services.serviceId, set: service });

      const page = {
        slug: s.slug,
        title: s.title,
        summary: s.summary,
        location: s.location,
        maxGuests: s.maxGuests,
        minNights: s.minNights,
        image: s.image ?? null,
        amenities: s.amenities,
        inclusions: s.inclusions,
        exclusions: s.exclusions,
        sortOrder: index,
        active: true,
      };
      await tx
        .insert(staycations)
        .values({ serviceId: s.id, ...page })
        .onConflictDoUpdate({ target: staycations.serviceId, set: page });

      const amount = s.pricePerNightInr * 100;
      await tx
        .insert(serviceRates)
        .values({ serviceId: s.id, kind: "per_night", currency: "INR", amount })
        .onConflictDoUpdate({
          target: [serviceRates.serviceId, serviceRates.kind, serviceRates.currency],
          set: { amount },
        });
    }
  });

  console.log(`Synced ${stays.length} staycations`);
}

sync(process.argv.includes("--dry-run"))
  .catch((err) => {
    console.error("Staycation sync failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

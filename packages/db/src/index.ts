import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://lemmido:lemmido_dev@localhost:5432/lemmido",
  max: 10,
});

export const db = drizzle(pool, { schema });
export { schema };
export * from "./schema/index.ts";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://lemmido:lemmido_dev@localhost:5432/lemmido",
  max: 10,
});

// An idle connection dropped by Postgres (restart, network blip) is emitted here.
// Without a listener Node treats it as unhandled and kills the whole process;
// the pool replaces the connection on its own.
pool.on("error", (error) => console.error("Postgres pool error:", error.message));

export const db = drizzle(pool, { schema });
export { pool, schema };

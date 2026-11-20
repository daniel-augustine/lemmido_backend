import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool } from "@lemmido/db";
import { bookingRoutes } from "./routes/bookings.ts";
import { staycationRoutes } from "./routes/staycations.ts";
import { tourPackageRoutes } from "./routes/tour-packages.ts";

const PORT = Number(process.env.API_PORT ?? 8081);
// The web app's address(es), comma-separated. The mobile app doesn't need CORS.
const WEB_ORIGINS = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",");

const app = new Hono();

app.use("*", cors({ origin: WEB_ORIGINS }));

app.get("/health", (c) => c.text("ok"));
app.route("/bookings", bookingRoutes);
app.route("/tour-packages", tourPackageRoutes);
app.route("/staycations", staycationRoutes);

app.onError((error, c) => {
  console.error(`${c.req.method} ${c.req.path} failed:`, error);
  return c.json({ error: "Something went wrong" }, 500);
});

serve({ fetch: app.fetch, port: PORT }, async (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`api service on ${url}`);
  console.log(`  GET ${url}/health`);
  console.log(`  GET ${url}/bookings/full-dates?from=YYYY-MM-DD&to=YYYY-MM-DD`);
  console.log(`  GET ${url}/bookings/unavailable-dates?from=YYYY-MM-DD&to=YYYY-MM-DD&taskMinutes=120`);
  console.log(`  GET ${url}/bookings/available-times?date=YYYY-MM-DD&taskMinutes=120`);
  console.log(`  POST ${url}/bookings/check-availability {date, time, taskMinutes}`);
  console.log(`  POST ${url}/bookings/trip {serviceId, vehicleSource, from, to, onSiteMinutes}`);
  console.log(`  GET ${url}/bookings/price?serviceId=&vehicleSource=&fromLat=&fromLng=&toLat=&toLng=&onSiteMinutes=`);
  console.log(`  POST ${url}/bookings {serviceId, vehicleSource, from, to, onSiteMinutes, date, time, ...} (signed in)`);
  console.log(`  GET ${url}/bookings/mine (signed in)`);
  console.log(`  GET ${url}/bookings/mine/:bookingId (signed in)`);
  console.log(`  GET ${url}/tour-packages`);
  console.log(`  GET ${url}/staycations`);
  console.log(`  CORS allowed for: ${WEB_ORIGINS.join(", ")}`);

  // Requests still start while the database is down; this only says so up front
  try {
    await pool.query("SELECT 1");
    console.log("  database: connected");
  } catch (error) {
    console.error(`  database: NOT reachable (${(error as Error).message}). Is Docker running? Try: docker compose up -d`);
  }
});

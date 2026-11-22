import type { Leg } from "@lemmido/shared";

export type LatLng = { lat: number; lng: number };

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Our base, where every job starts and ends (BASE_LAT / BASE_LNG in .env)
function baseLocation(): LatLng {
  const lat = Number(process.env.BASE_LAT);
  const lng = Number(process.env.BASE_LNG);
  if (!process.env.BASE_LAT || !process.env.BASE_LNG || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("BASE_LAT and BASE_LNG must be set in .env");
  }
  return { lat, lng };
}

const waypoint = ({ lat, lng }: LatLng) => ({ location: { latLng: { latitude: lat, longitude: lng } } });

// The driving legs of a job from Google's Routes API in one request: Base → From →
// To → Base, or on a round trip Base → From → To → From → Base. Throws when the key
// is missing or Google finds no route.
export async function fetchTripLegs(from: LatLng, to: LatLng, roundTrip: boolean): Promise<Leg[]> {
  const key = process.env.GOOGLE_ROUTES_API_KEY;
  if (!key) throw new Error("GOOGLE_ROUTES_API_KEY must be set in .env");
  const base = baseLocation();
  const stops = roundTrip ? [from, to, from] : [from, to];

  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      // Only the per-leg distance and time: Google bills by the fields asked for
      "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration",
    },
    body: JSON.stringify({
      origin: waypoint(base),
      intermediates: stops.map(waypoint),
      destination: waypoint(base),
      travelMode: "DRIVE",
    }),
  });
  if (!res.ok) throw new Error(`Routes API returned HTTP ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    routes?: { legs?: { distanceMeters?: number; duration?: string }[] }[];
  };
  const legs = data.routes?.[0]?.legs;
  if (!legs || legs.length !== stops.length + 1) throw new Error("Routes API found no driving route");

  // Duration comes as a string of seconds, e.g. "1234s". A leg between two points
  // at the same spot has no distance field at all.
  return legs.map((leg) => ({
    distanceMeters: leg.distanceMeters ?? 0,
    durationSeconds: Number.parseFloat(leg.duration ?? "0s"),
  }));
}

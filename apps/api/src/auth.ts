import type { Context } from "hono";
import { jwtVerify, SignJWT } from "jose";

// The web app signs a short-lived token for the signed-in user (lemmido_frontend
// src/app/api/rt-token) with the same JWT_SECRET; its subject is their users.id.
function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET must be set in .env");
  return new TextEncoder().encode(value);
}

// The signed-in user's id from the `Authorization: Bearer <token>` header,
// or null when there's no valid token
export async function signedInUserId(c: Context): Promise<string | null> {
  const token = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

// How long a tracking token works: long enough to keep watching through a job
const TRACKING_TOKEN_TTL = "12h";

// A token for the realtime service (apps/realtime) that lets the customer `customerId`
// watch the live location of `helperId`, the helper on their booking `bookingId`
export function trackingToken(customerId: string, helperId: string, bookingId: string) {
  return new SignJWT({ watch: helperId, booking: bookingId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(customerId)
    .setIssuedAt()
    .setExpirationTime(TRACKING_TOKEN_TTL)
    .sign(secret());
}

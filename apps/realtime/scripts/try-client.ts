import { SignJWT } from "jose";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me"
);

// Make a token the server will accept, for a fake user
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("test-user")
  .sign(JWT_SECRET);

const ws = new WebSocket(`ws://localhost:${PORT}?token=${token}`);

ws.on("open", () => {
  console.log("connected");
  // A valid location, then a bad message so you can see the error reply
  ws.send(JSON.stringify({ type: "location", lat: 43.65, lng: -79.38, timestamp: Date.now() }));
  ws.send("not json");
  setTimeout(() => ws.close(), 500);
});

ws.on("message", (data) => console.log("server says:", data.toString()));
ws.on("close", () => console.log("closed"));
ws.on("error", (err) => console.error("error:", err.message));

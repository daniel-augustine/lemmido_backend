import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { jwtVerify } from "jose";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8080);
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me"
);

// What a location message from the client must look like
const locationMessage = z.object({
  type: z.literal("location"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: z.number(),
});

type Location = z.infer<typeof locationMessage>;

// Who is on the other end of a connection: someone sharing their own location (a helper
// on a job), or a customer watching one helper's location for their booking
type Connection = { userId: string; watching: string | null };

// Each sharer's latest location, so a viewer who joins sees it straight away, and the
// viewers of each sharer. In memory, so one instance only: Redis is the next step.
const lastLocation = new Map<string, Location>();
const viewersOf = new Map<string, Set<WebSocket>>();

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

// Plain HTTP server, so we can answer a /health check
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

// Check the token before allowing the WebSocket connection
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) throw new Error("missing token");

    const { payload } = await jwtVerify(token, JWT_SECRET);
    // A tracking token from the API (GET /bookings/mine/:id) names the helper the
    // customer may watch; an ordinary sign-in token shares the user's own location
    const connection: Connection = {
      userId: String(payload.sub),
      watching: typeof payload.watch === "string" && payload.watch ? payload.watch : null,
    };

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, connection);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, { userId, watching }: Connection) => {
  if (watching) {
    // A viewer only receives: the helper's last known location now, then each update
    console.log(`viewer ${userId} watching ${watching}`);
    let viewers = viewersOf.get(watching);
    if (!viewers) viewersOf.set(watching, (viewers = new Set()));
    viewers.add(ws);
    const last = lastLocation.get(watching);
    if (last) send(ws, last);
    ws.on("close", () => {
      viewers.delete(ws);
      if (viewers.size === 0) viewersOf.delete(watching);
    });
    return;
  }

  console.log(`connected: ${userId}`);

  ws.on("message", (data) => {
    try {
      const msg = locationMessage.parse(JSON.parse(data.toString()));
      lastLocation.set(userId, msg);
      for (const viewer of viewersOf.get(userId) ?? []) send(viewer, msg);
    } catch {
      send(ws, { type: "error", message: "invalid message" });
    }
  });

  ws.on("close", () => console.log(`disconnected: ${userId}`));
});

server.listen(PORT, () => console.log(`realtime service on ws://localhost:${PORT} (health: http://localhost:${PORT}/health)`));
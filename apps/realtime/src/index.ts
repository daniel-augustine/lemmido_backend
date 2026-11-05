import { createServer } from "node:http";
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
    const userId = String(payload.sub);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, userId);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, _req, userId: string) => {
  console.log(`connected: ${userId}`);

  ws.on("message", (data) => {
    try {
      const msg = locationMessage.parse(JSON.parse(data.toString()));
      console.log(`location from ${userId}:`, msg.lat, msg.lng);
      // Next step: write to Redis and publish to viewers
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  });

  ws.on("close", () => console.log(`disconnected: ${userId}`));
});

server.listen(PORT, () => console.log(`realtime service on :${PORT}`));
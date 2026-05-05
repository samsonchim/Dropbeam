// DropBeam Signaling Server — FIXED
const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 8080;
const FRONTEND_URL = "https://dropbeam-mu.vercel.app";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_URL);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", frontend: FRONTEND_URL }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("DropBeam signaling server is running.");
});

const wss = new WebSocket.Server({
  server,
  verifyClient: ({ origin }, callback) => {
    if (!origin || origin === FRONTEND_URL) {
      callback(true);
    } else {
      console.warn(`Rejected WebSocket connection from origin: ${origin}`);
      callback(false, 403, "Forbidden");
    }
  },
});

const rooms = new Map();

function broadcast(room, senderWs, message) {
  if (!rooms.has(room)) return;
  const data = JSON.stringify(message);
  rooms.get(room).forEach((client) => {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastAll(room, message) {
  if (!rooms.has(room)) return;
  const data = JSON.stringify(message);
  rooms.get(room).forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on("connection", (ws) => {
  let currentRoom = null;
  let peerId = Math.random().toString(36).substr(2, 8);

  ws.on("message", (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (msg.type) {
      case "join": {
        const room = msg.room?.toUpperCase().trim();
        if (!room) return;

        currentRoom = room;
        ws.peerId = peerId;

        if (!rooms.has(room)) rooms.set(room, new Set());
        const members = rooms.get(room);

        // ✅ FIX: Add to room BEFORE broadcasting
        members.add(ws);

        // Tell new peer about existing peers (they'll initiate connections OUT)
        const existingPeers = [...members].filter(c => c !== ws).map((c) => c.peerId);
        ws.send(JSON.stringify({ type: "room-joined", room, peerId, peers: existingPeers }));

        // Tell existing peers about new peer (they'll accept connections IN)
        broadcast(room, ws, { type: "peer-joined", peerId });

        console.log(`[${room}] Peer ${peerId} joined. Total: ${members.size}`);
        break;
      }

      case "signal": {
        if (!currentRoom || !msg.to) return;
        const target = [...(rooms.get(currentRoom) || [])].find((c) => c.peerId === msg.to);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ type: "signal", from: peerId, data: msg.data }));
        }
        break;
      }

      case "chat": {
        if (!currentRoom) return;
        broadcast(currentRoom, ws, { type: "chat", from: peerId, text: msg.text });
        break;
      }

      case "leave": {
        handleLeave();
        break;
      }
    }
  });

  function handleLeave() {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      broadcast(currentRoom, ws, { type: "peer-left", peerId });
      console.log(`[${currentRoom}] Peer ${peerId} left. Remaining: ${rooms.get(currentRoom).size}`);
      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
        console.log(`[${currentRoom}] Room closed.`);
      }
    }
  }

  ws.on("close", handleLeave);
  ws.on("error", handleLeave);
});

server.listen(PORT, () => {
  console.log(`\n✅ DropBeam server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket signaling active on ws://localhost:${PORT}`);
  console.log(`🌐 Accepting connections from: ${FRONTEND_URL}\n`);
});

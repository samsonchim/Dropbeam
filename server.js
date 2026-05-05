// DropBeam Signaling Server — FIXED
const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 8080;
const FRONTEND_URL = "https://dropbeam-mu.vercel.app";
const ALLOWED_ORIGINS = [FRONTEND_URL, "http://localhost:8080", "http://localhost:3000", "http://127.0.0.1:8080", "http://127.0.0.1:3000", null];

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
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(true);
    } else {
      console.warn(`Rejected WebSocket connection from origin: ${origin}`);
      callback(false, 403, "Forbidden");
    }
  },
});

const rooms = new Map();

// Keepalive heartbeat
const HEARTBEAT_INTERVAL = 30000;
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`Terminating dead connection for peer ${ws.peerId || "unknown"}`);
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => {
  clearInterval(heartbeat);
});

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
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  let currentRoom = null;
  const peerId = Math.random().toString(36).substr(2, 8);
  ws.peerId = peerId;

  ws.on("message", (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      console.warn(`Peer ${peerId} sent invalid JSON`);
      return;
    }

    switch (msg.type) {
      case "join": {
        const room = msg.room?.toUpperCase().trim();
        if (!room) return;

        currentRoom = room;

        if (!rooms.has(room)) rooms.set(room, new Set());
        const members = rooms.get(room);

        // Add to room BEFORE broadcasting
        members.add(ws);

        // Tell new peer about existing peers (they'll wait for connections IN)
        const existingPeers = [...members].filter(c => c !== ws).map((c) => c.peerId);
        ws.send(JSON.stringify({ type: "room-joined", room, peerId, peers: existingPeers }));

        // Tell existing peers about new peer (they'll initiate connections OUT)
        broadcast(room, ws, { type: "peer-joined", peerId });

        console.log(`[${room}] Peer ${peerId} joined. Total: ${members.size}`);
        break;
      }

      case "signal": {
        if (!currentRoom || !msg.to) return;
        const target = [...(rooms.get(currentRoom) || [])].find((c) => c.peerId === msg.to);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ type: "signal", from: peerId, data: msg.data }));
        } else {
          console.warn(`Signal target ${msg.to} not found or not open in room ${currentRoom}`);
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
      const roomMembers = rooms.get(currentRoom);
      const wasInRoom = roomMembers.has(ws);
      roomMembers.delete(ws);

      if (wasInRoom) {
        broadcast(currentRoom, ws, { type: "peer-left", peerId });
        console.log(`[${currentRoom}] Peer ${peerId} left. Remaining: ${roomMembers.size}`);
      }

      if (roomMembers.size === 0) {
        rooms.delete(currentRoom);
        console.log(`[${currentRoom}] Room closed.`);
      }
      currentRoom = null;
    }
  }

  ws.on("close", (code, reason) => {
    console.log(`Peer ${peerId} disconnected (code: ${code}, reason: ${reason || "none"})`);
    handleLeave();
  });

  ws.on("error", (err) => {
    console.error(`Peer ${peerId} WebSocket error:`, err.message);
    // Do NOT call handleLeave here — transient errors shouldn't boot the peer
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ DropBeam server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket signaling active on ws://localhost:${PORT}`);
  console.log(`🌐 Accepting connections from: ${FRONTEND_URL} (and localhost for dev)`);
  console.log(`💓 Heartbeat every ${HEARTBEAT_INTERVAL / 1000}s\n`);
});

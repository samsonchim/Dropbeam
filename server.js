// DropBeam Signaling Server
// Run with: node server.js
// Requires: npm install ws

const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  // Serve the index.html file
  if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("index.html not found. Place it in the same folder as server.js");
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocket.Server({ server });

// rooms: { roomCode: Set<WebSocket> }
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

        // Send current peer list to new joiner
        const existingPeers = [...members].map((c) => c.peerId);
        ws.send(JSON.stringify({ type: "room-joined", room, peerId, peers: existingPeers }));

        // Notify others
        broadcast(room, ws, { type: "peer-joined", peerId });

        members.add(ws);
        console.log(`[${room}] Peer ${peerId} joined. Total: ${members.size}`);
        break;
      }

      case "signal": {
        // WebRTC signaling relay (offer/answer/ICE)
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
  console.log(`\nShare http://localhost:${PORT} on your local network (or deploy to a server)\n`);
});

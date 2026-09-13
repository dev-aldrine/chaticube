import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static assets from assets/
app.use('/assets', express.static(path.join(rootDir, 'assets')));
app.use(express.static(path.join(rootDir, 'dist')));

// In-Memory Multiplayer State
// roomName -> { ownerId, ownerName, createdAt, players: Map(socketId -> playerData), blocks: Map(key -> blockData) }
const rooms = new Map();

function getOrCreateRoom(roomName, socketId, playerName) {
  let room = rooms.get(roomName);
  if (!room) {
    room = {
      name: roomName,
      ownerId: socketId,
      ownerName: playerName,
      createdAt: Date.now(),
      players: new Map(),
      blocks: new Map(), // 'x,y,z' -> { x, y, z, type }
      pianoOccupantId: null
    };
    rooms.set(roomName, room);
  }
  return room;
}

function getWorldsList() {
  const list = [];
  for (const [name, room] of rooms.entries()) {
    const count = room.players.size;
    if (count > 0 || (Date.now() - room.createdAt < 600000)) { // Keep active or recent
      list.push({
        name: room.name,
        owner: room.ownerName || 'Public',
        playerCount: count,
        createdAt: room.createdAt,
        blockCount: room.blocks.size
      });
    }
  }
  return list.sort((a, b) => b.playerCount - a.playerCount);
}

function broadcastWorldsList() {
  io.emit('worlds-updated', getWorldsList());
}

// REST API for Worlds
app.get('/api/worlds', (req, res) => {
  res.json(getWorldsList());
});

// Socket.io Real-Time Protocol
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerData = null;

  // Initial worlds query
  socket.emit('worlds-updated', getWorldsList());

  socket.on('request-worlds', () => {
    socket.emit('worlds-updated', getWorldsList());
  });

  // Client Ping / Pong for live latency display
  socket.on('client-ping', (clientTimestamp, callback) => {
    if (typeof callback === 'function') {
      callback(clientTimestamp);
    } else {
      socket.emit('server-pong', clientTimestamp);
    }
  });

  socket.on('player-ping', ({ ping }) => {
    if (playerData) {
      playerData.ping = typeof ping === 'number' ? Math.round(ping) : 0;
    }
    if (currentRoom) {
      socket.to(currentRoom).emit('player-ping-update', {
        id: socket.id,
        ping: playerData ? playerData.ping : 0
      });
    }
  });

  socket.on('join-room', ({ roomName, name, colors }) => {
    if (!roomName || !name) return;
    const cleanRoom = roomName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default-room';
    const cleanName = name.trim().slice(0, 20) || 'Player';

    // Leave existing room if any
    if (currentRoom) {
      handleLeaveRoom();
    }

    currentRoom = cleanRoom;
    socket.join(currentRoom);

    const room = getOrCreateRoom(currentRoom, socket.id, cleanName);
    const isOwner = room.ownerId === socket.id;

    // Spawn coordinate calculation
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist = Math.random() * 2;
    const spawnX = Math.cos(spawnAngle) * spawnDist;
    const spawnZ = Math.sin(spawnAngle) * spawnDist;

    playerData = {
      id: socket.id,
      name: cleanName,
      colors: colors || { skin: '#ffd1b3', shirt: '#4f46e5', pants: '#2563eb', hair: '#4b382a' },
      x: spawnX,
      y: 0,
      z: spawnZ,
      rotationY: 0,
      anim: 'idle',
      heldItem: 'wall',
      joinedAt: Date.now(),
      ping: 0
    };

    room.players.set(socket.id, playerData);

    // Prepare existing players list
    const existingPlayers = Array.from(room.players.values());
    const existingBlocks = Array.from(room.blocks.values());

    // Send full room snapshot to joining player
    socket.emit('room-joined', {
      roomName: currentRoom,
      isOwner,
      ownerId: room.ownerId,
      ownerName: room.ownerName,
      selfId: socket.id,
      players: existingPlayers,
      blocks: existingBlocks,
      pianoOccupantId: room.pianoOccupantId
    });

    // Notify other players in the room
    socket.to(currentRoom).emit('player-joined', playerData);

    broadcastWorldsList();
  });

  socket.on('piano-lock', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.pianoOccupantId = socket.id;
    io.in(currentRoom).emit('piano-occupied', { occupantId: socket.id });
  });

  socket.on('piano-unlock', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.pianoOccupantId === socket.id) {
      room.pianoOccupantId = null;
      io.in(currentRoom).emit('piano-occupied', { occupantId: null });
    }
  });

  socket.on('piano-note', (data) => {
    if (!currentRoom) return;
    // Broadcast piano note to all other players in the room
    socket.to(currentRoom).emit('piano-note', {
      senderId: socket.id,
      note: data.note,
      velocity: data.velocity,
      on: Boolean(data.on)
    });
  });

  socket.on('piano-sustain', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('piano-sustain', {
      senderId: socket.id,
      isDown: Boolean(data.isDown)
    });
  });

  socket.on('player-update', (data) => {
    if (!currentRoom || !playerData) return;
    playerData.x = data.x ?? playerData.x;
    playerData.y = data.y ?? playerData.y;
    playerData.z = data.z ?? playerData.z;
    playerData.rotationY = data.rotationY ?? playerData.rotationY;
    playerData.anim = data.anim ?? playerData.anim;
    playerData.heldItem = data.heldItem ?? playerData.heldItem;
    if (typeof data.ping === 'number') {
      playerData.ping = Math.round(data.ping);
    }

    // Fast broadcast to room (exclude sender)
    socket.to(currentRoom).emit('player-moved', {
      id: socket.id,
      x: playerData.x,
      y: playerData.y,
      z: playerData.z,
      rotationY: playerData.rotationY,
      anim: playerData.anim,
      heldItem: playerData.heldItem,
      ping: playerData.ping
    });
  });

  socket.on('place-block', ({ x, y, z, type, rotationY }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const blockKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const block = {
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z),
      type: type || 'wall',
      rotationY: rotationY || 0,
      placedBy: playerData?.name || 'Player'
    };

    room.blocks.set(blockKey, block);
    io.in(currentRoom).emit('block-placed', block);
  });

  socket.on('remove-block', ({ x, y, z }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const blockKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    if (room.blocks.has(blockKey)) {
      room.blocks.delete(blockKey);
      io.in(currentRoom).emit('block-removed', { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
    }
  });

  socket.on('chat-message', ({ message, image }) => {
    if (!currentRoom || !playerData) return;
    const cleanMsg = typeof message === 'string' ? message.trim().slice(0, 150) : '';
    
    // Sanitize image attachment (only accept valid base64 data URIs under 120KB)
    let cleanImage = null;
    if (typeof image === 'string' && image.startsWith('data:image/') && image.length < 130000) {
      cleanImage = image;
    }

    if (!cleanMsg && !cleanImage) return;

    io.in(currentRoom).emit('chat-message', {
      id: socket.id,
      name: playerData.name,
      message: cleanMsg,
      image: cleanImage,
      timestamp: Date.now()
    });
  });

  // ==========================================
  // WebRTC P2P Voice Chat Signaling & Mic State
  // ==========================================
  socket.on('voice-signal', ({ targetId, signal }) => {
    if (!currentRoom || !targetId) return;
    // Relay WebRTC offer / answer / ICE candidate directly to target peer
    io.to(targetId).emit('voice-signal', {
      senderId: socket.id,
      signal
    });
  });

  socket.on('mic-status', ({ isMuted, isSpeaking }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('player-mic-status', {
      id: socket.id,
      isMuted: Boolean(isMuted),
      isSpeaking: Boolean(isSpeaking)
    });
  });

  function handleLeaveRoom() {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.players.delete(socket.id);
      socket.to(currentRoom).emit('player-left', { id: socket.id });

      if (room.pianoOccupantId === socket.id) {
        room.pianoOccupantId = null;
        socket.to(currentRoom).emit('piano-occupied', { occupantId: null });
      }

      // Transfer ownership if owner left
      if (room.ownerId === socket.id && room.players.size > 0) {
        const nextPlayer = room.players.values().next().value;
        room.ownerId = nextPlayer.id;
        room.ownerName = nextPlayer.name;
        io.in(currentRoom).emit('owner-changed', {
          ownerId: room.ownerId,
          ownerName: room.ownerName
        });
      }

      // Cleanup empty rooms after some inactivity
      if (room.players.size === 0) {
        setTimeout(() => {
          const r = rooms.get(currentRoom);
          if (r && r.players.size === 0) {
            rooms.delete(currentRoom);
            broadcastWorldsList();
          }
        }, 120000);
      }
    }
    socket.leave(currentRoom);
    currentRoom = null;
    broadcastWorldsList();
  }

  socket.on('leave-room', handleLeaveRoom);

  socket.on('disconnect', () => {
    handleLeaveRoom();
  });
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(rootDir, 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

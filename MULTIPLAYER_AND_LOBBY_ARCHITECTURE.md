# Multiplayer Networking & Lobby/Worlds System Architecture

A clean, production-ready specification for implementing multiplayer networking, room isolation, entity interpolation, and a modern 3D Character Studio Lobby with a live Worlds Browser.

---

## Table of Contents
1. [Multiplayer Network Architecture](#1-multiplayer-network-architecture)
2. [Socket.io Event Protocol & Payloads](#2-socketio-event-protocol--payloads)
3. [Client-Side Entity Interpolation (`RemotePlayer`)](#3-client-side-entity-interpolation-remoteplayer)
4. [Lobby UI & 3D Character Studio Architecture](#4-lobby-ui--3d-character-studio-architecture)
5. [Live Worlds Browser & Directory System](#5-live-worlds-browser--directory-system)
6. [Smooth Audio & View Transitions](#6-smooth-audio--view-transitions)

---

## 1. Multiplayer Network Architecture

### A. Topology & Server Authority
- **Server:** Node.js with Express and Socket.io.
- **Room Isolation:** Each room/world is an independent Socket.io room (`socket.join(roomName)`). Movement, chat, and interaction updates are strictly scoped to the player's current room.
- **State Storage:** In-memory room maps on the server holding the authoritative list of connected players, room metadata, and placed objects.

```
                 ┌─────────────────────────────────────────┐
                 │          Node.js Server                │
                 │  ┌───────────────────────────────────┐  │
                 │  │  Room: "cozy-lounge"              │  │
                 │  │  - World Objects / State          │  │
                 │  │  - Connected Sockets              │  │
                 │  └───────────────────────────────────┘  │
                 └──────────────▲───────────────▲──────────┘
                                │               │
                    Socket.io   │               │   Socket.io
                   (WebSockets) │               │  (WebSockets)
                                │               │
                   ┌────────────▼──┐         ┌──▼────────────┐
                   │ Client A      │         │ Client B      │
                   │ (LocalPlayer) │         │ (RemotePlayer)│
                   └───────────────┘         └───────────────┘
```

---

## 2. Socket.io Event Protocol & Payloads

### A. Lifecycle & Joining
| Event Name | Direction | Purpose | Payload |
|---|---|---|---|
| `join-room` | Client $\rightarrow$ Server | Request to join or create a room | `{ roomName, name, colors, wearables }` |
| `room-joined` | Server $\rightarrow$ Client | Initial room state, objects & self ID | `{ roomName, isOwner, ownerId, objects, players, selfId }` |
| `player-joined` | Server $\rightarrow$ Room | Broadcast new player arrival to others | `{ id, name, colors, wearables, x, y, z, anim }` |
| `player-left` | Server $\rightarrow$ Room | Broadcast player disconnect to others | `{ id: socket.id }` |

### B. Movement & Animation Sync (20–30 Hz)
Clients transmit delta updates only when position, rotation, or animation changes:
```javascript
// Client -> Server (player-update)
socket.emit('player-update', {
  x: localPlayer.position.x,
  y: localPlayer.position.y,
  z: localPlayer.position.z,
  rotationY: localPlayer.rotation.y,
  anim: 'walk', // 'idle' | 'walk' | 'sit' | 'action'
  heldItem: 'stone_axe',
  isBusy: false
});

// Server -> Room (player-moved)
socket.to(currentRoom).emit('player-moved', {
  id: socket.id,
  x, y, z, rotationY, anim, heldItem, isBusy
});
```

### C. World Interactions & Chat
- **Object Placed:** `{ x, y, z, type, category, rotation, customData }`
- **Object Removed:** `{ x, y, z, category }`
- **Chat Message:** `{ id, name, message, timestamp }`

---

## 3. Client-Side Entity Interpolation (`RemotePlayer`)

### Smooth Network Smoothing
Remote player packets arrive at discrete tick intervals (e.g., 20Hz). Snapping coordinates directly causes visual jitter. Use frame-rate independent linear interpolation (`lerp`) for position and spherical interpolation (`slerp`) for rotation:

```javascript
import * as THREE from 'three';

export class RemotePlayer {
  constructor(data, scene) {
    this.scene = scene;
    this.id = data.id;
    this.name = data.name;

    this.mesh = this.createCharacterMesh(data.colors);
    this.targetPosition = new THREE.Vector3(data.x, data.y, data.z);
    this.targetRotationY = data.rotationY || 0;
    this.mesh.position.copy(this.targetPosition);

    this.currentAnim = 'idle';
    this.scene.add(this.mesh);
  }

  // Called when 'player-moved' network packet arrives
  onNetworkUpdate(data) {
    this.targetPosition.set(data.x, data.y, data.z);
    this.targetRotationY = data.rotationY;

    if (data.anim && data.anim !== this.currentAnim) {
      this.playAnimation(data.anim);
    }
  }

  // Called every frame in requestAnimationFrame
  update(delta) {
    if (!this.mesh) return;

    // Smooth position lerp (damping factor 18)
    const lerpFactor = Math.min(18 * delta, 1.0);
    this.mesh.position.lerp(this.targetPosition, lerpFactor);

    // Shortest-angle rotation interpolation
    let rotDiff = this.targetRotationY - this.mesh.rotation.y;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    this.mesh.rotation.y += rotDiff * Math.min(20 * delta, 1.0);

    // Update Animation Mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }
  }

  destroy() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
  }
}
```

---

## 4. Lobby UI & 3D Character Studio Architecture

### A. Layout Structure (Responsive 2-Column Card)
A modern Glassmorphism lobby card floating over a dark atmospheric background:

```
┌────────────────────────────────────────────────────────────────────────┐
│  GAME LOBBY PORTAL                                       [Music Icon]  │
├──────────────────────────────────┬─────────────────────────────────────┤
│  LEFT: 3D Character Studio       │  RIGHT: Portal & Navigation         │
│                                  │  [ Play ] [ Worlds (3) ] [ Account] │
│   ┌──────────────────────────┐   ├─────────────────────────────────────┤
│   │                          │   │  Nickname: [ peko        ] [Random] │
│   │   3D Canvas Character    │   │  Room:     [ cozy-lounge ]          │
│   │   (Idle 360° Orbit)      │   │                                     │
│   │                          │   │  ┌───────────────────────────────┐  │
│   └──────────────────────────┘   │  │   [ Enter World -> ]          │  │
│   [ Random Look & Name ]         │  └───────────────────────────────┘  │
│                                  │                                     │
│   Skin:   [●][●][●][●][●]        │  Hint: If room is new, you become   │
│   Shirt:  [●][●][●][●][●]        │  the Room Owner!                    │
│   Pants:  [●][●][●][●][●]        │                                     │
└──────────────────────────────────┴─────────────────────────────────────┘
```

### B. 3D Character Studio (`CharacterPreviewRenderer`)
Runs an isolated, lightweight Three.js instance dedicated to character preview:
```javascript
export class CharacterPreviewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    
    this.camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 100);
    this.camera.position.set(0, 1.2, 4.2);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true, // Transparent canvas background
      antialias: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(3, 5, 4);
    this.scene.add(dirLight);

    this.loadCharacterModel();
  }

  updateColors(colors) {
    // Generate composite canvas texture and apply to avatar material
    this.characterMaterial.map = this.compositeTexture(colors);
    this.characterMaterial.needsUpdate = true;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.characterMesh) {
      // Gentle floating/rotating idle preview
      this.characterMesh.rotation.y += 0.012;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
```

---

## 5. Live Worlds Browser & Directory System

### A. Server World State Aggregator
The server maintains live metadata across all active rooms:
```javascript
function getWorldsList() {
  const worldList = [];
  for (const [name, data] of rooms.entries()) {
    const playerCount = Object.keys(data.players || {}).length;
    worldList.push({
      name: name,
      owner: data.ownerName || 'Public',
      playerCount: playerCount,
      claimedAt: data.claimedAt
    });
  }
  // Sort by highest player count first
  return worldList.sort((a, b) => b.playerCount - a.playerCount);
}

// Broadcast to lobby when player counts change
function broadcastWorldsList() {
  io.emit('worlds-updated', getWorldsList());
}
```

### B. REST API & WebSocket Sync
1. **REST Endpoint:** `GET /api/worlds` returns JSON of active rooms.
2. **Real-time Push:** `socket.on('worlds-updated', (worlds) => renderWorldsGrid(worlds))` updates room cards instantly when someone joins or leaves anywhere on the server.

### C. World Card UI Element
```html
<div class="world-card" data-room="sunny-park">
  <div class="world-card-info">
    <div class="world-card-header">
      <span class="world-card-name">sunny-park</span>
      <span class="world-pill-badge">Online: 4</span>
    </div>
    <span class="world-card-desc">Owner: mochi &bull; Created 2h ago</span>
  </div>
  <button type="button" class="btn-join-world" onclick="joinSpecificRoom('sunny-park')">
    Join
  </button>
</div>
```

---

## 6. Smooth Audio & View Transitions

### A. Join World Flow
```
User clicks [Enter World]
  │
  ├── 1. Trigger Loading Overlay (backdrop blur, animated progress bar)
  ├── 2. Fade out Lobby BGM (400ms linear fade)
  ├── 3. Emit 'join-room' over Socket.io
  ├── 4. Receive 'room-joined' -> populate initial world & spawn player
  ├── 5. Hide Loading Overlay (CSS opacity transition 350ms)
  ├── 6. Show In-Game HUD (Status bar, hotbar, chat)
  └── 7. Start In-Game Soundtrack Playlist
```

### B. Exit to Menu Flow
```
User clicks [Exit World] in Settings/HUD
  │
  ├── 1. Disconnect / Leave Socket.io room
  ├── 2. Stop In-Game Music
  ├── 3. Hide In-Game HUD
  ├── 4. Reveal Lobby Modal & Restart Character Studio Canvas
  ├── 5. Resume Lobby Music
  └── 6. Trigger real-time refresh of Worlds Browser
```

---

## Summary Protocol Reference

| System | Key Component | Pattern |
|---|---|---|
| **Networking** | Socket.io Rooms | Authoritative server room isolation with client prediction |
| **Smoothing** | `RemotePlayer.js` | Position `lerp` + Rotation shortest-angle `slerp` at 60 FPS |
| **Avatar Studio** | `CharacterPreviewRenderer` | Isolated transparent WebGL canvas with live palette swapping |
| **Worlds Browser** | `worlds-updated` | Real-time WebSocket broadcasting + REST `/api/worlds` fallback |
| **Audio Pipeline** | `AudioManager.js` | Crossfading between Lobby BGM and In-Game Soundtrack |

# Three.js Isometric Game Engine Architecture & Optimization Guide

A modular, production-ready guide for building high-performance, locked-60 FPS 3D isometric and voxel games in Three.js on Web and Mobile.

---

## Table of Contents
1. [Isometric Camera & View System](#1-isometric-camera--view-system)
2. [WebGLRenderer & Mobile DPR Clamping](#2-webglrenderer--mobile-dpr-clamping)
3. [Zero-Allocation Render Loop (GC Elimination)](#3-zero-allocation-render-loop-gc-elimination)
4. [Scene Graph Partitioning & Static Matrix Baking](#4-scene-graph-partitioning--static-matrix-baking)
5. [Throttled View-Frustum Culling](#5-throttled-view-frustum-culling)
6. [Chunk Streaming & WebGL Memory Disposal](#6-chunk-streaming--webgl-memory-disposal)
7. [Material Sharing & Texture Dilation](#7-material-sharing--texture-dilation)
8. [Perfect Voxel Collision & Sliding Physics](#8-perfect-voxel-collision--sliding-physics)

---

## 1. Isometric Camera & View System

### A. True Orthographic Isometric Setup
To create a standard isometric view in Three.js without perspective distortion:
```javascript
import * as THREE from 'three';

export class CameraSystem {
  constructor() {
    this.currentZoom = 14.5;
    this.targetZoom = 14.5;
    this.minZoom = 8.0;
    this.maxZoom = 24.0;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.currentZoom * aspect,
       this.currentZoom * aspect,
       this.currentZoom,
      -this.currentZoom,
       0.1,
       1000
    );

    // True 35.264° / 45° isometric angle
    this.camera.position.set(20, 20, 20);
    this.camera.lookAt(0, 0, 0);

    // Fixed camera offset from focus target
    this.cameraOffset = new THREE.Vector3(20, 20, 20);
  }

  // Handle browser resizing
  onResize() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = -this.currentZoom * aspect;
    this.camera.right = this.currentZoom * aspect;
    this.camera.top = this.currentZoom;
    this.camera.bottom = -this.currentZoom;
    this.camera.updateProjectionMatrix();
  }

  // Smooth scroll zooming
  handleZoom(deltaY) {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom + deltaY * 0.008));
  }

  // Smooth lerp follow behind target player
  update(targetPosition, delta) {
    // Zoom interpolation
    if (Math.abs(this.targetZoom - this.currentZoom) > 0.01) {
      this.currentZoom += (this.targetZoom - this.currentZoom) * Math.min(10 * delta, 1);
      this.onResize();
    }

    if (!targetPosition) return;

    // Smooth camera position damping
    const targetCamX = targetPosition.x + this.cameraOffset.x;
    const targetCamY = targetPosition.y + this.cameraOffset.y;
    const targetCamZ = targetPosition.z + this.cameraOffset.z;

    const lerpSpeed = Math.min(14 * delta, 1);
    this.camera.position.x += (targetCamX - this.camera.position.x) * lerpSpeed;
    this.camera.position.y += (targetCamY - this.camera.position.y) * lerpSpeed;
    this.camera.position.z += (targetCamZ - this.camera.position.z) * lerpSpeed;

    // Look directly at player
    this.camera.lookAt(targetPosition.x, targetPosition.y, targetPosition.z);
  }
}
```

---

## 2. WebGLRenderer & Mobile DPR Clamping

High-DPI screens (Retina / 3x / 4x mobile devices) will cause catastrophic GPU fillrate drops if given unconstrained pixel ratios.

```javascript
export class RenderSystem {
  constructor(container) {
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window);
    this.resolutionScale = 1.0;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile, // Disable expensive MSAA on mobile devices
      alpha: false,
      powerPreference: 'high-performance',
      precision: this.isMobile ? 'mediump' : 'highp'
    });

    this.updatePixelRatio();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    container.appendChild(this.renderer.domElement);
  }

  updatePixelRatio() {
    if (!this.renderer) return;
    const baseDpr = window.devicePixelRatio || 1;
    
    // Strict Cap: Max 1.5 on mobile, max 2.0 on desktop
    const maxDpr = this.isMobile ? 1.5 : 2.0;
    const clampedBase = Math.min(baseDpr, maxDpr);
    const effectivePixelRatio = Math.max(0.4, Math.min(maxDpr, clampedBase * this.resolutionScale));

    this.renderer.setPixelRatio(effectivePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setResolutionScale(scale) {
    this.resolutionScale = Math.max(0.5, Math.min(1.5, scale));
    this.updatePixelRatio();
  }
}
```

---

## 3. Zero-Allocation Render Loop (GC Elimination)

### Rule
**Never allocate heap memory (`new THREE.*`, inline arrays `[]`, or temporary objects `{}`) in your 60 FPS tick/animate loop.** Allocations trigger frequent Garbage Collection (GC) pauses causing stutter.

### Solution
Allocate static module-level scratch variables once at startup and reuse them with `.set()`, `.copy()`, and `.setFromObject()`.

```javascript
// Static Scratch Objects (Allocated ONCE at file top)
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchBoxA = new THREE.Box3();
const _scratchBoxB = new THREE.Box3();
const _scratchRaycaster = new THREE.Raycaster();
const _scratchMatrix = new THREE.Matrix4();
const _scratchFrustum = new THREE.Frustum();

export class ExampleRenderLoop {
  tick(player, delta) {
    // WRONG (Allocates new heap object every frame):
    // const targetPos = new THREE.Vector3(player.x, player.y + 0.5, player.z);

    // CORRECT (Zero allocations):
    _scratchVecA.set(player.x, player.y + 0.5, player.z);
    
    // Use scratch vector in calculations
    _scratchBoxA.setFromCenterAndSize(_scratchVecA, _scratchVecB.set(1, 2, 1));
  }
}
```

---

## 4. Scene Graph Partitioning & Static Matrix Baking

Placing thousands of meshes as flat children in `scene.add(mesh)` forces Three.js to run deep recursive matrix calculations every frame.

### 1. Chunk-Based Groups
Partition objects into 16×16 tile chunk groups:
```javascript
export class WorldSceneManager {
  constructor(scene) {
    this.scene = scene;
    this.chunkGroups = new Map(); // 'cx,cz' -> THREE.Group
  }

  getOrCreateChunkGroup(cx, cz) {
    const key = `${cx},${cz}`;
    let chunkGroup = this.chunkGroups.get(key);
    if (!chunkGroup) {
      chunkGroup = new THREE.Group();
      chunkGroup.name = `chunk_${key}`;
      this.chunkGroups.set(key, chunkGroup);
      this.scene.add(chunkGroup);
    }
    return chunkGroup;
  }

  addStaticBlock(x, y, z, mesh) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const chunkGroup = this.getOrCreateChunkGroup(cx, cz);

    mesh.position.set(x, y, z);

    // BAKE TRANSFORM & DISABLE MATRIX AUTO-UPDATE:
    // Stops Three.js from recalculating matrix math on static objects
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);

    chunkGroup.add(mesh);
  }
}
```

---

## 5. Throttled View-Frustum Culling

Three.js mesh bounding-sphere culling still tests every mesh on CPU. Testing whole chunk bounding boxes and setting `chunkGroup.visible = false` lets Three.js skip entire subtrees in 1 check.

```javascript
export class FrustumCullingSystem {
  constructor(camera, chunkGroups) {
    this.camera = camera;
    this.chunkGroups = chunkGroups;
    this.frameCounter = 0;
  }

  update() {
    this.frameCounter++;
    // Throttle check to every 10 frames (~160ms) for near-zero CPU cost
    if (this.frameCounter % 10 !== 0) return;

    this.camera.updateMatrixWorld();
    _scratchMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _scratchFrustum.setFromProjectionMatrix(_scratchMatrix);

    for (const [chunkKey, chunkGroup] of this.chunkGroups.entries()) {
      const [cx, cz] = chunkKey.split(',').map(Number);

      // 16x16 Chunk World Bounding Box
      _scratchBoxA.min.set(cx * 16 - 2, -10, cz * 16 - 2);
      _scratchBoxA.max.set((cx + 1) * 16 + 2, 20, (cz + 1) * 16 + 2);

      const inFrustum = _scratchFrustum.intersectsBox(_scratchBoxA);
      if (chunkGroup.visible !== inFrustum) {
        chunkGroup.visible = inFrustum; // Skips all matrix updates and draw calls for this chunk
      }
    }
  }
}
```

---

## 6. Chunk Streaming & WebGL Memory Disposal

When chunks are unloaded, geometries, textures, and materials must be explicitly disposed to avoid GPU VRAM memory leaks.

```javascript
export class ChunkStreamer {
  constructor(scene, chunkGroups, worldData) {
    this.scene = scene;
    this.chunkGroups = chunkGroups;
    this.worldData = worldData;
  }

  unloadDistantChunks(playerChunkX, playerChunkZ, renderRadius = 2) {
    for (const [chunkKey, chunkGroup] of this.chunkGroups.entries()) {
      const [cx, cz] = chunkKey.split(',').map(Number);
      const distance = Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));

      if (distance > renderRadius) {
        this.disposeChunk(chunkKey, chunkGroup);
      }
    }
  }

  disposeChunk(chunkKey, chunkGroup) {
    this.scene.remove(chunkGroup);

    // Deep WebGL Resource Cleanup
    chunkGroup.traverse((node) => {
      if (node.isMesh) {
        if (node.geometry) {
          node.geometry.dispose();
        }
        // Only dispose material if it was cloned specifically for this instance
        if (node.material && node.userData.isUniqueMaterial) {
          if (Array.isArray(node.material)) {
            node.material.forEach(m => m.dispose());
          } else {
            node.material.dispose();
          }
        }
      }
    });

    this.chunkGroups.delete(chunkKey);
    this.worldData.deleteChunk(chunkKey);
  }
}
```

---

## 7. Material Sharing & Texture Dilation

### A. Texture Dilation Pass (Eliminates 1px Gutter Seams)
Pixel art textures in 3D often bleed border transparent pixels due to texture filtering. Run a 3-pass canvas dilation once on load:
```javascript
export async function createDilatedTexture(sourceTexture) {
  const img = sourceTexture.image;
  const canvas = document.createElement('canvas');
  const width = img.width || 64;
  const height = img.height || 64;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 3 dilation passes into transparent edge pixels
  for (let pass = 0; pass < 3; pass++) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (copy[idx + 3] === 0) { // transparent pixel
          const neighbors = [
            x > 0 ? (y * width + (x - 1)) * 4 : null,
            x < width - 1 ? (y * width + (x + 1)) * 4 : null,
            y > 0 ? ((y - 1) * width + x) * 4 : null,
            y < height - 1 ? ((y + 1) * width + x) * 4 : null
          ];
          for (const nIdx of neighbors) {
            if (nIdx !== null && copy[nIdx + 3] > 0) {
              data[idx] = copy[nIdx];
              data[idx + 1] = copy[nIdx + 1];
              data[idx + 2] = copy[nIdx + 2];
              data[idx + 3] = 255;
              break;
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.magFilter = THREE.NearestFilter;
  newTexture.minFilter = THREE.NearestFilter;
  newTexture.generateMipmaps = false;
  return newTexture;
}
```

### B. Universal Material Reuse
Keep single static references for standard voxel block types:
```javascript
// Reused across tens of thousands of instances:
export const SharedMaterials = {
  grass: new THREE.MeshStandardMaterial({ map: dilatedGrassTexture, roughness: 0.8 }),
  dirt: new THREE.MeshStandardMaterial({ map: dilatedDirtTexture, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ map: dilatedStoneTexture, roughness: 0.6 })
};
```

---

## 8. Perfect Voxel Collision & Sliding Physics

### A. $O(1)$ Spatial Hash Grid
Store terrain and placed solid blocks in a keyed `Map`:
```javascript
export class WorldStorage {
  constructor() {
    this.solidBlocks = new Map(); // 'x,y,z' -> { type, solid: true, box: THREE.Box3 }
  }

  setBlock(x, y, z, data) {
    this.solidBlocks.set(`${Math.round(x)},${Math.round(y)},${Math.round(z)}`, data);
  }

  getBlock(x, y, z) {
    return this.solidBlocks.get(`${Math.round(x)},${Math.round(y)},${Math.round(z)}`) || null;
  }

  isSolid(x, y, z) {
    const block = this.getBlock(x, y, z);
    return block !== null && block.solid === true;
  }
}
```

### B. Swept Axis Sliding Physics (Smooth Wall Sliding)
Resolve X and Z motion independently so the character smoothly slides along walls instead of sticking:

```javascript
export class PlayerPhysics {
  constructor(worldStorage) {
    this.world = worldStorage;
    this.radius = 0.28; // Player horizontal collision radius
    this.height = 1.4;
  }

  move(player, inputDir, speed, delta) {
    const moveX = inputDir.x * speed * delta;
    const moveZ = inputDir.z * speed * delta;

    const currentX = player.position.x;
    const currentY = player.position.y;
    const currentZ = player.position.z;

    // --- STEP 1: TEST & RESOLVE X AXIS ---
    const targetX = currentX + moveX;
    if (!this.checkCollisionAt(targetX, currentY, currentZ)) {
      player.position.x = targetX;
    }

    // --- STEP 2: TEST & RESOLVE Z AXIS ---
    const targetZ = currentZ + moveZ;
    if (!this.checkCollisionAt(player.position.x, currentY, targetZ)) {
      player.position.z = targetZ;
    }
  }

  // Exact neighborhood bounds check
  checkCollisionAt(x, y, z) {
    const minTileX = Math.floor(x - this.radius);
    const maxTileX = Math.floor(x + this.radius);
    const minTileZ = Math.floor(z - this.radius);
    const maxTileZ = Math.floor(z + this.radius);
    const tileY = Math.round(y);

    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let tz = minTileZ; tz <= maxTileZ; tz++) {
        // Test blocks at body height
        if (this.world.isSolid(tx, tileY, tz) || this.world.isSolid(tx, tileY + 1, tz)) {
          // Point-in-box overlap check
          const boxMinX = tx - 0.5;
          const boxMaxX = tx + 0.5;
          const boxMinZ = tz - 0.5;
          const boxMaxZ = tz + 0.5;

          const playerMinX = x - this.radius;
          const playerMaxX = x + this.radius;
          const playerMinZ = z - this.radius;
          const playerMaxZ = z + this.radius;

          const overlapX = playerMaxX > boxMinX && playerMinX < boxMaxX;
          const overlapZ = playerMaxZ > boxMinZ && playerMinZ < boxMaxZ;

          if (overlapX && overlapZ) {
            return true; // Collision detected
          }
        }
      }
    }
    return false;
  }
}
```

---

## Summary Checklist for Locked 60 FPS

| Optimization | Rule / Target | Impact |
|---|---|---|
| **Mobile DPR** | Cap `devicePixelRatio` at `1.5` on mobile screens | Eliminates GPU fillrate overload & thermal throttling |
| **Render Loop GC** | 0 heap allocations in `tick()` using pre-allocated scratch objects | Completely eliminates GC frame spikes |
| **Matrix Baking** | `matrixAutoUpdate = false` on static terrain blocks | Cuts matrix traversal CPU cost by >80% |
| **Frustum Culling** | Test 16×16 chunk boxes against `THREE.Frustum` every 10 frames | Skips off-screen subtrees & draw calls |
| **Memory Cleanup** | Unload distant chunks & call `.dispose()` on unused resources | Prevents unbounded VRAM leaks |
| **Material Sharing**| Share `MeshStandardMaterial` across identical voxel blocks | Minimizes WebGL texture swaps |
| **Physics** | Independent swept X/Z AABB checks on spatial hash map | 0ms collision compute with smooth wall sliding |

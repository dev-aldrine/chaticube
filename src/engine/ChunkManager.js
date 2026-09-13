import * as THREE from 'three';

// Static Module-Level Scratch Objects (GC Elimination)
const _scratchBox = new THREE.Box3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchFrustum = new THREE.Frustum();

export class ChunkManager {
  constructor(scene, worldStorage, assetLoader) {
    this.scene = scene;
    this.worldStorage = worldStorage;
    this.assetLoader = assetLoader;
    this.chunkGroups = new Map(); // 'cx,cz' -> THREE.Group
    this.frameCounter = 0;
    this.chunkSize = 16;
  }

  getOrCreateChunkGroup(cx, cz) {
    const key = `${cx},${cz}`;
    let group = this.chunkGroups.get(key);
    if (!group) {
      group = new THREE.Group();
      group.name = `chunk_${key}`;
      this.chunkGroups.set(key, group);
      this.scene.add(group);
    }
    return group;
  }

  // Generate 15x15 World (-7 to 7) with North and West walls
  generateWorld15x15() {
    const minCoord = -7;
    const maxCoord = 7;

    // 1. 15x15 Base Floor (-7 to 7) flush at y = 0
    for (let x = minCoord; x <= maxCoord; x++) {
      for (let z = minCoord; z <= maxCoord; z++) {
        this.addFloorTile(x, 0, z);
      }
    }

    // 2. North Wall (along X at z = minCoord = -7, rotated -90 deg so panel sits on outer -Z border facing +Z)
    for (let x = minCoord; x <= maxCoord; x++) {
      this.addWallBlock(x, 0, minCoord, -Math.PI / 2);
    }

    // 3. West Wall (along Z at x = minCoord = -7, rotation 0 so panel sits on outer -X border facing +X)
    for (let z = minCoord; z <= maxCoord; z++) {
      this.addWallBlock(minCoord, 0, z, 0);
    }
  }

  // Alias
  generateBaseFloor() {
    this.generateWorld15x15();
  }

  addFloorTile(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const chunkGroup = this.getOrCreateChunkGroup(cx, cz);

    const tileMesh = this.assetLoader.getClonedModel('floor_tile');
    if (!tileMesh) return;

    tileMesh.position.set(x, y, z);
    
    // Static Matrix Baking
    tileMesh.matrixAutoUpdate = false;
    tileMesh.updateMatrix();
    tileMesh.updateMatrixWorld(true);

    chunkGroup.add(tileMesh);
    this.worldStorage.groundTiles.set(`${Math.round(x)},${Math.round(z)}`, { x, y, z, mesh: tileMesh });
  }

  addWallBlock(x, y, z, rotationY = 0) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);

    // Remove existing wall with SAME rotation if any
    this.removeBlock(rx, ry, rz, rotationY);

    const cx = Math.floor(rx / this.chunkSize);
    const cz = Math.floor(rz / this.chunkSize);
    const chunkGroup = this.getOrCreateChunkGroup(cx, cz);

    const wallMesh = this.assetLoader.getClonedModel('wall');
    if (!wallMesh) return;

    wallMesh.position.set(rx, ry, rz);
    wallMesh.rotation.y = rotationY;

    // Static Matrix Baking
    wallMesh.matrixAutoUpdate = false;
    wallMesh.updateMatrix();
    wallMesh.updateMatrixWorld(true);

    chunkGroup.add(wallMesh);

    // Compute rotational AABB
    let boxMinX, boxMaxX, boxMinZ, boxMaxZ;
    let normRot = rotationY % (Math.PI * 2);
    if (normRot > Math.PI) normRot -= Math.PI * 2;
    if (normRot < -Math.PI) normRot += Math.PI * 2;

    if (Math.abs(normRot - (-Math.PI / 2)) < 0.2 || Math.abs(normRot - (3 * Math.PI / 2)) < 0.2) {
      // Rotated -90 deg (-PI/2): panel on outer -Z edge
      boxMinX = rx - 0.5;
      boxMaxX = rx + 0.5;
      boxMinZ = rz - 0.563;
      boxMaxZ = rz - 0.48;
    } else if (Math.abs(normRot - (Math.PI / 2)) < 0.2) {
      // Rotated +90 deg (+PI/2): panel on +Z edge
      boxMinX = rx - 0.5;
      boxMaxX = rx + 0.5;
      boxMinZ = rz + 0.48;
      boxMaxZ = rz + 0.563;
    } else if (Math.abs(Math.abs(normRot) - Math.PI) < 0.2) {
      // Rotated 180 deg (PI): panel on +X edge
      boxMinX = rx + 0.48;
      boxMaxX = rx + 0.563;
      boxMinZ = rz - 0.5;
      boxMaxZ = rz + 0.5;
    } else {
      // Default (0 deg): panel on outer -X edge
      boxMinX = rx - 0.563;
      boxMaxX = rx - 0.48;
      boxMinZ = rz - 0.5;
      boxMaxZ = rz + 0.5;
    }

    this.worldStorage.setBlock(rx, ry, rz, {
      type: 'wall',
      solid: true,
      mesh: wallMesh,
      chunkGroup,
      rotationY,
      boxMinX,
      boxMaxX,
      boxMinZ,
      boxMaxZ,
      minY: ry,
      maxY: ry + 4.0
    });
  }

  addFurnitureBlock(modelName, x, y, z, rotationY = 0) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);

    // Remove existing object at same tile & rotation
    this.removeBlock(rx, ry, rz, rotationY);

    const cx = Math.floor(rx / this.chunkSize);
    const cz = Math.floor(rz / this.chunkSize);
    const chunkGroup = this.getOrCreateChunkGroup(cx, cz);

    const modelMesh = this.assetLoader.getClonedModel(modelName);
    if (!modelMesh) return;

    modelMesh.position.set(rx, ry, rz);
    modelMesh.rotation.y = rotationY;

    // Static Matrix Baking
    modelMesh.matrixAutoUpdate = false;
    modelMesh.updateMatrix();
    modelMesh.updateMatrixWorld(true);

    chunkGroup.add(modelMesh);

    // Find sitting point node if present (e.g., chair.glb)
    let sittingPoint = null;
    let sittingRotationY = rotationY;
    modelMesh.traverse((child) => {
      const name = (child.name || '').toLowerCase();
      if (name.includes('sitting_point') || name.includes('standing_point')) {
        sittingPoint = new THREE.Vector3();
        child.getWorldPosition(sittingPoint);
      }
    });

    if (!sittingPoint && modelName === 'chair') {
      // Fallback sitting point at center top of seat
      sittingPoint = new THREE.Vector3(rx, ry + 0.5, rz);
    }

    // AABB collision box: 1x1 tile footprint
    this.worldStorage.setBlock(rx, ry, rz, {
      type: modelName,
      solid: true,
      mesh: modelMesh,
      chunkGroup,
      rotationY,
      sittingPoint,
      sittingRotationY,
      boxMinX: rx - 0.45,
      boxMaxX: rx + 0.45,
      boxMinZ: rz - 0.45,
      boxMaxZ: rz + 0.45,
      minY: ry,
      maxY: ry + (modelName === 'chair' ? 1.4 : 1.6)
    });
  }

  removeBlock(x, y, z, rotationY = null) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);

    const removedList = this.worldStorage.removeBlock(rx, ry, rz, rotationY);
    if (Array.isArray(removedList)) {
      removedList.forEach(block => {
        if (block && block.mesh) {
          if (block.chunkGroup) {
            block.chunkGroup.remove(block.mesh);
          } else {
            this.scene.remove(block.mesh);
          }
          if (block.mesh.geometry) block.mesh.geometry.dispose();
        }
      });
      return removedList.length > 0;
    }
    return false;
  }

  // Throttled Frustum Culling (Every 10 frames)
  updateFrustumCulling(camera) {
    this.frameCounter++;
    if (this.frameCounter % 10 !== 0) return;

    camera.updateMatrixWorld();
    _scratchMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _scratchFrustum.setFromProjectionMatrix(_scratchMatrix);

    for (const [chunkKey, chunkGroup] of this.chunkGroups.entries()) {
      const [cx, cz] = chunkKey.split(',').map(Number);

      _scratchBox.min.set(cx * this.chunkSize - 2, -10, cz * this.chunkSize - 2);
      _scratchBox.max.set((cx + 1) * this.chunkSize + 2, 20, (cz + 1) * this.chunkSize + 2);

      const inFrustum = _scratchFrustum.intersectsBox(_scratchBox);
      if (chunkGroup.visible !== inFrustum) {
        chunkGroup.visible = inFrustum;
      }
    }
  }

  clear() {
    for (const group of this.chunkGroups.values()) {
      this.scene.remove(group);
      group.traverse(child => {
        if (child.isMesh && child.geometry) {
          child.geometry.dispose();
        }
      });
    }
    this.chunkGroups.clear();
    this.worldStorage.clear();
  }
}

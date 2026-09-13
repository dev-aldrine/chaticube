export class Physics {
  constructor(worldStorage) {
    this.world = worldStorage;
    this.radius = 0.28; // Player horizontal bounding radius
    this.height = 2.0;
  }

  move(playerMesh, inputDir, speed, delta) {
    if (!inputDir || (inputDir.x === 0 && inputDir.z === 0)) return;

    const moveX = inputDir.x * speed * delta;
    const moveZ = inputDir.z * speed * delta;

    const currentX = playerMesh.position.x;
    const currentY = playerMesh.position.y;
    const currentZ = playerMesh.position.z;

    const bounds = this.world.getFloorBounds ? this.world.getFloorBounds() : { minX: -10.5, maxX: 9.5, minZ: -10.5, maxZ: 9.5 };

    // --- STEP 1: TEST & RESOLVE X AXIS ---
    const targetX = currentX + moveX;
    const isWithinFloorX = (targetX - this.radius >= bounds.minX) && (targetX + this.radius <= bounds.maxX);
    if (isWithinFloorX && !this.checkCollisionAt(targetX, currentY, currentZ)) {
      playerMesh.position.x = targetX;
    }

    // --- STEP 2: TEST & RESOLVE Z AXIS ---
    const targetZ = currentZ + moveZ;
    const isWithinFloorZ = (targetZ - this.radius >= bounds.minZ) && (targetZ + this.radius <= bounds.maxZ);
    if (isWithinFloorZ && !this.checkCollisionAt(playerMesh.position.x, currentY, targetZ)) {
      playerMesh.position.z = targetZ;
    }
  }

  // Exact neighborhood bounds check against solid grid blocks
  checkCollisionAt(x, y, z) {
    const minTileX = Math.floor(x - this.radius - 1);
    const maxTileX = Math.floor(x + this.radius + 1);
    const minTileZ = Math.floor(z - this.radius - 1);
    const maxTileZ = Math.floor(z + this.radius + 1);
    const tileY = Math.round(y);

    const playerMinX = x - this.radius;
    const playerMaxX = x + this.radius;
    const playerMinZ = z - this.radius;
    const playerMaxZ = z + this.radius;

    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let tz = minTileZ; tz <= maxTileZ; tz++) {
        const blocks = this.world.getBlocksAt(tx, tileY, tz);
        for (const block of blocks) {
          if (block && block.solid) {
            const boxMinX = block.boxMinX !== undefined ? block.boxMinX : (tx - 0.5);
            const boxMaxX = block.boxMaxX !== undefined ? block.boxMaxX : (tx + 0.5);
            const boxMinZ = block.boxMinZ !== undefined ? block.boxMinZ : (tz - 0.5);
            const boxMaxZ = block.boxMaxZ !== undefined ? block.boxMaxZ : (tz + 0.5);

            const overlapX = playerMaxX > boxMinX && playerMinX < boxMaxX;
            const overlapZ = playerMaxZ > boxMinZ && playerMinZ < boxMaxZ;

            if (overlapX && overlapZ) {
              return true; // Collision detected
            }
          }
        }
      }
    }
    return false;
  }
}

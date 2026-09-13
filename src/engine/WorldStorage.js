export class WorldStorage {
  constructor() {
    // Key 'x,y,z_rot' -> { x, y, z, rotationY, type, solid: true, mesh, boxMinX, ... }
    this.solidBlocks = new Map();
    // Key 'x,z' -> ground tile metadata
    this.groundTiles = new Map();
  }

  getBlockKey(x, y, z, rotationY = 0) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const rRot = Math.round((rotationY || 0) * 100);
    return `${rx},${ry},${rz}_${rRot}`;
  }

  setBlock(x, y, z, data) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const key = this.getBlockKey(rx, ry, rz, data.rotationY || 0);
    this.solidBlocks.set(key, { ...data, x: rx, y: ry, z: rz, key });
  }

  getBlocksAt(x, y, z) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const prefix = `${rx},${ry},${rz}_`;
    const results = [];
    for (const [key, block] of this.solidBlocks.entries()) {
      if (key.startsWith(prefix) || key === `${rx},${ry},${rz}`) {
        results.push(block);
      }
    }
    return results;
  }

  getBlock(x, y, z, rotationY = 0) {
    const key = this.getBlockKey(x, y, z, rotationY);
    return this.solidBlocks.get(key) || null;
  }

  removeBlock(x, y, z, rotationY = null) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    
    if (rotationY !== null && rotationY !== undefined) {
      const key = this.getBlockKey(rx, ry, rz, rotationY);
      const block = this.solidBlocks.get(key);
      this.solidBlocks.delete(key);
      return block ? [block] : [];
    }

    // Remove all blocks at this grid coordinate
    const prefix = `${rx},${ry},${rz}_`;
    const removed = [];
    for (const [key, block] of this.solidBlocks.entries()) {
      if (key.startsWith(prefix) || key === `${rx},${ry},${rz}`) {
        removed.push(block);
        this.solidBlocks.delete(key);
      }
    }
    return removed;
  }

  isSolid(x, y, z) {
    const blocks = this.getBlocksAt(x, y, z);
    return blocks.some(b => b.solid === true);
  }

  getFloorBounds() {
    if (this.groundTiles.size === 0) {
      return { minX: -10.5, maxX: 9.5, minZ: -10.5, maxZ: 9.5 };
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const tile of this.groundTiles.values()) {
      if (tile.x - 0.5 < minX) minX = tile.x - 0.5;
      if (tile.x + 0.5 > maxX) maxX = tile.x + 0.5;
      if (tile.z - 0.5 < minZ) minZ = tile.z - 0.5;
      if (tile.z + 0.5 > maxZ) maxZ = tile.z + 0.5;
    }
    return { minX, maxX, minZ, maxZ };
  }

  clear() {
    this.solidBlocks.clear();
    this.groundTiles.clear();
  }
}

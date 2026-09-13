import * as THREE from 'three';

export const COLOR_PALETTES = {
  skin: [
    '#ffd1b3', // Light / Peach
    '#f5c29b', // Warm Sand
    '#dca177', // Honey
    '#ae734c', // Tan / Caramel
    '#704225', // Deep Bronze
    '#452a1b'  // Dark Mocha
  ],
  shirt: [
    '#ef4444', // Crimson Red
    '#3b82f6', // Sapphire Blue
    '#10b981', // Emerald Green
    '#f59e0b', // Amber Orange
    '#8b5cf6', // Amethyst Purple
    '#ec4899', // Ruby Pink
    '#14b8a6', // Teal
    '#1e293b'  // Midnight Black
  ],
  pants: [
    '#1e293b', // Midnight
    '#334155', // Slate Denim
    '#1e3a8a', // Deep Blue
    '#475569', // Steel Gray
    '#78350f', // Leather Brown
    '#14532d'  // Forest Green
  ]
};

const RANDOM_NAMES = [
  'PixelKnight', 'CozyWanderer', 'VoxelMage', 'CloudRunner',
  'MochiBun', 'StarSeeker', 'ForestWalker', 'NovaPulse',
  'SunnySpark', 'SkyCrafter', 'ShadowBlade', 'EchoWhisper',
  'ChibiHero', 'LunarNomad', 'ArcadeRider', 'VelvetPaws'
];

export class PaletteManager {
  static layerImages = {};
  static isLoaded = false;
  static loadPromise = null;

  static async loadLayers() {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    const layers = ['skin', 'shirt', 'short', 'face'];
    this.loadPromise = Promise.all(
      layers.map(name => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            this.layerImages[name] = img;
            resolve();
          };
          img.onerror = () => {
            const fallbackImg = new Image();
            fallbackImg.crossOrigin = 'anonymous';
            fallbackImg.onload = () => {
              this.layerImages[name] = fallbackImg;
              resolve();
            };
            fallbackImg.onerror = (err2) => {
              console.error(`Failed to load texture layer: ${name}`, err2);
              reject(err2);
            };
            fallbackImg.src = `/textures/player/${name}.png`;
          };
          img.src = `/assets/textures/player/${name}.png`;
        });
      })
    ).then(() => {
      this.isLoaded = true;
    });

    return this.loadPromise;
  }

  static getRandomName() {
    const base = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    const num = Math.floor(Math.random() * 900 + 100);
    return `${base}_${num}`;
  }

  static getRandomColors() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return {
      skin: pick(COLOR_PALETTES.skin),
      shirt: pick(COLOR_PALETTES.shirt),
      pants: pick(COLOR_PALETTES.pants)
    };
  }

  static hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  // Dynamic Compositing Pipeline (Original Layer Textures: Skin -> Shorts -> Shirt -> Face)
  static createCompositeTexture(colors) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function parseHex(hex) {
      const c = new THREE.Color(hex);
      return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    }

    const [bodyR, bodyG, bodyB] = parseHex(colors.skin || colors.body || '#ffd1b3');
    const [shirtR, shirtG, shirtB] = parseHex(colors.shirt || '#ef4444');
    const [pantsR, pantsG, pantsB] = parseHex(colors.pants || '#1e293b');

    function getPixels(img) {
      if (!img) return null;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, 64, 64).data;
    }

    const bodyData = getPixels(this.layerImages.skin || this.layerImages.body);
    const pantsData = getPixels(this.layerImages.short || this.layerImages.pants);
    const shirtData = getPixels(this.layerImages.shirt);
    const faceData = getPixels(this.layerImages.face);

    const imgData = ctx.createImageData(64, 64);
    const out = imgData.data;

    // 1. Multiplicative Shading Layer Composition (Bottom to Top)
    for (let i = 0; i < 64 * 64 * 4; i += 4) {
      let r = 0, g = 0, b = 0, a = 0;

      // Layer 1: Base Skin (skin.png)
      if (bodyData && bodyData[i + 3] > 0) {
        const shade = bodyData[i] / 255;
        r = Math.round(bodyR * shade);
        g = Math.round(bodyG * shade);
        b = Math.round(bodyB * shade);
        a = 255;
      }

      // Layer 2: Shorts / Pants (short.png)
      if (pantsData && pantsData[i + 3] > 0) {
        const shade = pantsData[i] / 255;
        r = Math.round(pantsR * shade);
        g = Math.round(pantsG * shade);
        b = Math.round(pantsB * shade);
        a = 255;
      }

      // Layer 3: Shirt (shirt.png)
      if (shirtData && shirtData[i + 3] > 0) {
        const shade = shirtData[i] / 255;
        r = Math.round(shirtR * shade);
        g = Math.round(shirtG * shade);
        b = Math.round(shirtB * shade);
        a = 255;
      }

      // Layer 4: Face (face.png)
      if (faceData && faceData[i + 3] > 0) {
        r = faceData[i];
        g = faceData[i + 1];
        b = faceData[i + 2];
        a = 255;
      }

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }

    // 2. Full-Canvas Texture Edge Dilation (Eliminates All Black/Transparent Seams)
    let hasTransparent = true;
    let passes = 0;
    while (hasTransparent && passes < 16) {
      hasTransparent = false;
      const copy = new Uint8ClampedArray(out);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const idx = (y * 64 + x) * 4;
          if (copy[idx + 3] === 0) {
            const neighbors = [
              x > 0 ? (y * 64 + (x - 1)) * 4 : null,
              x < 63 ? (y * 64 + (x + 1)) * 4 : null,
              y > 0 ? ((y - 1) * 64 + x) * 4 : null,
              y < 63 ? ((y + 1) * 64 + x) * 4 : null
            ];
            let filled = false;
            for (const nIdx of neighbors) {
              if (nIdx !== null && copy[nIdx + 3] > 0) {
                out[idx] = copy[nIdx];
                out[idx + 1] = copy[nIdx + 1];
                out[idx + 2] = copy[nIdx + 2];
                out[idx + 3] = 255;
                filled = true;
                break;
              }
            }
            if (!filled) {
              hasTransparent = true;
            }
          }
        }
      }
      passes++;
    }

    // Safety fallback: ensure 100% of canvas is opaque
    for (let i = 0; i < 64 * 64 * 4; i += 4) {
      if (out[i + 3] === 0) {
        out[i] = bodyR;
        out[i + 1] = bodyG;
        out[i + 2] = bodyB;
        out[i + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // 3. WebGL Texture Filter & Clamping Configuration
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    return texture;
  }

  // Apply UV half-texel contraction to prevent border texel bleeding across cube edges
  static applyUVHalfTexelInset(mesh) {
    mesh.traverse((child) => {
      if (child.isMesh && child.geometry && child.geometry.attributes.uv) {
        if (child.userData.uvAdjusted) return;
        child.userData.uvAdjusted = true;

        const uvAttr = child.geometry.attributes.uv;
        const uvs = uvAttr.array;
        const count = uvAttr.count;

        // Inset factor: 0.5 texels in 64x64 texture space = 0.5 / 64 = 0.0078125
        const eps = 0.5 / 64;

        for (let i = 0; i < count; i += 4) {
          // Find bounding box of the face quad UVs
          let minU = Infinity, maxU = -Infinity;
          let minV = Infinity, maxV = -Infinity;

          for (let j = 0; j < 4; j++) {
            const u = uvs[(i + j) * 2];
            const v = uvs[(i + j) * 2 + 1];
            if (u < minU) minU = u;
            if (u > maxU) maxU = u;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
          }

          const isFrontFace = (Math.abs(minU * 64 - 30) < 0.5 && Math.abs(maxU * 64 - 42) < 0.5 && Math.abs(minV * 64 - 0) < 0.5 && Math.abs(maxV * 64 - 12) < 0.5);
          // For front face, use tiny 0.05 texel micro-inset so face scale does not visibly change but boundary pixels don't bleed
          const currentEps = isFrontFace ? (0.05 / 64) : (0.4 / 64);

          const spanU = maxU - minU;
          const spanV = maxV - minV;

          // Only inset if span is large enough (greater than 2 texels)
          if (spanU > currentEps * 2 && spanV > currentEps * 2) {
            for (let j = 0; j < 4; j++) {
              const uIdx = (i + j) * 2;
              const vIdx = (i + j) * 2 + 1;

              if (Math.abs(uvs[uIdx] - minU) < 0.0001) {
                uvs[uIdx] += currentEps;
              } else if (Math.abs(uvs[uIdx] - maxU) < 0.0001) {
                uvs[uIdx] -= currentEps;
              }

              if (Math.abs(uvs[vIdx] - minV) < 0.0001) {
                uvs[vIdx] += currentEps;
              } else if (Math.abs(uvs[vIdx] - maxV) < 0.0001) {
                uvs[vIdx] -= currentEps;
              }
            }
          }
        }
        uvAttr.needsUpdate = true;
      }
    });
  }

  // Apply composite canvas texture to character mesh
  static applyColorsToCharacter(characterMesh, colors) {
    if (!characterMesh) return;

    if (!this.isLoaded) {
      this.loadLayers().then(() => {
        this.applyColorsToCharacter(characterMesh, colors);
      });
      return;
    }

    // Apply permanent UV half-texel contraction to eliminate edge gap bleeding
    this.applyUVHalfTexelInset(characterMesh);

    const compositeTexture = this.createCompositeTexture(colors);

    characterMesh.traverse((child) => {
      if (child.isMesh && child.material) {
        if (!child.userData.isCustomMaterial) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map(m => m.clone());
          } else {
            child.material = child.material.clone();
          }
          child.userData.isCustomMaterial = true;
        }

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          mat.color.setHex(0xffffff);
          mat.map = compositeTexture;
          mat.transparent = false;
          mat.alphaTest = 0;
          mat.depthWrite = true;
          mat.depthTest = true;
          mat.roughness = 0.85;
          mat.metalness = 0.05;
          mat.side = THREE.FrontSide;
          mat.needsUpdate = true;
        });
      }
    });
  }
}

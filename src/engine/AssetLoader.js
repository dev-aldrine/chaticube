import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PaletteManager } from '../lobby/PaletteManager.js';

export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.bounds = new Map();
    this.animations = new Map();
    this.textures = new Map();
  }

  async loadAll(onProgress) {
    const assets = [
      { name: 'player', url: '/assets/player.glb' },
      { name: 'wall', url: '/assets/wall.glb' },
      { name: 'floor_tile', url: '/assets/floor_tile.glb' },
      { name: 'piano', url: '/assets/piano.glb' },
      { name: 'books', url: '/assets/books.glb' },
      { name: 'chair', url: '/assets/chair.glb' }
    ];

    const totalTasks = assets.length + 1; // 6 GLTFs + 1 Palette Layers
    let completedTasks = 0;

    const report = (assetName) => {
      completedTasks++;
      if (onProgress) {
        onProgress(completedTasks / totalTasks, assetName);
      }
    };

    const promises = assets.map(asset => 
      this.loadGLTF(asset.name, asset.url).then(res => {
        report(`3D Model: ${asset.name}`);
        return res;
      })
    );

    const palettePromise = PaletteManager.loadLayers().then(res => {
      report('Character Customization Textures');
      return res;
    });

    await Promise.all([...promises, palettePromise]);
    return this;
  }

  loadGLTF(name, url) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          // Optimize materials and textures (supporting multi-material meshes)
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              const mats = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
              mats.forEach((mat) => {
                if (name === 'piano') {
                  mat.transparent = false;
                  mat.alphaTest = 0;
                  mat.side = THREE.FrontSide;
                } else {
                  mat.side = THREE.DoubleSide;
                }
                mat.depthWrite = true;
                mat.depthTest = true;
                if (mat.map) {
                  this.dilateTexture(mat.map);
                  mat.map.magFilter = THREE.NearestFilter;
                  mat.map.minFilter = THREE.NearestFilter;
                  mat.map.generateMipmaps = false;
                  mat.map.wrapS = THREE.ClampToEdgeWrapping;
                  mat.map.wrapT = THREE.ClampToEdgeWrapping;
                  mat.map.needsUpdate = true;
                }
              });
            }
          });

          this.cache.set(name, gltf.scene);
          
          // Pre-calculate exact model bounding box
          const box = new THREE.Box3().setFromObject(gltf.scene);
          this.bounds.set(name, box);

          if (gltf.animations && gltf.animations.length > 0) {
            const animClips = [...gltf.animations];
            
            // Create a dedicated head bobbing overlay clip from idle
            const idleClip = animClips.find(c => c.name === 'idle');
            if (idleClip) {
              const bobbingTracks = idleClip.tracks.filter(t => t.name.toLowerCase().includes('.position'));
              if (bobbingTracks.length > 0) {
                const bobbingClip = new THREE.AnimationClip('idle_bobbing', idleClip.duration, bobbingTracks);
                animClips.push(bobbingClip);
              }
            }

            this.animations.set(name, animClips);
          }
          resolve(gltf);
        },
        undefined,
        (error) => {
          console.error(`Failed to load asset: ${url}`, error);
          reject(error);
        }
      );
    });
  }

  dilateTexture(texture) {
    if (!texture || !texture.image || texture.userData?.dilated) return;
    try {
      const img = texture.image;
      const width = img.width || img.naturalWidth || (img.data ? img.data.width : null);
      const height = img.height || img.naturalHeight || (img.data ? img.data.height : null);
      if (!width || !height) return;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      // Iterative RGB edge dilation to eliminate transparent border bleeding
      const original = new Uint8ClampedArray(data);
      let changed = false;

      // 4 dilation passes to cover subpixel boundaries and low-res UV margins
      for (let pass = 0; pass < 4; pass++) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx + 3] === 0) {
              // Search 4 direct neighbors
              const neighbors = [
                x > 0 ? (y * width + (x - 1)) * 4 : null,
                x < width - 1 ? (y * width + (x + 1)) * 4 : null,
                y > 0 ? ((y - 1) * width + x) * 4 : null,
                y < height - 1 ? ((y + 1) * width + x) * 4 : null
              ];

              for (const nIdx of neighbors) {
                if (nIdx !== null && original[nIdx + 3] > 10) {
                  data[idx] = original[nIdx];
                  data[idx + 1] = original[nIdx + 1];
                  data[idx + 2] = original[nIdx + 2];
                  // Keep a non-zero alpha or solid alpha
                  data[idx + 3] = 255;
                  changed = true;
                  break;
                }
              }
            }
          }
        }
        original.set(data);
      }

      if (changed) {
        ctx.putImageData(imgData, 0, 0);
        texture.image = canvas;
        texture.needsUpdate = true;
      }
      texture.userData = texture.userData || {};
      texture.userData.dilated = true;
    } catch (e) {
      console.warn('Texture dilation skipped:', e);
    }
  }

  getClonedModel(name) {
    const original = this.cache.get(name);
    if (!original) return null;
    
    // Skeleton-aware cloning for animated models (player)
    const cloned = SkeletonUtils.clone(original);
    
    cloned.traverse((node) => {
      if (node.isMesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map(m => {
            const mClone = m.clone();
            if (name === 'piano') {
              mClone.transparent = false;
              mClone.alphaTest = 0;
              mClone.side = THREE.FrontSide;
            } else {
              mClone.side = THREE.DoubleSide;
            }
            mClone.depthWrite = true;
            mClone.depthTest = true;
            if (mClone.map) {
              mClone.map = mClone.map.clone();
              mClone.map.magFilter = THREE.NearestFilter;
              mClone.map.minFilter = THREE.NearestFilter;
              mClone.map.generateMipmaps = false;
              mClone.map.wrapS = THREE.ClampToEdgeWrapping;
              mClone.map.wrapT = THREE.ClampToEdgeWrapping;
              mClone.map.needsUpdate = true;
            }
            return mClone;
          });
        } else {
          node.material = node.material.clone();
          if (name === 'piano') {
            node.material.transparent = false;
            node.material.alphaTest = 0;
            node.material.side = THREE.FrontSide;
          } else {
            node.material.side = THREE.DoubleSide;
          }
          node.material.depthWrite = true;
          node.material.depthTest = true;
          if (node.material.map) {
            node.material.map = node.material.map.clone();
            node.material.map.magFilter = THREE.NearestFilter;
            node.material.map.minFilter = THREE.NearestFilter;
            node.material.map.generateMipmaps = false;
            node.material.map.wrapS = THREE.ClampToEdgeWrapping;
            node.material.map.wrapT = THREE.ClampToEdgeWrapping;
            node.material.map.needsUpdate = true;
          }
        }
      }
    });

    return cloned;
  }

  getAnimations(name) {
    return this.animations.get(name) || [];
  }

  getBounds(name) {
    return this.bounds.get(name) || null;
  }
}

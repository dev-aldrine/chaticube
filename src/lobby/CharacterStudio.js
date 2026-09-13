import * as THREE from 'three';
import { PaletteManager } from './PaletteManager.js';

export class CharacterStudio {
  constructor(canvas, assetLoader) {
    this.canvas = canvas;
    this.assetLoader = assetLoader;
    this.isRunning = true;

    this.scene = new THREE.Scene();
    
    const aspect = canvas.clientWidth / (canvas.clientHeight || 1);
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 100);
    this.camera.position.set(0, 0.82, 3.8);
    this.camera.lookAt(0, 0.8, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 1.4);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 4, 3);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0x6366f1, 1.0); // Soft purple rim light
    backLight.position.set(-2, 2, -3);
    this.scene.add(backLight);

    this.characterMesh = null;
    this.mixer = null;
    this.lastTime = performance.now();

    this.initModel();
    this.resize();

    // Resize handling (Window + Container ResizeObserver)
    this.onResize = this.resize.bind(this);
    window.addEventListener('resize', this.onResize);
    if (window.ResizeObserver && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initModel() {
    this.characterMesh = this.assetLoader.getClonedModel('player');
    if (!this.characterMesh) return;

    this.characterMesh.position.set(0, 0, 0);
    this.scene.add(this.characterMesh);

    // Play Idle Animation
    const anims = this.assetLoader.getAnimations('player');
    if (anims.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.characterMesh);
      const idleClip = THREE.AnimationClip.findByName(anims, 'idle') || anims[0];
      const action = this.mixer.clipAction(idleClip);
      action.play();
    }
  }

  updateColors(colors) {
    if (this.characterMesh) {
      PaletteManager.applyColorsToCharacter(this.characterMesh, colors);
    }
  }

  resize() {
    if (!this.canvas) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const aspect = width / height;
    this.camera.aspect = aspect;

    // The player model stands from Y=0.0 (feet) to Y=2.875 (top of head). Midpoint is Y=1.44m.
    const centerY = 1.44;

    if (aspect < 0.8) {
      this.camera.fov = 40;
      this.camera.position.set(0, centerY, 6.2);
    } else if (aspect < 1.3) {
      this.camera.fov = 34;
      this.camera.position.set(0, centerY, 5.8);
    } else {
      this.camera.fov = 30;
      this.camera.position.set(0, centerY, 5.4);
    }
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    if (!this.isRunning) return;
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.mixer) {
      this.mixer.update(delta);
    }

    if (this.characterMesh) {
      // Gentle 360° idle turntable rotation
      this.characterMesh.rotation.y += 0.015;
    }

    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.animate);
  }

  stop() {
    this.isRunning = false;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.renderer.dispose();
  }
}

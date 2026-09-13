import * as THREE from 'three';

export class RenderSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window);
    this.resolutionScale = 1.0;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !this.isMobile, // Disable MSAA on mobile for GPU fillrate savings
      alpha: false,
      powerPreference: 'high-performance',
      precision: this.isMobile ? 'mediump' : 'highp'
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.updatePixelRatio();

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  updatePixelRatio() {
    if (!this.renderer) return;
    const baseDpr = window.devicePixelRatio || 1;
    const maxDpr = this.isMobile ? 1.5 : 2.0;
    const clampedBase = Math.min(baseDpr, maxDpr);
    const effectivePixelRatio = Math.max(0.5, Math.min(maxDpr, clampedBase * this.resolutionScale));

    this.renderer.setPixelRatio(effectivePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onResize() {
    this.updatePixelRatio();
  }

  setResolutionScale(scale) {
    this.resolutionScale = Math.max(0.5, Math.min(1.5, scale));
    this.updatePixelRatio();
  }

  compile(scene, camera) {
    if (this.renderer && scene && camera) {
      try {
        this.renderer.compile(scene, camera);
      } catch (e) {
        console.warn('Renderer compile warmup note:', e);
      }
    }
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

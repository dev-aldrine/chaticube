import * as THREE from 'three';

export class CameraSystem {
  constructor() {
    this.currentZoom = 12.0;
    this.targetZoom = 12.0;
    this.minZoom = 3.5;
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

    // True Isometric Offset (35.264° elevation / 45° azimuth)
    // Distance 30 on each axis gives the canonical    // Fixed camera offset from focus target
    this.cameraOffset = new THREE.Vector3(25, 25, 25);
    this.camera.position.copy(this.cameraOffset);
    this.camera.lookAt(0, 0, 0);

    this.currentFocus = new THREE.Vector3(0, 0, 0);
    this.hasInitializedFocus = false;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  onResize() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = -this.currentZoom * aspect;
    this.camera.right = this.currentZoom * aspect;
    this.camera.top = this.currentZoom;
    this.camera.bottom = -this.currentZoom;
    this.camera.updateProjectionMatrix();
  }

  handleZoom(deltaY) {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom + deltaY * 0.006));
  }

  update(targetPosition, delta) {
    // Smooth zoom interpolation
    if (Math.abs(this.targetZoom - this.currentZoom) > 0.01) {
      this.currentZoom += (this.targetZoom - this.currentZoom) * Math.min(10 * delta, 1);
      this.onResize();
    }

    if (!targetPosition) return;

    // Smooth focus target tracking (Frame-rate independent damping)
    if (!this.hasInitializedFocus) {
      this.currentFocus.copy(targetPosition);
      this.hasInitializedFocus = true;
    } else {
      const lerpSpeed = Math.min(14 * delta, 1);
      this.currentFocus.x += (targetPosition.x - this.currentFocus.x) * lerpSpeed;
      this.currentFocus.y += (targetPosition.y - this.currentFocus.y) * lerpSpeed;
      this.currentFocus.z += (targetPosition.z - this.currentFocus.z) * lerpSpeed;
    }

    // Camera position is ALWAYS locked at exact fixed offset from currentFocus
    this.camera.position.x = this.currentFocus.x + this.cameraOffset.x;
    this.camera.position.y = this.currentFocus.y + this.cameraOffset.y;
    this.camera.position.z = this.currentFocus.z + this.cameraOffset.z;

    // Direct rigid lookAt to smoothed focus (zero angular wobble)
    this.camera.lookAt(this.currentFocus.x, this.currentFocus.y + 0.5, this.currentFocus.z);
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
  }
}

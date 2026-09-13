import * as THREE from 'three';

/**
 * PianoInteractPrompt
 * Renders a high-DPI 2D canvas texture onto a 3D Sprite floating above the piano.
 * Supports smooth bobbing animation, Hold-E progress ring, and clear typography.
 */
export class PianoInteractPrompt {
  constructor({ scene, position = new THREE.Vector3(-5, 2.2, -1) }) {
    this.scene = scene;
    this.basePosition = position.clone();
    this.visible = false;
    this.progress = 0;
    this.action = 'Play Piano';
    this.hint = 'Hold E';
    this.animTime = 0;

    // High resolution canvas for sharp rendering on 4K/retina screens
    this.canvasWidth = 512;
    this.canvasHeight = 256;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0.0,
      toneMapped: false
    });

    this.sprite = new THREE.Sprite(spriteMat);
    // 2:1 aspect ratio sprite scale in 3D world
    this.sprite.scale.set(2.4, 1.2, 1);
    this.sprite.position.copy(this.basePosition);
    this.sprite.visible = false;

    if (this.scene) {
      this.scene.add(this.sprite);
    }

    this.currentOpacity = 0.0;
    this.targetOpacity = 0.0;
    this.needsRedraw = true;
    this.redraw();
  }

  setPosition(pos) {
    this.basePosition.copy(pos);
    this.sprite.position.copy(this.basePosition);
  }

  updateState({ visible, progress = 0, action = 'Play Piano', hint = 'Hold E' }) {
    this.visible = visible;
    this.targetOpacity = visible ? 1.0 : 0.0;
    if (this.progress !== progress || this.action !== action || this.hint !== hint) {
      this.progress = Math.max(0, Math.min(1, progress));
      this.action = action;
      this.hint = hint;
      this.needsRedraw = true;
    }
  }

  update(delta) {
    this.animTime += delta;

    // Smooth fade in / fade out
    if (Math.abs(this.currentOpacity - this.targetOpacity) > 0.01) {
      this.currentOpacity += (this.targetOpacity - this.currentOpacity) * Math.min(14 * delta, 1.0);
      this.sprite.material.opacity = this.currentOpacity;
      this.sprite.visible = this.currentOpacity > 0.01;
    } else {
      this.currentOpacity = this.targetOpacity;
      this.sprite.material.opacity = this.currentOpacity;
      this.sprite.visible = this.currentOpacity > 0.01;
    }

    if (!this.sprite.visible) return;

    // Gentle floating bobbing animation
    const bobOffset = Math.sin(this.animTime * 3.5) * 0.08;
    this.sprite.position.y = this.basePosition.y + bobOffset;

    if (this.needsRedraw) {
      this.redraw();
    }
  }

  redraw() {
    this.needsRedraw = false;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    const cardWidth = 370;
    const cardHeight = 84;
    const cardX = centerX - cardWidth / 2;
    const cardY = centerY - cardHeight / 2;
    const radius = 28;

    ctx.save();

    // 1. Drop Glow / Shadow
    ctx.shadowColor = 'rgba(99, 102, 241, 0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 4;

    // 2. Glassmorphic Card Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.93)';
    this.roundRect(ctx, cardX, cardY, cardWidth, cardHeight, radius);
    ctx.fill();

    // 3. Glowing Card Border
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = this.progress > 0 ? 'rgba(168, 85, 247, 0.85)' : 'rgba(99, 102, 241, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Circular Key Badge (E) with radial progress ring
    const circleCenterX = cardX + 46;
    const circleCenterY = centerY;
    const ringRadius = 24;

    // Background track
    ctx.beginPath();
    ctx.arc(circleCenterX, circleCenterY, ringRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Progress Arc Fill
    if (this.progress > 0) {
      ctx.beginPath();
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + this.progress * Math.PI * 2;
      ctx.arc(circleCenterX, circleCenterY, ringRadius, startAngle, endAngle, false);
      ctx.strokeStyle = '#c084fc'; // Vibrant purple fill matching theme
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Key 'E' Letter Text
    ctx.font = '800 24px "Outfit", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', circleCenterX, circleCenterY + 1);

    // 5. Action and Hint Labels with Pixelart Music Icon
    const textStartX = circleCenterX + 38;

    // Mini Pixelart Music Icon before action text
    ctx.font = '22px "pixelart-icons-font"';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uecad', textStartX, centerY - 13); // Music icon

    // Action Header ("Play Piano" or "Entering Piano...")
    ctx.font = '700 23px "Outfit", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.action, textStartX + 28, centerY - 13);

    // Subtitle Hint ("Hold E" / "Holding E")
    ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.fillText('Hold ', textStartX, centerY + 18);

    const holdWidth = ctx.measureText('Hold ').width;
    ctx.fillStyle = '#fbbf24'; // Warm amber highlight
    ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('E', textStartX + holdWidth, centerY + 18);

    ctx.restore();
    this.texture.needsUpdate = true;
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  destroy() {
    if (this.sprite && this.scene) {
      this.scene.remove(this.sprite);
    }
    if (this.texture) {
      this.texture.dispose();
    }
  }
}

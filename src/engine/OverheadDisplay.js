import * as THREE from 'three';

export class OverheadDisplay {
  constructor({ name, isSelf = false, color = '#4f46e5', ping = 0 }) {
    this.name = name;
    this.isSelf = isSelf;
    this.accentColor = color;
    this.ping = ping;
    
    // Array of { text, createdAt, duration: 6000, opacity: 1.0 }
    this.chatBubbles = [];
    this.maxBubbles = 3;
    this.bubbleDuration = 6000; // 6 seconds per message

    this.canvasWidth = 640;
    this.canvasHeight = 480;
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
      toneMapped: false // Don't let ACES filmic tone mapper / exposure over-saturate or wash out UI canvas
    });

    this.sprite = new THREE.Sprite(spriteMat);
    // Aspect ratio 640:480 = 4:3, enlarged scale
    this.sprite.scale.set(4.0, 3.0, 1);
    // Well elevated above the player model
    this.sprite.position.set(0, 4.6, 0);

    this.needsRedraw = true;
    this.redraw();
  }

  setPing(pingMs) {
    const val = Math.max(0, Math.round(pingMs || 0));
    if (this.ping !== val) {
      this.ping = val;
      this.needsRedraw = true;
    }
  }

  addMessage(text, image = null) {
    const cleanText = text && typeof text === 'string' ? text.trim().slice(0, 70) : '';
    if (!cleanText && !image) return;

    let imgObj = null;
    if (image && typeof image === 'string' && image.startsWith('data:image/')) {
      imgObj = new Image();
      imgObj.onload = () => {
        this.needsRedraw = true;
      };
      imgObj.src = image;
    }

    this.chatBubbles.push({
      text: cleanText,
      image: imgObj,
      createdAt: performance.now(),
      duration: this.bubbleDuration
    });

    // Keep max 3 bubbles
    if (this.chatBubbles.length > this.maxBubbles) {
      this.chatBubbles.shift();
    }

    this.needsRedraw = true;
  }

  update(delta) {
    if (this.chatBubbles.length === 0) {
      if (this.needsRedraw) {
        this.redraw();
      }
      return;
    }

    const now = performance.now();
    let hasExpiredOrFading = false;

    // Filter out expired bubbles
    const prevCount = this.chatBubbles.length;
    this.chatBubbles = this.chatBubbles.filter(b => now - b.createdAt < b.duration);

    if (this.chatBubbles.length !== prevCount) {
      hasExpiredOrFading = true;
    }

    // Check if any bubble is in fade-in (first 350ms) or fade-out (last 900ms)
    for (const b of this.chatBubbles) {
      const elapsed = now - b.createdAt;
      const remaining = b.duration - elapsed;
      if (elapsed < 350 || remaining < 900) {
        hasExpiredOrFading = true;
      }
    }

    if (hasExpiredOrFading || this.needsRedraw) {
      this.redraw();
    }
  }

  redraw() {
    this.needsRedraw = false;
    const ctx = this.ctx;
    const now = performance.now();

    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const centerX = this.canvasWidth / 2;
    // Bottom anchor for name tag
    const nameTagY = this.canvasHeight - 64;

    // 1. Draw Player Name Tag with Live Ping at bottom
    ctx.save();
    ctx.font = 'bold 26px Outfit, Inter, sans-serif';
    const nameMetrics = ctx.measureText(this.name);
    
    // Measure ping string
    const pingText = `${this.ping || 0}ms`;
    ctx.font = '600 20px monospace';
    const pingMetrics = ctx.measureText(pingText);

    const tagPaddingLeft = 40;
    const tagPaddingRight = 24;
    const spacingBetween = 18;
    const tagWidth = Math.max(190, tagPaddingLeft + nameMetrics.width + spacingBetween + pingMetrics.width + tagPaddingRight);
    const tagHeight = 48;
    const tagX = centerX - tagWidth / 2;

    // Background pill (Dark Glass)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    this.roundRect(ctx, tagX, nameTagY, tagWidth, tagHeight, 24);
    ctx.fill();

    // Border (Self highlighted)
    ctx.strokeStyle = this.isSelf ? 'rgba(99, 102, 241, 0.9)' : 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Left player status dot (Shirt color)
    ctx.fillStyle = this.accentColor || '#6366f1';
    ctx.beginPath();
    ctx.arc(tagX + 22, nameTagY + tagHeight / 2, 7, 0, Math.PI * 2);
    ctx.fill();

    // Player Name Text
    ctx.font = 'bold 26px Outfit, Inter, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.name, tagX + tagPaddingLeft, nameTagY + tagHeight / 2 + 1);

    // Live Ping text & Ping quality color
    const pingColor = (this.ping < 80) ? '#34d399' : (this.ping < 160) ? '#facc15' : '#f87171';
    ctx.font = '600 20px monospace';
    ctx.fillStyle = pingColor;
    ctx.textAlign = 'right';
    ctx.fillText(pingText, tagX + tagWidth - 20, nameTagY + tagHeight / 2 + 1);

    // Mini ping status dot before the ping text
    ctx.fillStyle = pingColor;
    ctx.beginPath();
    ctx.arc(tagX + tagWidth - 20 - pingMetrics.width - 10, nameTagY + tagHeight / 2, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // 2. Draw Stacked Chat Bubbles (up to 3) directly above the name tag
    if (this.chatBubbles.length > 0) {
      let currentBubbleBottom = nameTagY - 18;

      // Draw in reverse order (newest near bottom, older above)
      for (let i = this.chatBubbles.length - 1; i >= 0; i--) {
        const bubble = this.chatBubbles[i];
        const elapsed = now - bubble.createdAt;
        const remaining = bubble.duration - elapsed;

        // Smooth Fade In (first 300ms) & Fade Out (last 800ms)
        let opacity = 1.0;
        if (elapsed < 300) {
          opacity = Math.max(0, Math.min(1.0, elapsed / 300));
        } else if (remaining < 800) {
          opacity = Math.max(0, remaining / 800);
        }

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';

        // Measure text with word wrapping
        const lines = bubble.text ? this.wrapText(ctx, bubble.text, 400) : [];
        const lineHeight = 30;
        const textHeight = lines.length * lineHeight;
        const paddingX = 24;
        const paddingY = 16;

        let maxLineWidth = 0;
        lines.forEach(l => {
          const w = ctx.measureText(l).width;
          if (w > maxLineWidth) maxLineWidth = w;
        });

        // Image attachment in bubble (Slightly larger for crystal clear visibility)
        let imgDrawWidth = 0;
        let imgDrawHeight = 0;
        if (bubble.image && bubble.image.complete && bubble.image.naturalWidth > 0) {
          const origW = bubble.image.naturalWidth;
          const origH = bubble.image.naturalHeight;
          const maxImgW = 260;
          const maxImgH = 180;
          const scale = Math.min(maxImgW / origW, maxImgH / origH, 1.0);
          imgDrawWidth = Math.round(origW * scale);
          imgDrawHeight = Math.round(origH * scale);
        }

        const contentWidth = Math.max(maxLineWidth, imgDrawWidth, lines.length > 0 ? 80 : 160);
        const bubbleWidth = contentWidth + paddingX * 2;
        const gapBetween = (lines.length > 0 && imgDrawHeight > 0) ? 12 : 0;
        const bubbleHeight = textHeight + imgDrawHeight + gapBetween + paddingY * 2;
        const bubbleX = centerX - bubbleWidth / 2;
        const bubbleY = currentBubbleBottom - bubbleHeight;

        // Bubble Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 5;

        // Bubble Background (Glassmorphism Dark)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        this.roundRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 18);
        ctx.fill();

        // Border Glow
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = i === this.chatBubbles.length - 1 ? 'rgba(129, 140, 248, 0.7)' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Downward speech pointer tail on the bottom-most bubble
        if (i === this.chatBubbles.length - 1) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
          ctx.beginPath();
          ctx.moveTo(centerX - 8, bubbleY + bubbleHeight);
          ctx.lineTo(centerX + 8, bubbleY + bubbleHeight);
          ctx.lineTo(centerX, bubbleY + bubbleHeight + 8);
          ctx.closePath();
          ctx.fill();
        }

        let currY = bubbleY + paddingY;

        // Render Text lines
        if (lines.length > 0) {
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          lines.forEach((line, lineIdx) => {
            const textY = currY + lineIdx * lineHeight + lineHeight / 2;
            ctx.fillText(line, centerX, textY);
          });
          currY += textHeight + gapBetween;
        }

        // Render Attached Image
        if (imgDrawHeight > 0 && bubble.image) {
          const imgX = centerX - imgDrawWidth / 2;
          const imgY = currY;

          ctx.save();
          this.roundRect(ctx, imgX, imgY, imgDrawWidth, imgDrawHeight, 8);
          ctx.clip();
          ctx.drawImage(bubble.image, imgX, imgY, imgDrawWidth, imgDrawHeight);
          ctx.restore();

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1.5;
          this.roundRect(ctx, imgX, imgY, imgDrawWidth, imgDrawHeight, 8);
          ctx.stroke();
        }

        ctx.restore();

        currentBubbleBottom = bubbleY - 10;
      }
    }

    this.texture.needsUpdate = true;
  }

  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.slice(0, 3); // Max 3 lines per bubble
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
    if (this.texture) this.texture.dispose();
  }
}

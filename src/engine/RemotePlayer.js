import * as THREE from 'three';
import { PaletteManager } from '../lobby/PaletteManager.js';
import { OverheadDisplay } from './OverheadDisplay.js';

export class RemotePlayer {
  constructor({ data, scene, assetLoader }) {
    this.scene = scene;
    this.assetLoader = assetLoader;
    this.id = data.id;
    this.name = data.name || 'Player';
    this.colors = data.colors;

    this.targetPosition = new THREE.Vector3(data.x || 0, data.y || 0, data.z || 0);
    this.targetRotationY = data.rotationY || 0;
    this.currentAnim = data.anim || 'idle';
    this.ping = typeof data.ping === 'number' ? data.ping : 0;

    this.mesh = this.assetLoader.getClonedModel('player');
    if (this.mesh) {
      this.mesh.position.copy(this.targetPosition);
      this.mesh.rotation.y = this.targetRotationY;
      PaletteManager.applyColorsToCharacter(this.mesh, this.colors);
      this.scene.add(this.mesh);

      // Locate arm bone/mesh nodes for interactive key-strike motion
      // In player.bbmodel: arm1 is at x=+7 (character's left arm), arm2 is at x=-7 (character's right arm)
      this.armLeft = null;
      this.armRight = null;
      this.mesh.traverse((node) => {
        const name = (node.name || '').toLowerCase();
        if (name === 'arm1' || name.includes('arm1')) {
          this.armLeft = node;
        } else if (name === 'arm2' || name.includes('arm2')) {
          this.armRight = node;
        }
      });
    }

    // Interactive note targeting arm states (Left: low notes / lowest note, Right: high notes / highest note)
    this.heldNotes = new Set();
    this.armPressRight = 0;
    this.armPressLeft = 0;
    this.armCurPressRight = 0;
    this.armCurPressLeft = 0;

    this.armYawTargetRight = 0.23; // Default resting inward yaw (~13.3°)
    this.armYawTargetLeft = -0.23; // Default resting inward yaw (~-13.3°)
    this.armCurYawRight = 0.23;
    this.armCurYawLeft = -0.23;

    // Overhead Display (Name Tag + Dynamic Chat Bubbles + Ping)
    this.overhead = new OverheadDisplay({
      name: this.name,
      isSelf: false,
      color: this.colors?.shirt || '#6366f1',
      ping: this.ping
    });
    if (this.overhead.sprite && this.mesh) {
      this.mesh.add(this.overhead.sprite);
    }

    // Animation Mixer
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.setupAnimations();
  }

  onPianoNoteDown(note) {
    this.heldNotes.add(note);
    this.updateArmTargetsFromHeldNotes();
  }

  onPianoNoteUp(note) {
    if (note !== undefined) {
      this.heldNotes.delete(note);
    } else {
      this.heldNotes.clear();
    }
    this.updateArmTargetsFromHeldNotes();
  }

  updateArmTargetsFromHeldNotes() {
    // Partition 88 piano keys (MIDI 21 to 108, middle note is ~64):
    // Left hand covers lower half (notes <= 64), aiming at lowest note pressed
    // Right hand covers upper half (notes > 64), aiming at highest note pressed
    let lowestLeft = null;
    let highestRight = null;

    for (const n of this.heldNotes) {
      if (n <= 64) {
        if (lowestLeft === null || n < lowestLeft) {
          lowestLeft = n;
        }
      } else {
        if (highestRight === null || n > highestRight) {
          highestRight = n;
        }
      }
    }

    // Left hand pointing & press
    if (lowestLeft !== null) {
      this.armPressLeft = 0.14; // Keypress downward pitch
      const leftFrac = (lowestLeft - 21) / (64 - 21); // 0 (lowest key) to 1 (middle key)
      this.armYawTargetLeft = -0.65 + leftFrac * 0.58; 
    } else {
      this.armPressLeft = 0.0;
      this.armYawTargetLeft = -0.23; // Resting natural inward posture
    }

    // Right hand pointing & press
    if (highestRight !== null) {
      this.armPressRight = 0.14; // Keypress downward pitch
      const rightFrac = (highestRight - 65) / (108 - 65); // 0 (middle key) to 1 (highest key)
      this.armYawTargetRight = 0.07 + rightFrac * 0.58;
    } else {
      this.armPressRight = 0.0;
      this.armYawTargetRight = 0.23; // Resting natural inward posture
    }
  }

  setPing(pingMs) {
    this.ping = Math.max(0, Math.round(pingMs || 0));
    if (this.overhead) {
      this.overhead.setPing(this.ping);
    }
  }

  addChatBubble(text, image = null) {
    if (this.overhead) {
      this.overhead.addMessage(text, image);
    }
  }

  setupAnimations() {
    if (!this.mesh) return;
    const anims = this.assetLoader.getAnimations('player');
    if (anims.length === 0) return;

    this.mixer = new THREE.AnimationMixer(this.mesh);

    anims.forEach(clip => {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    });

    const initAnim = this.actions[this.currentAnim] || this.actions['idle'];
    if (initAnim) {
      initAnim.play();
      this.activeAction = initAnim;
    }
  }

  playAnimation(name) {
    if (this.currentAnim === name || !this.actions[name]) return;

    const prevAction = this.activeAction;
    const nextAction = this.actions[name];

    if (prevAction) {
      prevAction.fadeOut(0.18);
    }
    nextAction.reset().fadeIn(0.18).play();
    this.activeAction = nextAction;
    this.currentAnim = name;

    // Overlay the gentle idle head-bobbing animation while playing the piano
    const bobbingAction = this.actions['idle_bobbing'];
    if (bobbingAction) {
      if (name === 'playingPiano') {
        bobbingAction.reset().fadeIn(0.2).play();
      } else {
        bobbingAction.fadeOut(0.2);
      }
    }
  }

  onNetworkUpdate(data) {
    this.targetPosition.set(data.x, data.y, data.z);
    this.targetRotationY = data.rotationY;

    if (data.anim && data.anim !== this.currentAnim) {
      this.playAnimation(data.anim);
    }

    if (typeof data.ping === 'number') {
      this.setPing(data.ping);
    }
  }

  update(delta) {
    if (!this.mesh) return;

    if (this.overhead) {
      this.overhead.update(delta);
    }

    // Smooth position lerp (Damping factor 18)
    const lerpFactor = Math.min(18 * delta, 1.0);
    this.mesh.position.lerp(this.targetPosition, lerpFactor);

    // Shortest-angle rotation interpolation
    let rotDiff = this.targetRotationY - this.mesh.rotation.y;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    this.mesh.rotation.y += rotDiff * Math.min(20 * delta, 1.0);

    // Update Animation Mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Apply dynamic hand strike and keyboard pointing angle on top of piano posture
    if (this.currentAnim === 'playingPiano') {
      // Fast press-down (32x) and snappy rebound on release (22x)
      const speedPressR = this.armPressRight > this.armCurPressRight ? 32 : 22;
      const speedPressL = this.armPressLeft > this.armCurPressLeft ? 32 : 22;

      this.armCurPressRight += (this.armPressRight - this.armCurPressRight) * Math.min(speedPressR * delta, 1.0);
      this.armCurPressLeft += (this.armPressLeft - this.armCurPressLeft) * Math.min(speedPressL * delta, 1.0);

      // Smooth horizontal arm aiming towards target key (~16x speed)
      this.armCurYawRight += (this.armYawTargetRight - this.armCurYawRight) * Math.min(16 * delta, 1.0);
      this.armCurYawLeft += (this.armYawTargetLeft - this.armCurYawLeft) * Math.min(16 * delta, 1.0);

      // Apply keypress downward angle (~6-8 degrees down onto the key) and directional yaw pointing
      if (this.armRight) {
        this.armRight.rotation.x = -0.85 + this.armCurPressRight;
        this.armRight.rotation.y = this.armCurYawRight;
      }
      if (this.armLeft) {
        this.armLeft.rotation.x = -0.85 + this.armCurPressLeft;
        this.armLeft.rotation.y = this.armCurYawLeft;
      }
    } else {
      this.armPressRight = 0;
      this.armPressLeft = 0;
      this.armCurPressRight = 0;
      this.armCurPressLeft = 0;
      this.armYawTargetRight = 0.23;
      this.armYawTargetLeft = -0.23;
      this.heldNotes.clear();
    }
  }

  setMicStatus(isMicOn, isSpeaking) {
    if (this.overhead) {
      this.overhead.setMicStatus(isMicOn, isSpeaking);
    }
  }

  destroy() {
    if (this.overhead) {
      this.overhead.destroy();
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
  }
}

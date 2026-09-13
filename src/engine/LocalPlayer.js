import * as THREE from 'three';
import { PaletteManager } from '../lobby/PaletteManager.js';
import { OverheadDisplay } from './OverheadDisplay.js';

// Scratch vector for zero-allocation tick calculations
const _scratchInput = new THREE.Vector3();
const _scratchWorldMove = new THREE.Vector3();

export class LocalPlayer {
  constructor({ scene, assetLoader, physics, initialData }) {
    this.scene = scene;
    this.assetLoader = assetLoader;
    this.physics = physics;
    this.name = initialData.name || 'Player';
    this.colors = initialData.colors;
    this.speed = 5.2;

    this.isLockedToPiano = false;
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };

    this.joystickDir = { x: 0, y: 0 };
    this.isMoving = false;
    this.currentAnim = 'idle';

    this.mesh = this.assetLoader.getClonedModel('player');
    if (this.mesh) {
      this.mesh.position.set(initialData.x || 0, 0, initialData.z || 0);
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

    // Overhead Display (Name Tag + Dynamic Chat Bubbles)
    this.overhead = new OverheadDisplay({
      name: this.name,
      isSelf: true,
      color: this.colors?.shirt || '#6366f1'
    });
    if (this.overhead.sprite && this.mesh) {
      this.mesh.add(this.overhead.sprite);
    }

    // Animation Mixer & Actions
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.setupAnimations();

    this.lastSentPos = new THREE.Vector3();
    this.lastSentRotY = 0;
    this.lastSentAnim = 'idle';
    this.sendTimer = 0;

    this.setupKeyListeners();
  }

  lockToPiano(targetPos, targetRotY = 0) {
    this.isLockedToPiano = true;
    this.isSittingOnChair = false;
    if (this.mesh) {
      this.mesh.position.set(targetPos.x, targetPos.y, targetPos.z);
      this.mesh.rotation.y = targetRotY;
    }
    this.playAnimation('playingPiano');
  }

  unlockFromPiano() {
    this.isLockedToPiano = false;
    this.playAnimation('idle');
    if (this.onUnlockFromPiano) {
      this.onUnlockFromPiano();
    }
  }

  sitOnChair(targetPos, targetRotY = 0, chairId = null) {
    this.isSittingOnChair = true;
    this.isLockedToPiano = false;
    this.currentChairId = chairId;
    if (this.mesh) {
      this.mesh.position.set(targetPos.x, targetPos.y, targetPos.z);
      this.mesh.rotation.y = targetRotY;
    }
    this.playAnimation('sit');
  }

  standUpFromChair() {
    this.isSittingOnChair = false;
    this.currentChairId = null;
    this.playAnimation('idle');
    if (this.onStandUpFromChair) {
      this.onStandUpFromChair();
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

    if (this.actions['idle']) {
      this.actions['idle'].play();
      this.activeAction = this.actions['idle'];
    }
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
      // Map MIDI 21..64 to yaw angle ~ [-0.65 (far left), -0.05 (near center)]
      const leftFrac = (lowestLeft - 21) / (64 - 21); // 0 (lowest key) to 1 (middle key)
      this.armYawTargetLeft = -0.65 + leftFrac * 0.58; 
    } else {
      this.armPressLeft = 0.0;
      this.armYawTargetLeft = -0.23; // Resting natural inward posture
    }

    // Right hand pointing & press
    if (highestRight !== null) {
      this.armPressRight = 0.14; // Keypress downward pitch
      // Map MIDI 65..108 to yaw angle ~ [0.05 (near center), 0.65 (far right)]
      const rightFrac = (highestRight - 65) / (108 - 65); // 0 (middle key) to 1 (highest key)
      this.armYawTargetRight = 0.07 + rightFrac * 0.58;
    } else {
      this.armPressRight = 0.0;
      this.armYawTargetRight = 0.23; // Resting natural inward posture
    }
  }

  setPing(pingMs) {
    if (this.overhead) {
      this.overhead.setPing(pingMs);
    }
  }

  addChatBubble(text, image = null) {
    if (this.overhead) {
      this.overhead.addMessage(text, image);
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

  setupKeyListeners() {
    this.onKeyDown = (e) => {
      // Don't capture when typing in chat
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (this.isLockedToPiano) {
        // Any movement key exits the locked piano pose
        if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          this.unlockFromPiano();
        }
      }

      if (this.isSittingOnChair) {
        // Any movement key stands up from chair
        if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          this.standUpFromChair();
        }
      }

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          break;
      }
    };

    this.onKeyUp = (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          break;
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  setJoystick(x, y) {
    this.joystickDir.x = x;
    this.joystickDir.y = y;
  }

  update(delta, networkManager) {
    if (!this.mesh) return;

    if (this.overhead) {
      this.overhead.update(delta);
    }

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

    // Determine 2D screen input vector
    let screenX = 0;
    let screenY = 0;

    if (this.keys.right) screenX += 1;
    if (this.keys.left) screenX -= 1;
    if (this.keys.down) screenY += 1;
    if (this.keys.up) screenY -= 1;

    // Joystick blend
    if (this.joystickDir.x !== 0 || this.joystickDir.y !== 0) {
      screenX = this.joystickDir.x;
      screenY = this.joystickDir.y;
    }

    if (this.isLockedToPiano || this.isSittingOnChair) {
      this.isMoving = false;
    } else {
      const inputLength = Math.hypot(screenX, screenY);
      this.isMoving = inputLength > 0.05;

      if (this.isMoving) {
        const normX = screenX / (inputLength > 1 ? inputLength : 1);
        const normY = screenY / (inputLength > 1 ? inputLength : 1);

        // Translate 2D screen motion to 3D Isometric world coordinates
        // Screen UP (normY < 0) -> (-1, -1) in X, Z
        // Screen RIGHT (normX > 0) -> (+1, -1) in X, Z
        const isoX = (normX + normY) * 0.7071;
        const isoZ = (normY - normX) * 0.7071;

        _scratchInput.set(isoX, 0, isoZ);

        // Physics Move with Swept AABB
        this.physics.move(this.mesh, _scratchInput, this.speed, delta);

        // Smooth Rotation facing movement direction
        const targetAngle = Math.atan2(isoX, isoZ);
        let diff = targetAngle - this.mesh.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.mesh.rotation.y += diff * Math.min(22 * delta, 1);

        if (this.currentAnim !== 'playingPiano') {
          this.playAnimation('walking');
        }
      } else {
        if (this.currentAnim === 'walking') {
          this.playAnimation('idle');
        }
      }
    }

    // Network Sync Throttle (~25 Hz)
    this.sendTimer += delta;
    if (this.sendTimer >= 0.04 && networkManager) {
      this.sendTimer = 0;
      const posDist = this.mesh.position.distanceTo(this.lastSentPos);
      const rotDiff = Math.abs(this.mesh.rotation.y - this.lastSentRotY);
      const animDiff = this.currentAnim !== this.lastSentAnim;

      if (posDist > 0.01 || rotDiff > 0.02 || animDiff) {
        networkManager.sendPlayerUpdate({
          x: this.mesh.position.x,
          y: this.mesh.position.y,
          z: this.mesh.position.z,
          rotationY: this.mesh.rotation.y,
          anim: this.currentAnim
        });

        this.lastSentPos.copy(this.mesh.position);
        this.lastSentRotY = this.mesh.rotation.y;
        this.lastSentAnim = this.currentAnim;
      }
    }
  }

  setMicStatus(isMicOn, isSpeaking) {
    if (this.overhead) {
      this.overhead.setMicStatus(isMicOn, isSpeaking);
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
  }
}

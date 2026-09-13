import * as THREE from 'three';

export class HUD {
  constructor({ 
    container, 
    onToolSelect, 
    onAction, 
    onChatMessage, 
    onExitRoom, 
    onVolumeChange, 
    onReverbChange,
    onVelocityCurveChange,
    onFloatingNotesToggle, 
    initialVolume = 0.70, 
    initialReverb = 0.12,
    initialVelocityCurve = 'linear',
    initialFloatingNotes = true 
  }) {
    this.container = container;
    this.onToolSelect = onToolSelect;
    this.onAction = onAction;
    this.onChatMessage = onChatMessage;
    this.onExitRoom = onExitRoom;
    this.onVolumeChange = onVolumeChange;
    this.onReverbChange = onReverbChange;
    this.onVelocityCurveChange = onVelocityCurveChange;
    this.onFloatingNotesToggle = onFloatingNotesToggle;
    this.volume = initialVolume;
    this.reverbLevel = initialReverb;
    this.velocityCurve = initialVelocityCurve;
    this.showFloatingNotes = initialFloatingNotes;

    this.activeTool = 'wall'; // 'wall' | 'floor' | 'remove' | 'emote'
    this.players = [];
    this.fps = 60;
    this.ping = 0;
    this.lastTime = performance.now();
    this.frames = 0;

    this.render();
    this.setupEvents();
  }

  render() {
    const volPercent = Math.round(this.volume * 100);
    const reverbPercent = Math.round(this.reverbLevel * 100);
    this.container.innerHTML = `
      <!-- Top Status Bar -->
      <header class="hud-header">
        <div class="hud-left">
          <div class="hud-room-badge">
            <span class="pulse-dot"></span>
            <span id="hud-room-name">World: Loading...</span>
          </div>
          <div class="hud-stat-badge stat-players">
            <i class="pixelart-icons-font-users" style="font-size: 15px; margin-right: 4px;"></i>
            <span id="hud-player-count">1 Player</span>
          </div>
          <div class="hud-stat-badge ping-badge" id="hud-ping-badge">
            <span class="ping-dot good"></span>
            <span id="hud-ping">-- ms</span>
          </div>
          <div class="hud-stat-badge fps-badge">
            <span id="hud-fps">60 FPS</span>
          </div>
        </div>

        <div class="hud-right">
          <!-- Mobile Chat Button (Icon only) -->
          <button id="btn-open-mobile-chat" class="hud-icon-btn mobile-only hud-chat-btn" title="Open Chat" aria-label="Open Chat">
            <i class="pixelart-icons-font-message"></i>
          </button>
          <button id="btn-toggle-settings" class="hud-icon-btn" title="Audio & Settings" aria-label="Settings">
            <i class="pixelart-icons-font-volume-2"></i>
          </button>
          <button id="btn-toggle-players" class="hud-icon-btn desk-btn" title="Player List" aria-label="Player List">
            <i class="pixelart-icons-font-users"></i>
          </button>
          <button id="btn-toggle-controls" class="hud-icon-btn desk-btn" title="Controls Guide" aria-label="Controls Guide">
            <i class="pixelart-icons-font-keyboard"></i>
          </button>
          <button id="btn-exit-world" class="hud-exit-btn" title="Leave World" aria-label="Leave World">
            <span class="btn-text">Exit</span> <i class="pixelart-icons-font-close" style="font-size: 14px;"></i>
          </button>
        </div>
      </header>

      <!-- Settings & Volume Overlay Modal -->
      <div id="hud-settings-modal" class="hud-overlay-modal hidden">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon"><i class="pixelart-icons-font-sliders"></i></span>
              <h3>Audio & Settings</h3>
            </div>
            <button id="btn-close-settings" class="btn-close"><i class="pixelart-icons-font-close"></i></button>
          </div>
          <div class="settings-content">
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Master Volume</span>
                <span class="setting-desc">Adjust piano & sound effect loudness</span>
              </div>
              <div class="setting-control">
                <span id="volume-icon" class="volume-icon"><i class="pixelart-icons-font-volume-2"></i></span>
                <input type="range" id="volume-slider" class="range-slider" min="0" max="100" value="${volPercent}" />
                <span id="volume-value-text" class="volume-val-badge">${volPercent}%</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Reverb Ambience</span>
                <span class="setting-desc">Natural room acoustic tail (0% Dry / Direct &bull; 100% Concert Hall)</span>
              </div>
              <div class="setting-control">
                <span class="volume-icon"><i class="pixelart-icons-font-radio-signal"></i></span>
                <input type="range" id="reverb-slider" class="range-slider" min="0" max="100" value="${reverbPercent}" />
                <span id="reverb-value-text" class="volume-val-badge">${reverbPercent}%</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Touch Velocity Curve</span>
                <span class="setting-desc">Keyboard touch sensitivity response profile</span>
              </div>
              <div class="setting-control">
                <select id="select-velocity-curve" class="settings-select">
                  <option value="linear" ${this.velocityCurve === 'linear' ? 'selected' : ''}>Linear (1:1 Natural)</option>
                  <option value="ease-in" ${this.velocityCurve === 'ease-in' ? 'selected' : ''}>Ease In (Gentle touch, punch on hard strike)</option>
                  <option value="ease-out" ${this.velocityCurve === 'ease-out' ? 'selected' : ''}>Ease Out (High sensitivity / lighter touch)</option>
                  <option value="ease-in-out" ${this.velocityCurve === 'ease-in-out' ? 'selected' : ''}>Ease In-Out (S-Curve dynamic compression)</option>
                  <option value="exponential" ${this.velocityCurve === 'exponential' ? 'selected' : ''}>Exponential (Cubic wide dynamic range)</option>
                </select>
              </div>
            </div>

            <div class="setting-row horizontal">
              <div class="setting-info">
                <span class="setting-label">Synthesia Floating Notes</span>
                <span class="setting-desc">Glowing waterfall visualizer notes rising from struck keys</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-floating-notes" ${this.showFloatingNotes ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Player List Overlay Modal -->
      <div id="hud-player-list-modal" class="hud-overlay-modal hidden">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon"><i class="pixelart-icons-font-users"></i></span>
              <h3>Connected Players</h3>
            </div>
            <button id="btn-close-players" class="btn-close"><i class="pixelart-icons-font-close"></i></button>
          </div>
          <div id="hud-players-container" class="players-list-scroll"></div>
        </div>
      </div>

      <!-- Controls Guide Modal -->
      <div id="hud-controls-modal" class="hud-overlay-modal hidden">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon"><i class="pixelart-icons-font-keyboard"></i></span>
              <h3>Game Controls</h3>
            </div>
            <button id="btn-close-controls" class="btn-close"><i class="pixelart-icons-font-close"></i></button>
          </div>
          <div class="controls-list">
            <div class="control-row">
              <span class="key-badge">W A S D</span> / <span class="key-badge">Arrows</span>
              <span>Smooth Isometric Movement</span>
            </div>
            <div class="control-row">
              <span class="key-badge">Mouse Scroll</span>
              <span>Smooth Zoom In / Out</span>
            </div>
            <div class="control-row">
              <span class="key-badge">Hold E</span>
              <span>Interact (Play Piano / Sit on Chair)</span>
            </div>
            <div class="control-row">
              <span class="key-badge">B</span>
              <span>Toggle Build & Decorate Mode</span>
            </div>
            <div class="control-row">
              <span class="key-badge">R</span>
              <span>Rotate Object 90° (in Build Mode)</span>
            </div>
            <div class="control-row">
              <span class="key-badge">Enter</span>
              <span>Focus Chat</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Overlay (Bottom Left) -->
      <div class="hud-chat-box">
        <div id="hud-chat-messages" class="chat-messages">
          <div class="chat-msg system">
            <span class="sender"><i class="pixelart-icons-font-message" style="font-size: 13px; margin-right: 4px;"></i> System:</span>
            <span class="text">Welcome to Chaticube! WASD to move, E to interact.</span>
          </div>
        </div>

        <!-- Pending Image Attachment Preview -->
        <div id="chat-attachment-preview" class="chat-attachment-preview hidden">
          <img id="chat-preview-img" src="" alt="attachment preview" />
          <span class="preview-name">Image attached</span>
          <button type="button" id="btn-remove-attachment" class="btn-remove-attachment" title="Remove attachment"><i class="pixelart-icons-font-close"></i></button>
        </div>

        <form id="hud-chat-form" class="chat-form">
          <input type="file" id="hud-chat-file-input" accept="image/png, image/jpeg, image/webp, image/gif" style="display: none;" />
          <button type="button" id="btn-attach-image" class="chat-attach-btn" title="Attach Image (or Paste Ctrl+V)"><i class="pixelart-icons-font-image"></i></button>
          <input type="text" id="hud-chat-input" placeholder="Press Enter to chat..." maxlength="120" autocomplete="off" />
          <button type="submit" class="chat-submit-btn"><i class="pixelart-icons-font-send" style="font-size: 14px;"></i></button>
        </form>
      </div>

      <!-- Mobile Floating Chat Input (Anchored above Keyboard via visualViewport) -->
      <div id="mobile-chat-bar" class="mobile-chat-bar hidden">
        <form id="mobile-chat-form" class="mobile-chat-form">
          <input type="file" id="mobile-chat-file-input" accept="image/png, image/jpeg, image/webp, image/gif" style="display: none;" />
          <button type="button" id="btn-mobile-attach" class="btn-mobile-chat-attach" title="Attach Image"><i class="pixelart-icons-font-image"></i></button>
          <input 
            type="text" 
            id="mobile-chat-input" 
            placeholder="Type a message..." 
            maxlength="120" 
            autocomplete="off" 
            autocorrect="off" 
            autocapitalize="off" 
            spellcheck="false"
          />
          <button type="submit" class="btn-mobile-chat-send"><i class="pixelart-icons-font-send"></i></button>
          <button type="button" id="btn-close-mobile-chat-bar" class="btn-mobile-chat-cancel"><i class="pixelart-icons-font-close"></i></button>
        </form>
      </div>

      <!-- Image Lightbox Modal -->
      <div id="hud-image-lightbox" class="hud-lightbox-modal hidden">
        <div class="lightbox-content">
          <img id="lightbox-img" src="" alt="Full view" />
          <button type="button" id="btn-close-lightbox" class="lightbox-close-btn"><i class="pixelart-icons-font-close"></i></button>
        </div>
      </div>

      <!-- Hotbar Toolbar (Building & Furniture) -->
      <div id="hud-hotbar" class="hud-hotbar hidden">
        <div class="hotbar-slot active" data-tool="wall" title="Place Wall (Rotatable with R)">
          <span class="slot-key">1</span>
          <span class="slot-icon"><i class="pixelart-icons-font-wall"></i></span>
          <span class="slot-name">Wall</span>
        </div>
        <div class="hotbar-slot" data-tool="floor" title="Place Floor Tile">
          <span class="slot-key">2</span>
          <span class="slot-icon"><i class="pixelart-icons-font-layout"></i></span>
          <span class="slot-name">Floor</span>
        </div>
        <div class="hotbar-slot" data-tool="chair" title="Place Chair (Rotatable with R)">
          <span class="slot-key">3</span>
          <span class="slot-icon"><i class="pixelart-icons-font-hotel-bed"></i></span>
          <span class="slot-name">Chair</span>
        </div>
        <div class="hotbar-slot" data-tool="books" title="Place Bookshelf / Books (Rotatable with R)">
          <span class="slot-key">4</span>
          <span class="slot-icon"><i class="pixelart-icons-font-book-open"></i></span>
          <span class="slot-name">Books</span>
        </div>
        <div class="hotbar-slot" data-tool="remove" title="Demolish / Remove Block">
          <span class="slot-key">5</span>
          <span class="slot-icon"><i class="pixelart-icons-font-trash"></i></span>
          <span class="slot-name">Remove</span>
        </div>
      </div>

      <!-- Placement Coordinate Banner -->
      <div id="hud-placement-info" class="hud-placement-info">
        <span class="info-tag">BUILD MODE ACTIVE</span>
        <div class="info-coords">Tile: <strong id="hud-coord-text">x: 0, z: 0 (rot: 0°)</strong></div>
        <div class="info-help">
          <span>[L-Click] Place</span> &bull; 
          <span>[R] Rotate 90°</span> &bull; 
          <span>[1-5] Select Tool</span>
        </div>
      </div>

      <!-- Interaction Prompt (Hold E to Play Piano) -->
      <div id="hud-interact-prompt" class="hud-interact-prompt hidden">
        <div class="interact-key-circle">
          <svg class="interact-progress-ring" width="44" height="44">
            <circle class="ring-bg" cx="22" cy="22" r="18"></circle>
            <circle id="interact-progress-circle" class="ring-fill" cx="22" cy="22" r="18"></circle>
          </svg>
          <span class="key-label">E</span>
        </div>
        <div class="interact-info">
          <span class="interact-action">Play Piano</span>
          <span class="interact-hint">Hold <strong id="interact-hint-text">E</strong></span>
        </div>
      </div>

      <!-- Virtual Mobile Joystick -->
      <div id="mobile-joystick-zone" class="joystick-zone">
        <div id="joystick-base" class="joystick-base">
          <div id="joystick-stick" class="joystick-stick"></div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Enter') {
        const chatInput = document.getElementById('hud-chat-input');
        if (chatInput) {
          e.preventDefault();
          chatInput.focus();
        }
      }
    });

    // Image Attachment State
    this.pendingImageData = null;
    const fileInput = this.container.querySelector('#hud-chat-file-input');
    const attachBtn = this.container.querySelector('#btn-attach-image');
    const previewContainer = this.container.querySelector('#chat-attachment-preview');
    const previewImg = this.container.querySelector('#chat-preview-img');
    const removeAttachBtn = this.container.querySelector('#btn-remove-attachment');

    const clearAttachment = () => {
      this.pendingImageData = null;
      if (fileInput) fileInput.value = '';
      if (previewImg) previewImg.src = '';
      if (previewContainer) previewContainer.classList.add('hidden');
    };

    removeAttachBtn?.addEventListener('click', clearAttachment);

    const processAndAttachFile = (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Downscale to max 280x280 for ultra-lightweight memory & network (under ~15KB WebP/JPEG)
          const maxDim = 280;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          // Compress to lightweight webp/jpeg data URI
          const compressedData = canvas.toDataURL('image/webp', 0.72) || canvas.toDataURL('image/jpeg', 0.7);
          this.pendingImageData = compressedData;

          if (previewImg) previewImg.src = compressedData;
          if (previewContainer) previewContainer.classList.remove('hidden');
          
          const chatInput = this.container.querySelector('#hud-chat-input');
          chatInput?.focus();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };

    attachBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) processAndAttachFile(file);
    });

    // Paste from Clipboard (Ctrl+V) directly into chat
    const chatInput = this.container.querySelector('#hud-chat-input');
    chatInput?.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (items) {
        for (const item of items) {
          if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) processAndAttachFile(file);
            break;
          }
        }
      }
    });

    // Lightbox Modal setup
    const lightboxModal = this.container.querySelector('#hud-image-lightbox');
    const lightboxImg = this.container.querySelector('#lightbox-img');
    const closeLightboxBtn = this.container.querySelector('#btn-close-lightbox');

    const closeLightbox = () => {
      lightboxModal?.classList.add('hidden');
      if (lightboxImg) lightboxImg.src = '';
    };

    closeLightboxBtn?.addEventListener('click', closeLightbox);
    lightboxModal?.addEventListener('click', (e) => {
      if (e.target === lightboxModal) closeLightbox();
    });

    // Chat Form Submit
    const chatForm = this.container.querySelector('#hud-chat-form');
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      const img = this.pendingImageData;

      if (text || img) {
        if (this.onChatMessage) this.onChatMessage(text, img);
        chatInput.value = '';
        clearAttachment();
      }
      chatInput.blur();
    });

    // Hotbar Slot Selection
    const hotbar = this.container.querySelector('#hud-hotbar');
    if (hotbar) {
      hotbar.querySelectorAll('.hotbar-slot').forEach(slot => {
        slot.addEventListener('click', () => {
          hotbar.querySelectorAll('.hotbar-slot').forEach(s => s.classList.remove('active'));
          slot.classList.add('active');
          const tool = slot.getAttribute('data-tool');
          this.activeTool = tool;
          if (this.onToolSelect) {
            this.onToolSelect(tool);
          }
        });
      });
    }

    // Exit World Button
    this.container.querySelector('#btn-exit-world').addEventListener('click', () => {
      if (this.onExitRoom) this.onExitRoom();
    });

    // Toggle Settings Modal
    this.container.querySelector('#btn-toggle-settings').addEventListener('click', () => {
      const modal = this.container.querySelector('#hud-settings-modal');
      modal.classList.toggle('hidden');
    });

    this.container.querySelector('#btn-close-settings').addEventListener('click', () => {
      this.container.querySelector('#hud-settings-modal').classList.add('hidden');
    });

    // Volume Slider
    const volSlider = this.container.querySelector('#volume-slider');
    const volValText = this.container.querySelector('#volume-value-text');
    const volIcon = this.container.querySelector('#volume-icon');

    volSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const normalized = val / 100;
      this.volume = normalized;
      if (volValText) volValText.textContent = `${val}%`;

      if (volIcon) {
        if (val === 0) volIcon.innerHTML = '<i class="pixelart-icons-font-volume-x"></i>';
        else if (val < 40) volIcon.innerHTML = '<i class="pixelart-icons-font-volume-1"></i>';
        else volIcon.innerHTML = '<i class="pixelart-icons-font-volume-2"></i>';
      }

      if (this.onVolumeChange) {
        this.onVolumeChange(normalized);
      }
    });

    // Reverb Ambience Slider
    const reverbSlider = this.container.querySelector('#reverb-slider');
    const reverbValText = this.container.querySelector('#reverb-value-text');

    reverbSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const normalized = val / 100;
      this.reverbLevel = normalized;
      if (reverbValText) reverbValText.textContent = `${val}%`;

      if (this.onReverbChange) {
        this.onReverbChange(normalized);
      }
    });

    // Velocity Curve Select
    const curveSelect = this.container.querySelector('#select-velocity-curve');
    curveSelect?.addEventListener('change', (e) => {
      this.velocityCurve = e.target.value;
      if (this.onVelocityCurveChange) {
        this.onVelocityCurveChange(this.velocityCurve);
      }
    });

    // Floating Notes Toggle
    const notesToggle = this.container.querySelector('#toggle-floating-notes');
    notesToggle?.addEventListener('change', (e) => {
      this.showFloatingNotes = e.target.checked;
      if (this.onFloatingNotesToggle) {
        this.onFloatingNotesToggle(this.showFloatingNotes);
      }
    });

    // Toggle Player List
    this.container.querySelector('#btn-toggle-players').addEventListener('click', () => {
      const modal = this.container.querySelector('#hud-player-list-modal');
      modal.classList.toggle('hidden');
    });

    this.container.querySelector('#btn-close-players').addEventListener('click', () => {
      this.container.querySelector('#hud-player-list-modal').classList.add('hidden');
    });

    // Toggle Controls Guide
    this.container.querySelector('#btn-toggle-controls').addEventListener('click', () => {
      const modal = this.container.querySelector('#hud-controls-modal');
      modal.classList.toggle('hidden');
    });

    this.container.querySelector('#btn-close-controls').addEventListener('click', () => {
      this.container.querySelector('#hud-controls-modal').classList.add('hidden');
    });

    // Leave Piano Button (if present)
    this.container.querySelector('#btn-leave-piano')?.addEventListener('click', () => {
      if (this.onLeavePiano) this.onLeavePiano();
    });

    this.setupMobileJoystick();
    this.setupMobileChat();
  }

  updatePing(pingMs) {
    this.ping = pingMs;
    const pingEl = this.container.querySelector('#hud-ping');
    const dotEl = this.container.querySelector('.ping-dot');
    if (pingEl) pingEl.textContent = `${pingMs} ms`;

    if (dotEl) {
      dotEl.classList.remove('good', 'medium', 'bad');
      if (pingMs < 60) {
        dotEl.classList.add('good');
      } else if (pingMs < 140) {
        dotEl.classList.add('medium');
      } else {
        dotEl.classList.add('bad');
      }
    }
  }

  setPianoMode(active) { }

  updatePianoMidiStatus(devices) { }

  updatePianoNoteDisplay(text) { }

  updateInteractPrompt({ visible, progress = 0, action = 'Play Piano', hint = 'Hold E' }) {
    const el = this.container.querySelector('#hud-interact-prompt');
    if (!el) return;
    if (!visible) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    const actionEl = el.querySelector('.interact-action');
    const hintEl = el.querySelector('#interact-hint-text');
    const circle = el.querySelector('#interact-progress-circle');

    if (actionEl) actionEl.textContent = action;
    if (hintEl) hintEl.textContent = hint;

    if (circle) {
      const radius = 18;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (Math.min(1, Math.max(0, progress)) * circumference);
      circle.style.strokeDasharray = `${circumference}`;
      circle.style.strokeDashoffset = `${offset}`;
    }
  }

  selectToolByIndex(index) {
    const slots = this.container.querySelectorAll('.hotbar-slot');
    if (slots[index]) {
      slots[index].click();
    }
  }

  setBuildMode(active) {
    const hotbar = this.container.querySelector('#hud-hotbar');
    const info = this.container.querySelector('#hud-placement-info');
    if (hotbar) {
      hotbar.classList.toggle('hidden', !active);
    }
    if (info) {
      info.classList.toggle('active', active);
    }
  }

  updatePlacementInfo({ x, z, rotDeg, tool, isValid = true }) {
    const info = this.container.querySelector('#hud-placement-info');
    const coordText = this.container.querySelector('#hud-coord-text');
    if (coordText) {
      coordText.textContent = `[${tool?.toUpperCase() || 'WALL'}] x: ${x}, z: ${z} (rot: ${rotDeg}°)`;
      coordText.style.color = isValid ? '#38bdf8' : '#f87171';
    }
  }

  setRoomInfo(roomName, playerCount, isOwner) {
    const roomEl = this.container.querySelector('#hud-room-name');
    const countEl = this.container.querySelector('#hud-player-count');
    if (roomEl) roomEl.textContent = `World: ${roomName} ${isOwner ? '👑' : ''}`;
    if (countEl) countEl.textContent = `👥 ${playerCount} ${playerCount === 1 ? 'Player' : 'Players'}`;
  }

  updatePlayerList(players) {
    this.players = players || [];
    const container = this.container.querySelector('#hud-players-container');
    if (!container) return;

    container.innerHTML = this.players.map(p => {
      const pingVal = typeof p.ping === 'number' ? p.ping : 0;
      const pingClass = pingVal < 80 ? 'good' : pingVal < 160 ? 'medium' : 'bad';
      return `
        <div class="player-list-row">
          <span class="player-dot" style="background: ${p.colors?.shirt || '#4f46e5'}"></span>
          <span class="player-name">${this.escapeHTML(p.name)}</span>
          ${p.isSelf ? '<span class="pill-badge-mini">You</span>' : ''}
          <div class="player-ping-badge">
            <span class="ping-dot ${pingClass}"></span>
            <span class="ping-num">${pingVal} ms</span>
          </div>
        </div>
      `;
    }).join('');
  }

  addChatMessage({ name, message, image, timestamp, isSystem }) {
    const msgContainer = this.container.querySelector('#hud-chat-messages');
    if (!msgContainer) return;

    const div = document.createElement('div');
    div.className = `chat-msg ${isSystem ? 'system' : ''}`;

    let imageHTML = '';
    if (image) {
      imageHTML = `
        <div class="chat-msg-image-wrap">
          <img class="chat-msg-thumb" src="${image}" alt="Attached image" loading="lazy" />
        </div>
      `;
    }

    div.innerHTML = `
      <span class="sender">${this.escapeHTML(name)}:</span>
      ${message ? `<span class="text">${this.escapeHTML(message)}</span>` : ''}
      ${imageHTML}
    `;

    // Click thumbnail to expand in lightbox modal
    if (image) {
      const thumb = div.querySelector('.chat-msg-thumb');
      thumb?.addEventListener('click', () => {
        const lightboxModal = this.container.querySelector('#hud-image-lightbox');
        const lightboxImg = this.container.querySelector('#lightbox-img');
        if (lightboxModal && lightboxImg) {
          lightboxImg.src = image;
          lightboxModal.classList.remove('hidden');
        }
      });
    }

    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Limit scrollback to 40 messages
    if (msgContainer.children.length > 40) {
      msgContainer.removeChild(msgContainer.firstChild);
    }
  }

  updateFPS() {
    this.frames++;
    const now = performance.now();
    if (now >= this.lastTime + 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
      this.frames = 0;
      this.lastTime = now;
      const el = this.container.querySelector('#hud-fps');
      if (el) el.textContent = `${this.fps} FPS`;
    }
  }

  setupMobileJoystick() {
    const zone = this.container.querySelector('#mobile-joystick-zone');
    const stick = this.container.querySelector('#joystick-stick');
    const base = this.container.querySelector('#joystick-base');

    if (!zone || !stick || !base) return;

    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
      zone.style.display = 'none';
      return;
    }

    let activeTouchId = null;
    let originX = 0;
    let originY = 0;
    const maxDist = 50;

    const onTouchMove = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId) {
          let deltaX = touch.clientX - originX;
          let deltaY = touch.clientY - originY;
          const dist = Math.hypot(deltaX, deltaY);

          if (dist > maxDist) {
            deltaX = (deltaX / dist) * maxDist;
            deltaY = (deltaY / dist) * maxDist;
          }

          stick.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          if (this.onJoystick) {
            this.onJoystick(deltaX / maxDist, deltaY / maxDist);
          }
        }
      }
    };

    const onTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId) {
          activeTouchId = null;
          base.classList.remove('active');
          base.style.left = '50%';
          base.style.top = '50%';
          stick.style.transform = 'translate(0px, 0px)';
          if (this.onJoystick) {
            this.onJoystick(0, 0);
          }
        }
      }
    };

    // Magnetic Dynamic Joystick: Touch anywhere in the bottom-left/middle zone spawns the joystick directly under finger
    zone.addEventListener('touchstart', (e) => {
      if (activeTouchId === null && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        activeTouchId = touch.identifier;

        const zoneRect = zone.getBoundingClientRect();
        originX = touch.clientX;
        originY = touch.clientY;

        const relX = originX - zoneRect.left;
        const relY = originY - zoneRect.top;

        base.style.left = `${relX}px`;
        base.style.top = `${relY}px`;
        base.classList.add('active');
        stick.style.transform = 'translate(0px, 0px)';

        if (this.onJoystick) {
          this.onJoystick(0, 0);
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }

  setupMobileChat() {
    const mobileChatBar = this.container.querySelector('#mobile-chat-bar');
    const btnOpenMobileChat = this.container.querySelector('#btn-open-mobile-chat');
    const btnCloseMobileChatBar = this.container.querySelector('#btn-close-mobile-chat-bar');
    const mobileChatForm = this.container.querySelector('#mobile-chat-form');
    const mobileChatInput = this.container.querySelector('#mobile-chat-input');
    const mobileFileInput = this.container.querySelector('#mobile-chat-file-input');
    const btnMobileAttach = this.container.querySelector('#btn-mobile-attach');

    let pendingMobileImage = null;

    // 1. Dynamic visual viewport tracking for virtual on-screen keyboard alignment
    const updateMobileChatPosition = () => {
      if (!mobileChatBar || mobileChatBar.classList.contains('hidden')) return;
      if (window.visualViewport) {
        const vp = window.visualViewport;
        const offsetBottom = Math.max(0, window.innerHeight - (vp.height + vp.offsetTop));
        mobileChatBar.style.bottom = `${offsetBottom + 12}px`;
      } else {
        mobileChatBar.style.bottom = '12px';
      }
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateMobileChatPosition);
      window.visualViewport.addEventListener('scroll', updateMobileChatPosition);
    }

    const closeMobileChat = () => {
      if (!mobileChatBar) return;
      mobileChatBar.classList.add('hidden');
      pendingMobileImage = null;
      if (btnMobileAttach) {
        btnMobileAttach.classList.remove('has-image');
      }
      if (mobileChatInput) {
        mobileChatInput.blur();
        mobileChatInput.value = '';
      }
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    };

    btnOpenMobileChat?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!mobileChatBar || !mobileChatInput) return;
      mobileChatBar.classList.remove('hidden');
      mobileChatInput.value = '';
      mobileChatInput.focus({ preventScroll: true });
      updateMobileChatPosition();
    });

    btnCloseMobileChatBar?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeMobileChat();
    });

    // Mobile Image attachment
    btnMobileAttach?.addEventListener('click', () => {
      mobileFileInput?.click();
    });

    mobileFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 280;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          pendingMobileImage = canvas.toDataURL('image/webp', 0.72) || canvas.toDataURL('image/jpeg', 0.7);
          btnMobileAttach.classList.add('has-image');
          mobileChatInput?.focus({ preventScroll: true });
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    mobileChatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = mobileChatInput.value.trim();
      const img = pendingMobileImage;
      if (text || img) {
        if (this.onChatMessage) {
          this.onChatMessage(text, img);
        }
      }
      closeMobileChat();
    });

    mobileChatInput?.addEventListener('focus', () => {
      updateMobileChatPosition();
    });

    mobileChatInput?.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== mobileChatInput && document.activeElement !== mobileFileInput) {
          closeMobileChat();
        }
      }, 150);
    });
  }

  escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g,
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}

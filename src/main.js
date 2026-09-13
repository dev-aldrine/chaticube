import * as THREE from 'three';
import { AssetLoader } from './engine/AssetLoader.js';
import { CameraSystem } from './engine/CameraSystem.js';
import { RenderSystem } from './engine/RenderSystem.js';
import { WorldStorage } from './engine/WorldStorage.js';
import { ChunkManager } from './engine/ChunkManager.js';
import { Physics } from './engine/Physics.js';
import { LocalPlayer } from './engine/LocalPlayer.js';
import { RemotePlayer } from './engine/RemotePlayer.js';
import { CharacterStudio } from './lobby/CharacterStudio.js';
import { PaletteManager, COLOR_PALETTES } from './lobby/PaletteManager.js';
import { WorldsBrowser } from './lobby/WorldsBrowser.js';
import { NetworkManager } from './network/NetworkManager.js';
import { SalamanderPianoEngine } from './engine/SalamanderPianoEngine.js';
import { VoiceChatManager } from './engine/VoiceChatManager.js';
import { MidiManager } from './engine/MidiManager.js';
import { PianoInteractPrompt } from './engine/PianoInteractPrompt.js';
import { HUD } from './ui/HUD.js';
import { Notifications } from './ui/Notifications.js';

class GameApp {
  constructor() {
    initBrowserLockdown();

    this.gameState = 'LOBBY'; // 'LOBBY' | 'IN_GAME'
    this.assetLoader = new AssetLoader();
    this.networkManager = new NetworkManager();
    this.pianoEngine = new SalamanderPianoEngine();
    this.voiceChatManager = null;
    this.midiManager = null;

    this.characterStudio = null;
    this.worldsBrowser = null;
    this.hud = null;

    // Selected Customization State
    this.playerColors = PaletteManager.getRandomColors();
    this.playerName = PaletteManager.getRandomName();
    this.currentRoom = 'cozy-lounge';

    // Game Engine State
    this.scene = null;
    this.cameraSystem = null;
    this.renderSystem = null;
    this.worldStorage = null;
    this.chunkManager = null;
    this.physics = null;
    this.localPlayer = null;
    this.remotePlayers = new Map(); // id -> RemotePlayer

    // 3D Piano Keys Mapping & State
    this.pianoKeyMeshes = new Map(); // midiNote (21..108) -> Object3D (key mesh)
    this.animatingKeys = new Set(); // Set of currently moving/glowing keys for zero-waste loop
    this.pressedKeys = new Set();
    this.activeComputerKeys = new Map();

    // Synthesia Floating Waterfall Notes System (Pre-allocated zero-allocation assets)
    this.synthesiaNotes = []; // Active and rising note visualizer meshes
    this.activeSynthesiaNotes = new Map(); // midi -> currently growing note mesh
    const savedNotesToggle = localStorage.getItem('piano_floating_notes');
    this.showFloatingNotes = savedNotesToggle !== null ? savedNotesToggle === 'true' : true;

    // Pre-allocated shared geometries for sleek thin waterfall tracks
    this.synthesiaGeomWhite = new THREE.BoxGeometry(0.042, 0.05, 0.04);
    this.synthesiaGeomWhite.translate(0, 0.025, 0);
    this.synthesiaGeomBlack = new THREE.BoxGeometry(0.028, 0.05, 0.04);
    this.synthesiaGeomBlack.translate(0, 0.025, 0);

    // Pre-allocated shared materials (Zero shader compile stutter on note strike)
    // Lower half (MIDI <= 64): Purple, Upper half (MIDI > 64): Light Blue
    this.synthesiaMatPurple = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    this.synthesiaMatLightBlue = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });

    // Interaction & Building
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hoverTile = { x: 0, z: 0, isValid: false };
    this.cursorIndicator = null;
    this.isBuildMode = false;
    this.activeTool = 'wall';
    this.placementRotationY = 0; // 0, PI/2, PI, -PI/2 (0°, 90°, 180°, 270°)

    // Dynamic Chair Interaction Prompt & Nearest Chair Tracking
    this.chairPrompt = null;
    this.nearestChair = null;

    this.lastFrameTime = performance.now();
    this.isLoopRunning = false;

    this.init();
  }

  async init() {
    try {
      // Show startup preload overlay
      const loading = document.getElementById('loading-overlay');
      loading?.classList.remove('hidden');
      this.updateLoadingProgress(10, 'Preloading Game Engine...', 'Loading 3D voxel models, textures, & animations...');

      // 1. Preload all 3D GLTF models and palette textures with progress
      await this.assetLoader.loadAll((ratio, name) => {
        const percent = Math.round(10 + ratio * 45); // 10% -> 55%
        this.updateLoadingProgress(percent, 'Loading 3D Assets...', `Loaded ${name}`);
      });

      // 2. Preload Salamander Grand Piano Audio Samples (Core + Remaining Anchors)
      this.updateLoadingProgress(60, 'Preloading Piano Audio...', 'Buffering high-fidelity acoustic samples...');
      await this.pianoEngine.loadSamples((ratio) => {
        const percent = Math.round(60 + ratio * 35); // 60% -> 95%
        this.updateLoadingProgress(percent, 'Buffering Audio Samples...', `Buffered ${Math.round(ratio * 100)}% acoustic piano notes`);
      });

      // 3. Initialize Lobby UI, Network & Commands
      this.initLobbyUI();
      this.initNetwork();
      this.setupConsoleCommands();

      // 4. Complete startup loading smoothly
      this.updateLoadingProgress(100, 'Assets Ready!', 'Launching lobby...');
      await new Promise(r => setTimeout(r, 200));
      loading?.classList.add('hidden');

      Notifications.show('All game assets & audio samples preloaded!', 'success', 2500);
    } catch (err) {
      console.error('Initialization error:', err);
      Notifications.show('Failed to load assets: ' + err.message, 'error', 6000);
      document.getElementById('loading-overlay')?.classList.add('hidden');
    }
  }

  initLobbyUI() {
    // 3D Character Studio Canvas
    const previewCanvas = document.getElementById('character-preview-canvas');
    if (previewCanvas) {
      this.characterStudio = new CharacterStudio(previewCanvas, this.assetLoader);
      this.characterStudio.updateColors(this.playerColors);
    }

    // Populate Swatches
    this.renderColorSwatches('skin-swatches', COLOR_PALETTES.skin, 'skin');
    this.renderColorSwatches('shirt-swatches', COLOR_PALETTES.shirt, 'shirt');
    this.renderColorSwatches('pants-swatches', COLOR_PALETTES.pants, 'pants');

    // Inputs
    const nameInput = document.getElementById('player-name-input');
    const roomInput = document.getElementById('room-name-input');
    if (nameInput) nameInput.value = this.playerName;
    if (roomInput) roomInput.value = this.currentRoom;

    // Randomizer
    document.getElementById('btn-random-avatar')?.addEventListener('click', () => {
      this.playerColors = PaletteManager.getRandomColors();
      this.playerName = PaletteManager.getRandomName();
      if (nameInput) nameInput.value = this.playerName;

      if (this.characterStudio) {
        this.characterStudio.updateColors(this.playerColors);
      }
      this.updateActiveSwatches();
    });

    // Worlds Browser
    const worldsContainer = document.getElementById('worlds-list-container');
    this.worldsBrowser = new WorldsBrowser(worldsContainer, (selectedRoom) => {
      if (roomInput) roomInput.value = selectedRoom;
      this.startJoinFlow(selectedRoom);
    });

    // Worlds Search Filter
    document.getElementById('world-search-input')?.addEventListener('input', (e) => {
      this.worldsBrowser.setFilter(e.target.value);
    });

    // Join Room Form
    document.getElementById('join-room-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim() || this.playerName;
      const room = roomInput.value.trim() || 'default-room';
      this.playerName = name;
      this.currentRoom = room;
      this.startJoinFlow(room);
    });
  }

  renderColorSwatches(containerId, colors, category) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = colors.map((col, idx) => `
      <button type="button" 
        class="swatch-btn ${this.playerColors[category] === col ? 'active' : ''}" 
        style="background-color: ${col};" 
        data-cat="${category}" 
        data-col="${col}">
      </button>
    `).join('');

    container.querySelectorAll('.swatch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.getAttribute('data-cat');
        const col = e.currentTarget.getAttribute('data-col');
        this.playerColors[cat] = col;

        container.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        if (this.characterStudio) {
          this.characterStudio.updateColors(this.playerColors);
        }
      });
    });
  }

  updateActiveSwatches() {
    ['skin', 'shirt', 'pants'].forEach(cat => {
      const container = document.getElementById(`${cat}-swatches`);
      if (container) {
        container.querySelectorAll('.swatch-btn').forEach(btn => {
          const col = btn.getAttribute('data-col');
          btn.classList.toggle('active', this.playerColors[cat] === col);
        });
      }
    });
  }

  initNetwork() {
    this.networkManager.callbacks.onConnect = () => {
      document.getElementById('server-status-text').textContent = 'Server Connected';
    };

    this.networkManager.callbacks.onDisconnect = () => {
      document.getElementById('server-status-text').textContent = 'Disconnected (Reconnecting...)';
      Notifications.show('Connection lost with server', 'warning');
    };

    this.networkManager.callbacks.onWorldsUpdated = (worlds) => {
      if (this.worldsBrowser) {
        this.worldsBrowser.updateWorlds(worlds);
      }
    };

    this.networkManager.callbacks.onRoomJoined = (data) => {
      this.onRoomJoined(data);
    };

    this.networkManager.callbacks.onPlayerJoined = (data) => {
      if (this.gameState !== 'IN_GAME') return;
      if (data.id === this.networkManager.selfId) return;

      const remote = new RemotePlayer({
        data,
        scene: this.scene,
        assetLoader: this.assetLoader
      });
      this.remotePlayers.set(data.id, remote);
      Notifications.show(`${data.name} joined the room!`, 'info', 2500);

      // Connect WebRTC Voice Peer (Existing players initiate to newcomer)
      if (this.voiceChatManager) {
        this.voiceChatManager.connectToPeer(data.id, true);
      }

      this.updateHUDPlayerList();
    };

    this.networkManager.callbacks.onPlayerMoved = (data) => {
      const remote = this.remotePlayers.get(data.id);
      if (remote) {
        remote.onNetworkUpdate(data);
      }
    };

    this.networkManager.callbacks.onPlayerPing = ({ id, ping }) => {
      const remote = this.remotePlayers.get(id);
      if (remote) {
        remote.setPing(ping);
        this.updateHUDPlayerList();
      }
    };

    this.networkManager.callbacks.onPlayerLeft = ({ id }) => {
      const remote = this.remotePlayers.get(id);
      if (remote) {
        Notifications.show(`${remote.name} left the room`, 'info', 2000);
        remote.destroy();
        this.remotePlayers.delete(id);

        if (this.voiceChatManager) {
          this.voiceChatManager.removePeer(id);
        }

        this.updateHUDPlayerList();
      }
    };

    this.networkManager.callbacks.onBlockPlaced = (block) => {
      if (this.chunkManager) {
        if (block.type === 'wall') {
          this.chunkManager.addWallBlock(block.x, 0, block.z, block.rotationY || 0);
        } else if (block.type === 'floor') {
          this.chunkManager.addFloorTile(block.x, 0, block.z);
        } else if (block.type === 'chair' || block.type === 'books') {
          this.chunkManager.addFurnitureBlock(block.type, block.x, 0, block.z, block.rotationY || 0);
        }
      }
    };

    this.networkManager.callbacks.onBlockRemoved = ({ x, y, z }) => {
      if (this.chunkManager) {
        this.chunkManager.removeBlock(x, y, z);
      }
    };

    this.networkManager.callbacks.onChatMessage = (msg) => {
      if (this.hud) {
        this.hud.addChatMessage(msg);
      }

      // Display overhead decaying chat bubble
      if (this.localPlayer && msg.id === this.networkManager.selfId) {
        this.localPlayer.addChatBubble(msg.message, msg.image);
      } else {
        const remote = this.remotePlayers.get(msg.id);
        if (remote) {
          remote.addChatBubble(msg.message, msg.image);
        }
      }
    };

    this.networkManager.callbacks.onPianoOccupied = ({ occupantId }) => {
      this.pianoOccupantId = occupantId;
      if (this.hud && occupantId) {
        // Someone occupied the piano -> hide prompt for everyone
        this.hud.updateInteractPrompt({ visible: false });
      }
    };

    this.networkManager.callbacks.onPianoNote = ({ senderId, note, velocity, on }) => {
      // Resume AudioContext if suspended when remote note arrives
      this.pianoEngine.initAudioContext();
      if (on) {
        this.playPianoNote(note, velocity, false);
      } else {
        this.stopPianoNote(note, false);
      }
    };

    this.networkManager.callbacks.onPianoSustain = ({ senderId, isDown }) => {
      this.pianoEngine.initAudioContext();
      this.setPianoSustain(isDown, false);
    };

    this.networkManager.callbacks.onPingUpdate = (pingMs) => {
      if (this.hud) {
        this.hud.updatePing(pingMs);
      }
      if (this.localPlayer) {
        this.localPlayer.setPing(pingMs);
      }
      this.updateHUDPlayerList();
    };

    this.networkManager.connect();
  }

  updateLoadingProgress(percent, title, subtext) {
    const fill = document.getElementById('loading-bar-fill');
    const titleEl = document.getElementById('loading-title-text');
    const subEl = document.getElementById('loading-sub-text');

    if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (titleEl && title) titleEl.textContent = title;
    if (subEl && subtext) subEl.textContent = subtext;
  }

  startJoinFlow(roomName) {
    const loading = document.getElementById('loading-overlay');
    loading?.classList.remove('hidden');
    this.updateLoadingProgress(20, 'Connecting to Server...', `Joining world "${roomName}"`);

    setTimeout(() => {
      this.networkManager.joinRoom(roomName, this.playerName, this.playerColors);
    }, 150);
  }

  async onRoomJoined(data) {
    this.updateLoadingProgress(50, 'Building World...', 'Spawning 3D voxels and concert piano...');

    // Unlock Web Audio API upon room join gesture
    this.pianoEngine.initAudioContext();

    // Initialize 3D Game World
    this.initGameWorld(data);

    // Warm up WebGL Shaders, Synthesia materials & GPU pipeline to prevent frame drops on first view/note
    this.updateLoadingProgress(80, 'Warming Up Shaders...', 'Pre-compiling WebGL shaders & materials...');
    if (this.renderSystem && this.scene && this.cameraSystem) {
      // Warm up Synthesia note materials
      const dummyWhite = new THREE.Mesh(this.synthesiaGeomWhite, this.synthesiaMatWhite);
      const dummyBlack = new THREE.Mesh(this.synthesiaGeomBlack, this.synthesiaMatBlack);
      this.scene.add(dummyWhite);
      this.scene.add(dummyBlack);

      this.renderSystem.compile(this.scene, this.cameraSystem.camera);

      this.scene.remove(dummyWhite);
      this.scene.remove(dummyBlack);
    }

    // Smooth transition
    this.updateLoadingProgress(100, 'Ready!', 'Entering world...');
    await new Promise(r => setTimeout(r, 220));

    // Hide Lobby Overlay & Loading
    document.getElementById('lobby-overlay')?.classList.add('hidden');
    document.getElementById('loading-overlay')?.classList.add('hidden');
    document.getElementById('hud-container')?.classList.remove('hidden');

    if (this.characterStudio) {
      this.characterStudio.stop();
    }

    this.gameState = 'IN_GAME';

    Notifications.show(`Entered world "${data.roomName}"`, 'success');
  }

  initGameWorld(roomData) {
    const canvas = document.getElementById('game-canvas');
    this.scene = new THREE.Scene();
    // Background & Atmosphere
    this.scene.background = new THREE.Color(0x0a0e17);
    this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.008);

    // Systems
    this.cameraSystem = new CameraSystem();
    this.renderSystem = new RenderSystem(canvas);
    this.worldStorage = new WorldStorage();
    this.chunkManager = new ChunkManager(this.scene, this.worldStorage, this.assetLoader);
    this.physics = new Physics(this.worldStorage);

    // Atmospheric Base Lighting (Clean Neutral White)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.85); // Crisp sky / soft slate ground
    this.scene.add(this.hemiLight);

    // Directional Key Light (Angled to create distinct lighting contrast between North and West walls)
    const isMobileDevice = this.renderSystem?.isMobile;
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.dirLight.position.set(12, 36, -30);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = isMobileDevice ? 1024 : 2048;
    this.dirLight.shadow.mapSize.height = isMobileDevice ? 1024 : 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 150;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.02;
    const shadowDist = 25;
    this.dirLight.shadow.camera.left = -shadowDist;
    this.dirLight.shadow.camera.right = shadowDist;
    this.dirLight.shadow.camera.top = shadowDist;
    this.dirLight.shadow.camera.bottom = -shadowDist;
    this.scene.add(this.dirLight);

    // Dedicated Stage Spotlight (Cinematic sweep onto the piano from far across the room)
    this.centerSpot = new THREE.SpotLight(0xfffaed, 0.0, 32, Math.PI / 3.8, 0.65, 1.2);
    // Initial / Off position (originating from high up and far back in the opposite corner)
    this.spotSourceRest = new THREE.Vector3(18, 22, 18);
    this.spotSourceTarget = new THREE.Vector3(-5, 9.5, 0.5);

    // Initial aim target (way out across the opposite room floor / wall before sweeping inward)
    this.spotAimRest = new THREE.Vector3(14, 0, 14);
    this.spotAimTarget = new THREE.Vector3(-5, 0.8, -0.8); // Focuses right on the keybed

    this.centerSpot.position.copy(this.spotSourceRest);
    this.centerSpot.target.position.copy(this.spotAimRest);
    this.centerSpot.castShadow = !isMobileDevice;
    if (!isMobileDevice) {
      this.centerSpot.shadow.mapSize.width = 1024;
      this.centerSpot.shadow.mapSize.height = 1024;
      this.centerSpot.shadow.bias = -0.0003;
      this.centerSpot.shadow.normalBias = 0.02;
    }
    this.scene.add(this.centerSpot);
    this.scene.add(this.centerSpot.target);

    // Soft Rim / Fill Light for Depth & Shadow Definition
    this.fillLight = new THREE.DirectionalLight(0x94a3b8, 0.5);
    this.fillLight.position.set(28, 18, 24);
    this.scene.add(this.fillLight);

    // Atmospheric Dimming State & Spotlight Sweep Interpolator
    this.currentLightDimFactor = 0.0; // 0.0 = normal room, 1.0 = focused stage spotlight mood
    this.spotlightSweepProgress = 0.0; // 0.0 = rest/initial angle, 1.0 = locked onto piano keybed

    // Initial 15x15 World with North and West Walls
    this.chunkManager.generateWorld15x15();

    // Spawn Permanent Main Piano at pos=(-5, 0, -1), rotY=270 deg (3*PI/2)
    this.pianoPosition = new THREE.Vector3(-5, 0, -1);
    this.pianoRotationY = (270 * Math.PI) / 180; // 3 * Math.PI / 2 (~4.712 rad)
    this.pianoStandingPoint = new THREE.Vector3();
    this.pianoStandingRotationY = this.pianoRotationY;

    this.pianoMesh = this.assetLoader.getClonedModel('piano');
    if (this.pianoMesh) {
      this.pianoMesh.position.copy(this.pianoPosition);
      this.pianoMesh.rotation.y = this.pianoRotationY;
      this.pianoMesh.updateMatrixWorld(true);
      this.scene.add(this.pianoMesh);

      // Find the 'standing_point' reference node in the piano hierarchy
      let foundStandingPoint = null;
      this.pianoMesh.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes('standing_point')) {
          foundStandingPoint = child;
        }
      });

      if (foundStandingPoint) {
        foundStandingPoint.getWorldPosition(this.pianoStandingPoint);
        // Extract facing rotation (facing toward piano keyboard)
        this.pianoStandingRotationY = (this.pianoRotationY + Math.PI) % (Math.PI * 2);
        console.log('[Piano] Extracted standing_point position:', this.pianoStandingPoint, 'rotY:', this.pianoStandingRotationY);
      } else {
        // Fallback offset
        this.pianoStandingPoint.set(-5.0, 0, 0.5);
      }

      // Map all 88 3D piano keys by sorting their local X coordinates (MIDI 21 to 108)
      this.setupPianoKeyMappings();
    }

    // Preload Salamander Grand Piano Samples in background
    this.pianoEngine.loadSamples((progress) => {
      if (progress === 1) {
        console.log('[Piano] Salamander samples ready');
      }
    });

    // Initialize Web MIDI Hardware Manager
    this.setupMidiManager();

    // Register Solid Collision Box for Piano in WorldStorage
    // Piano body footprint rotated 270 deg around (-5, 0, -1):
    this.worldStorage.setBlock(-5, 0, -1, {
      type: 'piano',
      solid: true,
      boxMinX: -6.8,
      boxMaxX: -3.2,
      boxMinZ: -2.2,
      boxMaxZ: -0.4,
      minY: 0,
      maxY: 3.0
    });

    // Piano Interaction & Seating State
    this.isHoldingE = false;
    this.holdETimer = 0;
    this.holdEDuration = 0.65; // Hold for 0.65s to lock in
    this.isPlayerSeatedAtPiano = false;

    // 3D Floating Canvas Interaction Prompt directly above the Piano
    this.pianoPrompt = new PianoInteractPrompt({
      scene: this.scene,
      position: new THREE.Vector3(this.pianoPosition.x, 2.3, this.pianoPosition.z)
    });

    // 3D Floating Canvas Interaction Prompt dynamically repositioned over nearest chair
    this.chairPrompt = new PianoInteractPrompt({
      scene: this.scene,
      position: new THREE.Vector3(0, 2.0, 0)
    });

    // Cursor indicator wireframe box for build mode
    const cursorGeom = new THREE.BoxGeometry(1.02, 0.1, 1.02);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    this.cursorIndicator = new THREE.Mesh(cursorGeom, cursorMat);
    this.cursorIndicator.visible = false;
    this.scene.add(this.cursorIndicator);

    if (roomData.blocks && roomData.blocks.length > 0) {
      roomData.blocks.forEach(block => {
        if (block.type === 'wall') {
          this.chunkManager.addWallBlock(block.x, 0, block.z, block.rotationY || 0);
        } else if (block.type === 'floor') {
          this.chunkManager.addFloorTile(block.x, 0, block.z);
        } else if (block.type === 'chair' || block.type === 'books') {
          this.chunkManager.addFurnitureBlock(block.type, block.x, 0, block.z, block.rotationY || 0);
        }
      });
    }

    // Track piano occupant across network
    this.pianoOccupantId = roomData.pianoOccupantId || null;

    // Local Player
    const selfData = roomData.players.find(p => p.id === roomData.selfId) || {
      name: this.playerName,
      colors: this.playerColors,
      x: 0, z: 0
    };

    this.localPlayer = new LocalPlayer({
      scene: this.scene,
      assetLoader: this.assetLoader,
      physics: this.physics,
      initialData: selfData
    });

    this.localPlayer.onUnlockFromPiano = () => {
      this.networkManager.sendPianoUnlock();
      this.pianoOccupantId = null;
      this.isPlayerSeatedAtPiano = false;
      if (this.hud) {
        this.hud.setPianoMode(false);
      }
    };

    // Remote Players
    this.remotePlayers.clear();
    roomData.players.forEach(p => {
      if (p.id !== roomData.selfId) {
        const remote = new RemotePlayer({
          data: p,
          scene: this.scene,
          assetLoader: this.assetLoader
        });
        this.remotePlayers.set(p.id, remote);
      }
    });

    // Voice Chat Manager (Peer-to-Peer Spatial Audio with $0 server cost)
    if (this.voiceChatManager) {
      this.voiceChatManager.destroy();
    }
    this.voiceChatManager = new VoiceChatManager({
      networkManager: this.networkManager,
      getLocalPlayerPosition: () => (this.localPlayer?.mesh ? this.localPlayer.mesh.position : null),
      getRemotePlayerPosition: (id) => {
        const remote = this.remotePlayers.get(id);
        return remote?.mesh ? remote.mesh.position : null;
      }
    });

    this.voiceChatManager.onMicStatusChange = (isMuted, isSpeaking) => {
      const isMicOn = !isMuted;
      if (this.hud) {
        this.hud.updateMicStatusUI(isMicOn, isSpeaking);
      }
      if (this.localPlayer) {
        this.localPlayer.setMicStatus(isMicOn, isSpeaking);
      }
    };

    this.voiceChatManager.onRemoteVoiceActivity = (id, { isMuted, isSpeaking }) => {
      const remote = this.remotePlayers.get(id);
      if (remote) {
        remote.setMicStatus(!isMuted, isSpeaking);
      }
    };

    // Connect to all existing remote players in the room
    roomData.players.forEach(p => {
      if (p.id !== roomData.selfId) {
        this.voiceChatManager.connectToPeer(p.id, true);
      }
    });

    // HUD Setup
    const hudContainer = document.getElementById('hud-container');
    this.hud = new HUD({
      container: hudContainer,
      initialVolume: this.pianoEngine.volume,
      initialReverb: this.pianoEngine.reverbLevel,
      initialVelocityCurve: this.pianoEngine.velocityCurve,
      initialFloatingNotes: this.showFloatingNotes,
      onToggleMic: async () => {
        if (!this.voiceChatManager) return;
        const micActive = await this.voiceChatManager.toggleMic();
        if (micActive) {
          Notifications.show('🎤 Microphone ON (Press V to mute)', 'success', 2500);
          // Refresh device list with permissions granted labels
          this.refreshAudioDevices();
        } else {
          Notifications.show('🔇 Microphone Muted (Press V to talk)', 'info', 2500);
        }
      },
      onMicDeviceChange: async (deviceId) => {
        if (this.voiceChatManager) {
          await this.voiceChatManager.setAudioInputDevice(deviceId);
          Notifications.show('Microphone input device updated', 'info', 2000);
        }
      },
      onOutputDeviceChange: async (deviceId) => {
        if (this.voiceChatManager) {
          await this.voiceChatManager.setAudioOutputDevice(deviceId);
        }
        if (this.pianoEngine) {
          await this.pianoEngine.setAudioOutputDevice(deviceId);
        }
        Notifications.show('Audio output device updated', 'info', 2000);
      },
      onVolumeChange: (vol) => {
        this.pianoEngine.setVolume(vol);
      },
      onReverbChange: (reverb) => {
        this.pianoEngine.setReverbLevel(reverb);
      },
      onVelocityCurveChange: (curve) => {
        this.pianoEngine.setVelocityCurve(curve);
      },
      onFloatingNotesToggle: (enabled) => {
        this.showFloatingNotes = enabled;
        localStorage.setItem('piano_floating_notes', enabled ? 'true' : 'false');
      },
      onChatMessage: (text, image) => {
        this.networkManager.sendChatMessage(text, image);
      },
      onToolSelect: (tool) => {
        this.activeTool = tool;
        if (this.hud && this.hoverTile) {
          const rotDeg = Math.round((this.placementRotationY * 180) / Math.PI);
          this.hud.updatePlacementInfo({
            x: this.hoverTile.x,
            z: this.hoverTile.z,
            rotDeg,
            tool: this.activeTool,
            isValid: this.hoverTile.isValid
          });
        }
      },
      onExitRoom: () => {
        this.exitToLobby();
      }
    });

    // Populate initial audio input & output devices
    this.refreshAudioDevices();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.refreshAudioDevices();
      });
    }

    this.hud.onLeavePiano = () => {
      if (this.localPlayer && this.isPlayerSeatedAtPiano) {
        this.localPlayer.unlockFromPiano();
      }
    };

    this.hud.onJoystick = (jx, jy) => {
      if (this.localPlayer) {
        this.localPlayer.setJoystick(jx, jy);
      }
    };

    this.hud.setRoomInfo(roomData.roomName, roomData.players.length, roomData.isOwner);
    this.updateHUDPlayerList();

    // Event Listeners for Game Canvas Interaction
    this.setupGameInteractions();

    // Start 60 FPS Render Loop
    this.isLoopRunning = true;
    this.lastFrameTime = performance.now();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  async refreshAudioDevices() {
    if (!this.voiceChatManager || !this.hud) return;
    const { inputs, outputs } = await this.voiceChatManager.getAudioDevices();
    this.hud.populateAudioDevices({
      inputs,
      outputs,
      selectedInputId: this.voiceChatManager.selectedAudioInputId,
      selectedOutputId: this.voiceChatManager.selectedAudioOutputId
    });
  }

  setupConsoleCommands() {
    // Expose password-protected build mode command in browser console:
    // togglebuild("mNsDq") or toggleBuildMode("mNsDq")
    // window.listBlocks() or window.exportBlocks()
    const BUILD_PASS = 'mNsDq';

    const handleToggle = (password, forceState) => {
      if (password !== BUILD_PASS) {
        console.warn('%c[Build Mode] Access Denied: Incorrect password. Usage: togglebuild("mNsDq")', 'color: #ef4444; font-weight: bold;');
        Notifications.show('Build Mode: Incorrect Password', 'error', 2500);
        return 'Access Denied: Incorrect password.';
      }

      if (forceState !== undefined) {
        this.isBuildMode = Boolean(forceState);
      } else {
        this.isBuildMode = !this.isBuildMode;
      }

      if (this.hud) {
        this.hud.setBuildMode(this.isBuildMode);
      }
      if (this.cursorIndicator) {
        this.cursorIndicator.visible = this.isBuildMode;
      }

      const status = this.isBuildMode ? 'ENABLED 🔨' : 'DISABLED 🔒';
      console.log(`%c[Build Mode] ${status}`, 'color: #38bdf8; font-weight: bold; font-size: 14px;');
      if (this.isBuildMode) {
        console.log('%cControls in Build Mode:', 'color: #94a3b8;');
        console.log('  - Hotbar / [1-5]: Select Wall, Floor, Chair, Books, Remove');
        console.log('  - [R]: Rotate piece by 90°');
        console.log('  - Left Click on tile: Place block (Logs exact coordinates to console)');
        console.log('  - togglebuild("mNsDq"): Toggle Build Mode off');
        console.log('  - window.listBlocks() / window.exportBlocks(): Print all placed blocks');
      }

      Notifications.show(`Build Mode ${this.isBuildMode ? 'Enabled' : 'Disabled'}`, this.isBuildMode ? 'success' : 'info', 2500);
      return `Build Mode is now ${this.isBuildMode ? 'ON' : 'OFF'}`;
    };

    window.togglebuild = handleToggle;
    window.toggleBuild = handleToggle;
    window.toggleBuildMode = handleToggle;
    window.buildMode = handleToggle;

    window.listBlocks = () => {
      if (!this.worldStorage) return [];
      const blocks = [];
      for (const block of this.worldStorage.solidBlocks.values()) {
        blocks.push({
          type: block.type,
          x: block.x,
          y: block.y,
          z: block.z,
          rotationY: block.rotationY,
          rotDeg: Math.round(((block.rotationY || 0) * 180) / Math.PI)
        });
      }
      console.table(blocks);
      console.log('[Blocks JSON]:\n' + JSON.stringify(blocks, null, 2));
      return blocks;
    };
    window.exportBlocks = window.listBlocks;
  }

  setupGameInteractions() {
    // Desktop Wheel Zoom
    this.onWheel = (e) => {
      if (this.cameraSystem) {
        this.cameraSystem.handleZoom(e.deltaY);
      }
    };
    window.addEventListener('wheel', this.onWheel, { passive: true });

    // Mobile Pinch-to-Zoom Gesture for In-Game Camera
    let initialPinchDistance = null;
    this.onTouchStartPinch = (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDistance = Math.hypot(dx, dy);
      } else {
        initialPinchDistance = null;
      }
    };

    this.onTouchMovePinch = (e) => {
      if (e.touches.length === 2 && initialPinchDistance !== null && this.cameraSystem) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDistance = Math.hypot(dx, dy);
        const distanceDelta = initialPinchDistance - currentDistance;
        
        // Pass scaled delta to camera zoom (pinching together zooms out, spreading zooms in)
        this.cameraSystem.handleZoom(distanceDelta * 3.5);
        initialPinchDistance = currentDistance;
      }
    };

    this.onTouchEndPinch = (e) => {
      if (e.touches.length < 2) {
        initialPinchDistance = null;
      }
    };

    window.addEventListener('touchstart', this.onTouchStartPinch, { passive: true });
    window.addEventListener('touchmove', this.onTouchMovePinch, { passive: false });
    window.addEventListener('touchend', this.onTouchEndPinch, { passive: true });
    window.addEventListener('touchcancel', this.onTouchEndPinch, { passive: true });

    // Pointer movement for Hover Tile & Placement in Build Mode
    this.onPointerMove = (e) => {
      if (!this.isBuildMode || !this.cameraSystem) return;

      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.cameraSystem.camera);
      const targetPoint = new THREE.Vector3();
      const hit = this.raycaster.ray.intersectPlane(this.groundPlane, targetPoint);

      if (hit) {
        const gridX = Math.round(targetPoint.x);
        const gridZ = Math.round(targetPoint.z);

        this.hoverTile = {
          x: gridX,
          z: gridZ,
          isValid: Math.abs(gridX) <= 15 && Math.abs(gridZ) <= 15
        };

        if (this.cursorIndicator) {
          this.cursorIndicator.visible = true;
          this.cursorIndicator.position.set(gridX, 0.05, gridZ);
          this.cursorIndicator.material.color.setHex(this.hoverTile.isValid ? 0x38bdf8 : 0xf87171);
        }

        if (this.hud) {
          const rotDeg = Math.round((this.placementRotationY * 180) / Math.PI);
          this.hud.updatePlacementInfo({
            x: gridX,
            z: gridZ,
            rotDeg,
            tool: this.activeTool,
            isValid: this.hoverTile.isValid
          });
        }
      }
    };
    window.addEventListener('pointermove', this.onPointerMove);

    // Pointer Click for Placement / Removal in Build Mode
    this.onPointerDown = (e) => {
      if (!this.isBuildMode || e.button !== 0) return;
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
      if (e.target && e.target.closest('#hud-hotbar, .hud-header, .hud-overlay-modal, .hud-chat-box')) return;

      if (this.hoverTile && this.hoverTile.isValid) {
        const { x, z } = this.hoverTile;
        const rotY = this.placementRotationY;
        const rotDeg = Math.round((rotY * 180) / Math.PI);

        if (this.activeTool === 'remove') {
          console.log(`%c[Build Mode] ⛏️ REMOVED block at x=${x}, z=${z}`, 'color: #f87171; font-weight: bold;');
          this.chunkManager?.removeBlock(x, 0, z);
          this.networkManager?.removeBlock(x, 0, z);
          Notifications.show(`Removed block at (${x}, ${z})`, 'info', 1500);
        } else {
          console.log(`%c[Build Mode] 🔨 PLACED ${this.activeTool.toUpperCase()} at x=${x}, z=${z}, rotY=${rotY} (${rotDeg}°)`, 'color: #38bdf8; font-weight: bold;');
          console.log(`%c  Permanent Spec Code: { type: '${this.activeTool}', x: ${x}, y: 0, z: ${z}, rotationY: ${rotY.toFixed(4)} }`, 'color: #a855f7;');

          if (this.activeTool === 'wall') {
            this.chunkManager?.addWallBlock(x, 0, z, rotY);
          } else if (this.activeTool === 'floor') {
            this.chunkManager?.addFloorTile(x, 0, z);
          } else if (this.activeTool === 'chair' || this.activeTool === 'books') {
            this.chunkManager?.addFurnitureBlock(this.activeTool, x, 0, z, rotY);
          }

          this.networkManager?.placeBlock(x, 0, z, this.activeTool, rotY);
          Notifications.show(`Placed ${this.activeTool} at (${x}, ${z}) [${rotDeg}°]`, 'success', 1800);
        }
      }
    };
    window.addEventListener('pointerdown', this.onPointerDown);

    // QWERTY Key Mapping for Keyboard testing (Middle C Octaves C4 - E5)
    const KEY_TO_NOTE = {
      'KeyZ': 48, 'KeyS': 49, 'KeyX': 50, 'KeyD': 51, 'KeyC': 52, 'KeyV': 53, 'KeyG': 54, 'KeyB': 55, 'KeyH': 56, 'KeyN': 57, 'KeyJ': 58, 'KeyM': 59,
      'KeyQ': 60, 'Digit2': 61, 'KeyW': 62, 'Digit3': 63, 'KeyE': 64, 'KeyR': 65, 'Digit5': 66, 'KeyT': 67, 'Digit6': 68, 'KeyY': 69, 'Digit7': 70, 'KeyU': 71,
      'KeyI': 72, 'Digit9': 73, 'KeyO': 74, 'Digit0': 75, 'KeyP': 76, 'BracketLeft': 77, 'Equal': 78, 'BracketRight': 79
    };

    // Keydown for Hold E interaction, Piano Play & Build Mode
    this.onKeyDownPlacement = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      // Rotate placement with 'R' key (only in build mode)
      if (e.code === 'KeyR' && !e.repeat && this.isBuildMode) {
        this.placementRotationY = (this.placementRotationY + Math.PI / 2) % (Math.PI * 2);
        const rotDeg = Math.round((this.placementRotationY * 180) / Math.PI);
        if (this.hud && this.hoverTile) {
          this.hud.updatePlacementInfo({
            x: this.hoverTile.x,
            z: this.hoverTile.z,
            rotDeg,
            tool: this.activeTool,
            isValid: this.hoverTile.isValid
          });
        }
        Notifications.show(`Placement rotation: ${rotDeg}°`, 'info', 1200);
        return;
      }

      // Select Hotbar slots 1-5
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code) && !this.isPlayerSeatedAtPiano && this.isBuildMode) {
        const slotIdx = parseInt(e.code.replace('Digit', ''), 10) - 1;
        this.hud?.selectToolByIndex(slotIdx);
        return;
      }

      if (this.isPlayerSeatedAtPiano) {
        if (e.code === 'Escape') {
          if (this.localPlayer) {
            this.localPlayer.unlockFromPiano();
          }
          return;
        }

        if (e.code === 'Space' && !e.repeat) {
          this.setPianoSustain(true, true);
          return;
        }

        const note = KEY_TO_NOTE[e.code];
        if (note && !e.repeat && !this.activeComputerKeys.has(e.code)) {
          this.activeComputerKeys.set(e.code, note);
          this.playPianoNote(note, 95, true);
          return;
        }
      }

      if (e.code === 'KeyE') {
        this.isHoldingE = true;
      }
    };

    this.onKeyUpPlacement = (e) => {
      if (this.isPlayerSeatedAtPiano) {
        if (e.code === 'Space') {
          this.setPianoSustain(false, true);
          return;
        }

        if (this.activeComputerKeys.has(e.code)) {
          const note = this.activeComputerKeys.get(e.code);
          this.activeComputerKeys.delete(e.code);
          this.stopPianoNote(note, true);
          return;
        }
      }

      if (e.code === 'KeyE') {
        this.isHoldingE = false;
        this.holdETimer = 0;
      }
    };

    window.addEventListener('keydown', this.onKeyDownPlacement);
    window.addEventListener('keyup', this.onKeyUpPlacement);
  }

  updateHUDPlayerList() {
    if (!this.hud) return;
    const list = [];
    if (this.localPlayer) {
      list.push({
        name: this.playerName,
        colors: this.playerColors,
        isSelf: true,
        ping: this.networkManager.currentPing || 0
      });
    }
    for (const remote of this.remotePlayers.values()) {
      list.push({
        name: remote.name,
        colors: remote.colors,
        isSelf: false,
        ping: remote.ping || 0
      });
    }
    this.hud.updatePlayerList(list);
    this.hud.setRoomInfo(this.currentRoom, list.length, false);
  }

  exitToLobby() {
    this.isLoopRunning = false;
    this.gameState = 'LOBBY';

    // Remove interaction listeners
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('touchstart', this.onTouchStartPinch);
    window.removeEventListener('touchmove', this.onTouchMovePinch);
    window.removeEventListener('touchend', this.onTouchEndPinch);
    window.removeEventListener('touchcancel', this.onTouchEndPinch);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDownPlacement);
    window.removeEventListener('keyup', this.onKeyUpPlacement);

    // Leave network room
    this.networkManager.leaveRoom();

    // Cleanup Game Scene
    if (this.pianoPrompt) {
      this.pianoPrompt.destroy();
      this.pianoPrompt = null;
    }
    if (this.chairPrompt) {
      this.chairPrompt.destroy();
      this.chairPrompt = null;
    }
    if (this.cursorIndicator && this.scene) {
      this.scene.remove(this.cursorIndicator);
      this.cursorIndicator.geometry?.dispose();
      this.cursorIndicator = null;
    }
    if (this.voiceChatManager) {
      this.voiceChatManager.destroy();
      this.voiceChatManager = null;
    }
    if (this.localPlayer) this.localPlayer.destroy();
    for (const remote of this.remotePlayers.values()) {
      remote.destroy();
    }
    this.remotePlayers.clear();
    if (this.chunkManager) this.chunkManager.clear();
    if (this.renderSystem) this.renderSystem.destroy();
    if (this.cameraSystem) this.cameraSystem.destroy();

    // Toggle HUD & Lobby Visibility
    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('lobby-overlay')?.classList.remove('hidden');

    if (this.characterStudio) {
      this.characterStudio.start();
    }

    this.networkManager.requestWorlds();
    Notifications.show('Returned to Lobby', 'info');
  }

  // Locked 60 FPS Render Loop (Zero-Allocation)
  tick() {
    if (!this.isLoopRunning) return;
    requestAnimationFrame(this.tick);

    const now = performance.now();
    const delta = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    // Update Local Player & Physics
    if (this.localPlayer) {
      this.localPlayer.update(delta, this.networkManager);

      // Check proximity to permanent piano using extracted standing_point
      if (this.pianoPosition && this.localPlayer.mesh) {
        const playerPos = this.localPlayer.mesh.position;
        const seatPosition = this.pianoStandingPoint || new THREE.Vector3(-5.0, 0, 0.5);
        const playerSeatRotY = this.pianoStandingRotationY ?? ((this.pianoRotationY + Math.PI) % (Math.PI * 2));

        // Distance to keybed seat position or piano center
        const distToSeat = playerPos.distanceTo(seatPosition);
        const distToCenter = playerPos.distanceTo(this.pianoPosition);
        const isNearPiano = distToSeat < 2.0 || distToCenter < 2.3;

        // Is piano already occupied by someone else?
        const isOccupiedByOther = Boolean(this.pianoOccupantId && this.pianoOccupantId !== this.networkManager.selfId);

        // Find nearest chair placed in world for seating interaction
        let nearestChairBlock = null;
        let nearestChairDist = Infinity;
        if (this.worldStorage && !this.localPlayer.isLockedToPiano && !this.localPlayer.isSittingOnChair) {
          for (const block of this.worldStorage.solidBlocks.values()) {
            if (block.type === 'chair') {
              const chairPos = block.sittingPoint || new THREE.Vector3(block.x, 0.5, block.z);
              const dist = playerPos.distanceTo(chairPos);
              if (dist < 1.8 && dist < nearestChairDist) {
                nearestChairDist = dist;
                nearestChairBlock = block;
              }
            }
          }
        }
        this.nearestChair = nearestChairBlock;

        if (this.localPlayer.isLockedToPiano || isOccupiedByOther) {
          // When the player is playing the piano OR when someone else is playing it, NEVER show the piano UI
          this.holdETimer = 0;
          if (this.pianoPrompt) {
            this.pianoPrompt.updateState({ visible: false });
          }
          if (this.hud) {
            this.hud.updateInteractPrompt({ visible: false });
          }
        } else if (isNearPiano) {
          // Near piano and available: handle Hold E interaction
          if (this.isHoldingE) {
            this.holdETimer += delta;
            const progress = Math.min(1.0, this.holdETimer / this.holdEDuration);

            if (this.pianoPrompt) {
              this.pianoPrompt.updateState({
                visible: true,
                progress,
                action: 'Entering Piano...',
                hint: 'Holding E'
              });
            }
            if (this.hud) {
              this.hud.updateInteractPrompt({
                visible: false,
                progress,
                action: 'Entering Piano...',
                hint: 'Holding E'
              });
            }

            if (this.holdETimer >= this.holdEDuration) {
              this.localPlayer.lockToPiano(seatPosition, playerSeatRotY);
              this.networkManager.sendPianoLock();
              this.pianoOccupantId = this.networkManager.selfId;
              this.isPlayerSeatedAtPiano = true;
              this.isHoldingE = false;
              this.holdETimer = 0;
              if (this.pianoPrompt) {
                this.pianoPrompt.updateState({ visible: false });
              }
              if (this.hud) {
                this.hud.updateInteractPrompt({ visible: false });
                this.hud.setPianoMode(true);
                if (this.midiManager) {
                  this.hud.updatePianoMidiStatus(this.midiManager.connectedDeviceNames);
                }
              }
              Notifications.show('Playing piano! Press keys on MIDI keyboard or Q-P/1-0.', 'info', 3500);
            }
          } else {
            this.holdETimer = 0;
            if (this.pianoPrompt) {
              this.pianoPrompt.updateState({
                visible: true,
                progress: 0,
                action: 'Play Piano',
                hint: 'Hold E'
              });
            }
            if (this.hud) {
              this.hud.updateInteractPrompt({
                visible: false,
                progress: 0,
                action: 'Play Piano',
                hint: 'Hold E'
              });
            }
          }
        } else {
          this.holdETimer = 0;
          if (this.pianoPrompt) {
            this.pianoPrompt.updateState({ visible: false });
          }
          if (this.hud) {
            this.hud.updateInteractPrompt({ visible: false });
          }
        }

        // Handle Chair Sitting Interaction
        if (this.nearestChair && !isNearPiano && !this.localPlayer.isSittingOnChair) {
          const chairBlock = this.nearestChair;
          const chairSitPos = chairBlock.sittingPoint || new THREE.Vector3(chairBlock.x, 0.5, chairBlock.z);
          const chairRotY = (chairBlock.rotationY || 0);

          if (this.chairPrompt) {
            this.chairPrompt.setPosition(new THREE.Vector3(chairBlock.x, 1.8, chairBlock.z));
            if (this.isHoldingE) {
              this.holdETimer += delta;
              const progress = Math.min(1.0, this.holdETimer / 0.35); // Snappy 0.35s sit
              this.chairPrompt.updateState({
                visible: true,
                progress,
                action: 'Sitting Down...',
                hint: 'Holding E'
              });

              if (this.holdETimer >= 0.35) {
                this.localPlayer.sitOnChair(chairSitPos, chairRotY, chairBlock.key);
                this.isHoldingE = false;
                this.holdETimer = 0;
                this.chairPrompt.updateState({ visible: false });
                Notifications.show('Sitting on chair! Move WASD to stand up.', 'info', 2500);
              }
            } else {
              this.chairPrompt.updateState({
                visible: true,
                progress: 0,
                action: 'Sit on Chair',
                hint: 'Hold E'
              });
            }
          }
        } else if (this.chairPrompt && !this.localPlayer.isSittingOnChair) {
          this.chairPrompt.updateState({ visible: false });
        }
      }
    }

    // Update 3D Floating Canvas Piano & Chair Interact Prompts
    if (this.pianoPrompt) {
      this.pianoPrompt.update(delta);
    }
    if (this.chairPrompt) {
      this.chairPrompt.update(delta);
    }

    // Smoothly update 3D piano key depression animations
    this.updatePianoKeyAnimations(delta);

    // Update 3D floating musical notes particle animation
    this.updateFloatingNotes(delta);

    // Smooth Atmospheric Light Dimming Transition (Cozy concert hall focus)
    this.updateAtmosphericLighting(delta);

    // Update 3D Positional Voice Spatial Audio Volume
    if (this.voiceChatManager) {
      this.voiceChatManager.updateSpatialAudioPositions();
    }

    // Update Remote Players Lerp & Animation
    for (const remote of this.remotePlayers.values()) {
      remote.update(delta);
    }

    // Smooth Isometric Camera Tracking
    if (this.cameraSystem && this.localPlayer?.mesh) {
      this.cameraSystem.update(this.localPlayer.mesh.position, delta);
    }

    // Throttled Frustum Culling
    if (this.chunkManager && this.cameraSystem) {
      this.chunkManager.updateFrustumCulling(this.cameraSystem.camera);
    }

    // Render Scene
    if (this.renderSystem && this.scene && this.cameraSystem) {
      this.renderSystem.render(this.scene, this.cameraSystem.camera);
    }

    // FPS Meter
    if (this.hud) {
      this.hud.updateFPS();
    }
  }

  updateAtmosphericLighting(delta) {
    if (!this.ambientLight || !this.dirLight) return;

    // Target dimming: 1.0 if player or someone else is seated at the piano, 0.0 otherwise
    const isPianoActive = Boolean(this.isPlayerSeatedAtPiano || this.pianoOccupantId);
    const targetDim = isPianoActive ? 1.0 : 0.0;

    // Smooth exponential ease-in / ease-out transition (2.8x speed ~ 0.55s smooth transition)
    this.currentLightDimFactor += (targetDim - this.currentLightDimFactor) * Math.min(2.8 * delta, 1.0);
    const d = this.currentLightDimFactor;

    // Spotlight Sweep Progress: Smooth cinematic transition
    this.spotlightSweepProgress += (targetDim - this.spotlightSweepProgress) * Math.min(1.85 * delta, 1.0);
    const s = this.spotlightSweepProgress;

    // Theatrical Ease-In Curve:
    // Starts gracefully from afar, accelerates smoothly across the floor, then settles crisply onto the piano
    const easeInSweep = targetDim > 0.5 
      ? Math.pow(s, 2.4) // Deep ease-in acceleration when sweeping onto piano
      : s * s * (3 - 2 * s); // Smoothstep when leaving piano

    // True Natural Stage Dimming:
    // We DON'T tint or muddy the RGB colors (which makes voxels look weirdly washed/saturated).
    // Instead, we lower ambient diffusion to let shadows fall naturally, and turn ON the overhead stage spotlight on the piano.

    // 1. Ambient Light: 0.95 -> 0.14 (Deeper ambient drop for dramatic theatrical room dimming)
    this.ambientLight.intensity = 0.95 * (1 - d * 0.85);
    this.ambientLight.color.setRGB(1, 1, 1);

    // 2. Hemisphere Light: 0.85 -> 0.12
    if (this.hemiLight) {
      this.hemiLight.intensity = 0.85 * (1 - d * 0.86);
    }

    // 3. Directional Sun Light: 1.6 -> 0.18 (Sun fades away so the spotlight commands the scene)
    this.dirLight.intensity = 1.6 * (1 - d * 0.89);

    // 4. Fill Rim Light: 0.6 -> 0.08
    if (this.fillLight) {
      this.fillLight.intensity = 0.6 * (1 - d * 0.87);
    }

    // 5. Piano Stage Spotlight: Sweeps from far across the venue with ease-in before focusing onto the piano keybed
    if (this.centerSpot && this.spotSourceRest && this.spotSourceTarget && this.spotAimRest && this.spotAimTarget) {
      this.centerSpot.intensity = d * 6.5;

      // Interpolate spotlight position from distant origin to stage fixture position
      this.centerSpot.position.lerpVectors(this.spotSourceRest, this.spotSourceTarget, easeInSweep);

      // Interpolate spotlight target from far room corner across the floor and ease in onto the piano keyboard
      this.centerSpot.target.position.lerpVectors(this.spotAimRest, this.spotAimTarget, easeInSweep);
      this.centerSpot.target.updateMatrixWorld();
    }

    // 6. Camera Tone-Mapping Exposure: keep at a clean natural 1.15
    if (this.renderSystem && this.renderSystem.renderer) {
      this.renderSystem.renderer.toneMappingExposure = 1.15;
    }
  }

  setupPianoKeyMappings() {
    this.pianoKeyMeshes.clear();
    this.animatingKeys.clear();
    if (!this.pianoMesh) return;

    // Collect all 88 key parent nodes
    const rawKeys = [];
    this.pianoMesh.traverse((child) => {
      if (child.name && (child.name.startsWith('white_') || child.name.startsWith('black_'))) {
        rawKeys.push(child);
      }
    });

    // Sort descending by local X position (from +1.625 down to -1.5625)
    rawKeys.sort((a, b) => b.position.x - a.position.x);

    // Dynamic point light pool for keys affecting surrounding environment
    // 4 high-efficiency reusable point lights shared across active chords to cast real light on floor/walls
    if (!this.keyLightPool) {
      this.keyLightPool = [];
      for (let i = 0; i < 6; i++) {
        const light = new THREE.PointLight(0xc084fc, 0, 5.5, 1.8);
        light.visible = false;
        this.scene.add(light);
        this.keyLightPool.push({ light, activeMidi: null });
      }
    }

    // Map each node to its corresponding MIDI note (21 to 108)
    rawKeys.forEach((keyNode, idx) => {
      const midi = 21 + idx;
      // Store original resting rotation
      keyNode.userData.baseRotX = keyNode.rotation.x;
      keyNode.userData.currentDepression = 0;
      keyNode.userData.targetDepression = 0;

      // Find mesh children and clone material for independent zero-cost emissive glow
      keyNode.userData.glowMaterials = [];
      keyNode.traverse((child) => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          const clonedMats = mats.map(m => {
            const cm = m.clone();
            cm.userData.originalColor = cm.color ? cm.color.clone() : new THREE.Color(0xffffff);
            cm.emissive = new THREE.Color(0x000000);
            cm.emissiveIntensity = 0.0;
            return cm;
          });
          child.material = Array.isArray(child.material) ? clonedMats : clonedMats[0];
          keyNode.userData.glowMaterials.push(...clonedMats);
        }
      });

      this.pianoKeyMeshes.set(midi, keyNode);
    });

    console.log(`[Piano] Successfully mapped ${this.pianoKeyMeshes.size} 3D keys with environment light emission.`);
  }

  setupMidiManager() {
    this.midiManager = new MidiManager({
      onNoteOn: (note, velocity, channel) => {
        if (!this.isPlayerSeatedAtPiano) return;
        this.playPianoNote(note, velocity, true);
      },
      onNoteOff: (note, channel) => {
        if (!this.isPlayerSeatedAtPiano) return;
        this.stopPianoNote(note, true);
      },
      onControlChange: (type, value) => {
        if (!this.isPlayerSeatedAtPiano) return;
        if (type === 'sustain') {
          this.setPianoSustain(value, true);
        }
      },
      onDeviceChange: (devices) => {
        if (this.hud) {
          this.hud.updatePianoMidiStatus(devices);
        }
        if (devices.length > 0) {
          Notifications.show(`🎹 MIDI Connected: ${devices[0]}`, 'success', 3000);
        }
      }
    });

    this.midiManager.init();
  }

  playPianoNote(note, velocity = 90, broadcast = true) {
    if (note < 21 || note > 108) return;

    this.pressedKeys.add(note);
    this.animatingKeys.add(note);

    // Play local audio synthesis
    this.pianoEngine.noteOn(note, velocity);

    // Animate 3D key depression & glow
    const keyNode = this.pianoKeyMeshes.get(note);
    if (keyNode) {
      keyNode.userData.targetDepression = 1.0;

      // Assign an environment-illuminating point light from the pool
      if (this.keyLightPool) {
        let poolSlot = this.keyLightPool.find(s => s.activeMidi === note);
        if (!poolSlot) {
          poolSlot = this.keyLightPool.find(s => s.activeMidi === null);
        }
        if (poolSlot) {
          poolSlot.activeMidi = note;
          const worldPos = new THREE.Vector3();
          keyNode.getWorldPosition(worldPos);
          poolSlot.light.position.set(worldPos.x, worldPos.y + 0.45, worldPos.z + 0.15);
          poolSlot.light.color.set(note <= 64 ? 0xc084fc : 0x38bdf8);
          poolSlot.light.intensity = 3.5;
          poolSlot.light.visible = true;
        }
      }

      // Start Synthesia glowing waterfall note block rising from key
      if (this.showFloatingNotes) {
        this.startSynthesiaNote(keyNode, note);
      }
    }

    // Animate character hands: rotate hand down into key on press, return on release
    if (this.isPlayerSeatedAtPiano && this.localPlayer) {
      this.localPlayer.onPianoNoteDown(note);
    } else if (this.pianoOccupantId && this.remotePlayers.has(this.pianoOccupantId)) {
      this.remotePlayers.get(this.pianoOccupantId).onPianoNoteDown(note);
    }

    // Update HUD display
    if (broadcast && this.hud) {
      const noteName = this.getNoteName(note);
      this.hud.updatePianoNoteDisplay(`♪ ${noteName} (MIDI ${note}) &bull; Vel ${velocity}`);
    }

    // Broadcast over WebSocket if we are the performer
    if (broadcast) {
      this.networkManager.sendPianoNote(note, velocity, true);
    }
  }

  stopPianoNote(note, broadcast = true) {
    this.pressedKeys.delete(note);
    this.animatingKeys.add(note); // Keep in animating set until spring returns to 0

    this.pianoEngine.noteOff(note);

    const keyNode = this.pianoKeyMeshes.get(note);
    if (keyNode) {
      keyNode.userData.targetDepression = 0.0;
    }

    // Release hand strike rotation
    if (this.isPlayerSeatedAtPiano && this.localPlayer) {
      this.localPlayer.onPianoNoteUp(note);
    } else if (this.pianoOccupantId && this.remotePlayers.has(this.pianoOccupantId)) {
      this.remotePlayers.get(this.pianoOccupantId).onPianoNoteUp(note);
    }

    // End Synthesia note growth on key release (note continues rising into air)
    this.endSynthesiaNote(note);

    if (broadcast) {
      this.networkManager.sendPianoNote(note, 0, false);
    }
  }

  setPianoSustain(isDown, broadcast = true) {
    this.pianoEngine.setSustainPedal(isDown);

    if (broadcast) {
      this.networkManager.sendPianoSustain(isDown);
      if (this.hud) {
        this.hud.updatePianoNoteDisplay(isDown ? 'Sustain Pedal DOWN' : 'Sustain Pedal UP');
      }
    }
  }

  updatePianoKeyAnimations(delta) {
    if (this.animatingKeys.size === 0 && (!this.keyLightPool || this.keyLightPool.every(p => !p.activeMidi))) return;

    if (!this._cachedGlowPurple) {
      this._cachedGlowPurple = new THREE.Color(0xc084fc);
      this._cachedGlowLightBlue = new THREE.Color(0x38bdf8);
    }
    const glowColorPurple = this._cachedGlowPurple;
    const glowColorLightBlue = this._cachedGlowLightBlue;

    const toRemove = [];

    for (const midi of this.animatingKeys) {
      const keyNode = this.pianoKeyMeshes.get(midi);
      if (!keyNode) {
        toRemove.push(midi);
        continue;
      }

      const uData = keyNode.userData;
      const activeGlowColor = midi <= 64 ? glowColorPurple : glowColorLightBlue;

      // Fast dynamic spring lerp
      const speed = uData.targetDepression > uData.currentDepression ? 48 : 24;
      uData.currentDepression += (uData.targetDepression - uData.currentDepression) * Math.min(speed * delta, 1);

      // Pivot downward (negative X in piano model space tilts player-facing key front DOWN)
      keyNode.rotation.x = uData.baseRotX - uData.currentDepression * 0.13;

      const factor = uData.currentDepression;

      // Apply intense emissive radiance and color shift to the key mesh
      if (uData.glowMaterials && uData.glowMaterials.length > 0) {
        for (const mat of uData.glowMaterials) {
          if (factor > 0.005) {
            mat.emissive.copy(activeGlowColor);
            mat.emissiveIntensity = factor * 12.0;

            if (mat.userData.originalColor) {
              mat.color.lerpColors(mat.userData.originalColor, activeGlowColor, factor * 0.98);
            }
          } else {
            mat.emissiveIntensity = 0;
            if (mat.userData.originalColor) {
              mat.color.copy(mat.userData.originalColor);
            }
          }
        }
      }

      // Dim environment point light
      if (this.keyLightPool) {
        const slot = this.keyLightPool.find(s => s.activeMidi === midi);
        if (slot) {
          slot.light.intensity = factor * 3.5;
          if (factor < 0.01 && uData.targetDepression === 0) {
            slot.light.visible = false;
            slot.activeMidi = null;
          }
        }
      }

      // If key returned completely to rest position, remove from active animation loop
      if (uData.targetDepression === 0 && Math.abs(uData.currentDepression) < 0.002) {
        uData.currentDepression = 0;
        keyNode.rotation.x = uData.baseRotX;
        toRemove.push(midi);
      }
    }

    toRemove.forEach(m => this.animatingKeys.delete(m));
  }

  startSynthesiaNote(keyNode, midi) {
    if (!this.scene) return;

    // End any previously active note on same key
    this.endSynthesiaNote(midi);

    const worldPos = new THREE.Vector3();
    keyNode.getWorldPosition(worldPos);

    const isBlack = keyNode.name && keyNode.name.startsWith('black_');
    const geom = isBlack ? this.synthesiaGeomBlack : this.synthesiaGeomWhite;
    // Lower half (MIDI <= 64): Purple, Upper half (MIDI > 64): Light Blue
    const colorHex = midi <= 64 ? 0xc084fc : 0x38bdf8;
    
    // Independent material per rising note to smoothly animate fade-out opacity without shader stutter
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(worldPos.x, worldPos.y + 0.08, worldPos.z);
    mesh.rotation.y = this.pianoRotationY || (3 * Math.PI / 2);
    this.scene.add(mesh);

    const noteTrack = {
      midi,
      mesh,
      mat,
      isHolding: true,
      height: 0.05,
      maxLifetime: 3.2,
      age: 0
    };

    this.activeSynthesiaNotes.set(midi, noteTrack);
    this.synthesiaNotes.push(noteTrack);
  }

  endSynthesiaNote(midi) {
    const noteTrack = this.activeSynthesiaNotes.get(midi);
    if (noteTrack) {
      noteTrack.isHolding = false;
      this.activeSynthesiaNotes.delete(midi);
    }
  }

  updateFloatingNotes(delta) {
    if (this.synthesiaNotes.length === 0) return;

    const SPEED = 3.6; // Crisp waterfall rise speed
    const toRemove = [];

    for (let i = this.synthesiaNotes.length - 1; i >= 0; i--) {
      const note = this.synthesiaNotes[i];
      note.age += delta;

      if (note.isHolding) {
        // While key is held down, grow height upwards
        note.height += SPEED * delta;
        note.mesh.scale.y = note.height / 0.05;
      } else {
        // When key is released, the entire bar floats upward continuously
        note.mesh.position.y += SPEED * delta;
      }

      // Smooth elegant fade-out animation as notes rise into the air
      // Full opacity during initial rise, then gracefully fades out to 0 opacity
      const currentTopY = note.mesh.position.y + (note.isHolding ? note.height : 0);
      const fadeStartHeight = 2.4;
      const fadeEndHeight = 7.5;
      
      if (currentTopY > fadeStartHeight && note.mat) {
        const progress = Math.min(1.0, (currentTopY - fadeStartHeight) / (fadeEndHeight - fadeStartHeight));
        note.mat.opacity = Math.max(0.0, 0.95 * (1.0 - Math.pow(progress, 1.4)));
      }

      if (currentTopY > fadeEndHeight || note.age > note.maxLifetime || (note.mat && note.mat.opacity <= 0.01)) {
        this.scene.remove(note.mesh);
        if (note.mat) {
          note.mat.dispose();
        }
        toRemove.push(i);
      }
    }

    toRemove.forEach(idx => {
      this.synthesiaNotes.splice(idx, 1);
    });
  }

  getNoteName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    return `${names[midi % 12]}${octave}`;
  }
}

// Native-App Viewport Pinning & Browser Lockdown for Web Games
export function initBrowserLockdown() {
  // 1. Disable Right-Click Context Menu on Game Canvas & UI (Allow inside text inputs)
  window.addEventListener('contextmenu', (e) => {
    if (['input', 'textarea'].includes(e.target?.tagName?.toLowerCase())) {
      return;
    }
    e.preventDefault();
  }, { passive: false });

  // 2. Intercept Disruptive Browser Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    const isTyping = ['input', 'textarea'].includes(document.activeElement?.tagName?.toLowerCase());
    
    // Disable Tab key cycling through DOM buttons
    if (e.key === 'Tab' || e.code === 'Tab') {
      e.preventDefault();
      return;
    }
    // Disable Spacebar page scrolling when playing / jumping
    if (!isTyping && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
    }
    // Disable F1 (Help), F3 (Find), Ctrl+P (Print)
    if (!isTyping && (e.key === 'F1' || (e.ctrlKey && e.key.toLowerCase() === 'p'))) {
      e.preventDefault();
    }
  });

  // 3. Prevent Safari / iOS Pinch-to-Zoom Gestures
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  // 4. Prevent Multi-Touch Viewport Zooming
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault(); // Prevent 2-finger zoom gestures
    }
  }, { passive: false });

  // 5. Prevent Dragging Images or Ghosting Elements
  window.addEventListener('dragstart', (e) => {
    if (e.target.tagName?.toLowerCase() === 'img') {
      e.preventDefault();
    }
  });
}

// Bootstrap Game Application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});

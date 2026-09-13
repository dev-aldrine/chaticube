import { io } from 'socket.io-client';

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.currentPing = 0;
    this.pingInterval = null;

    this.callbacks = {
      onRoomJoined: null,
      onPlayerJoined: null,
      onPlayerMoved: null,
      onPlayerLeft: null,
      onBlockPlaced: null,
      onBlockRemoved: null,
      onChatMessage: null,
      onWorldsUpdated: null,
      onPianoOccupied: null,
      onPianoNote: null,
      onPianoSustain: null,
      onVoiceSignal: null,
      onPlayerMicStatus: null,
      onPingUpdate: null,
      onPlayerPing: null,
      onConnect: null,
      onDisconnect: null
    };
  }

  connect() {
    // In Vite dev or production, connect to current host origin or default port
    this.socket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.selfId = this.socket.id;
      if (this.callbacks.onConnect) this.callbacks.onConnect();
      this.startPingLoop();
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.stopPingLoop();
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    });

    this.socket.on('player-ping-update', (data) => {
      if (this.callbacks.onPlayerPing) this.callbacks.onPlayerPing(data);
    });

    this.socket.on('room-joined', (data) => {
      if (this.callbacks.onRoomJoined) this.callbacks.onRoomJoined(data);
    });

    this.socket.on('player-joined', (data) => {
      if (this.callbacks.onPlayerJoined) this.callbacks.onPlayerJoined(data);
    });

    this.socket.on('player-moved', (data) => {
      if (this.callbacks.onPlayerMoved) this.callbacks.onPlayerMoved(data);
    });

    this.socket.on('player-left', (data) => {
      if (this.callbacks.onPlayerLeft) this.callbacks.onPlayerLeft(data);
    });

    this.socket.on('piano-occupied', (data) => {
      if (this.callbacks.onPianoOccupied) this.callbacks.onPianoOccupied(data);
    });

    this.socket.on('piano-note', (data) => {
      if (this.callbacks.onPianoNote) this.callbacks.onPianoNote(data);
    });

    this.socket.on('piano-sustain', (data) => {
      if (this.callbacks.onPianoSustain) this.callbacks.onPianoSustain(data);
    });

    this.socket.on('block-placed', (data) => {
      if (this.callbacks.onBlockPlaced) this.callbacks.onBlockPlaced(data);
    });

    this.socket.on('block-removed', (data) => {
      if (this.callbacks.onBlockRemoved) this.callbacks.onBlockRemoved(data);
    });

    this.socket.on('chat-message', (data) => {
      if (this.callbacks.onChatMessage) this.callbacks.onChatMessage(data);
    });

    this.socket.on('voice-signal', (data) => {
      if (this.callbacks.onVoiceSignal) this.callbacks.onVoiceSignal(data);
    });

    this.socket.on('player-mic-status', (data) => {
      if (this.callbacks.onPlayerMicStatus) this.callbacks.onPlayerMicStatus(data);
    });

    this.socket.on('worlds-updated', (data) => {
      if (this.callbacks.onWorldsUpdated) this.callbacks.onWorldsUpdated(data);
    });
  }

  joinRoom(roomName, name, colors) {
    if (!this.socket) return;
    this.socket.emit('join-room', { roomName, name, colors });
  }

  leaveRoom() {
    if (!this.socket) return;
    this.socket.emit('leave-room');
  }

  sendVoiceSignal(targetId, signal) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('voice-signal', { targetId, signal });
  }

  sendMicStatus(isMuted, isSpeaking) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('mic-status', { isMuted, isSpeaking });
  }

  sendPlayerUpdate(data) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('player-update', data);
  }

  placeBlock(x, y, z, type, rotationY = 0) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('place-block', { x, y, z, type, rotationY });
  }

  removeBlock(x, y, z) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('remove-block', { x, y, z });
  }

  sendChatMessage(message, image = null) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('chat-message', { message, image });
  }

  sendPianoLock() {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('piano-lock');
  }

  sendPianoUnlock() {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('piano-unlock');
  }

  sendPianoNote(note, velocity, on) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('piano-note', { note, velocity, on });
  }

  sendPianoSustain(isDown) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('piano-sustain', { isDown });
  }

  requestWorlds() {
    if (!this.socket) return;
    this.socket.emit('request-worlds');
  }

  startPingLoop() {
    this.stopPingLoop();
    const sendPing = () => {
      if (!this.socket || !this.isConnected) return;
      const start = performance.now();
      this.socket.emit('client-ping', start, () => {
        const rtt = Math.max(1, Math.round(performance.now() - start));
        this.currentPing = rtt;
        if (this.socket && this.isConnected) {
          this.socket.emit('player-ping', { ping: rtt });
        }
        if (this.callbacks.onPingUpdate) {
          this.callbacks.onPingUpdate(rtt);
        }
      });
    };

    sendPing();
    this.pingInterval = setInterval(sendPing, 2000);
  }

  stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

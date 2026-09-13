/**
 * MidiManager.js
 * Hardware MIDI Input System supporting:
 * 1. Web MIDI API (navigator.requestMIDIAccess) with automatic hot-plugging.
 * 2. Python MIDI Bridge WebSocket (ws://localhost:8765) with auto-reconnect.
 * Supports note on/off velocity parsing, CC 64 sustain pedal, and active device name reporting.
 */

export class MidiManager {
  constructor({ onNoteOn, onNoteOff, onControlChange, onDeviceChange, bridgeUrl = 'ws://localhost:8765' }) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.onControlChange = onControlChange;
    this.onDeviceChange = onDeviceChange;
    this.bridgeUrl = bridgeUrl;

    this.midiAccess = null;
    this.activeInputs = new Map();
    this.isSupported = Boolean(navigator.requestMIDIAccess);
    this.connectedDeviceNames = [];

    // Python MIDI Bridge WebSocket State (Disabled by default so browser does not spam ERR_CONNECTION_REFUSED)
    const savedBridge = localStorage.getItem('midi_bridge_enabled') === 'true';
    this.isBridgeEnabled = savedBridge;
    this.bridgeSocket = null;
    this.isBridgeConnected = false;
    this.bridgeReconnectTimer = null;
  }

  async init() {
    // 1. Initialize native Web MIDI hardware access if supported (zero external ports needed)
    if (this.isSupported) {
      try {
        this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        this.midiAccess.onstatechange = (e) => this.handleStateChange(e);

        for (const input of this.midiAccess.inputs.values()) {
          this.attachInput(input);
        }
        this.updateDeviceList();
      } catch (err) {
        console.warn('[MIDI] Failed to access Web MIDI devices:', err);
      }
    } else {
      console.warn('[MIDI] Web MIDI API not supported in this browser environment.');
    }

    // 2. Only connect to Python MIDI bridge if explicitly enabled
    if (this.isBridgeEnabled) {
      this.connectBridge();
    }
    return true;
  }

  setBridgeEnabled(enabled) {
    this.isBridgeEnabled = Boolean(enabled);
    localStorage.setItem('midi_bridge_enabled', this.isBridgeEnabled ? 'true' : 'false');
    if (this.isBridgeEnabled) {
      this.connectBridge();
    } else {
      this.disconnectBridge();
    }
  }

  disconnectBridge() {
    if (this.bridgeReconnectTimer) {
      clearTimeout(this.bridgeReconnectTimer);
      this.bridgeReconnectTimer = null;
    }
    if (this.bridgeSocket) {
      this.bridgeSocket.onclose = null;
      this.bridgeSocket.onerror = null;
      this.bridgeSocket.close();
      this.bridgeSocket = null;
    }
    this.isBridgeConnected = false;
    this.updateDeviceList();
  }

  /**
   * Connect to Python MIDI Bridge WebSocket Server
   */
  connectBridge() {
    if (!this.isBridgeEnabled) return;
    if (this.bridgeSocket && (this.bridgeSocket.readyState === WebSocket.OPEN || this.bridgeSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.bridgeSocket = new WebSocket(this.bridgeUrl);

      this.bridgeSocket.onopen = () => {
        console.log(`[MIDI Bridge] 🟢 Connected to Python MIDI Bridge at ${this.bridgeUrl}`);
        this.isBridgeConnected = true;
        this.updateDeviceList();
      };

      this.bridgeSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleBridgeMessage(data);
        } catch (err) {
          console.warn('[MIDI Bridge] Error parsing bridge message:', err, event.data);
        }
      };

      this.bridgeSocket.onclose = () => {
        if (this.isBridgeConnected) {
          console.log('[MIDI Bridge] 🔴 Disconnected from Python MIDI Bridge.');
        }
        this.isBridgeConnected = false;
        this.updateDeviceList();
        if (this.isBridgeEnabled) {
          this.scheduleBridgeReconnect();
        }
      };

      this.bridgeSocket.onerror = () => {
        this.bridgeSocket?.close();
      };
    } catch (err) {
      if (this.isBridgeEnabled) {
        this.scheduleBridgeReconnect();
      }
    }
  }

  scheduleBridgeReconnect() {
    if (!this.isBridgeEnabled || this.bridgeReconnectTimer) return;
    this.bridgeReconnectTimer = setTimeout(() => {
      this.bridgeReconnectTimer = null;
      this.connectBridge();
    }, 5000);
  }

  /**
   * Handle JSON messages from Python MIDI Bridge
   */
  handleBridgeMessage(data) {
    if (!data || !data.type) return;

    if (data.type === 'note_on') {
      const note = Number(data.note);
      const velocity = typeof data.velocity === 'number' ? Number(data.velocity) : 90;
      if (velocity > 0) {
        if (this.onNoteOn) this.onNoteOn(note, velocity, data.channel || 0);
      } else {
        if (this.onNoteOff) this.onNoteOff(note, data.channel || 0);
      }
    } else if (data.type === 'note_off') {
      const note = Number(data.note);
      if (this.onNoteOff) this.onNoteOff(note, data.channel || 0);
    } else if (data.type === 'sustain') {
      const isDown = typeof data.value === 'boolean' ? data.value : Number(data.value) >= 64;
      if (this.onControlChange) this.onControlChange('sustain', isDown, data.channel || 0);
    } else if (data.type === 'control_change' && data.controller === 64) {
      const isDown = Number(data.value) >= 64;
      if (this.onControlChange) this.onControlChange('sustain', isDown, data.channel || 0);
    }
  }

  attachInput(input) {
    if (!this.activeInputs.has(input.id)) {
      input.onmidimessage = (msg) => this.handleMidiMessage(msg);
      this.activeInputs.set(input.id, input);
      console.log(`[MIDI] Attached: ${input.name || 'MIDI Input'} (${input.manufacturer || 'Generic'})`);
    }
  }

  handleStateChange(event) {
    const port = event.port;
    if (port.type === 'input') {
      if (port.state === 'connected') {
        this.attachInput(port);
      } else if (port.state === 'disconnected') {
        this.activeInputs.delete(port.id);
        console.log(`[MIDI] Detached: ${port.name || 'MIDI Input'}`);
      }
      this.updateDeviceList();
    }
  }

  updateDeviceList() {
    const devices = Array.from(this.activeInputs.values()).map(
      (inp) => inp.name || 'MIDI Keyboard'
    );
    if (this.isBridgeConnected) {
      devices.unshift('Python MIDI Bridge (ws://localhost:8765)');
    }
    this.connectedDeviceNames = devices;
    if (this.onDeviceChange) {
      this.onDeviceChange(this.connectedDeviceNames);
    }
  }

  handleMidiMessage(event) {
    if (!event.data || event.data.length < 2) return;

    const [status, data1, data2 = 0] = event.data;
    const command = status >> 4;
    const channel = status & 0x0f;

    switch (command) {
      case 0x9: // Note On
        if (data2 > 0) {
          if (this.onNoteOn) this.onNoteOn(data1, data2, channel);
        } else {
          if (this.onNoteOff) this.onNoteOff(data1, channel);
        }
        break;

      case 0x8: // Note Off
        if (this.onNoteOff) this.onNoteOff(data1, channel);
        break;

      case 0xb: // Control Change (CC)
        if (data1 === 64) {
          // CC 64 = Sustain Pedal
          const isDown = data2 >= 64;
          if (this.onControlChange) this.onControlChange('sustain', isDown, channel);
        }
        break;
    }
  }

  destroy() {
    if (this.bridgeReconnectTimer) {
      clearTimeout(this.bridgeReconnectTimer);
      this.bridgeReconnectTimer = null;
    }
    if (this.bridgeSocket) {
      this.bridgeSocket.onclose = null;
      this.bridgeSocket.onerror = null;
      this.bridgeSocket.close();
      this.bridgeSocket = null;
    }
  }
}


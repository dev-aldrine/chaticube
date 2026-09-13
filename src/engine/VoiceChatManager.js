import * as THREE from 'three';

// Public STUN servers for $0 NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

export class VoiceChatManager {
  constructor({ networkManager, getRemotePlayerPosition, getLocalPlayerPosition }) {
    this.networkManager = networkManager;
    this.getRemotePlayerPosition = getRemotePlayerPosition;
    this.getLocalPlayerPosition = getLocalPlayerPosition;

    this.localStream = null;
    this.isMuted = true; // Mic starts off/muted by default
    this.isSpeaking = false;
    this.audioContext = null;
    this.analyser = null;
    this.analyserData = null;

    // targetId -> { peerConnection, remoteStream, gainNode, pannerNode, isSpeaking }
    this.peers = new Map();
    this.onMicStatusChange = null; // Callback for local UI
    this.onRemoteVoiceActivity = null; // Callback: (id, isSpeaking)

    this.selectedAudioInputId = '';
    this.selectedAudioOutputId = '';

    this.setupNetworkCallbacks();
  }

  async getAudioDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return { inputs: [], outputs: [] };
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      return { inputs, outputs };
    } catch (err) {
      console.warn('[VoiceChat] Failed to enumerate audio devices:', err);
      return { inputs: [], outputs: [] };
    }
  }

  async setAudioInputDevice(deviceId) {
    this.selectedAudioInputId = deviceId;
    if (!this.localStream) return;

    try {
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      newTrack.enabled = !this.isMuted;

      // Replace tracks in all existing peer connections
      for (const peer of this.peers.values()) {
        if (peer.peerConnection) {
          const senders = peer.peerConnection.getSenders();
          const sender = senders.find(s => s.track && s.track.kind === 'audio');
          if (sender) {
            sender.replaceTrack(newTrack);
          }
        }
      }

      // Stop old tracks
      this.localStream.getAudioTracks().forEach(t => t.stop());
      this.localStream = newStream;

      // Reconnect analyzer
      if (this.audioContext) {
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        if (this.analyser) {
          source.connect(this.analyser);
        }
      }
    } catch (err) {
      console.warn('[VoiceChat] Error switching audio input device:', err);
    }
  }

  async setAudioOutputDevice(deviceId) {
    this.selectedAudioOutputId = deviceId;
    for (const peer of this.peers.values()) {
      if (peer.audioElement && typeof peer.audioElement.setSinkId === 'function') {
        try {
          await peer.audioElement.setSinkId(deviceId);
        } catch (err) {
          console.warn('[VoiceChat] Error setting sink ID on peer audio element:', err);
        }
      }
    }
  }

  setupNetworkCallbacks() {
    this.networkManager.callbacks.onVoiceSignal = async ({ senderId, signal }) => {
      await this.handleVoiceSignal(senderId, signal);
    };

    this.networkManager.callbacks.onPlayerMicStatus = ({ id, isMuted, isSpeaking }) => {
      if (this.onRemoteVoiceActivity) {
        this.onRemoteVoiceActivity(id, { isMuted, isSpeaking });
      }
    };
  }

  async initLocalMicrophone() {
    if (this.localStream) return true;

    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      };
      if (this.selectedAudioInputId) {
        constraints.audio.deviceId = { exact: this.selectedAudioInputId };
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Mute audio tracks by default until user toggles ON
      this.localStream.getAudioTracks().forEach(t => (t.enabled = !this.isMuted));

      // Setup audio analyzer for voice activity detection (VAD)
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);

      this.startVoiceActivityDetection();

      // Renegotiate with all peers to add audio track
      for (const [targetId, peer] of this.peers.entries()) {
        if (peer.peerConnection) {
          const track = this.localStream.getAudioTracks()[0];
          if (track) {
            const existingSender = peer.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (existingSender) {
              await existingSender.replaceTrack(track);
            } else {
              peer.peerConnection.addTrack(track, this.localStream);
              try {
                const offer = await peer.peerConnection.createOffer();
                await peer.peerConnection.setLocalDescription(offer);
                this.networkManager.sendVoiceSignal(targetId, { sdp: peer.peerConnection.localDescription });
              } catch (e) {
                console.warn('[VoiceChat] Error renegotiating after mic init:', e);
              }
            }
          }
        }
      }

      return true;
    } catch (err) {
      console.warn('[VoiceChat] Microphone access denied or unavailable:', err);
      return false;
    }
  }

  async toggleMic() {
    if (!this.localStream) {
      const ok = await this.initLocalMicrophone();
      if (!ok) return false;
    }

    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(t => (t.enabled = !this.isMuted));

    if (this.isMuted) {
      this.isSpeaking = false;
    }

    // Broadcast mic status
    this.networkManager.sendMicStatus(this.isMuted, this.isSpeaking);
    if (this.onMicStatusChange) {
      this.onMicStatusChange(this.isMuted, this.isSpeaking);
    }

    return !this.isMuted;
  }

  startVoiceActivityDetection() {
    const checkVAD = () => {
      if (!this.localStream) return;
      if (!this.isMuted && this.analyser && this.analyserData) {
        this.analyser.getByteFrequencyData(this.analyserData);
        let sum = 0;
        for (let i = 0; i < this.analyserData.length; i++) {
          sum += this.analyserData[i];
        }
        const average = sum / this.analyserData.length;
        const speakingNow = average > 14; // Sensitivity threshold

        if (speakingNow !== this.isSpeaking) {
          this.isSpeaking = speakingNow;
          this.networkManager.sendMicStatus(this.isMuted, this.isSpeaking);
          if (this.onMicStatusChange) {
            this.onMicStatusChange(this.isMuted, this.isSpeaking);
          }
        }
      }
      requestAnimationFrame(checkVAD);
    };
    checkVAD();
  }

  async connectToPeer(targetId, isInitiator = false) {
    if (this.peers.has(targetId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peerInfo = {
      peerConnection: pc,
      remoteStream: null,
      audioElement: null,
      pendingCandidates: []
    };
    this.peers.set(targetId, peerInfo);

    // Add local mic stream tracks if available, or create dummy audio transceiver for two-way audio
    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    } else {
      // Ensure browser is prepared to receive remote audio even if local mic is not yet enabled
      try {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      } catch (e) {
        // Fallback for older WebRTC implementations
      }
    }

    // Send ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.networkManager.sendVoiceSignal(targetId, { candidate: event.candidate });
      }
    };

    // Receive remote audio stream with 3D positional audio
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.setupSpatialAudioForPeer(targetId, remoteStream);
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        this.networkManager.sendVoiceSignal(targetId, { sdp: pc.localDescription });
      } catch (err) {
        console.warn(`[VoiceChat] Create offer failed for ${targetId}:`, err);
      }
    }
  }

  async handleVoiceSignal(senderId, signal) {
    let peer = this.peers.get(senderId);
    if (!peer) {
      await this.connectToPeer(senderId, false);
      peer = this.peers.get(senderId);
    }
    if (!peer) return;

    const pc = peer.peerConnection;

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Flush any ICE candidates that arrived before remoteDescription was set
        if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
          for (const cand of peer.pendingCandidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[VoiceChat] Error adding queued candidate:', e);
            }
          }
          peer.pendingCandidates = [];
        }

        if (signal.sdp.type === 'offer') {
          // If we have local stream, ensure audio track is added
          if (this.localStream) {
            this.localStream.getTracks().forEach(t => {
              if (!pc.getSenders().find(s => s.track === t)) {
                pc.addTrack(t, this.localStream);
              }
            });
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.networkManager.sendVoiceSignal(senderId, { sdp: pc.localDescription });
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          // Queue candidate until remoteDescription is set
          if (!peer.pendingCandidates) peer.pendingCandidates = [];
          peer.pendingCandidates.push(signal.candidate);
        }
      }
    } catch (err) {
      console.warn(`[VoiceChat] Signal error with ${senderId}:`, err);
    }
  }

  setupSpatialAudioForPeer(targetId, stream) {
    let peer = this.peers.get(targetId);
    if (!peer) return;

    let audio = peer.audioElement;
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 1.0;
      // Attach to document to ensure reliable playback across all desktop browsers
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }

    audio.srcObject = stream;

    // Trigger play() with promise catch to handle browser autoplay policies
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy prevented immediate playback; unlock on user interaction
        const unlockAudio = () => {
          audio.play().catch(() => {});
          window.removeEventListener('click', unlockAudio);
          window.removeEventListener('keydown', unlockAudio);
          window.removeEventListener('touchstart', unlockAudio);
        };
        window.addEventListener('click', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });
        window.addEventListener('touchstart', unlockAudio, { once: true });
      });
    }

    if (this.selectedAudioOutputId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(this.selectedAudioOutputId).catch(err => {
        console.warn('[VoiceChat] Failed to set sink ID on peer audio:', err);
      });
    }

    peer.remoteStream = stream;
    peer.audioElement = audio;
  }

  updateSpatialAudioPositions() {
    const localPos = this.getLocalPlayerPosition ? this.getLocalPlayerPosition() : null;
    if (!localPos) return;

    for (const [id, peer] of this.peers.entries()) {
      if (peer.audioElement) {
        if (this.getRemotePlayerPosition) {
          const remotePos = this.getRemotePlayerPosition(id);
          if (remotePos) {
            const dist = localPos.distanceTo(remotePos);
            // Realistic inverse distance falloff (Clear within 8m, fades smoothly to 0 by 30m)
            const MAX_DISTANCE = 28.0;
            const MIN_DISTANCE = 3.5;
            if (dist <= MIN_DISTANCE) {
              peer.audioElement.volume = 1.0;
            } else if (dist >= MAX_DISTANCE) {
              peer.audioElement.volume = 0.0;
            } else {
              const factor = 1.0 - (dist - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
              peer.audioElement.volume = Math.max(0, Math.min(1.0, factor * factor));
            }
          } else {
            // Position not yet resolved, keep audible at default level
            peer.audioElement.volume = 1.0;
          }
        } else {
          peer.audioElement.volume = 1.0;
        }
      }
    }
  }

  removePeer(targetId) {
    const peer = this.peers.get(targetId);
    if (peer) {
      if (peer.audioElement) {
        peer.audioElement.pause();
        peer.audioElement.srcObject = null;
      }
      if (peer.peerConnection) {
        peer.peerConnection.close();
      }
      this.peers.delete(targetId);
    }
  }

  destroy() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    for (const id of Array.from(this.peers.keys())) {
      this.removePeer(id);
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

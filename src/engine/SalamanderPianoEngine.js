// High-resolution Salamander sample definitions matching Python repository download_samples.py:
// Uses authentic lossless FLAC acoustic samples across dual dynamic velocity layers (v8 mf & v14 ff)
const SALAMANDER_BASE_URL = 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples/';

// Anchor notes sampled across all 88 keys (7+ octaves) matching download_samples.py
const ANCHOR_DEFINITIONS = [
  { midi: 24, name: 'C1' },
  { midi: 27, name: 'D#1' },
  { midi: 30, name: 'F#1' },
  { midi: 33, name: 'A1' },
  { midi: 36, name: 'C2' },
  { midi: 39, name: 'D#2' },
  { midi: 42, name: 'F#2' },
  { midi: 45, name: 'A2' },
  { midi: 48, name: 'C3' },
  { midi: 51, name: 'D#3' },
  { midi: 54, name: 'F#3' },
  { midi: 57, name: 'A3' },
  { midi: 60, name: 'C4' },
  { midi: 63, name: 'D#4' },
  { midi: 66, name: 'F#4' },
  { midi: 69, name: 'A4' },
  { midi: 72, name: 'C5' },
  { midi: 75, name: 'D#5' },
  { midi: 78, name: 'F#5' },
  { midi: 81, name: 'A5' },
  { midi: 84, name: 'C6' },
  { midi: 87, name: 'D#6' },
  { midi: 90, name: 'F#6' },
  { midi: 93, name: 'A6' },
  { midi: 96, name: 'C7' },
  { midi: 99, name: 'D#7' },
  { midi: 102, name: 'F#7' },
  { midi: 105, name: 'A7' },
  { midi: 108, name: 'C8' }
];

const ANCHOR_MIDIS = ANCHOR_DEFINITIONS.map(a => a.midi);
const PRIORITY_MIDIS = [48, 54, 60, 66, 72, 78, 84]; // Core center octaves

// Velocity Curves matching Python velocity_curve.py
export const VELOCITY_CURVES = {
  linear: (v) => v,
  'ease-in': (v) => v * v,
  'ease-out': (v) => (v > 0 ? Math.sqrt(v) : 0),
  'ease-in-out': (v) => (v < 0.5 ? 2.0 * v * v : 1.0 - Math.pow(-2.0 * v + 2.0, 2.0) / 2.0),
  exponential: (v) => v * v * v
};

export class SalamanderPianoEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.softLimiter = null;

    // Multi-layer sample caches: key = `${midi}_v8` and `${midi}_v14`
    this.sampleCache = new Map(); // key -> AudioBuffer
    this.activeVoices = new Map(); // midiNote -> Voice[]
    this.sustainPedal = false;
    this.sustainedNotes = new Set();
    this.isLoaded = false;
    this.isLoading = false;
    this.anchorMidis = ANCHOR_MIDIS;
    
    // Master Volume: 0.0 to 1.0 (defaults to 1.0 for 100% full raw dynamics)
    const savedVol = parseFloat(localStorage.getItem('piano_master_volume'));
    this.volume = isNaN(savedVol) ? 1.0 : Math.max(0, Math.min(1, savedVol));

    // Velocity Curve: linear | ease-in | ease-out | ease-in-out | exponential
    const savedCurve = localStorage.getItem('piano_velocity_curve');
    this.velocityCurve = savedCurve && VELOCITY_CURVES[savedCurve] ? savedCurve : 'linear';
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      // Native 48,000 Hz, low latency interactive buffer
      this.audioCtx = new AudioContextClass({
        latencyHint: 'interactive',
        sampleRate: 48000
      });

      // Master Limiter & Anti-Clipping DSP: output = tanh(mix * 0.95)
      // Preserves ultra-crisp hammer strike & full bright transients while preventing chord digital clipping
      this.softLimiter = this.audioCtx.createWaveShaper();
      this.softLimiter.curve = this.generateTanhCurve(4096, 0.95);
      this.softLimiter.oversample = '2x';

      // Master Output Gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);

      // Signal Flow: VoiceGain -> softLimiter (tanh 0.95) -> MasterGain -> Destination
      this.softLimiter.connect(this.masterGain);
      this.masterGain.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Generates tanh soft-saturation curve: y = tanh(x * 0.95)
   */
  generateTanhCurve(samples = 4096, drive = 0.95) {
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1; // -1.0 to 1.0
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  async loadSamples(onProgress) {
    if (this.isLoaded) return;
    if (this.isLoading) return;

    this.isLoading = true;
    this.initAudioContext();

    const anchorMap = new Map();
    ANCHOR_DEFINITIONS.forEach(a => anchorMap.set(a.midi, a.name));

    // Fallback ToneJS mp3 map
    const TONEJS_URL = 'https://tonejs.github.io/audio/salamander/';
    const TONEJS_MAP = {
      24: 'C1', 27: 'Ds1', 30: 'Fs1', 33: 'A1',
      36: 'C2', 39: 'Ds2', 42: 'Fs2', 45: 'A2',
      48: 'C3', 51: 'Ds3', 54: 'Fs3', 57: 'A3',
      60: 'C4', 63: 'Ds4', 66: 'Fs4', 69: 'A4',
      72: 'C5', 75: 'Ds5', 78: 'Fs5', 81: 'A5',
      84: 'C6', 87: 'Ds6', 90: 'Fs6', 93: 'A6',
      96: 'C7', 99: 'Ds7', 102: 'Fs7', 105: 'A7',
      108: 'C8'
    };

    const loadSampleLayer = async (midi, layer) => {
      const cacheKey = `${midi}_${layer}`;
      if (this.sampleCache.has(cacheKey)) return;

      const noteName = anchorMap.get(midi) || 'C4';
      const flacUrl = `${SALAMANDER_BASE_URL}${encodeURIComponent(noteName)}${layer}.flac`;

      try {
        const resp = await fetch(flacUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();
        const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf);
        this.sampleCache.set(cacheKey, audioBuf);
      } catch (err) {
        // Fallback to ToneJS if FLAC is blocked or unavailable
        try {
          const toneName = TONEJS_MAP[midi] || 'C4';
          const resp = await fetch(`${TONEJS_URL}${toneName}.mp3`);
          const arrayBuf = await resp.arrayBuffer();
          const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf);
          this.sampleCache.set(cacheKey, audioBuf);
        } catch (e2) {
          console.warn(`[PianoAudio] Note ${noteName} (${layer}) load failed:`, err);
        }
      }
    };

    const totalSteps = this.anchorMidis.length * 2;
    let completedSteps = 0;

    const loadAnchorBothLayers = async (midi) => {
      await Promise.all([
        loadSampleLayer(midi, 'v8'),
        loadSampleLayer(midi, 'v14')
      ]);
      completedSteps += 2;
      if (onProgress) {
        onProgress(Math.min(1.0, completedSteps / totalSteps));
      }
    };

    // Phase 1: Load Priority Center Octaves (Immediate Playability)
    await Promise.all(PRIORITY_MIDIS.map(loadAnchorBothLayers));

    // Phase 2: Stagger remaining anchors in small batches
    const remainingMidis = this.anchorMidis.filter(m => !PRIORITY_MIDIS.includes(m));
    const BATCH_SIZE = 3;

    for (let i = 0; i < remainingMidis.length; i += BATCH_SIZE) {
      const chunk = remainingMidis.slice(i, i + BATCH_SIZE);
      await Promise.all(chunk.map(loadAnchorBothLayers));
      await new Promise(r => setTimeout(r, 10));
    }

    this.isLoaded = true;
    this.isLoading = false;
    console.log(`[PianoAudio] Salamander Dual-Layer Grand Piano loaded (${this.sampleCache.size} sample buffers).`);
  }

  findNearestAnchor(note, layer) {
    let nearest = 60;
    let minDiff = Infinity;
    for (const anchor of this.anchorMidis) {
      const diff = Math.abs(note - anchor);
      if (diff < minDiff && (this.sampleCache.has(`${anchor}_${layer}`) || this.sampleCache.has(`${anchor}_v8`) || this.sampleCache.has(`${anchor}_v14`))) {
        minDiff = diff;
        nearest = anchor;
      }
    }
    return nearest;
  }

  noteOn(note, velocity = 90) {
    this.initAudioContext();
    if (this.sampleCache.size === 0) return;

    // Fast-release previous voice on same note
    this.noteOff(note, true);

    // Dual velocity layer selection matching Python engine:
    // v8 for velocity <= 80 (warm mf), v14 for velocity > 80 (bright, crisp ff hammer attack)
    const layer = velocity > 80 ? 'v14' : 'v8';
    const fallbackLayer = layer === 'v14' ? 'v8' : 'v14';

    const anchor = this.findNearestAnchor(note, layer);
    let buffer = this.sampleCache.get(`${anchor}_${layer}`);
    if (!buffer) {
      buffer = this.sampleCache.get(`${anchor}_${fallbackLayer}`);
    }
    if (!buffer) return;

    const semitoneDiff = note - anchor;
    // Pitch shift / Transposition: Linear frequency ratio without lowpass damping
    const playbackRate = Math.pow(2.0, semitoneDiff / 12.0);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    // Dynamic gain scaling: gain = velocity / 127.0 with configured velocity curve
    const normVel = Math.max(0.01, Math.min(1.0, velocity / 127.0));
    const curveFn = VELOCITY_CURVES[this.velocityCurve] || VELOCITY_CURVES.linear;
    const curvedVel = curveFn(normVel);
    const gainVal = Math.max(0.01, Math.min(1.0, curvedVel));

    const voiceGain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;

    // Attack: 0ms instantaneous (preserve natural acoustic hammer transient). Max 3ms anti-click ramp
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(gainVal, now + 0.002);

    source.connect(voiceGain);

    // Direct Dry Routing to tanh Soft-Limiter (No muddy reverb or filters)
    voiceGain.connect(this.softLimiter);

    source.start(now);

    // Enforce Polyphony Management (LRU Voice Stealing)
    const MAX_POLYPHONY = 28;
    let totalVoices = 0;
    let oldestVoice = null;
    let oldestMidi = null;

    for (const [vMidi, vList] of this.activeVoices.entries()) {
      totalVoices += vList.length;
      for (const v of vList) {
        if (!oldestVoice || v.startTime < oldestVoice.startTime) {
          oldestVoice = v;
          oldestMidi = vMidi;
        }
      }
    }

    if (totalVoices >= MAX_POLYPHONY && oldestVoice) {
      try {
        oldestVoice.gainNode.gain.cancelScheduledValues(now);
        oldestVoice.gainNode.gain.setValueAtTime(oldestVoice.gainNode.gain.value, now);
        oldestVoice.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
        oldestVoice.source.stop(now + 0.02);
      } catch (e) {}
      
      const vList = this.activeVoices.get(oldestMidi);
      if (vList) {
        const idx = vList.indexOf(oldestVoice);
        if (idx !== -1) vList.splice(idx, 1);
        if (vList.length === 0) this.activeVoices.delete(oldestMidi);
      }
    }

    const voice = { source, gainNode: voiceGain, note, startTime: now };
    if (!this.activeVoices.has(note)) {
      this.activeVoices.set(note, []);
    }
    this.activeVoices.get(note).push(voice);
  }

  noteOff(note, force = false) {
    if (!this.audioCtx) return;

    if (this.sustainPedal && !force) {
      this.sustainedNotes.add(note);
      return;
    }

    const voices = this.activeVoices.get(note);
    if (!voices) return;

    const now = this.audioCtx.currentTime;

    // Real acoustic damper release decay matching Python engine:
    // decay = exp(-release_frames / 4000.0) at 48000 Hz (~83 ms decay duration)
    // Cutoff voice when decay < 0.002
    const timeConstant = 0.0833;

    voices.forEach((voice) => {
      try {
        const currentVal = Math.max(voice.gainNode.gain.value, 0.001);
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(currentVal, now);
        voice.gainNode.gain.setTargetAtTime(0, now, timeConstant);
        
        // Cleanly stop buffer source after decay cutoff threshold (< 0.002)
        voice.source.stop(now + 0.35);
      } catch (e) {
        // Voice ended
      }
    });

    this.activeVoices.delete(note);
    this.sustainedNotes.delete(note);
  }

  setSustainPedal(isDown) {
    this.sustainPedal = isDown;
    if (!isDown) {
      for (const note of this.sustainedNotes) {
        this.noteOff(note, true);
      }
      this.sustainedNotes.clear();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('piano_master_volume', this.volume.toFixed(2));
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
    }
  }

  setVelocityCurve(curveName) {
    if (VELOCITY_CURVES[curveName]) {
      this.velocityCurve = curveName;
      localStorage.setItem('piano_velocity_curve', curveName);
    }
  }
}



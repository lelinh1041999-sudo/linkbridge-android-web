/**
 * Adaptive low-latency stereo PCM jitter-buffer AudioWorkletProcessor
 * with smooth linear-interpolated fractional resampling for music-grade audio.
 *
 * - Prebuffers a target amount before (re)starting playback (starts at 100ms).
 * - Target grows automatically after underruns (up to 300ms) and slowly
 *   shrinks back toward 60ms when the network is stable.
 * - Excess latency is removed via fractional linear interpolation at 1.004x
 *   (+0.4%, imperceptible pitch shift, zero aliasing clicks) with hysteresis.
 * - Short fade-in / fade-out on start/underrun to avoid pops.
 */
const SR = 48000;
const MIN_TARGET = Math.round(SR * 0.06);   // 60ms
const MAX_TARGET = Math.round(SR * 0.30);   // 300ms
const START_TARGET = Math.round(SR * 0.10); // 100ms
const FADE_LEN = 96;

class LowLatencyPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = SR * 2; // 2s ring buffer
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.readPos = 0; // Fractional index in [0, capacity)
    this.writePos = 0;
    this.available = 0; // Fractional available samples
    this.muted = false;

    this.target = START_TARGET;
    this.playing = false;
    this.catchingUp = false;
    this.rate = 1.0;
    this.fadeIn = 0;
    this.stableFrames = 0;
    this.lastL = 0;
    this.lastR = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'mute') {
        this.muted = Boolean(msg.muted);
        return;
      }
      if (msg.type === 'clear') {
        this.readPos = 0;
        this.writePos = 0;
        this.available = 0;
        this.playing = false;
        this.catchingUp = false;
        this.rate = 1.0;
        return;
      }
      if (msg.type === 'pcm') {
        const chL = msg.left;
        const chR = msg.right || msg.left;
        const n = chL.length;

        // Hard safety cap only for huge backlogs (e.g. tab was in background)
        const hardCap = this.target + Math.round(SR * 0.40);
        if (this.available + n > hardCap) {
          const drop = Math.min(Math.floor(this.available), Math.floor(this.available + n - this.target));
          this.readPos = (this.readPos + drop) % this.capacity;
          this.available = Math.max(0, this.available - drop);
          this.fadeIn = FADE_LEN;
        }

        for (let i = 0; i < n; i++) {
          this.left[this.writePos] = chL[i];
          this.right[this.writePos] = chR[i];
          this.writePos = (this.writePos + 1) % this.capacity;
        }
        this.available = Math.min(this.capacity - 2, this.available + n);
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out[1] || out[0];
    const frames = outL.length;

    if (this.muted) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      const consume = Math.min(frames, Math.floor(this.available));
      this.readPos = (this.readPos + consume) % this.capacity;
      this.available = Math.max(0, this.available - consume);
      this.playing = false;
      this.catchingUp = false;
      this.rate = 1.0;
      return true;
    }

    // Wait until enough audio is buffered before (re)starting
    if (!this.playing) {
      if (this.available >= this.target) {
        this.playing = true;
        this.fadeIn = FADE_LEN;
        this.catchingUp = false;
        this.rate = 1.0;
      } else {
        outL.fill(0);
        if (outR !== outL) outR.fill(0);
        return true;
      }
    }

    // Hysteresis catch-up threshold: avoids oscillating during DeX video bursts
    const highWatermark = this.target * 2 + 2400; // target*2 + 50ms
    const lowWatermark = this.target + 960;       // target + 20ms
    if (!this.catchingUp && this.available > highWatermark) {
      this.catchingUp = true;
    } else if (this.catchingUp && this.available <= lowWatermark) {
      this.catchingUp = false;
    }

    // Smoothly approach 1.004x (+0.4%, inaudible) when catching up, 1.0x otherwise
    const targetRate = this.catchingUp ? 1.004 : 1.0;

    let i = 0;
    for (; i < frames; i++) {
      if (this.available < 2) break;

      this.rate += (targetRate - this.rate) * 0.01;

      const idx0 = Math.floor(this.readPos) % this.capacity;
      const idx1 = (idx0 + 1) % this.capacity;
      const frac = this.readPos - Math.floor(this.readPos);

      let l = this.left[idx0] + (this.left[idx1] - this.left[idx0]) * frac;
      let r = this.right[idx0] + (this.right[idx1] - this.right[idx0]) * frac;

      if (this.fadeIn > 0) {
        const g = 1 - this.fadeIn / FADE_LEN;
        l *= g;
        r *= g;
        this.fadeIn--;
      }

      outL[i] = l;
      if (outR !== outL) outR[i] = r;
      this.lastL = l;
      this.lastR = r;

      this.readPos += this.rate;
      if (this.readPos >= this.capacity) this.readPos -= this.capacity;
      this.available -= this.rate;
    }

    if (i < frames) {
      // Underrun: fade tail out smoothly, then grow the buffer target
      let l = this.lastL;
      let r = this.lastR;
      for (let k = i; k < frames; k++) {
        l *= 0.92;
        r *= 0.92;
        outL[k] = l;
        if (outR !== outL) outR[k] = r;
      }
      this.lastL = 0;
      this.lastR = 0;
      this.playing = false;
      this.catchingUp = false;
      this.rate = 1.0;
      this.stableFrames = 0;
      this.target = Math.min(MAX_TARGET, this.target + Math.round(SR * 0.03));
    } else {
      // Network stable: very slowly lower latency target (every ~8s)
      this.stableFrames += frames;
      if (this.stableFrames > SR * 8) {
        this.stableFrames = 0;
        this.target = Math.max(MIN_TARGET, this.target - Math.round(SR * 0.01));
      }
    }
    return true;
  }
}

registerProcessor('low-latency-pcm', LowLatencyPcmProcessor);

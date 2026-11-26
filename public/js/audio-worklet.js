/**
 * Adaptive low-latency stereo PCM jitter-buffer AudioWorkletProcessor.
 *
 * Why: Wi-Fi delivers Opus packets in bursts. The old fixed ~85ms cap kept
 * running dry (silence gaps) and hard-dropping samples (clicks) => "giật giật".
 *
 * Now:
 *  - Prebuffers a target amount before (re)starting playback.
 *  - Target grows automatically after each underrun (up to 300ms) and slowly
 *    shrinks back when the network is stable, keeping latency as low as possible.
 *  - Excess latency is removed gently by skipping 1 sample in every ~50
 *    (~2% speed-up, inaudible) instead of chopping big chunks.
 *  - Short fade-in / fade-out on start/underrun to avoid pops.
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
    this.readPos = 0;
    this.writePos = 0;
    this.available = 0;
    this.muted = false;

    this.target = START_TARGET;
    this.playing = false;
    this.fadeIn = 0;
    this.stableFrames = 0;
    this.skipCounter = 0;
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
        return;
      }
      if (msg.type === 'pcm') {
        const chL = msg.left;
        const chR = msg.right || msg.left;
        const n = chL.length;

        // Hard safety cap only for huge backlogs (e.g. tab was in background)
        const hardCap = this.target + Math.round(SR * 0.35);
        if (this.available + n > hardCap) {
          const drop = Math.min(this.available, this.available + n - this.target);
          this.readPos = (this.readPos + drop) % this.capacity;
          this.available -= drop;
          this.fadeIn = FADE_LEN;
        }

        for (let i = 0; i < n; i++) {
          this.left[this.writePos] = chL[i];
          this.right[this.writePos] = chR[i];
          this.writePos = (this.writePos + 1) % this.capacity;
        }
        this.available = Math.min(this.capacity, this.available + n);
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
      const consume = Math.min(frames, this.available);
      this.readPos = (this.readPos + consume) % this.capacity;
      this.available -= consume;
      this.playing = false;
      return true;
    }

    // Wait until enough audio is buffered before (re)starting
    if (!this.playing) {
      if (this.available >= this.target) {
        this.playing = true;
        this.fadeIn = FADE_LEN;
      } else {
        outL.fill(0);
        if (outR !== outL) outR.fill(0);
        return true;
      }
    }

    // Gentle catch-up when latency is clearly above target
    const catchUp = this.available > this.target * 1.6 + 960;

    let i = 0;
    for (; i < frames; i++) {
      if (this.available <= 0) break;
      if (catchUp && ++this.skipCounter >= 50 && this.available > 1) {
        this.skipCounter = 0;
        this.readPos = (this.readPos + 1) % this.capacity;
        this.available -= 1;
      }
      let l = this.left[this.readPos];
      let r = this.right[this.readPos];
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
      this.readPos = (this.readPos + 1) % this.capacity;
      this.available -= 1;
    }

    if (i < frames) {
      // Underrun: fade the tail out instead of a hard cut, then grow the buffer target
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

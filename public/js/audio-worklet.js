/**
 * Ultra-low-latency stereo PCM ring-buffer AudioWorkletProcessor.
 * Receives Float32Array interleaved or planar stereo chunks from WebCodecs AudioDecoder
 * and trims excess latency automatically if queued audio exceeds ~80ms.
 */
class LowLatencyPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 48kHz * 0.5s stereo ring buffer per channel
    this.capacity = 24000;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.available = 0;
    this.muted = false;

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
        return;
      }
      if (msg.type === 'pcm') {
        const chL = msg.left;
        const chR = msg.right || msg.left;
        const n = chL.length;

        // If latency builds up beyond ~85ms (~4096 samples at 48kHz), skip old samples
        const maxLagSamples = 4096;
        if (this.available + n > maxLagSamples) {
          const drop = Math.min(this.available, (this.available + n) - 1920);
          this.readPos = (this.readPos + drop) % this.capacity;
          this.available -= drop;
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

    if (this.muted || this.available === 0) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      if (this.muted && this.available > 0) {
        const consume = Math.min(frames, this.available);
        this.readPos = (this.readPos + consume) % this.capacity;
        this.available -= consume;
      }
      return true;
    }

    const toCopy = Math.min(frames, this.available);
    for (let i = 0; i < toCopy; i++) {
      outL[i] = this.left[this.readPos];
      if (outR !== outL) outR[i] = this.right[this.readPos];
      this.readPos = (this.readPos + 1) % this.capacity;
    }
    for (let i = toCopy; i < frames; i++) {
      outL[i] = 0;
      if (outR !== outL) outR[i] = 0;
    }
    this.available -= toCopy;
    return true;
  }
}

registerProcessor('low-latency-pcm', LowLatencyPcmProcessor);

/**
 * Client-side scrcpy v5.0.1 binary control encoder + WebCodecs H.264 & Opus ultra-low-latency decoder.
 * Supports BOTH:
 *   1. Local / Crostini Wi-Fi Bridge (WebSocket binary stream)
 *   2. Direct Browser WebUSB (100% browser-only, zero server install on GitHub Pages)
 */

export const MOTION_ACTION = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
};

export const KEY_ACTION = {
  DOWN: 0,
  UP: 1,
};

export const POINTER_ID_FINGER = -2n;
export const POINTER_ID_PINCH_2 = 1002n;

function floatToU16Fixed(v) {
  const c = Math.max(0, Math.min(1, v));
  let u = Math.round(c * 0x10000);
  if (u >= 0xffff) u = 0xffff;
  return u;
}

function floatToI16Fixed(v) {
  const c = Math.max(-1, Math.min(1, v));
  let i = Math.round(c * 0x8000);
  if (i >= 0x7fff) i = 0x7fff;
  if (i <= -0x8000) i = -0x8000;
  return i;
}

export function encodeTouchEvent({
  action,
  pointerId = POINTER_ID_FINGER,
  x,
  y,
  screenWidth,
  screenHeight,
  pressure = 1.0,
  actionButton = 0,
  buttons = 0,
}) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 2); // TYPE_INJECT_TOUCH_EVENT
  v.setUint8(1, action & 0xff);
  v.setBigInt64(2, BigInt(pointerId), false);
  v.setInt32(10, Math.round(x), false);
  v.setInt32(14, Math.round(y), false);
  v.setUint16(18, screenWidth & 0xffff, false);
  v.setUint16(20, screenHeight & 0xffff, false);
  v.setUint16(22, floatToU16Fixed(pressure), false);
  v.setInt32(24, actionButton | 0, false);
  v.setInt32(28, buttons | 0, false);
  return buf;
}

export function encodeScrollEvent({
  x,
  y,
  screenWidth,
  screenHeight,
  hScroll = 0,
  vScroll = 0,
  buttons = 0,
}) {
  const buf = new ArrayBuffer(21);
  const v = new DataView(buf);
  v.setUint8(0, 3); // TYPE_INJECT_SCROLL_EVENT
  v.setInt32(1, Math.round(x), false);
  v.setInt32(5, Math.round(y), false);
  v.setUint16(9, screenWidth & 0xffff, false);
  v.setUint16(11, screenHeight & 0xffff, false);
  v.setInt16(13, floatToI16Fixed(hScroll / 16), false);
  v.setInt16(15, floatToI16Fixed(vScroll / 16), false);
  v.setInt32(17, buttons | 0, false);
  return buf;
}

export function encodeKeycodeEvent(action, keycode, repeat = 0, metaState = 0) {
  const buf = new ArrayBuffer(14);
  const v = new DataView(buf);
  v.setUint8(0, 0); // TYPE_INJECT_KEYCODE
  v.setUint8(1, action & 0xff);
  v.setInt32(2, keycode | 0, false);
  v.setInt32(6, repeat | 0, false);
  v.setInt32(10, metaState | 0, false);
  return buf;
}

export function encodeInjectText(text) {
  const encoded = new TextEncoder().encode(String(text).slice(0, 300));
  const buf = new Uint8Array(5 + encoded.length);
  const v = new DataView(buf.buffer);
  v.setUint8(0, 1); // TYPE_INJECT_TEXT
  v.setUint32(1, encoded.length, false);
  buf.set(encoded, 5);
  return buf.buffer;
}

/**
 * Extracts exact WebCodecs AVC codec string (e.g. "avc1.64002a") from an Annex-B H.264 config packet (SPS NAL).
 */
function extractAvcCodecString(annexBBytes) {
  for (let i = 0; i < annexBBytes.length - 6; i++) {
    let startLen = 0;
    if (annexBBytes[i] === 0 && annexBBytes[i + 1] === 0 && annexBBytes[i + 2] === 1) {
      startLen = 3;
    } else if (
      annexBBytes[i] === 0 &&
      annexBBytes[i + 1] === 0 &&
      annexBBytes[i + 2] === 0 &&
      annexBBytes[i + 3] === 1
    ) {
      startLen = 4;
    }
    if (startLen > 0) {
      const nalIdx = i + startLen;
      const nalType = annexBBytes[nalIdx] & 0x1f;
      if (nalType === 7 && nalIdx + 3 < annexBBytes.length) {
        const profile = annexBBytes[nalIdx + 1].toString(16).padStart(2, '0');
        const compat = annexBBytes[nalIdx + 2].toString(16).padStart(2, '0');
        const level = annexBBytes[nalIdx + 3].toString(16).padStart(2, '0');
        return `avc1.${profile}${compat}${level}`;
      }
      i += startLen - 1;
    }
  }
  return 'avc1.64002a';
}

function concatUint8(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toWsBase(httpBase) {
  if (!httpBase) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }
  return httpBase.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/+$/, '');
}

/**
 * WebCodecs Hardware VideoDecoder + AudioDecoder (Opus -> AudioWorklet) client.
 */
export class ScrcpyWebClient {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.cb = callbacks;

    this.transportMode = null; // 'ws' | 'webusb'
    this.ws = null;
    this.webUsbDriver = null;
    this.serial = null;
    this.width = 0;
    this.height = 0;

    // Video decode state
    this.videoDecoder = null;
    this.lastConfigBytes = null;
    this.awaitingKeyFrame = true;
    this.latestFrame = null;
    this.rafId = null;
    this.decodeTimes = new Map();
    this.smoothedLatencyMs = 0;
    this.renderedFramesSec = 0;
    this.localFps = 0;
    this.fpsTimer = null;

    // Audio decode state
    this.audioEnabled = true;
    this.audioMuted = false;
    this.audioCtx = null;
    this.audioWorkletNode = null;
    this.audioDecoder = null;
    this.audioReady = false;
  }

  static isWebCodecsSupported() {
    return typeof window !== 'undefined' && typeof window.VideoDecoder === 'function';
  }

  _startLoops() {
    this._startRenderLoop();
    if (this.fpsTimer) clearInterval(this.fpsTimer);
    this.fpsTimer = setInterval(() => {
      this.localFps = this.renderedFramesSec;
      this.renderedFramesSec = 0;
      this.cb.onLocalStats?.({
        localFps: this.localFps,
        decodeLatencyMs: Math.round(this.smoothedLatencyMs),
      });
    }, 1000);
  }

  /**
   * Mode 1: Connect via local/Crostini Bridge WebSocket (Wi-Fi or Bridge USB).
   */
  connect(serial, options = {}, forceRestart = false, bridgeBase = '') {
    this.disconnect();
    this.transportMode = 'ws';
    this.serial = serial;
    this.audioEnabled = options.audio !== false;

    const params = new URLSearchParams({
      maxSize: String(options.maxSize || 1080),
      bitRate: String(options.bitRate || 8_000_000),
      maxFps: String(options.maxFps || 60),
      audio: String(this.audioEnabled),
      stayAwake: String(Boolean(options.stayAwake)),
      turnScreenOff: String(Boolean(options.turnScreenOff)),
      videoCodec: options.videoCodec || 'h264',
      restart: String(Boolean(forceRestart)),
    });

    const url = `${toWsBase(bridgeBase)}/ws/device/${encodeURIComponent(serial)}?${params}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this._startLoops();

    ws.onopen = () => {
      this.cb.onStatus?.('connecting', 'Đang khởi động luồng video trên điện thoại...');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          this._handleJsonMessage(JSON.parse(event.data));
        } catch {}
        return;
      }
      this._handleBinaryMessage(event.data);
    };

    ws.onerror = () => {
      this.cb.onError?.('Lỗi kết nối WebSocket tới Bridge server.');
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.cb.onStatus?.('disconnected', 'Đã ngắt kết nối luồng.');
      }
    };
  }

  /**
   * Mode 2: Attach directly to a browser WebUSB scrcpy driver (zero server hop!).
   */
  attachWebUsb(driver, options = {}) {
    this.disconnect();
    this.transportMode = 'webusb';
    this.webUsbDriver = driver;
    this.audioEnabled = options.audio !== false;
    this._startLoops();
  }

  applyMeta(meta) {
    if (meta.width > 0 && meta.height > 0) {
      this.width = meta.width;
      this.height = meta.height;
      if (this.canvas.width !== meta.width || this.canvas.height !== meta.height) {
        this.canvas.width = meta.width;
        this.canvas.height = meta.height;
      }
    }
    this.cb.onMeta?.(meta);
  }

  _handleJsonMessage(msg) {
    switch (msg.type) {
      case 'status':
        this.cb.onStatus?.(msg.status, msg.reason || '');
        break;
      case 'meta':
        this.applyMeta(msg);
        break;
      case 'stats':
        this.cb.onServerStats?.(msg);
        break;
      case 'clipboard':
        this.cb.onClipboard?.(msg.text || '');
        break;
      case 'display_power':
        this.cb.onDisplayPower?.(Boolean(msg.on));
        break;
      case 'audio_meta':
        this.cb.onAudioMeta?.(msg);
        break;
      case 'error':
        this.cb.onError?.(msg.message || 'Lỗi từ thiết bị.');
        break;
      default:
        break;
    }
  }

  _handleBinaryMessage(arrayBuffer) {
    if (arrayBuffer.byteLength < 10) return;
    const view = new DataView(arrayBuffer);
    const frameType = view.getUint8(0);
    const flags = view.getUint8(1);
    const pts = Number(view.getBigUint64(2, false));
    const payload = new Uint8Array(arrayBuffer, 10);

    if (frameType === 0x01) {
      this.handleVideoPacket(flags, pts, payload);
    } else if (frameType === 0x02) {
      this.handleAudioPacket(flags, pts, payload);
    }
  }

  _initVideoDecoder(codecString) {
    if (!ScrcpyWebClient.isWebCodecsSupported()) {
      this.cb.onError?.('Trình duyệt không hỗ trợ WebCodecs. Hãy mở bằng Chrome.');
      return;
    }

    if (this.videoDecoder) {
      try { this.videoDecoder.close(); } catch {}
      this.videoDecoder = null;
    }

    this.awaitingKeyFrame = true;
    this.decodeTimes.clear();

    this.videoDecoder = new VideoDecoder({
      output: (frame) => {
        const sentAt = this.decodeTimes.get(frame.timestamp);
        if (sentAt !== undefined) {
          const dt = performance.now() - sentAt;
          this.decodeTimes.delete(frame.timestamp);
          this.smoothedLatencyMs = this.smoothedLatencyMs === 0 ? dt : this.smoothedLatencyMs * 0.8 + dt * 0.2;
        }
        if (this.latestFrame) {
          this.latestFrame.close();
        }
        this.latestFrame = frame;
      },
      error: (err) => {
        console.warn('[VideoDecoder error]', err);
        this.awaitingKeyFrame = true;
        this.sendJson({ type: 'reset_video' });
      },
    });

    this.videoDecoder.configure({
      codec: codecString,
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware',
    });
  }

  handleVideoPacket(flags, pts, payload) {
    const isConfig = (flags & 1) !== 0;
    const isKeyFrame = (flags & 2) !== 0;

    if (isConfig) {
      this.lastConfigBytes = new Uint8Array(payload);
      const codecString = extractAvcCodecString(this.lastConfigBytes);
      this._initVideoDecoder(codecString);
      return;
    }

    if (!this.videoDecoder || this.videoDecoder.state !== 'configured') return;
    if (this.awaitingKeyFrame && !isKeyFrame) return;
    // Never drop a single P-frame mid-GOP without resetting to a keyframe (dropping a delta frame freezes H.264!)
    if (!isKeyFrame && this.videoDecoder.decodeQueueSize > 12) {
      this.awaitingKeyFrame = true;
      this.sendJson({ type: 'reset_video' });
      return;
    }

    let chunkData = payload;
    if (isKeyFrame && this.lastConfigBytes) {
      chunkData = concatUint8(this.lastConfigBytes, payload);
      this.awaitingKeyFrame = false;
    }

    const ts = pts > 0 ? pts : Math.round(performance.now() * 1000);
    if (this.decodeTimes.size > 32) this.decodeTimes.clear();
    this.decodeTimes.set(ts, performance.now());

    try {
      this.videoDecoder.decode(
        new EncodedVideoChunk({
          type: isKeyFrame ? 'key' : 'delta',
          timestamp: ts,
          data: chunkData,
        })
      );
    } catch (err) {
      console.warn('[VideoDecoder decode failed]', err);
      this.awaitingKeyFrame = true;
    }
  }

  async ensureAudioContext() {
    if (!this.audioEnabled || typeof AudioDecoder !== 'function') return false;
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.audioCtx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.audioCtx.audioWorklet.addModule('./js/audio-worklet.js');
      this.audioWorkletNode = new AudioWorkletNode(this.audioCtx, 'low-latency-pcm', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.audioWorkletNode.connect(this.audioCtx.destination);
      this.audioWorkletNode.port.postMessage({ type: 'mute', muted: this.audioMuted });
      this.audioReady = true;
    }
    if (this.audioCtx.state === 'suspended') {
      try { await this.audioCtx.resume(); } catch {}
    }
    return this.audioReady;
  }

  setAudioMuted(muted) {
    this.audioMuted = Boolean(muted);
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'mute', muted: this.audioMuted });
    }
    if (!this.audioMuted) {
      this.ensureAudioContext();
    }
  }

  _initAudioDecoder(opusHeadBytes) {
    if (!this.audioEnabled || typeof AudioDecoder !== 'function') return;
    if (opusHeadBytes && opusHeadBytes.length >= 19) {
      this.lastOpusConfig = new Uint8Array(opusHeadBytes);
    }
    if (this.audioDecoder) {
      try { this.audioDecoder.close(); } catch {}
      this.audioDecoder = null;
    }

    this.audioDecoder = new AudioDecoder({
      output: (audioData) => {
        if (!this.audioReady || this.audioMuted || !this.audioWorkletNode) {
          audioData.close();
          return;
        }
        try {
          const frames = audioData.numberOfFrames;
          const channels = audioData.numberOfChannels;
          const fmt = audioData.format || '';
          const left = new Float32Array(frames);
          const right = new Float32Array(frames);

          if (fmt.endsWith('-planar')) {
            audioData.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
            if (channels > 1) audioData.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
            else right.set(left);
          } else {
            const interleaved = new Float32Array(frames * channels);
            audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
            for (let i = 0; i < frames; i++) {
              left[i] = interleaved[i * channels];
              right[i] = channels > 1 ? interleaved[i * channels + 1] : left[i];
            }
          }
          this.audioWorkletNode.port.postMessage({ type: 'pcm', left, right }, [left.buffer, right.buffer]);
        } catch {} finally {
          audioData.close();
        }
      },
      error: (err) => {
        console.warn('[AudioDecoder error — auto recovering]', err);
        this.audioDecoder = null;
      },
    });

    const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
    const desc = opusHeadBytes && opusHeadBytes.length >= 19 ? opusHeadBytes : this.lastOpusConfig;
    if (desc && desc.length >= 19) {
      config.description = desc;
    }
    this.audioDecoder.configure(config);
  }

  handleAudioPacket(flags, pts, payload) {
    if (!this.audioEnabled || !payload || payload.byteLength === 0) return;
    const isConfig = (flags & 1) !== 0;

    if (isConfig) {
      this._initAudioDecoder(payload);
      return;
    }
    if (!this.audioDecoder || this.audioDecoder.state === 'closed') {
      this._initAudioDecoder(this.lastOpusConfig || null);
    }
    if (!this.audioDecoder || this.audioDecoder.state !== 'configured' || this.audioMuted) return;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    try {
      this.audioDecoder.decode(
        new EncodedAudioChunk({ type: 'key', timestamp: pts, data: payload })
      );
    } catch {
      // Self-heal on malformed transition packet between apps/videos
      this._initAudioDecoder(this.lastOpusConfig || null);
    }
  }

  _startRenderLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const tick = () => {
      if (this.latestFrame) {
        const frame = this.latestFrame;
        this.latestFrame = null;
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
          this.width = frame.displayWidth;
          this.height = frame.displayHeight;
          this.cb.onResize?.(this.width, this.height);
        }
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
        this.renderedFramesSec += 1;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  sendBinary(arrayBuffer) {
    if (this.transportMode === 'webusb' && this.webUsbDriver) {
      return this.webUsbDriver.sendBinary(arrayBuffer);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(arrayBuffer);
      return true;
    }
    return false;
  }

  sendJson(obj) {
    if (this.transportMode === 'webusb' && this.webUsbDriver) {
      return this.webUsbDriver.sendJson(obj);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.fpsTimer) {
      clearInterval(this.fpsTimer);
      this.fpsTimer = null;
    }
    if (this.latestFrame) {
      this.latestFrame.close();
      this.latestFrame = null;
    }
    if (this.videoDecoder) {
      try { this.videoDecoder.close(); } catch {}
      this.videoDecoder = null;
    }
    if (this.audioDecoder) {
      try { this.audioDecoder.close(); } catch {}
      this.audioDecoder = null;
    }
    if (this.audioWorkletNode) {
      try { this.audioWorkletNode.port.postMessage({ type: 'clear' }); } catch {}
    }
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try { old.close(); } catch {}
    }
    this.webUsbDriver = null;
    this.transportMode = null;
    this.lastConfigBytes = null;
    this.awaitingKeyFrame = true;
    this.smoothedLatencyMs = 0;
  }
}

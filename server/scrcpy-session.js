'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const adb = require('./adb');
const proto = require('./scrcpy-protocol');

const REMOTE_SERVER_PATH = '/data/local/tmp/scrcpy-server';
const LOCAL_SERVER_PATH = path.resolve(__dirname, '..', 'bin', 'scrcpy-server');

const WS_FRAME_VIDEO = 0x01;
const WS_FRAME_AUDIO = 0x02;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function connectTcp(port) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.setNoDelay(true);
    const onErr = (err) => {
      sock.removeListener('connect', onConnect);
      reject(err);
    };
    const onConnect = () => {
      sock.removeListener('error', onErr);
      resolve(sock);
    };
    sock.once('error', onErr);
    sock.once('connect', onConnect);
  });
}

/**
 * Connects the first scrcpy socket (video) with retry until the server writes its 1-byte dummy handshake.
 * Returns { socket, initialRemainder }.
 */
async function connectVideoWithDummyRetry(port, isStoppedFn, maxAttempts = 50) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isStoppedFn()) throw new Error('Phiên kết nối đã bị hủy.');

    try {
      const result = await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: '127.0.0.1', port });
        sock.setNoDelay(true);

        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            sock.destroy();
            reject(new Error('Timeout chờ phản hồi từ scrcpy-server'));
          }
        }, 1200);

        const cleanup = () => {
          clearTimeout(timer);
          sock.removeListener('data', onFirstData);
          sock.removeListener('close', onClose);
          sock.removeListener('error', onError);
        };

        const onFirstData = (chunk) => {
          if (settled || chunk.length === 0) return;
          settled = true;
          cleanup();
          // Byte 0 is scrcpy's dummy handshake byte; pass any extra bytes to the parser
          const remainder = chunk.length > 1 ? chunk.subarray(1) : null;
          resolve({ socket: sock, remainder });
        };

        const onClose = () => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('Socket đóng sớm (server chưa sẵn sàng)'));
          }
        };

        const onError = (err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        };

        sock.on('data', onFirstData);
        sock.once('close', onClose);
        sock.once('error', onError);
      });

      return result;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 90));
    }
  }
  throw lastError || new Error('Không thể kết nối tới scrcpy-server trên điện thoại.');
}

function packWsMediaFrame(frameType, flags, pts, payload) {
  const buf = Buffer.allocUnsafe(10 + payload.length);
  buf.writeUInt8(frameType, 0);
  buf.writeUInt8(flags & 0xff, 1);
  buf.writeBigUInt64BE(BigInt(pts), 2);
  payload.copy(buf, 10);
  return buf;
}

class ScrcpySession extends EventEmitter {
  constructor(serial, options = {}) {
    super();
    this.serial = serial;
    const parsedMaxSize = Number(options.maxSize);
    this.options = {
      maxSize: options.maxSize !== undefined && options.maxSize !== null && !Number.isNaN(parsedMaxSize) ? parsedMaxSize : 1080,
      bitRate: Number(options.bitRate) || 8_000_000,
      maxFps: Number(options.maxFps) || 60,
      audio: options.audio !== undefined ? Boolean(options.audio) : true,
      stayAwake: Boolean(options.stayAwake),
      turnScreenOff: Boolean(options.turnScreenOff),
      videoCodec: options.videoCodec || 'h264',
      newDisplay: typeof options.newDisplay === 'string' && /^\d{3,4}x\d{3,4}(\/\d{2,3})?$/.test(options.newDisplay.trim())
        ? options.newDisplay.trim()
        : '',
    };

    this.state = 'idle'; // idle | starting | running | stopped
    this.scidHex = null;
    this.localPort = null;
    this.serverProc = null;
    this.videoSocket = null;
    this.audioSocket = null;
    this.controlSocket = null;

    this.deviceName = '';
    this.videoCodec = 'h264';
    this.audioCodec = null;
    this.width = 0;
    this.height = 0;
    this.displayPowerOn = !this.options.turnScreenOff;

    this.lastVideoConfigFrame = null;
    this.lastVideoKeyFrame = null;
    this.lastAudioConfigFrame = null;
    this.lastClipboard = '';
    this.clipboardSeq = 1n;

    this.clients = new Set();
    this.bytesSentSec = 0;
    this.framesSec = 0;
    this.currentFps = 0;
    this.currentMbps = 0;
    this.statsTimer = null;
    this.idleDestroyTimer = null;
    this.serverLogs = [];
  }

  getInfo() {
    return {
      serial: this.serial,
      state: this.state,
      deviceName: this.deviceName,
      videoCodec: this.videoCodec,
      audioCodec: this.audioCodec,
      width: this.width,
      height: this.height,
      displayPowerOn: this.displayPowerOn,
      options: this.options,
      clientCount: this.clients.size,
      fps: this.currentFps,
      mbps: this.currentMbps,
    };
  }

  async ensureServerBinaryPushed() {
    if (!fs.existsSync(LOCAL_SERVER_PATH)) {
      throw new Error(
        `Không tìm thấy file ${LOCAL_SERVER_PATH}. Hãy chạy ./setup.sh để tải scrcpy-server v${proto.SCRCPY_VERSION}.`
      );
    }
    const localStat = fs.statSync(LOCAL_SERVER_PATH);
    const check = await adb.execAdb(
      ['-s', this.serial, 'shell', `stat -c %s ${REMOTE_SERVER_PATH} 2>/dev/null || echo 0`],
      { timeout: 5000 }
    );
    const remoteSize = parseInt((check.stdout || '').trim(), 10);
    if (remoteSize === localStat.size) {
      return; // Already up-to-date on phone
    }
    const pushRes = await adb.pushFile(this.serial, LOCAL_SERVER_PATH, REMOTE_SERVER_PATH);
    if (!pushRes.ok) {
      throw new Error(`Lỗi đẩy scrcpy-server lên điện thoại: ${pushRes.stderr || pushRes.stdout}`);
    }
  }

  async start() {
    if (this.state === 'running' || this.state === 'starting') return;
    this.state = 'starting';
    this.serverLogs = [];

    try {
      await this.ensureServerBinaryPushed();

      // 31-bit non-negative random SCID formatted as 8 lowercase hex digits
      const scidInt = crypto.randomInt(1, 0x7fffffff);
      this.scidHex = scidInt.toString(16).padStart(8, '0');
      const socketName = `scrcpy_${this.scidHex}`;

      this.localPort = await getFreePort();
      const fwd = await adb.forwardPort(this.serial, this.localPort, socketName);
      if (!fwd.ok) {
        throw new Error(`Không thể tạo adb forward: ${fwd.stderr || fwd.stdout}`);
      }

      const serverArgs = [
        '-s', this.serial,
        'shell',
        `CLASSPATH=${REMOTE_SERVER_PATH}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        proto.SCRCPY_VERSION,
        `scid=${this.scidHex}`,
        'log_level=info',
        'tunnel_forward=true',
        'video=true',
        `audio=${this.options.audio ? 'true' : 'false'}`,
        'control=true',
        `video_codec=${this.options.videoCodec}`,
        'audio_codec=opus',
        `max_size=${this.options.newDisplay ? 0 : this.options.maxSize}`,
        `video_bit_rate=${this.options.bitRate}`,
        `max_fps=${this.options.maxFps}`,
        'video_codec_options=i-frame-interval=2',
        `stay_awake=${this.options.stayAwake ? 'true' : 'false'}`,
        'power_on=true',
        'clipboard_autosync=true',
        'send_dummy_byte=true',
        'send_device_meta=true',
        'send_stream_meta=true',
        'send_frame_meta=true',
        'cleanup=true',
        ...(this.options.newDisplay ? [`new_display=${this.options.newDisplay}`, 'vd_destroy_content=false'] : []),
      ];

      this.serverProc = spawn(adb.ADB_BIN, serverArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let procExitedEarly = false;
      this.serverProc.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8').trim();
        if (text) this.serverLogs.push(text);
      });
      this.serverProc.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8').trim();
        if (text) this.serverLogs.push(text);
      });
      this.serverProc.on('close', (code) => {
        procExitedEarly = true;
        if (this.state === 'running') {
          this.broadcastJson({
            type: 'status',
            status: 'disconnected',
            reason: `scrcpy-server đã dừng (mã ${code ?? 'null'})`,
            logs: this.serverLogs.slice(-6),
          });
          this.stop();
        }
      });

      // 1) Connect Video socket (waits for 1-byte dummy handshake)
      const { socket: videoSock, remainder } = await connectVideoWithDummyRetry(
        this.localPort,
        () => this.state === 'stopped' || procExitedEarly
      );
      this.videoSocket = videoSock;

      // 2) Connect Audio socket (if enabled)
      if (this.options.audio) {
        this.audioSocket = await connectTcp(this.localPort);
      }

      // 3) Connect Control socket
      this.controlSocket = await connectTcp(this.localPort);

      this._attachParsers(remainder);

      this.state = 'running';

      // Optionally dim/turn off physical OLED display on connect
      if (this.options.turnScreenOff) {
        setTimeout(() => {
          if (this.state === 'running') this.setDisplayPower(false);
        }, 350);
      }

      // Live FPS & Bitrate telemetry every 1s
      this.statsTimer = setInterval(() => {
        this.currentFps = this.framesSec;
        this.currentMbps = Number(((this.bytesSentSec * 8) / 1_000_000).toFixed(2));
        this.framesSec = 0;
        this.bytesSentSec = 0;
        if (this.clients.size > 0) {
          this.broadcastJson({
            type: 'stats',
            fps: this.currentFps,
            mbps: this.currentMbps,
            width: this.width,
            height: this.height,
            displayPowerOn: this.displayPowerOn,
          });
        }
      }, 1000);

      this.emit('started');
    } catch (err) {
      const logTail = this.serverLogs.slice(-5).join(' | ');
      await this.stop();
      throw new Error(logTail ? `${err.message} (${logTail})` : err.message);
    }
  }

  _attachParsers(initialVideoRemainder) {
    const videoParser = new proto.ScrcpyVideoParser({
      onDeviceMeta: (deviceName) => {
        this.deviceName = deviceName;
        this.broadcastJson({
          type: 'meta',
          deviceName: this.deviceName,
          videoCodec: this.videoCodec,
          audioCodec: this.audioCodec,
          width: this.width,
          height: this.height,
          displayPowerOn: this.displayPowerOn,
          options: this.options,
        });
      },
      onVideoCodec: (codec) => {
        this.videoCodec = codec;
        this.broadcastJson({
          type: 'meta',
          deviceName: this.deviceName,
          videoCodec: this.videoCodec,
          audioCodec: this.audioCodec,
          width: this.width,
          height: this.height,
          displayPowerOn: this.displayPowerOn,
          options: this.options,
        });
      },
      onSessionMeta: ({ width, height }) => {
        this.width = width;
        this.height = height;
        this.lastVideoKeyFrame = null;
        this.broadcastJson({
          type: 'meta',
          deviceName: this.deviceName,
          videoCodec: this.videoCodec,
          audioCodec: this.audioCodec,
          width: this.width,
          height: this.height,
          displayPowerOn: this.displayPowerOn,
          options: this.options,
        });
      },
      onVideoPacket: ({ isConfig, isKeyFrame, pts, data }) => {
        const flags = (isConfig ? 1 : 0) | (isKeyFrame ? 2 : 0);
        const frame = packWsMediaFrame(WS_FRAME_VIDEO, flags, pts, data);
        this.bytesSentSec += frame.length;
        if (!isConfig) this.framesSec += 1;

        if (isConfig) {
          this.lastVideoConfigFrame = frame;
        } else if (isKeyFrame) {
          this.lastVideoKeyFrame = frame;
        }

        this.broadcastBinary(frame, { isVideo: true, critical: isConfig || isKeyFrame });
      },
      onStreamDisabled: (isError) => {
        this.broadcastJson({
          type: 'error',
          message: isError ? 'Lỗi bộ mã hóa video trên điện thoại.' : 'Luồng video bị tắt.',
        });
      },
      onError: (err) => {
        this.broadcastJson({ type: 'error', message: err.message });
      },
    });

    if (initialVideoRemainder && initialVideoRemainder.length > 0) {
      videoParser.feed(initialVideoRemainder);
    }

    this.videoSocket.on('data', (chunk) => videoParser.feed(chunk));
    this.videoSocket.on('error', () => {});
    this.videoSocket.on('close', () => {
      if (this.state === 'running') this.stop();
    });

    if (this.audioSocket) {
      const audioParser = new proto.ScrcpyAudioParser({
        onAudioCodec: (codec) => {
          this.audioCodec = codec;
          this.broadcastJson({ type: 'audio_meta', codec });
        },
        onStreamDisabled: () => {
          this.audioCodec = null;
          this.broadcastJson({ type: 'audio_meta', codec: null, disabled: true });
        },
        onAudioPacket: ({ isConfig, pts, data }) => {
          const flags = isConfig ? 1 : 0;
          const frame = packWsMediaFrame(WS_FRAME_AUDIO, flags, pts, data);
          if (isConfig) this.lastAudioConfigFrame = frame;
          this.broadcastBinary(frame, { isVideo: false, critical: isConfig });
        },
      });
      this.audioSocket.on('data', (chunk) => audioParser.feed(chunk));
      this.audioSocket.on('error', () => {});
    }

    if (this.controlSocket) {
      const deviceMsgParser = new proto.ScrcpyDeviceMessageParser({
        onClipboard: (text) => {
          this.lastClipboard = text;
          this.broadcastJson({ type: 'clipboard', text });
        },
      });
      this.controlSocket.on('data', (chunk) => deviceMsgParser.feed(chunk));
      this.controlSocket.on('error', () => {});
    }
  }

  addClient(ws) {
    if (this.idleDestroyTimer) {
      clearTimeout(this.idleDestroyTimer);
      this.idleDestroyTimer = null;
    }
    ws._awaitingVideoKeyFrame = false;
    this.clients.add(ws);

    // Replay current metadata & SPS/PPS + last keyframe so the client paints immediately
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'meta',
        deviceName: this.deviceName,
        videoCodec: this.videoCodec,
        audioCodec: this.audioCodec,
        width: this.width,
        height: this.height,
        displayPowerOn: this.displayPowerOn,
        options: this.options,
      }));
      if (this.lastVideoConfigFrame) ws.send(this.lastVideoConfigFrame);
      if (this.lastVideoKeyFrame) ws.send(this.lastVideoKeyFrame);
      if (this.lastAudioConfigFrame) ws.send(this.lastAudioConfigFrame);
      if (this.lastClipboard) {
        ws.send(JSON.stringify({ type: 'clipboard', text: this.lastClipboard }));
      }
    }
  }

  removeClient(ws) {
    this.clients.delete(ws);
    if (this.clients.size === 0 && this.state === 'running') {
      // Keep session warm for 15 seconds for fast reload/CLI reuse, then clean up
      this.idleDestroyTimer = setTimeout(() => {
        if (this.clients.size === 0) {
          this.stop();
        }
      }, 15000);
    }
  }

  broadcastJson(obj) {
    const str = JSON.stringify(obj);
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        ws.send(str);
      }
    }
  }

  broadcastBinary(buf, opts = {}) {
    const isVideo = typeof opts === 'object' ? Boolean(opts.isVideo) : false;
    const critical = typeof opts === 'object' ? Boolean(opts.critical) : Boolean(opts);
    let needResetVideo = false;
    for (const ws of this.clients) {
      if (ws.readyState !== 1) continue;
      if (isVideo) {
        if (critical) {
          ws._awaitingVideoKeyFrame = false;
        } else {
          // Never send orphaned P-frames after a drop — causes severe H.264 smearing/streaking!
          if (ws._awaitingVideoKeyFrame) continue;
          if (ws.bufferedAmount > 2 * 1024 * 1024) {
            ws._awaitingVideoKeyFrame = true;
            needResetVideo = true;
            continue;
          }
        }
      } else if (!critical && ws.bufferedAmount > 2 * 1024 * 1024) {
        continue;
      }
      ws.send(buf);
    }
    if (needResetVideo) {
      const now = Date.now();
      if (!this._lastBackpressureResetAt || now - this._lastBackpressureResetAt > 1500) {
        this._lastBackpressureResetAt = now;
        this.resetVideo();
      }
    }
  }

  writeControlRaw(buffer) {
    if (this.controlSocket && !this.controlSocket.destroyed) {
      this.controlSocket.write(buffer);
      return true;
    }
    return false;
  }

  // ---- High-level ultra-fast control helpers (used by Web UI, REST API & CLI) ----

  async tap(x, y) {
    if (!this.width || !this.height) return false;
    const down = proto.serializeInjectTouchEvent({
      action: proto.MOTION_ACTION.DOWN,
      pointerId: proto.POINTER_ID_GENERIC_FINGER,
      x,
      y,
      screenWidth: this.width,
      screenHeight: this.height,
      pressure: 1.0,
    });
    const up = proto.serializeInjectTouchEvent({
      action: proto.MOTION_ACTION.UP,
      pointerId: proto.POINTER_ID_GENERIC_FINGER,
      x,
      y,
      screenWidth: this.width,
      screenHeight: this.height,
      pressure: 0.0,
    });
    this.writeControlRaw(down);
    await new Promise((r) => setTimeout(r, 25));
    this.writeControlRaw(up);
    return true;
  }

  async swipe(x1, y1, x2, y2, durationMs = 260) {
    if (!this.width || !this.height) return false;
    const steps = Math.max(4, Math.min(30, Math.round(durationMs / 16)));
    const stepDelay = Math.max(8, Math.round(durationMs / steps));

    this.writeControlRaw(proto.serializeInjectTouchEvent({
      action: proto.MOTION_ACTION.DOWN,
      pointerId: proto.POINTER_ID_GENERIC_FINGER,
      x: x1,
      y: y1,
      screenWidth: this.width,
      screenHeight: this.height,
      pressure: 1.0,
    }));

    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, stepDelay));
      const t = i / steps;
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      this.writeControlRaw(proto.serializeInjectTouchEvent({
        action: proto.MOTION_ACTION.MOVE,
        pointerId: proto.POINTER_ID_GENERIC_FINGER,
        x: cx,
        y: cy,
        screenWidth: this.width,
        screenHeight: this.height,
        pressure: 1.0,
      }));
    }

    this.writeControlRaw(proto.serializeInjectTouchEvent({
      action: proto.MOTION_ACTION.UP,
      pointerId: proto.POINTER_ID_GENERIC_FINGER,
      x: x2,
      y: y2,
      screenWidth: this.width,
      screenHeight: this.height,
      pressure: 0.0,
    }));
    return true;
  }

  pressKey(keycode, metaState = 0) {
    const down = proto.serializeInjectKeycode(proto.KEY_ACTION.DOWN, keycode, 0, metaState);
    const up = proto.serializeInjectKeycode(proto.KEY_ACTION.UP, keycode, 0, metaState);
    return this.writeControlRaw(Buffer.concat([down, up]));
  }

  injectText(text) {
    const str = String(text || '');
    // Pure printable ASCII goes via fast INJECT_TEXT; Vietnamese/Unicode uses SET_CLIPBOARD + paste!
    if (/^[\x20-\x7e]*$/.test(str) && str.length <= 300) {
      return this.writeControlRaw(proto.serializeInjectText(str));
    }
    return this.setClipboard(str, true);
  }

  setClipboard(text, paste = false) {
    this.lastClipboard = String(text || '');
    const seq = this.clipboardSeq++;
    return this.writeControlRaw(proto.serializeSetClipboard(this.lastClipboard, paste, seq));
  }

  setDisplayPower(on) {
    this.displayPowerOn = Boolean(on);
    const ok = this.writeControlRaw(proto.serializeSetDisplayPower(this.displayPowerOn));
    this.broadcastJson({ type: 'display_power', on: this.displayPowerOn });
    return ok;
  }

  rotateDevice() {
    return this.writeControlRaw(proto.serializeEmpty(proto.CONTROL_MSG_TYPE.ROTATE_DEVICE));
  }

  expandNotifications() {
    return this.writeControlRaw(proto.serializeEmpty(proto.CONTROL_MSG_TYPE.EXPAND_NOTIFICATION_PANEL));
  }

  expandSettings() {
    return this.writeControlRaw(proto.serializeEmpty(proto.CONTROL_MSG_TYPE.EXPAND_SETTINGS_PANEL));
  }

  collapsePanels() {
    return this.writeControlRaw(proto.serializeEmpty(proto.CONTROL_MSG_TYPE.COLLAPSE_PANELS));
  }

  backOrScreenOn() {
    const down = proto.serializeBackOrScreenOn(proto.KEY_ACTION.DOWN);
    const up = proto.serializeBackOrScreenOn(proto.KEY_ACTION.UP);
    return this.writeControlRaw(Buffer.concat([down, up]));
  }

  resetVideo() {
    return this.writeControlRaw(proto.serializeEmpty(proto.CONTROL_MSG_TYPE.RESET_VIDEO));
  }

  startApp(name) {
    return this.writeControlRaw(proto.serializeStartApp(name));
  }

  async stop() {
    if (this.state === 'stopped') return;
    this.state = 'stopped';

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.idleDestroyTimer) {
      clearTimeout(this.idleDestroyTimer);
      this.idleDestroyTimer = null;
    }

    try { this.videoSocket?.destroy(); } catch {}
    try { this.audioSocket?.destroy(); } catch {}
    try { this.controlSocket?.destroy(); } catch {}
    this.videoSocket = null;
    this.audioSocket = null;
    this.controlSocket = null;

    if (this.serverProc) {
      try { this.serverProc.kill('SIGTERM'); } catch {}
      this.serverProc = null;
    }

    if (this.localPort) {
      const port = this.localPort;
      this.localPort = null;
      try { await adb.removeForward(this.serial, port); } catch {}
    }

    this.emit('stopped');
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map(); // serial -> ScrcpySession
  }

  get(serial) {
    const s = this.sessions.get(serial);
    return s && s.state !== 'stopped' ? s : null;
  }

  async getOrCreate(serial, options = {}, forceRestart = false) {
    let existing = this.get(serial);

    if (existing && forceRestart) {
      await existing.stop();
      this.sessions.delete(serial);
      existing = null;
    }

    if (existing) {
      if (existing.state === 'starting') {
        await new Promise((resolve, reject) => {
          existing.once('started', resolve);
          existing.once('stopped', () => reject(new Error('Phiên khởi động thất bại')));
        });
      }
      return existing;
    }

    const session = new ScrcpySession(serial, options);
    this.sessions.set(serial, session);
    session.once('stopped', () => {
      if (this.sessions.get(serial) === session) {
        this.sessions.delete(serial);
      }
    });

    await session.start();
    return session;
  }

  async stopAll() {
    const list = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.all(list.map((s) => s.stop()));
  }

  listInfos() {
    const out = {};
    for (const [serial, s] of this.sessions.entries()) {
      if (s.state !== 'stopped') out[serial] = s.getInfo();
    }
    return out;
  }
}

module.exports = {
  ScrcpySession,
  SessionManager,
  LOCAL_SERVER_PATH,
};

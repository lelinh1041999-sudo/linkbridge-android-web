import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { ReadableStream } from '@yume-chan/stream-extra';

const SCRCPY_VERSION = '5.0.1';
const REMOTE_SERVER_PATH = '/data/local/tmp/scrcpy-server';

/**
 * Browser-native Uint8Array accumulator for parsing exact scrcpy v5.0.1 binary packets.
 */
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (!chunk || chunk.byteLength === 0) return;
    this.chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    this.length += chunk.byteLength;
  }

  consume(n) {
    if (this.length < n) return null;
    if (this.chunks.length === 1) {
      const first = this.chunks[0];
      if (first.byteLength === n) {
        this.chunks.length = 0;
        this.length = 0;
        return first;
      }
      const out = first.subarray(0, n);
      this.chunks[0] = first.subarray(n);
      this.length -= n;
      return out;
    }
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.chunks[0];
      const need = n - offset;
      if (head.byteLength <= need) {
        out.set(head, offset);
        offset += head.byteLength;
        this.chunks.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        this.chunks[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }
}

function readU32(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function readI32(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, false);
}

function readU64(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
}

function codecIdToName(id) {
  switch (id) {
    case 0x68323634: return 'h264';
    case 0x68323635: return 'h265';
    case 0x00617631: return 'av1';
    case 0x6f707573: return 'opus';
    default: return `0x${id.toString(16)}`;
  }
}

class BrowserVideoParser {
  constructor(cb) {
    this.cb = cb;
    this.q = new ByteQueue();
    this.state = 'DEVICE_META';
    this.pending = null;
  }

  feed(chunk) {
    this.q.push(chunk);
    while (true) {
      if (this.state === 'DEVICE_META') {
        const b = this.q.consume(64);
        if (!b) return;
        const nul = b.indexOf(0);
        const name = new TextDecoder().decode(nul === -1 ? b : b.subarray(0, nul));
        this.cb.onDeviceMeta?.(name);
        this.state = 'CODEC';
        continue;
      }
      if (this.state === 'CODEC') {
        const b = this.q.consume(4);
        if (!b) return;
        const id = readU32(b, 0);
        if (id === 0 || id === 1) {
          this.cb.onError?.('Luồng video trên điện thoại bị tắt hoặc lỗi encoder.');
          return;
        }
        this.cb.onCodec?.(codecIdToName(id));
        this.state = 'HDR';
        continue;
      }
      if (this.state === 'HDR') {
        const hdr = this.q.consume(12);
        if (!hdr) return;
        const b0 = hdr[0];
        if ((b0 & 0x80) !== 0) {
          const width = readI32(hdr, 4);
          const height = readI32(hdr, 8);
          this.cb.onSessionMeta?.({ width, height });
          continue;
        }
        const isConfig = (b0 & 0x40) !== 0;
        const isKeyFrame = (b0 & 0x20) !== 0;
        const pts = Number(readU64(hdr, 0) & 0x1fffffffffffffffn);
        const size = readU32(hdr, 8);
        this.pending = { isConfig, isKeyFrame, pts, size };
        this.state = 'DATA';
        continue;
      }
      if (this.state === 'DATA') {
        const { isConfig, isKeyFrame, pts, size } = this.pending;
        const payload = this.q.consume(size);
        if (!payload) return;
        this.pending = null;
        this.state = 'HDR';
        this.cb.onPacket?.({ isConfig, isKeyFrame, pts, payload });
      }
    }
  }
}

class BrowserAudioParser {
  constructor(cb) {
    this.cb = cb;
    this.q = new ByteQueue();
    this.state = 'CODEC';
    this.pending = null;
  }

  feed(chunk) {
    this.q.push(chunk);
    while (true) {
      if (this.state === 'CODEC') {
        const b = this.q.consume(4);
        if (!b) return;
        const id = readU32(b, 0);
        if (id === 0 || id === 1) {
          this.state = 'DISABLED';
          this.cb.onDisabled?.();
          return;
        }
        this.cb.onCodec?.(codecIdToName(id));
        this.state = 'HDR';
        continue;
      }
      if (this.state === 'DISABLED') return;
      if (this.state === 'HDR') {
        const hdr = this.q.consume(12);
        if (!hdr) return;
        const isConfig = (hdr[0] & 0x40) !== 0;
        const pts = Number(readU64(hdr, 0) & 0x1fffffffffffffffn);
        const size = readU32(hdr, 8);
        this.pending = { isConfig, pts, size };
        this.state = 'DATA';
        continue;
      }
      if (this.state === 'DATA') {
        const { isConfig, pts, size } = this.pending;
        const payload = this.q.consume(size);
        if (!payload) return;
        this.pending = null;
        this.state = 'HDR';
        this.cb.onPacket?.({ isConfig, pts, payload });
      }
    }
  }
}

class BrowserDeviceMsgParser {
  constructor(cb) {
    this.cb = cb;
    this.q = new ByteQueue();
    this.state = 'TYPE';
    this.len = 0;
  }

  feed(chunk) {
    this.q.push(chunk);
    while (true) {
      if (this.state === 'TYPE') {
        const b = this.q.consume(1);
        if (!b) return;
        if (b[0] === 0) this.state = 'CLIP_LEN';
        else if (b[0] === 1) this.state = 'ACK_SEQ';
        else if (b[0] === 2) this.state = 'UHID_HDR';
        else return;
        continue;
      }
      if (this.state === 'CLIP_LEN') {
        const b = this.q.consume(4);
        if (!b) return;
        this.len = readU32(b, 0);
        this.state = 'CLIP_DATA';
        continue;
      }
      if (this.state === 'CLIP_DATA') {
        const b = this.q.consume(this.len);
        if (!b) return;
        this.state = 'TYPE';
        this.cb.onClipboard?.(new TextDecoder().decode(b));
        continue;
      }
      if (this.state === 'ACK_SEQ') {
        const b = this.q.consume(8);
        if (!b) return;
        this.state = 'TYPE';
        continue;
      }
      if (this.state === 'UHID_HDR') {
        const b = this.q.consume(4);
        if (!b) return;
        const dv = new DataView(b.buffer, b.byteOffset, 4);
        this.len = dv.getUint16(2, false);
        this.state = 'UHID_DATA';
        continue;
      }
      if (this.state === 'UHID_DATA') {
        const b = this.q.consume(this.len);
        if (!b) return;
        this.state = 'TYPE';
      }
    }
  }
}

// Control message helpers for WebUSB direct path
function makeSetClipboard(text, paste = false, seq = 1n) {
  const encoded = new TextEncoder().encode(String(text || ''));
  const out = new Uint8Array(14 + encoded.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, 9);
  v.setBigInt64(1, seq, false);
  v.setUint8(9, paste ? 1 : 0);
  v.setUint32(10, encoded.length, false);
  out.set(encoded, 14);
  return out;
}

function makeKeycode(action, keycode, metaState = 0) {
  const out = new Uint8Array(14);
  const v = new DataView(out.buffer);
  v.setUint8(0, 0);
  v.setUint8(1, action & 0xff);
  v.setInt32(2, keycode | 0, false);
  v.setInt32(6, 0, false);
  v.setInt32(10, metaState | 0, false);
  return out;
}

function makeStartApp(pkg) {
  const encoded = new TextEncoder().encode(String(pkg || '')).subarray(0, 255);
  const out = new Uint8Array(2 + encoded.length);
  out[0] = 16;
  out[1] = encoded.length;
  out.set(encoded, 2);
  return out;
}

const KEY_MAP = {
  HOME: 3, BACK: 4, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26,
  TAB: 61, SPACE: 62, ENTER: 66, BACKSPACE: 67, DEL: 67, ESCAPE: 111,
  DELETE: 112, APP_SWITCH: 187, RECENTS: 187, SLEEP: 223, WAKEUP: 224,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22,
};

function resolveKey(k) {
  if (typeof k === 'number') return k;
  const s = String(k || '').trim().toUpperCase().replace(/^KEYCODE_/, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return KEY_MAP[s] ?? 0;
}

let cachedServerBinary = null;

async function fetchScrcpyServerBinary() {
  if (cachedServerBinary) return cachedServerBinary;
  const res = await fetch('./scrcpy-server');
  if (!res.ok) {
    throw new Error(`Không tải được ./scrcpy-server (HTTP ${res.status})`);
  }
  cachedServerBinary = new Uint8Array(await res.arrayBuffer());
  return cachedServerBinary;
}

export class WebUsbScrcpyDriver {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.credentialStore = new AdbWebCredentialStore('LinhBridge');
    this.usbDevice = null;
    this.adb = null;
    this.serverProcess = null;
    this.videoSocket = null;
    this.audioSocket = null;
    this.controlSocket = null;
    this.controlWriter = null;
    this.controlQueue = Promise.resolve();

    this.deviceName = '';
    this.serial = '';
    this.width = 0;
    this.height = 0;
    this.displayPowerOn = true;
    this.clipboardSeq = 1n;
    this.bytesSec = 0;
    this.statsTimer = null;
    this.stopped = false;
  }

  static isSupported() {
    return Boolean(typeof navigator !== 'undefined' && navigator.usb && AdbDaemonWebUsbDeviceManager.BROWSER);
  }

  async connect(options = {}, reuseDevice = null) {
    if (!WebUsbScrcpyDriver.isSupported()) {
      throw new Error('Trình duyệt không hỗ trợ WebUSB. Hãy mở bằng Chrome / Edge trên máy tính hoặc Chromebook.');
    }

    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    this.stopped = false;

    this.cb.onStatus?.('connecting', 'Chọn Samsung S26 trong hộp thoại USB của Chrome...');
    const device = reuseDevice || (await manager.requestDevice());
    if (!device) {
      throw new Error('Bạn đã hủy chọn thiết bị USB.');
    }
    this.usbDevice = device;
    this.serial = device.serial || 'webusb';

    this.cb.onStatus?.('connecting', 'Đang xác thực ADB — hãy bấm "Cho phép (Allow)" trên điện thoại nếu thấy hộp thoại!');

    let connection;
    try {
      connection = await device.connect();
    } catch (err) {
      if (err?.name === 'DeviceBusyError' || /busy|claim/i.test(String(err?.message))) {
        throw new Error(
          'Cổng USB đang bị chương trình khác chiếm (ví dụ adb trên Linux Crostini). Hãy rút cắm lại cáp hoặc tắt kết nối USB với Linux rồi thử lại.'
        );
      }
      throw err;
    }

    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: this.credentialStore,
    });
    this.adb = new Adb(transport);

    this.adb.disconnected.then(() => {
      if (!this.stopped) {
        this.cb.onStatus?.('disconnected', 'Thiết bị USB đã ngắt kết nối.');
        this.disconnect();
      }
    });

    await this.startStream(options);
    return { serial: this.serial, name: device.name || this.deviceName || 'Android USB' };
  }

  async startStream(options = {}) {
    if (!this.adb) throw new Error('Chưa kết nối ADB qua WebUSB.');
    await this.stopStreamOnly();
    this.stopped = false;

    const parsedMaxSize = Number(options.maxSize);
    const opts = {
      maxSize: options.maxSize !== undefined && options.maxSize !== null && !Number.isNaN(parsedMaxSize) ? parsedMaxSize : 1080,
      bitRate: Number(options.bitRate) || 8_000_000,
      maxFps: Number(options.maxFps) || 60,
      audio: options.audio !== false,
      audioDup: Boolean(options.audioDup),
      stayAwake: Boolean(options.stayAwake),
      turnScreenOff: Boolean(options.turnScreenOff),
      videoCodec: options.videoCodec || 'h264',
      newDisplay: typeof options.newDisplay === 'string' && /^\d{3,4}x\d{3,4}(\/\d{2,3})?$/.test(options.newDisplay.trim())
        ? options.newDisplay.trim()
        : '',
    };

    // 1. Push scrcpy-server v5.0.1 if missing or size differs
    this.cb.onStatus?.('connecting', 'Đang nạp scrcpy-server v5.0.1 lên điện thoại qua USB...');
    const serverBytes = await fetchScrcpyServerBinary();
    const remoteSizeStr = await this.adb.subprocess.noneProtocol
      .spawnWaitText(`stat -c %s ${REMOTE_SERVER_PATH} 2>/dev/null || echo 0`)
      .catch(() => '0');

    if (parseInt(remoteSizeStr.trim(), 10) !== serverBytes.byteLength) {
      const sync = await this.adb.sync();
      try {
        const chunkSize = 64 * 1024;
        const stream = new ReadableStream({
          start(controller) {
            for (let off = 0; off < serverBytes.byteLength; off += chunkSize) {
              controller.enqueue(serverBytes.subarray(off, Math.min(off + chunkSize, serverBytes.byteLength)));
            }
            controller.close();
          },
        });
        await sync.write({ filename: REMOTE_SERVER_PATH, file: stream, permission: 0o644 });
      } finally {
        await sync.dispose();
      }
    }

    // 2. Launch scrcpy-server v5.0.1
    this.cb.onStatus?.('connecting', 'Đang khởi chạy bộ mã hóa H.264 phần cứng trên điện thoại...');
    const scidInt = (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0;
    const scidHex = scidInt.toString(16).padStart(8, '0');
    const socketAddr = `localabstract:scrcpy_${scidHex}`;

    const cmd = [
      `CLASSPATH=${REMOTE_SERVER_PATH}`,
      'app_process / com.genymobile.scrcpy.Server',
      SCRCPY_VERSION,
      `scid=${scidHex}`,
      'log_level=info',
      'tunnel_forward=true',
      'video=true',
      `audio=${opts.audio ? 'true' : 'false'}`,
      ...(opts.audio && opts.audioDup ? ['audio_dup=true'] : []),
      'control=true',
      `video_codec=${opts.videoCodec}`,
      'audio_codec=opus',
      'audio_bit_rate=256000',
      `max_size=${opts.newDisplay ? 0 : opts.maxSize}`,
      `video_bit_rate=${opts.bitRate}`,
      `max_fps=${opts.maxFps}`,
      'video_codec_options=i-frame-interval=2',
      `stay_awake=${opts.stayAwake ? 'true' : 'false'}`,
      'power_on=true',
      'clipboard_autosync=true',
      'send_dummy_byte=true',
      'send_device_meta=true',
      'send_stream_meta=true',
      'send_frame_meta=true',
      'cleanup=true',
      ...(opts.newDisplay ? [`new_display=${opts.newDisplay}`, 'vd_destroy_content=false'] : []),
    ].join(' ');

    this.serverProcess = await this.adb.subprocess.noneProtocol.spawn(cmd);
    // Drain stdout/stderr in background so process never blocks
    this._drainProcessOutput(this.serverProcess);

    // 3. Connect Video socket (retry until dummy byte received)
    const { socket: videoSock, reader: videoReader, remainder } = await this._connectVideoWithRetry(socketAddr);
    this.videoSocket = videoSock;

    // 4. Connect Audio socket (if enabled)
    if (opts.audio) {
      this.audioSocket = await this.adb.createSocket(socketAddr);
    }

    // 5. Connect Control socket
    this.controlSocket = await this.adb.createSocket(socketAddr);
    this.controlWriter = this.controlSocket.writable.getWriter();

    this.displayPowerOn = !opts.turnScreenOff;
    this.cb.onStatus?.('connected', 'Đã kết nối trực tiếp qua WebUSB!');

    // 6. Start reading video, audio, and device messages
    this._pumpVideo(videoReader, remainder);
    if (this.audioSocket) this._pumpAudio(this.audioSocket);
    this._pumpControl(this.controlSocket);

    if (opts.turnScreenOff) {
      setTimeout(() => {
        if (!this.stopped) this.sendJson({ type: 'display_power', on: false });
      }, 350);
    }

    this.statsTimer = setInterval(() => {
      const mbps = Number(((this.bytesSec * 8) / 1_000_000).toFixed(2));
      this.bytesSec = 0;
      this.cb.onServerStats?.({
        mbps,
        width: this.width,
        height: this.height,
        displayPowerOn: this.displayPowerOn,
      });
    }, 1000);
  }

  async _drainProcessOutput(proc) {
    try {
      const reader = proc.output.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
  }

  async _connectVideoWithRetry(socketAddr, maxAttempts = 50) {
    let lastErr = null;
    for (let i = 0; i < maxAttempts; i++) {
      if (this.stopped) throw new Error('Đã hủy kết nối.');
      let sock = null;
      try {
        sock = await this.adb.createSocket(socketAddr);
        const reader = sock.readable.getReader();
        const { value, done } = await reader.read();
        if (!done && value && value.byteLength > 0) {
          const remainder = value.byteLength > 1 ? value.subarray(1) : null;
          return { socket: sock, reader, remainder };
        }
        try { reader.releaseLock(); } catch {}
        try { await sock.close(); } catch {}
      } catch (err) {
        lastErr = err;
        if (sock) try { await sock.close(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 85));
    }
    throw lastErr || new Error('Không kết nối được tới scrcpy-server qua WebUSB.');
  }

  async _pumpVideo(reader, remainder) {
    const parser = new BrowserVideoParser({
      onDeviceMeta: (name) => {
        this.deviceName = name;
        this.cb.onMeta?.({
          deviceName: name,
          width: this.width,
          height: this.height,
          displayPowerOn: this.displayPowerOn,
        });
      },
      onSessionMeta: ({ width, height }) => {
        this.width = width;
        this.height = height;
        this.cb.onMeta?.({
          deviceName: this.deviceName,
          width,
          height,
          displayPowerOn: this.displayPowerOn,
        });
      },
      onPacket: ({ isConfig, isKeyFrame, pts, payload }) => {
        this.bytesSec += payload.byteLength;
        const flags = (isConfig ? 1 : 0) | (isKeyFrame ? 2 : 0);
        this.cb.onVideoPacket?.(flags, pts, payload);
      },
      onError: (msg) => this.cb.onError?.(msg),
    });

    if (remainder) parser.feed(remainder);

    try {
      while (!this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parser.feed(value);
      }
    } catch {}
    try { reader.releaseLock(); } catch {}
  }

  async _pumpAudio(socket) {
    const reader = socket.readable.getReader();
    const parser = new BrowserAudioParser({
      onPacket: ({ isConfig, pts, payload }) => {
        this.cb.onAudioPacket?.(isConfig ? 1 : 0, pts, payload);
      },
    });
    try {
      while (!this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parser.feed(value);
      }
    } catch {}
    try { reader.releaseLock(); } catch {}
  }

  async _pumpControl(socket) {
    const reader = socket.readable.getReader();
    const parser = new BrowserDeviceMsgParser({
      onClipboard: (text) => this.cb.onClipboard?.(text),
    });
    try {
      while (!this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parser.feed(value);
      }
    } catch {}
    try { reader.releaseLock(); } catch {}
  }

  sendBinary(buffer) {
    if (!this.controlWriter || this.stopped) return false;
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.controlQueue = this.controlQueue
      .then(() => this.controlWriter?.write(bytes))
      .catch(() => {});
    return true;
  }

  sendJson(msg) {
    switch (msg.type) {
      case 'key': {
        const kc = resolveKey(msg.keycode);
        if (!kc) return false;
        this.sendBinary(makeKeycode(0, kc, msg.metaState || 0));
        return this.sendBinary(makeKeycode(1, kc, msg.metaState || 0));
      }
      case 'clipboard': {
        const seq = this.clipboardSeq++;
        return this.sendBinary(makeSetClipboard(msg.text || '', Boolean(msg.paste), seq));
      }
      case 'display_power': {
        this.displayPowerOn = Boolean(msg.on);
        this.cb.onDisplayPower?.(this.displayPowerOn);
        return this.sendBinary(new Uint8Array([10, this.displayPowerOn ? 1 : 0]));
      }
      case 'rotate':
        return this.sendBinary(new Uint8Array([11]));
      case 'expand_notifications':
        return this.sendBinary(new Uint8Array([5]));
      case 'expand_settings':
        return this.sendBinary(new Uint8Array([6]));
      case 'collapse_panels':
        return this.sendBinary(new Uint8Array([7]));
      case 'back_or_screen_on':
        this.sendBinary(new Uint8Array([4, 0]));
        return this.sendBinary(new Uint8Array([4, 1]));
      case 'reset_video':
        return this.sendBinary(new Uint8Array([17]));
      case 'start_app':
        return this.sendBinary(makeStartApp(msg.package));
      default:
        return false;
    }
  }

  async runShell(command) {
    if (!this.adb) throw new Error('Chưa kết nối WebUSB.');
    const t0 = performance.now();
    const stdout = await this.adb.subprocess.noneProtocol.spawnWaitText(command);
    return { ok: true, stdout, stderr: '', durationMs: Math.round(performance.now() - t0) };
  }

  async listApps() {
    const cmd = 'pm list packages -3; pm list packages -s | grep -E "(samsung|android\\.settings|android\\.vending|google\\.android\\.youtube|google\\.android\\.gm|google\\.android\\.apps\\.maps|android\\.chrome|sec\\.android\\.app\\.camera|sec\\.android\\.gallery3d)"';
    const { stdout } = await this.runShell(cmd);
    const seen = new Set();
    const apps = [];
    for (const line of stdout.split('\n')) {
      const pkg = line.trim().replace(/^package:/, '');
      if (!pkg || seen.has(pkg)) continue;
      seen.add(pkg);
      const last = pkg.split('.').pop() || pkg;
      apps.push({ package: pkg, label: last.charAt(0).toUpperCase() + last.slice(1) });
    }
    apps.sort((a, b) => a.label.localeCompare(b.label));
    return apps;
  }

  async takeScreenshotBlob() {
    if (!this.adb) throw new Error('Chưa kết nối WebUSB.');
    const sock = await this.adb.createSocket('exec:screencap -p');
    const reader = sock.readable.getReader();
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
      try { await sock.close(); } catch {}
    }
    return new Blob(chunks, { type: 'image/png' });
  }

  async pushFile(name, bytes) {
    if (!this.adb) throw new Error('Chưa kết nối WebUSB.');
    const safeName = String(name || `file-${Date.now()}.bin`)
      .replace(/[\x00-\x1f/\\:*?"<>|]/g, '_')
      .trim() || `file-${Date.now()}.bin`;
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const isApk = safeName.toLowerCase().endsWith('.apk');
    const remotePath = isApk ? `/data/local/tmp/${safeName}` : `/sdcard/Download/${safeName}`;

    const sync = await this.adb.sync();
    try {
      const stream = new ReadableStream({
        start(controller) {
          const CHUNK = 65536;
          for (let off = 0; off < data.byteLength; off += CHUNK) {
            controller.enqueue(data.subarray(off, Math.min(off + CHUNK, data.byteLength)));
          }
          controller.close();
        },
      });
      await sync.write({ filename: remotePath, file: stream, permission: 0o644 });
    } finally {
      await sync.dispose();
    }

    const escapedPath = remotePath.replace(/"/g, '\\"');
    if (isApk) {
      const res = await this.runShell(`pm install -r "${escapedPath}"; rm -f "${escapedPath}"`);
      if (!/Success/i.test(res.stdout || '')) {
        throw new Error(`Cài APK thất bại: ${(res.stdout || '').trim() || 'Lỗi không xác định'}`);
      }
      return { ok: true, name: safeName, remotePath, size: data.byteLength, installed: true };
    }

    // Trigger Android MediaStore scan so pasted/dropped photos appear immediately in Gallery / Zalo / Messenger
    this.runShell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${escapedPath}"`).catch(() => {});
    return { ok: true, name: safeName, remotePath, size: data.byteLength, installed: false };
  }

  async listFiles(dirKey = 'camera') {
    if (!this.adb) throw new Error('Chưa kết nối WebUSB.');
    const dirs = {
      camera: '/sdcard/DCIM/Camera',
      screenshots: '/sdcard/DCIM/Screenshots',
      downloads: '/sdcard/Download',
    };
    const dir = dirs[String(dirKey).toLowerCase()] || dirs.camera;
    const cmd = `cd "${dir}" 2>/dev/null && ls -1t 2>/dev/null | head -n 45 | while IFS= read -r f; do [ -f "$f" ] && stat -c '%Y|%s|%n' "$f" 2>/dev/null; done`;
    const { stdout } = await this.runShell(cmd);
    const files = [];
    for (const line of (stdout || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const b1 = trimmed.indexOf('|');
      const b2 = trimmed.indexOf('|', b1 + 1);
      if (b1 < 0 || b2 < 0) continue;
      const mtime = Number(trimmed.slice(0, b1)) || 0;
      const size = Number(trimmed.slice(b1 + 1, b2)) || 0;
      const name = trimmed.slice(b2 + 1);
      if (!name || name.startsWith('.')) continue;
      files.push({ name, path: `${dir}/${name}`, size, mtime });
    }
    return { ok: true, dir: dirKey, remoteDir: dir, files: files.slice(0, 40) };
  }

  async pullFileBlob(remotePath) {
    if (!this.adb) throw new Error('Chưa kết nối WebUSB.');
    if (!remotePath || !remotePath.startsWith('/sdcard/') || remotePath.includes('..')) {
      throw new Error('Đường dẫn file không hợp lệ.');
    }
    const sync = await this.adb.sync();
    const chunks = [];
    try {
      const reader = sync.read(remotePath).getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    } finally {
      await sync.dispose();
    }
    return new Blob(chunks, { type: 'application/octet-stream' });
  }

  async stopStreamOnly() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    try { this.controlWriter?.releaseLock(); } catch {}
    this.controlWriter = null;
    try { await this.videoSocket?.close(); } catch {}
    try { await this.audioSocket?.close(); } catch {}
    try { await this.controlSocket?.close(); } catch {}
    this.videoSocket = null;
    this.audioSocket = null;
    this.controlSocket = null;
    try { await this.serverProcess?.kill(); } catch {}
    this.serverProcess = null;
  }

  async disconnect() {
    this.stopped = true;
    await this.stopStreamOnly();
    try { await this.adb?.close(); } catch {}
    this.adb = null;
    this.usbDevice = null;
  }
}

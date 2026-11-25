'use strict';

/**
 * Byte-exact scrcpy v5.0.1 binary protocol encoder & stateful TCP stream parsers.
 * Verified directly against Genymobile/scrcpy tag v5.0.1:
 *   - Streamer.java
 *   - DesktopConnection.java
 *   - ControlMessage.java / ControlMessageReader.java
 *   - DeviceMessage.java / DeviceMessageWriter.java
 */

const SCRCPY_VERSION = '5.0.1';

const CONTROL_MSG_TYPE = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  START_APP: 16,
  RESET_VIDEO: 17,
};

const DEVICE_MSG_TYPE = {
  CLIPBOARD: 0,
  ACK_CLIPBOARD: 1,
  UHID_OUTPUT: 2,
};

const MOTION_ACTION = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  CANCEL: 3,
  HOVER_MOVE: 7,
};

const KEY_ACTION = {
  DOWN: 0,
  UP: 1,
};

const POINTER_ID_MOUSE = -1n; // 0xffffffffffffffffn
const POINTER_ID_GENERIC_FINGER = -2n; // 0xfffffffffffffffen

function floatToU16FixedPoint(v) {
  const clamped = Math.max(0, Math.min(1, v));
  let u = Math.round(clamped * 0x10000);
  if (u >= 0xffff) u = 0xffff;
  return u;
}

function floatToI16FixedPoint(v) {
  const clamped = Math.max(-1, Math.min(1, v));
  let i = Math.round(clamped * 0x8000);
  if (i >= 0x7fff) i = 0x7fff;
  if (i <= -0x8000) i = -0x8000;
  return i;
}

function serializeInjectKeycode(action, keycode, repeat = 0, metaState = 0) {
  const buf = Buffer.allocUnsafe(14);
  buf.writeUInt8(CONTROL_MSG_TYPE.INJECT_KEYCODE, 0);
  buf.writeUInt8(action & 0xff, 1);
  buf.writeInt32BE(keycode | 0, 2);
  buf.writeInt32BE(repeat | 0, 6);
  buf.writeInt32BE(metaState | 0, 10);
  return buf;
}

function serializeInjectText(text) {
  const textBuf = Buffer.from(String(text), 'utf8').subarray(0, 300);
  const buf = Buffer.allocUnsafe(5 + textBuf.length);
  buf.writeUInt8(CONTROL_MSG_TYPE.INJECT_TEXT, 0);
  buf.writeUInt32BE(textBuf.length, 1);
  textBuf.copy(buf, 5);
  return buf;
}

function serializeInjectTouchEvent({
  action,
  pointerId = POINTER_ID_GENERIC_FINGER,
  x,
  y,
  screenWidth,
  screenHeight,
  pressure = 1.0,
  actionButton = 0,
  buttons = 0,
}) {
  const buf = Buffer.allocUnsafe(32);
  buf.writeUInt8(CONTROL_MSG_TYPE.INJECT_TOUCH_EVENT, 0);
  buf.writeUInt8(action & 0xff, 1);
  buf.writeBigInt64BE(BigInt(pointerId), 2);
  buf.writeInt32BE(Math.round(x), 10);
  buf.writeInt32BE(Math.round(y), 14);
  buf.writeUInt16BE(screenWidth & 0xffff, 18);
  buf.writeUInt16BE(screenHeight & 0xffff, 20);
  buf.writeUInt16BE(floatToU16FixedPoint(pressure), 22);
  buf.writeInt32BE(actionButton | 0, 24);
  buf.writeInt32BE(buttons | 0, 28);
  return buf;
}

function serializeInjectScrollEvent({
  x,
  y,
  screenWidth,
  screenHeight,
  hScroll = 0,
  vScroll = 0,
  buttons = 0,
}) {
  const buf = Buffer.allocUnsafe(21);
  buf.writeUInt8(CONTROL_MSG_TYPE.INJECT_SCROLL_EVENT, 0);
  buf.writeInt32BE(Math.round(x), 1);
  buf.writeInt32BE(Math.round(y), 5);
  buf.writeUInt16BE(screenWidth & 0xffff, 9);
  buf.writeUInt16BE(screenHeight & 0xffff, 11);
  // scrcpy v3+/v5 scales i16 fixed-point [-1, 1] by 16 -> divide input range [-16, 16] by 16
  buf.writeInt16BE(floatToI16FixedPoint(hScroll / 16), 13);
  buf.writeInt16BE(floatToI16FixedPoint(vScroll / 16), 15);
  buf.writeInt32BE(buttons | 0, 17);
  return buf;
}

function serializeBackOrScreenOn(action) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt8(CONTROL_MSG_TYPE.BACK_OR_SCREEN_ON, 0);
  buf.writeUInt8(action & 0xff, 1);
  return buf;
}

function serializeEmpty(type) {
  return Buffer.from([type & 0xff]);
}

function serializeGetClipboard(copyKey = 0) {
  return Buffer.from([CONTROL_MSG_TYPE.GET_CLIPBOARD, copyKey & 0xff]);
}

function serializeSetClipboard(text, paste = false, sequence = 0n) {
  const textBuf = Buffer.from(String(text || ''), 'utf8');
  const buf = Buffer.allocUnsafe(14 + textBuf.length);
  buf.writeUInt8(CONTROL_MSG_TYPE.SET_CLIPBOARD, 0);
  buf.writeBigInt64BE(BigInt(sequence), 1);
  buf.writeUInt8(paste ? 1 : 0, 9);
  buf.writeUInt32BE(textBuf.length, 10);
  textBuf.copy(buf, 14);
  return buf;
}

function serializeSetDisplayPower(on) {
  return Buffer.from([CONTROL_MSG_TYPE.SET_DISPLAY_POWER, on ? 1 : 0]);
}

function serializeStartApp(name) {
  const nameBuf = Buffer.from(String(name || ''), 'utf8').subarray(0, 255);
  const buf = Buffer.allocUnsafe(2 + nameBuf.length);
  buf.writeUInt8(CONTROL_MSG_TYPE.START_APP, 0);
  buf.writeUInt8(nameBuf.length, 1);
  nameBuf.copy(buf, 2);
  return buf;
}

/**
 * Simple zero-bloat ring-like accumulator for reading exact byte lengths from TCP streams.
 */
class ByteAccumulator {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  consume(n) {
    if (this.length < n) return null;
    if (this.chunks.length === 1) {
      const single = this.chunks[0];
      if (single.length === n) {
        this.chunks.length = 0;
        this.length = 0;
        return single;
      }
      const out = single.subarray(0, n);
      this.chunks[0] = single.subarray(n);
      this.length -= n;
      return out;
    }

    const out = Buffer.allocUnsafe(n);
    let offset = 0;
    while (offset < n) {
      const head = this.chunks[0];
      const need = n - offset;
      if (head.length <= need) {
        head.copy(out, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, offset, 0, need);
        this.chunks[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }
}

function codecIdToString(id) {
  switch (id) {
    case 0x68323634: return 'h264';
    case 0x68323635: return 'h265';
    case 0x00617631: return 'av1';
    case 0x00767038: return 'vp8';
    case 0x00767039: return 'vp9';
    case 0x6f707573: return 'opus';
    case 0x00616163: return 'aac';
    case 0x666c6163: return 'flac';
    case 0x00726177: return 'raw';
    default: return `0x${id.toString(16)}`;
  }
}

/**
 * Parses scrcpy v5.0.1 video socket:
 *   - Optional 1-byte dummy byte (consumed externally during handshake)
 *   - 64-byte device name (UTF-8 null padded)
 *   - 4-byte codec ID
 *   - Repeating 12-byte headers:
 *       - If bit 63 set (PACKET_FLAG_SESSION): 4B flags + 4B width + 4B height (NO payload)
 *       - Else: 8B ptsAndFlags (bit 62 = config, bit 61 = keyframe, low 61b = pts) + 4B size + <size>B payload
 */
class ScrcpyVideoParser {
  constructor(callbacks) {
    this.cb = callbacks;
    this.acc = new ByteAccumulator();
    this.state = 'DEVICE_META'; // DEVICE_META -> CODEC_HEADER -> PACKET_HEADER -> PACKET_PAYLOAD
    this.pendingHeader = null;
  }

  feed(chunk) {
    this.acc.push(chunk);

    while (true) {
      if (this.state === 'DEVICE_META') {
        const buf = this.acc.consume(64);
        if (!buf) return;
        const nul = buf.indexOf(0);
        const deviceName = buf.subarray(0, nul === -1 ? 64 : nul).toString('utf8');
        this.cb.onDeviceMeta?.(deviceName);
        this.state = 'CODEC_HEADER';
        continue;
      }

      if (this.state === 'CODEC_HEADER') {
        const buf = this.acc.consume(4);
        if (!buf) return;
        const codecId = buf.readUInt32BE(0);
        if (codecId === 0 || codecId === 1) {
          this.cb.onStreamDisabled?.(codecId === 1);
          return;
        }
        this.cb.onVideoCodec?.(codecIdToString(codecId), codecId);
        this.state = 'PACKET_HEADER';
        continue;
      }

      if (this.state === 'PACKET_HEADER') {
        const header = this.acc.consume(12);
        if (!header) return;

        const firstByte = header[0];
        const isSession = (firstByte & 0x80) !== 0;

        if (isSession) {
          const flags = header.readUInt32BE(0);
          const width = header.readInt32BE(4);
          const height = header.readInt32BE(8);
          this.cb.onSessionMeta?.({
            width,
            height,
            isClientResize: (flags & 1) !== 0,
          });
          // No payload follows a session meta header
          continue;
        }

        const isConfig = (firstByte & 0x40) !== 0;
        const isKeyFrame = (firstByte & 0x20) !== 0;
        const ptsAndFlags = header.readBigUInt64BE(0);
        const pts = ptsAndFlags & 0x1fffffffffffffffn;
        const packetSize = header.readUInt32BE(8);

        if (packetSize > 32 * 1024 * 1024) {
          this.cb.onError?.(new Error(`Kích thước gói video bất thường: ${packetSize}`));
          return;
        }

        this.pendingHeader = { isConfig, isKeyFrame, pts, packetSize };
        this.state = 'PACKET_PAYLOAD';
        continue;
      }

      if (this.state === 'PACKET_PAYLOAD') {
        const { isConfig, isKeyFrame, pts, packetSize } = this.pendingHeader;
        const payload = this.acc.consume(packetSize);
        if (!payload) return;
        this.pendingHeader = null;
        this.state = 'PACKET_HEADER';
        this.cb.onVideoPacket?.({ isConfig, isKeyFrame, pts, data: payload });
      }
    }
  }
}

/**
 * Parses scrcpy v5.0.1 audio socket:
 *   - 4-byte codec ID (0 = disabled, 1 = error)
 *   - Repeating 12-byte header (8B ptsAndFlags + 4B size) + <size>B payload
 */
class ScrcpyAudioParser {
  constructor(callbacks) {
    this.cb = callbacks;
    this.acc = new ByteAccumulator();
    this.state = 'CODEC_HEADER';
    this.pendingHeader = null;
  }

  feed(chunk) {
    this.acc.push(chunk);

    while (true) {
      if (this.state === 'CODEC_HEADER') {
        const buf = this.acc.consume(4);
        if (!buf) return;
        const codecId = buf.readUInt32BE(0);
        if (codecId === 0 || codecId === 1) {
          this.cb.onStreamDisabled?.(codecId === 1);
          this.state = 'DISABLED';
          return;
        }
        this.cb.onAudioCodec?.(codecIdToString(codecId), codecId);
        this.state = 'PACKET_HEADER';
        continue;
      }

      if (this.state === 'DISABLED') return;

      if (this.state === 'PACKET_HEADER') {
        const header = this.acc.consume(12);
        if (!header) return;
        const firstByte = header[0];
        const isConfig = (firstByte & 0x40) !== 0;
        const isKeyFrame = (firstByte & 0x20) !== 0;
        const pts = header.readBigUInt64BE(0) & 0x1fffffffffffffffn;
        const packetSize = header.readUInt32BE(8);

        if (packetSize > 4 * 1024 * 1024) {
          this.cb.onError?.(new Error(`Kích thước gói âm thanh bất thường: ${packetSize}`));
          return;
        }

        this.pendingHeader = { isConfig, isKeyFrame, pts, packetSize };
        this.state = 'PACKET_PAYLOAD';
        continue;
      }

      if (this.state === 'PACKET_PAYLOAD') {
        const { isConfig, isKeyFrame, pts, packetSize } = this.pendingHeader;
        const payload = this.acc.consume(packetSize);
        if (!payload) return;
        this.pendingHeader = null;
        this.state = 'PACKET_HEADER';
        this.cb.onAudioPacket?.({ isConfig, isKeyFrame, pts, data: payload });
      }
    }
  }
}

/**
 * Parses scrcpy v5.0.1 DeviceMessage stream coming back from control socket (clipboard, ack, uhid).
 */
class ScrcpyDeviceMessageParser {
  constructor(callbacks) {
    this.cb = callbacks;
    this.acc = new ByteAccumulator();
    this.state = 'TYPE';
    this.msgType = 0;
    this.pendingLen = 0;
    this.pendingUhidId = 0;
  }

  feed(chunk) {
    this.acc.push(chunk);

    while (true) {
      if (this.state === 'TYPE') {
        const b = this.acc.consume(1);
        if (!b) return;
        this.msgType = b[0];
        if (this.msgType === DEVICE_MSG_TYPE.CLIPBOARD) {
          this.state = 'CLIPBOARD_LEN';
        } else if (this.msgType === DEVICE_MSG_TYPE.ACK_CLIPBOARD) {
          this.state = 'ACK_SEQ';
        } else if (this.msgType === DEVICE_MSG_TYPE.UHID_OUTPUT) {
          this.state = 'UHID_HDR';
        } else {
          // Unknown message type; stop parsing to avoid desync
          return;
        }
        continue;
      }

      if (this.state === 'CLIPBOARD_LEN') {
        const b = this.acc.consume(4);
        if (!b) return;
        this.pendingLen = b.readUInt32BE(0);
        this.state = 'CLIPBOARD_DATA';
        continue;
      }

      if (this.state === 'CLIPBOARD_DATA') {
        const b = this.acc.consume(this.pendingLen);
        if (!b) return;
        this.state = 'TYPE';
        this.cb.onClipboard?.(b.toString('utf8'));
        continue;
      }

      if (this.state === 'ACK_SEQ') {
        const b = this.acc.consume(8);
        if (!b) return;
        const seq = b.readBigInt64BE(0);
        this.state = 'TYPE';
        this.cb.onAckClipboard?.(seq);
        continue;
      }

      if (this.state === 'UHID_HDR') {
        const b = this.acc.consume(4);
        if (!b) return;
        this.pendingUhidId = b.readUInt16BE(0);
        this.pendingLen = b.readUInt16BE(2);
        this.state = 'UHID_DATA';
        continue;
      }

      if (this.state === 'UHID_DATA') {
        const b = this.acc.consume(this.pendingLen);
        if (!b) return;
        this.state = 'TYPE';
        this.cb.onUhidOutput?.(this.pendingUhidId, b);
      }
    }
  }
}

module.exports = {
  SCRCPY_VERSION,
  CONTROL_MSG_TYPE,
  DEVICE_MSG_TYPE,
  MOTION_ACTION,
  KEY_ACTION,
  POINTER_ID_MOUSE,
  POINTER_ID_GENERIC_FINGER,
  serializeInjectKeycode,
  serializeInjectText,
  serializeInjectTouchEvent,
  serializeInjectScrollEvent,
  serializeBackOrScreenOn,
  serializeEmpty,
  serializeGetClipboard,
  serializeSetClipboard,
  serializeSetDisplayPower,
  serializeStartApp,
  ScrcpyVideoParser,
  ScrcpyAudioParser,
  ScrcpyDeviceMessageParser,
};

import {
  ScrcpyWebClient,
  MOTION_ACTION,
  KEY_ACTION,
  POINTER_ID_FINGER,
  POINTER_ID_PINCH_2,
  encodeTouchEvent,
  encodeScrollEvent,
  encodeKeycodeEvent,
  encodeInjectText,
} from './scrcpy-client.js';
import { CODE_TO_ANDROID_KEYCODE, getAndroidMetaState } from './keymap.js';

// ==========================================================================
// State & DOM References
// ==========================================================================

const $ = (id) => document.getElementById(id);

const dom = {
  appShell: $('app-shell'),
  connDot: $('conn-dot'),
  deviceSelect: $('device-select'),
  btnRefreshDevices: $('btn-refresh-devices'),
  btnOpenWifi: $('btn-open-wifi'),
  btnConnectToggle: $('btn-connect-toggle'),
  presetSelect: $('preset-select'),
  btnAudioToggle: $('btn-audio-toggle'),
  iconAudioOn: $('icon-audio-on'),
  iconAudioOff: $('icon-audio-off'),
  btnToggleDrawer: $('btn-toggle-drawer'),

  statFps: $('stat-fps'),
  statLatency: $('stat-latency'),
  statRes: $('stat-res'),
  statMbps: $('stat-mbps'),

  phoneBezel: $('phone-bezel'),
  canvas: $('screen-canvas'),
  imeProxy: $('ime-proxy'),
  touchDot1: $('touch-dot-1'),
  touchDot2: $('touch-dot-2'),
  coordHud: $('coord-hud'),
  recBadge: $('rec-badge'),
  screenOverlay: $('screen-overlay'),
  overlayTitle: $('overlay-title'),
  overlayDesc: $('overlay-desc'),
  btnOverlayWifi: $('btn-overlay-wifi'),
  btnOverlayDemo: $('btn-overlay-demo'),

  hwPower: $('hw-power'),
  hwOled: $('hw-oled'),
  hwVolUp: $('hw-vol-up'),
  hwVolDown: $('hw-vol-down'),
  hwBack: $('hw-back'),
  hwHome: $('hw-home'),
  hwRecents: $('hw-recents'),
  hwNotif: $('hw-notif'),
  hwRotate: $('hw-rotate'),
  hwScreenshot: $('hw-screenshot'),
  hwCoord: $('hw-coord'),
  hwFullscreen: $('hw-fullscreen'),

  consoleOutput: $('console-output'),
  consoleForm: $('console-form'),
  consoleInput: $('console-input'),
  btnRecordMacro: $('btn-record-macro'),
  btnToggleMacroEditor: $('btn-toggle-macro-editor'),
  macroPanel: $('macro-panel'),
  macroEditor: $('macro-editor'),
  btnClearMacro: $('btn-clear-macro'),
  btnRunMacro: $('btn-run-macro'),
  btnCopyCli: $('btn-copy-cli'),

  appsSearch: $('apps-search'),
  btnReloadApps: $('btn-reload-apps'),
  appsList: $('apps-list'),

  clipSendInput: $('clip-send-input'),
  btnClipPaste: $('btn-clip-paste'),
  btnClipCopy: $('btn-clip-copy'),
  clipPhoneBox: $('clip-phone-box'),
  btnCopyFromPhone: $('btn-copy-from-phone'),

  setMaxSize: $('set-maxsize'),
  setFps: $('set-fps'),
  setBitrate: $('set-bitrate'),
  setBitrateVal: $('set-bitrate-val'),
  setAudio: $('set-audio'),
  setScreenOff: $('set-screenoff'),
  setStayAwake: $('set-stayawake'),
  setRightBack: $('set-rightback'),
  btnApplySettings: $('btn-apply-settings'),

  wifiModal: $('wifi-modal'),
  btnCloseWifi: $('btn-close-wifi'),
  pairAddr: $('pair-addr'),
  pairCode: $('pair-code'),
  pairConnectAddr: $('pair-connect-addr'),
  quickConnectAddr: $('quick-connect-addr'),
  btnDoPair: $('btn-do-pair'),
  btnDoPairConnect: $('btn-do-pair-connect'),
  btnDoConnect: $('btn-do-connect'),
  btnDoTcpip: $('btn-do-tcpip'),
  wifiFeedback: $('wifi-feedback'),

  toastContainer: $('toast-container'),
};

const PRESETS = {
  ultra120: { maxSize: 1080, maxFps: 120, bitRate: 12_000_000 },
  balanced60: { maxSize: 1080, maxFps: 60, bitRate: 8_000_000 },
  lowlat720: { maxSize: 720, maxFps: 60, bitRate: 5_000_000 },
  sharp1440: { maxSize: 1440, maxFps: 60, bitRate: 14_000_000 },
};

const state = {
  devices: [],
  selectedSerial: '',
  connected: false,
  connecting: false,
  demoMode: false,
  displayPowerOn: true,
  audioMuted: false,
  coordHudOn: false,
  recordingMacro: false,
  lastRecordTs: 0,
  apps: [],
  cmdHistory: [],
  cmdHistoryIdx: -1,
  options: {
    maxSize: 1080,
    maxFps: 60,
    bitRate: 8_000_000,
    audio: true,
    stayAwake: false,
    turnScreenOff: false,
    rightClickBack: true,
  },
};

// ==========================================================================
// Toast & Console Helpers
// ==========================================================================

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 180ms ease';
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

function appendLog(kind, text, meta = '') {
  const entry = document.createElement('div');
  entry.className = 'log-entry';

  if (kind === 'cmd') {
    const span = document.createElement('span');
    span.className = 'log-cmd';
    span.textContent = `$ ${text}`;
    entry.appendChild(span);
    if (meta) {
      const m = document.createElement('span');
      m.className = 'log-meta';
      m.textContent = meta;
      entry.appendChild(m);
    }
  } else {
    const pre = document.createElement('pre');
    pre.className = kind === 'err' ? 'log-err' : kind === 'sys' ? 'log-sys' : 'log-out';
    pre.textContent = text;
    entry.appendChild(pre);
  }

  dom.consoleOutput.appendChild(entry);
  dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
}

function setConnectionVisual(mode, title = '', desc = '') {
  dom.connDot.className = 'status-dot';
  if (mode === 'live') {
    dom.connDot.classList.add('live');
    dom.screenOverlay.classList.add('hidden');
    dom.btnConnectToggle.textContent = 'Ngắt kết nối';
    dom.btnConnectToggle.classList.add('btn-danger');
    dom.btnConnectToggle.disabled = false;
  } else if (mode === 'demo') {
    dom.connDot.classList.add('demo');
    dom.screenOverlay.classList.add('hidden');
    dom.btnConnectToggle.textContent = 'Thoát Mô phỏng';
    dom.btnConnectToggle.classList.add('btn-danger');
    dom.btnConnectToggle.disabled = false;
  } else if (mode === 'connecting') {
    dom.connDot.classList.add('connecting');
    dom.overlayTitle.textContent = title || 'Đang kết nối thiết bị...';
    dom.overlayDesc.textContent = desc || 'Đang khởi chạy scrcpy-server v5 và thiết lập luồng H.264 phần cứng.';
    dom.screenOverlay.classList.remove('hidden');
    dom.btnConnectToggle.textContent = 'Đang kết nối...';
    dom.btnConnectToggle.classList.remove('btn-danger');
    dom.btnConnectToggle.disabled = true;
  } else {
    dom.overlayTitle.textContent = title || 'Sẵn sàng kết nối Samsung S26';
    dom.overlayDesc.textContent =
      desc || 'Không cần dây USB — kết nối trực tiếp qua Gỡ lỗi không dây (Wi-Fi) trên cùng mạng với Chromebook.';
    dom.screenOverlay.classList.remove('hidden');
    dom.btnConnectToggle.textContent = 'Kết nối';
    dom.btnConnectToggle.classList.remove('btn-danger');
    dom.btnConnectToggle.disabled = !state.selectedSerial;
    dom.statFps.textContent = '--';
    dom.statLatency.textContent = '--ms';
    dom.statRes.textContent = '---';
    dom.statMbps.textContent = '-- Mbps';
  }
}

function updateOrientation(width, height) {
  if (!width || !height) return;
  const isLandscape = width > height;
  dom.phoneBezel.classList.toggle('is-landscape', isLandscape);
  dom.statRes.textContent = `${width}×${height}`;
}

// ==========================================================================
// Scrcpy WebCodecs Client
// ==========================================================================

const client = new ScrcpyWebClient(dom.canvas, {
  onStatus(status, reason) {
    if (status === 'connecting') {
      state.connecting = true;
      state.connected = false;
      setConnectionVisual('connecting', 'Đang kết nối luồng hình ảnh...', reason);
    } else if (status === 'connected') {
      state.connecting = false;
      state.connected = true;
      setConnectionVisual('live');
      appendLog('sys', `[scrcpy v5] Đã kết nối tới ${state.selectedSerial} (WebCodecs Hardware Decode).`);
      toast('Đã kết nối màn hình điện thoại!', 'ok');
      loadAppsList();
    } else if (status === 'disconnected') {
      const wasConnected = state.connected;
      state.connecting = false;
      state.connected = false;
      if (!state.demoMode) {
        setConnectionVisual('idle');
      }
      if (wasConnected) {
        appendLog('sys', reason || 'Đã ngắt kết nối luồng.');
      }
    }
  },

  onMeta(meta) {
    if (meta.width && meta.height) {
      updateOrientation(meta.width, meta.height);
    }
    if (meta.displayPowerOn !== undefined) {
      state.displayPowerOn = Boolean(meta.displayPowerOn);
      dom.hwOled.classList.toggle('is-oled-off', !state.displayPowerOn);
    }
  },

  onResize(w, h) {
    updateOrientation(w, h);
  },

  onServerStats(stats) {
    dom.statMbps.textContent = `${stats.mbps.toFixed(1)} Mbps`;
    if (stats.width && stats.height) {
      dom.statRes.textContent = `${stats.width}×${stats.height}`;
    }
  },

  onLocalStats({ localFps, decodeLatencyMs }) {
    dom.statFps.textContent = String(localFps);
    dom.statLatency.textContent = `${decodeLatencyMs}ms`;
  },

  onClipboard(text) {
    dom.clipPhoneBox.value = text;
    if (text) {
      toast('Đã nhận Clipboard từ điện thoại', 'ok');
      // Try automatic sync to Chromebook clipboard if tab is focused
      if (document.hasFocus() && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    }
  },

  onDisplayPower(on) {
    state.displayPowerOn = on;
    dom.hwOled.classList.toggle('is-oled-off', !on);
  },

  onError(message) {
    state.connecting = false;
    state.connected = false;
    if (!state.demoMode) setConnectionVisual('idle', 'Kết nối không thành công', message);
    appendLog('err', `[Lỗi] ${message}`);
    toast(message, 'err');
  },
});

// ==========================================================================
// Device Discovery & Connection Controls
// ==========================================================================

async function refreshDevices(autoSelectSerial = null) {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();

    if (!data.adbAvailable && data.error) {
      dom.deviceSelect.innerHTML = `<option value="">Chưa cài ADB trên máy</option>`;
      dom.btnConnectToggle.disabled = true;
      return;
    }

    state.devices = data.devices || [];
    const prev = autoSelectSerial || state.selectedSerial;

    dom.deviceSelect.innerHTML = '';
    if (state.devices.length === 0) {
      dom.deviceSelect.innerHTML = `<option value="">Chưa có thiết bị (Bấm Kết nối Wi-Fi)</option>`;
      state.selectedSerial = '';
      if (!state.connected && !state.demoMode) dom.btnConnectToggle.disabled = true;
      return;
    }

    for (const dev of state.devices) {
      const opt = document.createElement('option');
      opt.value = dev.serial;
      const transportTag = dev.transport === 'wifi' ? 'Wi-Fi' : 'USB';
      const batTag = dev.batteryLevel !== null ? ` · ${dev.batteryLevel}%` : '';
      const stateTag = dev.state !== 'device' ? ` [${dev.state}]` : '';
      opt.textContent = `${dev.displayName || dev.serial} (${transportTag}${batTag})${stateTag}`;
      dom.deviceSelect.appendChild(opt);
    }

    const match = state.devices.find((d) => d.serial === prev) || state.devices[0];
    state.selectedSerial = match.serial;
    dom.deviceSelect.value = state.selectedSerial;

    if (!state.connected && !state.demoMode) {
      dom.btnConnectToggle.disabled = match.state !== 'device';
    }
  } catch (err) {
    appendLog('err', `Không thể đọc danh sách thiết bị: ${err.message}`);
  }
}

function startStream(forceRestart = false) {
  if (!state.selectedSerial) {
    toast('Vui lòng ghép nối hoặc chọn thiết bị trước.', 'err');
    return;
  }
  stopDemoMode();
  readSettingsFromForm();
  client.ensureAudioContext();
  client.connect(state.selectedSerial, state.options, forceRestart);
}

function stopStream() {
  if (state.demoMode) {
    stopDemoMode();
    return;
  }
  client.disconnect();
  state.connected = false;
  state.connecting = false;
  setConnectionVisual('idle');
}

dom.deviceSelect.addEventListener('change', () => {
  state.selectedSerial = dom.deviceSelect.value;
  if (state.connected) {
    startStream(false);
  } else {
    const dev = state.devices.find((d) => d.serial === state.selectedSerial);
    dom.btnConnectToggle.disabled = !dev || dev.state !== 'device';
  }
});

dom.btnRefreshDevices.addEventListener('click', () => {
  refreshDevices();
  toast('Đã làm mới danh sách thiết bị', 'ok');
});

dom.btnConnectToggle.addEventListener('click', () => {
  if (state.connected || state.connecting || state.demoMode) {
    stopStream();
  } else {
    startStream(false);
  }
});

// ==========================================================================
// Pointer, Multi-touch Pinch, Scroll, Coordinate Picker & Macro Recorder
// ==========================================================================

let activePointerDown = false;
let dragStartPt = null;
let dragStartTime = 0;

function getPhoneCoords(e) {
  const rect = dom.canvas.getBoundingClientRect();
  const w = state.demoMode ? demo.width : (client.width || dom.canvas.width);
  const h = state.demoMode ? demo.height : (client.height || dom.canvas.height);
  if (!rect.width || !rect.height || !w || !h) return null;

  const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  return {
    x: Math.round(nx * (w - 1)),
    y: Math.round(ny * (h - 1)),
    w,
    h,
    cssX: e.clientX - rect.left,
    cssY: e.clientY - rect.top,
    rectW: rect.width,
    rectH: rect.height,
  };
}

function showTouchDots(visible, pt, pinch = false) {
  if (!visible || !pt) {
    dom.touchDot1.classList.remove('visible');
    dom.touchDot2.classList.remove('visible');
    return;
  }
  dom.touchDot1.style.left = `${pt.cssX}px`;
  dom.touchDot1.style.top = `${pt.cssY}px`;
  dom.touchDot1.classList.add('visible');

  if (pinch) {
    const mx = pt.rectW - pt.cssX;
    const my = pt.rectH - pt.cssY;
    dom.touchDot2.style.left = `${mx}px`;
    dom.touchDot2.style.top = `${my}px`;
    dom.touchDot2.classList.add('visible');
  } else {
    dom.touchDot2.classList.remove('visible');
  }
}

function sendTouch(action, pt, isPinch = false) {
  if (state.demoMode) {
    demo.handleTouch(action, pt);
    return;
  }
  if (!state.connected) return;

  const pressure = action === MOTION_ACTION.UP ? 0.0 : 1.0;
  client.sendBinary(
    encodeTouchEvent({
      action,
      pointerId: POINTER_ID_FINGER,
      x: pt.x,
      y: pt.y,
      screenWidth: pt.w,
      screenHeight: pt.h,
      pressure,
    })
  );

  // Ctrl + Drag = symmetric dual-finger pinch-to-zoom!
  if (isPinch) {
    const mx = Math.max(0, Math.min(pt.w - 1, pt.w - 1 - pt.x));
    const my = Math.max(0, Math.min(pt.h - 1, pt.h - 1 - pt.y));
    client.sendBinary(
      encodeTouchEvent({
        action,
        pointerId: POINTER_ID_PINCH_2,
        x: mx,
        y: my,
        screenWidth: pt.w,
        screenHeight: pt.h,
        pressure,
      })
    );
  }
}

function recordMacroLine(line) {
  if (!state.recordingMacro) return;
  const now = Date.now();
  const lines = [];
  if (state.lastRecordTs > 0) {
    const gap = Math.min(5000, now - state.lastRecordTs);
    if (gap >= 120) lines.push(`wait ${gap}`);
  }
  state.lastRecordTs = now;
  lines.push(line);

  const cur = dom.macroEditor.value.trim();
  dom.macroEditor.value = cur ? `${cur}\n${lines.join('\n')}` : lines.join('\n');
  dom.macroEditor.scrollTop = dom.macroEditor.scrollHeight;
}

dom.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

dom.canvas.addEventListener('pointerdown', (e) => {
  if (!state.connected && !state.demoMode) return;
  e.preventDefault();

  // Unlock Web Audio on first user interaction
  if (state.connected && !state.audioMuted) {
    client.ensureAudioContext();
  }

  // Focus hidden IME textarea so keyboard & Vietnamese Telex/VNI work immediately
  dom.imeProxy.focus({ preventScroll: true });

  // Middle click = Home
  if (e.button === 1) {
    triggerHardwareKey('HOME');
    return;
  }

  // Right click = Back (if enabled)
  if (e.button === 2 && state.options.rightClickBack) {
    triggerHardwareKey('BACK');
    return;
  }

  if (e.button !== 0) return;

  const pt = getPhoneCoords(e);
  if (!pt) return;

  // Shift + Click while Coordinate HUD is active -> insert `tap x y` directly into Console!
  if (state.coordHudOn && e.shiftKey) {
    dom.consoleInput.value = `tap ${pt.x} ${pt.y}`;
    dom.consoleInput.focus();
    toast(`Đã chép tọa độ: tap ${pt.x} ${pt.y}`, 'ok');
    return;
  }

  dom.canvas.setPointerCapture(e.pointerId);
  activePointerDown = true;
  dragStartPt = pt;
  dragStartTime = Date.now();

  showTouchDots(true, pt, e.ctrlKey);
  sendTouch(MOTION_ACTION.DOWN, pt, e.ctrlKey);
});

dom.canvas.addEventListener('pointermove', (e) => {
  const pt = getPhoneCoords(e);
  if (pt && state.coordHudOn) {
    dom.coordHud.textContent = `x: ${pt.x}, y: ${pt.y}`;
  }
  if (!activePointerDown || !pt) return;
  showTouchDots(true, pt, e.ctrlKey);
  sendTouch(MOTION_ACTION.MOVE, pt, e.ctrlKey);
});

function finishPointer(e) {
  if (!activePointerDown) return;
  activePointerDown = false;
  const pt = getPhoneCoords(e) || dragStartPt;
  showTouchDots(false, null);
  if (pt) {
    sendTouch(MOTION_ACTION.UP, pt, e.ctrlKey);

    if (state.recordingMacro && dragStartPt) {
      const dist = Math.hypot(pt.x - dragStartPt.x, pt.y - dragStartPt.y);
      if (dist < 18) {
        recordMacroLine(`tap ${pt.x} ${pt.y}`);
      } else {
        const dur = Math.max(80, Math.min(2000, Date.now() - dragStartTime));
        recordMacroLine(`swipe ${dragStartPt.x} ${dragStartPt.y} ${pt.x} ${pt.y} ${dur}`);
      }
    }
  }
  dragStartPt = null;
}

dom.canvas.addEventListener('pointerup', finishPointer);
dom.canvas.addEventListener('pointercancel', finishPointer);

dom.canvas.addEventListener(
  'wheel',
  (e) => {
    if (!state.connected && !state.demoMode) return;
    e.preventDefault();
    const pt = getPhoneCoords(e);
    if (!pt) return;

    // Normalize wheel delta cleanly for both Chromebook trackpads and mice
    const scale = e.deltaMode === 1 ? 1.0 : 1 / 48;
    const hScroll = Math.max(-16, Math.min(16, -e.deltaX * scale));
    const vScroll = Math.max(-16, Math.min(16, -e.deltaY * scale));

    if (state.demoMode) {
      demo.handleScroll(vScroll);
      return;
    }

    client.sendBinary(
      encodeScrollEvent({
        x: pt.x,
        y: pt.y,
        screenWidth: pt.w,
        screenHeight: pt.h,
        hScroll,
        vScroll,
        buttons: 0,
      })
    );
  },
  { passive: false }
);

// ==========================================================================
// Keyboard & Vietnamese IME Input (through #ime-proxy)
// ==========================================================================

let isComposingIme = false;

dom.imeProxy.addEventListener('compositionstart', () => {
  isComposingIme = true;
});

dom.imeProxy.addEventListener('compositionend', (e) => {
  isComposingIme = false;
  const text = e.data || dom.imeProxy.value;
  dom.imeProxy.value = '';
  if (!text) return;
  sendTypedText(text);
});

dom.imeProxy.addEventListener('input', (e) => {
  if (isComposingIme || e.isComposing) return;
  const text = dom.imeProxy.value;
  dom.imeProxy.value = '';
  if (!text) return;
  sendTypedText(text);
});

function sendTypedText(text) {
  if (state.demoMode) {
    demo.appendText(text);
    return;
  }
  if (!state.connected) return;
  // Pure printable ASCII goes via fast INJECT_TEXT; Vietnamese/Unicode uses SET_CLIPBOARD + immediate paste!
  if (/^[\x20-\x7e]+$/.test(text)) {
    client.sendBinary(encodeInjectText(text));
  } else {
    client.sendJson({ type: 'clipboard', text, paste: true });
  }
}

const DIRECT_CONTROL_CODES = new Set([
  'Enter', 'NumpadEnter', 'Backspace', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

dom.imeProxy.addEventListener('keydown', async (e) => {
  if (!state.connected && !state.demoMode) return;
  if (isComposingIme || e.isComposing) return;

  // Ctrl+V -> pull Chromebook clipboard and paste into Samsung S26
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
    e.preventDefault();
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        if (state.demoMode) demo.appendText(clipText);
        else client.sendJson({ type: 'clipboard', text: clipText, paste: true });
        toast('Đã dán từ Clipboard Chromebook', 'ok');
      }
    } catch {
      // Fallback: let Android handle Ctrl+V
      sendKeycode(KEY_ACTION.DOWN, 50, 0x1000);
      sendKeycode(KEY_ACTION.UP, 50, 0x1000);
    }
    return;
  }

  // Handle Ctrl shortcuts (Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+Z) & special navigation keys
  const isShortcut = (e.ctrlKey || e.metaKey || e.altKey) && CODE_TO_ANDROID_KEYCODE[e.code];
  if (DIRECT_CONTROL_CODES.has(e.code) || isShortcut) {
    e.preventDefault();
    const kc = CODE_TO_ANDROID_KEYCODE[e.code];
    if (!kc) return;
    if (state.demoMode) {
      demo.handleKey(e.code);
      return;
    }
    sendKeycode(KEY_ACTION.DOWN, kc, getAndroidMetaState(e));
    if (state.recordingMacro && DIRECT_CONTROL_CODES.has(e.code)) {
      recordMacroLine(`key ${e.code.toUpperCase()}`);
    }
  }
});

dom.imeProxy.addEventListener('keyup', (e) => {
  if (!state.connected || isComposingIme) return;
  const isShortcut = (e.ctrlKey || e.metaKey || e.altKey) && CODE_TO_ANDROID_KEYCODE[e.code];
  if (DIRECT_CONTROL_CODES.has(e.code) || isShortcut) {
    const kc = CODE_TO_ANDROID_KEYCODE[e.code];
    if (kc) sendKeycode(KEY_ACTION.UP, kc, getAndroidMetaState(e));
  }
});

function sendKeycode(action, keycode, metaState = 0) {
  client.sendBinary(encodeKeycodeEvent(action, keycode, 0, metaState));
}

// ==========================================================================
// Hardware Control Rail
// ==========================================================================

function triggerHardwareKey(name) {
  if (state.demoMode) {
    demo.handleHardware(name);
    if (state.recordingMacro) recordMacroLine(`key ${name}`);
    return;
  }
  if (!state.connected) {
    toast('Hãy kết nối thiết bị trước.', 'err');
    return;
  }
  if (name === 'BACK') {
    client.sendJson({ type: 'back_or_screen_on' });
  } else {
    client.sendJson({ type: 'key', keycode: name });
  }
  if (state.recordingMacro) recordMacroLine(`key ${name}`);
}

dom.hwPower.addEventListener('click', () => triggerHardwareKey('POWER'));
dom.hwVolUp.addEventListener('click', () => triggerHardwareKey('VOLUME_UP'));
dom.hwVolDown.addEventListener('click', () => triggerHardwareKey('VOLUME_DOWN'));
dom.hwBack.addEventListener('click', () => triggerHardwareKey('BACK'));
dom.hwHome.addEventListener('click', () => triggerHardwareKey('HOME'));
dom.hwRecents.addEventListener('click', () => triggerHardwareKey('APP_SWITCH'));

dom.hwOled.addEventListener('click', () => {
  const next = !state.displayPowerOn;
  if (state.demoMode) {
    state.displayPowerOn = next;
    dom.hwOled.classList.toggle('is-oled-off', !next);
    toast(next ? 'Đã bật lại màn hình điện thoại' : 'Đã tắt màn hình OLED trên ĐT (vẫn hiển thị trên web)', 'ok');
    return;
  }
  if (!state.connected) return toast('Chưa kết nối thiết bị.', 'err');
  client.sendJson({ type: 'display_power', on: next });
  toast(next ? 'Đã bật màn hình vật lý trên ĐT' : 'Đã tắt màn hình OLED trên ĐT (vẫn thao tác được trên web)', 'ok');
});

dom.hwNotif.addEventListener('click', () => {
  if (state.demoMode) return demo.toggleNotif();
  if (!state.connected) return toast('Chưa kết nối thiết bị.', 'err');
  client.sendJson({ type: 'expand_notifications' });
});

dom.hwRotate.addEventListener('click', () => {
  if (state.demoMode) return demo.rotate();
  if (!state.connected) return toast('Chưa kết nối thiết bị.', 'err');
  client.sendJson({ type: 'rotate' });
});

dom.hwScreenshot.addEventListener('click', () => {
  if (state.demoMode) {
    const link = document.createElement('a');
    link.download = `linkbridge-demo-${Date.now()}.png`;
    link.href = dom.canvas.toDataURL('image/png');
    link.click();
    toast('Đã lưu ảnh màn hình (PNG)', 'ok');
    return;
  }
  if (!state.selectedSerial) return toast('Chưa chọn thiết bị.', 'err');
  const link = document.createElement('a');
  link.href = `/api/device/${encodeURIComponent(state.selectedSerial)}/screenshot`;
  link.download = `s26-screenshot-${Date.now()}.png`;
  link.click();
  toast('Đang tải ảnh chụp màn hình gốc...', 'ok');
});

dom.hwCoord.addEventListener('click', () => {
  state.coordHudOn = !state.coordHudOn;
  dom.hwCoord.classList.toggle('is-active', state.coordHudOn);
  dom.coordHud.classList.toggle('visible', state.coordHudOn);
  if (state.coordHudOn) {
    toast('Bật thước tọa độ: giữ Shift + Click lên màn hình để lấy lệnh tap', 'ok');
  }
});

dom.hwFullscreen.addEventListener('click', () => {
  const target = document.querySelector('.stage-area');
  if (!document.fullscreenElement) {
    target.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
});

// Audio & Drawer Toggles
dom.btnAudioToggle.addEventListener('click', () => {
  state.audioMuted = !state.audioMuted;
  client.setAudioMuted(state.audioMuted);
  dom.btnAudioToggle.classList.toggle('is-active', !state.audioMuted);
  dom.iconAudioOn.style.display = state.audioMuted ? 'none' : '';
  dom.iconAudioOff.style.display = state.audioMuted ? '' : 'none';
});

dom.btnToggleDrawer.addEventListener('click', () => {
  const collapsed = dom.appShell.classList.toggle('drawer-collapsed');
  dom.btnToggleDrawer.classList.toggle('is-active', !collapsed);
});

// ==========================================================================
// Drawer Tabs & Settings Sync
// ==========================================================================

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `pane-${target}`);
    });
    if (target === 'apps' && state.apps.length === 0 && (state.connected || state.selectedSerial)) {
      loadAppsList();
    }
  });
});

function readSettingsFromForm() {
  state.options.maxSize = Number(dom.setMaxSize.value);
  state.options.maxFps = Number(dom.setFps.value);
  state.options.bitRate = Number(dom.setBitrate.value) * 1_000_000;
  state.options.audio = dom.setAudio.checked;
  state.options.turnScreenOff = dom.setScreenOff.checked;
  state.options.stayAwake = dom.setStayAwake.checked;
  state.options.rightClickBack = dom.setRightBack.checked;
}

dom.setBitrate.addEventListener('input', () => {
  dom.setBitrateVal.textContent = `${dom.setBitrate.value} Mbps`;
});

dom.setRightBack.addEventListener('change', () => {
  state.options.rightClickBack = dom.setRightBack.checked;
});

dom.presetSelect.addEventListener('change', () => {
  const p = PRESETS[dom.presetSelect.value];
  if (!p) return;
  dom.setMaxSize.value = String(p.maxSize);
  dom.setFps.value = String(p.maxFps);
  dom.setBitrate.value = String(Math.round(p.bitRate / 1_000_000));
  dom.setBitrateVal.textContent = `${dom.setBitrate.value} Mbps`;
  readSettingsFromForm();
  if (state.connected) {
    toast('Đang áp dụng cấu hình luồng mới...', 'ok');
    startStream(true);
  }
});

dom.btnApplySettings.addEventListener('click', () => {
  readSettingsFromForm();
  if (state.connected) {
    startStream(true);
    toast('Đã áp dụng cài đặt & tải lại luồng', 'ok');
  } else {
    toast('Đã lưu cài đặt cho lần kết nối tiếp theo', 'ok');
  }
});

// ==========================================================================
// Command Console & Macro Engine
// ==========================================================================

const HELP_TEXT = [
  'Các lệnh điều khiển nhanh (< 5ms khi đang kết nối):',
  '  tap <x> <y>                    Chạm tọa độ (x, y)',
  '  swipe <x1> <y1> <x2> <y2> [ms] Vuốt từ điểm 1 sang điểm 2',
  '  text <nội dung>                Nhập chữ (hỗ trợ Tiếng Việt)',
  '  key <HOME|BACK|ENTER|POWER|VOLUME_UP|VOLUME_DOWN|APP_SWITCH>',
  '  app <package>                  Mở ứng dụng (vd: app com.android.chrome)',
  '  screen <on|off>                Bật/tắt màn hình OLED vật lý trên ĐT',
  '  rotate | notif | clear         Xoay màn hình / kéo thông báo / xóa log',
  '  <lệnh adb shell bất kỳ>        Vd: dumpsys battery, wm size, pm list packages -3',
].join('\n');

async function executeCommandLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) return;

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === 'help' || cmd === '?') {
    appendLog('cmd', line);
    appendLog('out', HELP_TEXT);
    return;
  }
  if (cmd === 'clear' || cmd === 'cls') {
    dom.consoleOutput.innerHTML = '';
    return;
  }

  // Demo mode simulation for commands
  if (state.demoMode) {
    appendLog('cmd', line, 'demo · 1ms');
    const out = demo.runCommand(cmd, parts.slice(1), line);
    if (out) appendLog('out', out);
    return;
  }

  if (!state.selectedSerial) {
    appendLog('cmd', line);
    appendLog('err', 'Chưa có thiết bị nào được chọn. Bấm "Kết nối Wi-Fi" hoặc bật "Mô phỏng".');
    return;
  }

  const serialEnc = encodeURIComponent(state.selectedSerial);

  try {
    if (cmd === 'tap' && parts.length >= 3) {
      const res = await fetch(`/api/device/${serialEnc}/tap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: Number(parts[1]), y: Number(parts[2]) }),
      });
      const data = await res.json();
      appendLog('cmd', line, `${data.via || 'api'} · ${data.durationMs ?? 0}ms`);
      if (!data.ok) appendLog('err', data.error || data.stderr || 'Thất bại');
      return;
    }

    if (cmd === 'swipe' && parts.length >= 5) {
      const res = await fetch(`/api/device/${serialEnc}/swipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x1: Number(parts[1]),
          y1: Number(parts[2]),
          x2: Number(parts[3]),
          y2: Number(parts[4]),
          durationMs: Number(parts[5]) || 260,
        }),
      });
      const data = await res.json();
      appendLog('cmd', line, `${data.via || 'api'} · ${data.durationMs ?? 0}ms`);
      if (!data.ok) appendLog('err', data.error || data.stderr || 'Thất bại');
      return;
    }

    if (cmd === 'key' && parts.length >= 2) {
      const res = await fetch(`/api/device/${serialEnc}/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keycode: parts[1] }),
      });
      const data = await res.json();
      appendLog('cmd', line, `${data.via || 'api'} · ${data.durationMs ?? 0}ms`);
      if (!data.ok) appendLog('err', data.error || data.stderr || 'Thất bại');
      return;
    }

    if ((cmd === 'text' || cmd === 'paste') && parts.length >= 2) {
      const text = line.slice(cmd.length).trim();
      const res = await fetch(`/api/device/${serialEnc}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      appendLog('cmd', line, `${data.via || 'api'} · ${data.durationMs ?? 0}ms`);
      if (!data.ok) appendLog('err', data.error || data.stderr || 'Thất bại');
      return;
    }

    if (cmd === 'app' && parts.length >= 2) {
      const res = await fetch(`/api/device/${serialEnc}/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: parts[1] }),
      });
      const data = await res.json();
      appendLog('cmd', line, data.via || 'api');
      if (!data.ok) appendLog('err', data.error || data.stderr || 'Không mở được app');
      return;
    }

    if (cmd === 'screen' && parts.length >= 2) {
      const on = parts[1].toLowerCase() === 'on';
      const res = await fetch(`/api/device/${serialEnc}/display-power`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      const data = await res.json();
      appendLog('cmd', line, data.ok ? 'ok' : 'err');
      if (!data.ok) appendLog('err', data.error || 'Cần mở luồng kết nối trước.');
      return;
    }

    if (cmd === 'rotate') {
      client.sendJson({ type: 'rotate' });
      appendLog('cmd', line, 'scrcpy');
      return;
    }

    if (cmd === 'notif') {
      client.sendJson({ type: 'expand_notifications' });
      appendLog('cmd', line, 'scrcpy');
      return;
    }

    if (cmd === 'wait' || cmd === 'sleep') {
      const ms = Math.min(30000, Math.max(0, Number(parts[1]) || 300));
      appendLog('cmd', line, `${ms}ms`);
      await new Promise((r) => setTimeout(r, ms));
      return;
    }

    // Fallback: execute directly as `adb shell <command>`
    const res = await fetch(`/api/device/${serialEnc}/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: line }),
    });
    const data = await res.json();
    appendLog('cmd', line, `adb shell · ${data.durationMs ?? 0}ms`);
    if (data.stdout && data.stdout.trim()) appendLog('out', data.stdout.trim());
    if (data.stderr && data.stderr.trim()) appendLog('err', data.stderr.trim());
  } catch (err) {
    appendLog('cmd', line);
    appendLog('err', err.message);
  }
}

dom.consoleForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cmd = dom.consoleInput.value.trim();
  if (!cmd) return;
  state.cmdHistory.push(cmd);
  state.cmdHistoryIdx = state.cmdHistory.length;
  dom.consoleInput.value = '';
  executeCommandLine(cmd);
});

dom.consoleInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    if (state.cmdHistoryIdx > 0) {
      e.preventDefault();
      state.cmdHistoryIdx--;
      dom.consoleInput.value = state.cmdHistory[state.cmdHistoryIdx];
    }
  } else if (e.key === 'ArrowDown') {
    if (state.cmdHistoryIdx < state.cmdHistory.length - 1) {
      e.preventDefault();
      state.cmdHistoryIdx++;
      dom.consoleInput.value = state.cmdHistory[state.cmdHistoryIdx];
    } else {
      state.cmdHistoryIdx = state.cmdHistory.length;
      dom.consoleInput.value = '';
    }
  }
});

document.querySelectorAll('[data-quick-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    executeCommandLine(btn.dataset.quickCmd);
  });
});

// Macro Recorder & Script Runner
dom.btnRecordMacro.addEventListener('click', () => {
  state.recordingMacro = !state.recordingMacro;
  state.lastRecordTs = 0;
  dom.btnRecordMacro.classList.toggle('recording', state.recordingMacro);
  dom.btnRecordMacro.textContent = state.recordingMacro ? '■ Dừng ghi' : '● Ghi Macro';
  dom.recBadge.classList.toggle('visible', state.recordingMacro);
  if (state.recordingMacro) {
    dom.macroPanel.classList.add('open');
    toast('Đang ghi Macro: chạm/vuốt lên màn hình điện thoại để tạo lệnh tự động', 'ok');
  }
});

dom.btnToggleMacroEditor.addEventListener('click', () => {
  dom.macroPanel.classList.toggle('open');
});

dom.btnClearMacro.addEventListener('click', () => {
  dom.macroEditor.value = '';
});

dom.btnRunMacro.addEventListener('click', async () => {
  const lines = dom.macroEditor.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return toast('Chưa có lệnh nào trong kịch bản Macro.', 'err');

  dom.btnRunMacro.disabled = true;
  appendLog('sys', `▶ Bắt đầu chạy Macro (${lines.length} bước)...`);
  for (const line of lines) {
    await executeCommandLine(line);
  }
  appendLog('sys', '✓ Hoàn tất chạy Macro.');
  dom.btnRunMacro.disabled = false;
});

dom.btnCopyCli.addEventListener('click', async () => {
  const lines = dom.macroEditor.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return toast('Chưa có lệnh nào để copy.', 'err');

  const bashScript = [
    '#!/usr/bin/env bash',
    'set -e',
    ...lines.map((l) => {
      const [c, ...rest] = l.split(/\s+/);
      if (c === 'wait') return `sleep ${(Number(rest[0] || 300) / 1000).toFixed(2)}`;
      if (c === 'text') return `./bin/phone-ctl text "${rest.join(' ').replace(/"/g, '\\"')}"`;
      return `./bin/phone-ctl ${l}`;
    }),
  ].join('\n');

  try {
    await navigator.clipboard.writeText(bashScript);
    toast('Đã chép script bash (dùng ./bin/phone-ctl trên Crostini)', 'ok');
  } catch {
    appendLog('out', bashScript);
    toast('Đã in script bash ra khung Console', 'ok');
  }
});

// ==========================================================================
// Apps Launcher & Clipboard Sync
// ==========================================================================

async function loadAppsList() {
  if (state.demoMode) {
    state.apps = [
      { label: 'Cài đặt (Settings)', package: 'com.android.settings' },
      { label: 'Google Chrome', package: 'com.android.chrome' },
      { label: 'YouTube', package: 'com.google.android.youtube' },
      { label: 'Camera (Samsung)', package: 'com.sec.android.app.camera' },
      { label: 'Samsung Notes', package: 'com.samsung.android.app.notes' },
      { label: 'Zalo', package: 'com.zing.zalo' },
      { label: 'Telegram', package: 'org.telegram.messenger' },
    ];
    renderAppsList();
    return;
  }
  if (!state.selectedSerial) return;
  dom.appsList.innerHTML = `<div class="tip-box">Đang tải danh sách ứng dụng...</div>`;
  try {
    const res = await fetch(`/api/device/${encodeURIComponent(state.selectedSerial)}/apps`);
    const data = await res.json();
    state.apps = data.apps || [];
    renderAppsList();
  } catch (err) {
    dom.appsList.innerHTML = `<div class="tip-box">Lỗi tải ứng dụng: ${err.message}</div>`;
  }
}

function renderAppsList() {
  const q = dom.appsSearch.value.trim().toLowerCase();
  const filtered = state.apps.filter(
    (a) => a.label.toLowerCase().includes(q) || a.package.toLowerCase().includes(q)
  );
  if (filtered.length === 0) {
    dom.appsList.innerHTML = `<div class="tip-box">Không tìm thấy ứng dụng phù hợp.</div>`;
    return;
  }

  dom.appsList.innerHTML = '';
  for (const app of filtered) {
    const row = document.createElement('button');
    row.className = 'app-row';
    row.innerHTML = `
      <div class="app-info">
        <span class="app-name"></span>
        <span class="app-pkg"></span>
      </div>
      <span class="btn btn-sm">Mở</span>
    `;
    row.querySelector('.app-name').textContent = app.label;
    row.querySelector('.app-pkg').textContent = app.package;
    row.addEventListener('click', () => executeCommandLine(`app ${app.package}`));
    dom.appsList.appendChild(row);
  }
}

dom.appsSearch.addEventListener('input', renderAppsList);
dom.btnReloadApps.addEventListener('click', loadAppsList);

dom.btnClipPaste.addEventListener('click', () => {
  const text = dom.clipSendInput.value;
  if (!text) return toast('Nhập nội dung cần gửi trước.', 'err');
  if (state.demoMode) {
    demo.appendText(text);
    toast('Đã dán vào chế độ Mô phỏng', 'ok');
    return;
  }
  if (!state.connected) return toast('Cần kết nối luồng điện thoại trước.', 'err');
  client.sendJson({ type: 'clipboard', text, paste: true });
  toast('Đã gửi & dán vào điện thoại!', 'ok');
});

dom.btnClipCopy.addEventListener('click', () => {
  const text = dom.clipSendInput.value;
  if (!text) return toast('Nhập nội dung cần chép trước.', 'err');
  if (!state.connected) return toast('Cần kết nối luồng điện thoại trước.', 'err');
  client.sendJson({ type: 'clipboard', text, paste: false });
  toast('Đã đồng bộ sang Clipboard điện thoại!', 'ok');
});

dom.btnCopyFromPhone.addEventListener('click', async () => {
  const text = dom.clipPhoneBox.value;
  if (!text) return toast('Clipboard từ điện thoại đang trống.', 'err');
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép sang Chromebook!', 'ok');
  } catch {
    dom.clipPhoneBox.select();
    document.execCommand('copy');
    toast('Đã sao chép!', 'ok');
  }
});

// ==========================================================================
// Wireless Debugging Modal (Samsung Galaxy S26)
// ==========================================================================

function setModalFeedback(ok, text) {
  dom.wifiFeedback.className = `modal-feedback ${ok ? 'ok' : 'err'}`;
  dom.wifiFeedback.textContent = text;
}

function openWifiModal() {
  dom.wifiFeedback.className = 'modal-feedback';
  dom.wifiFeedback.textContent = '';
  dom.wifiModal.showModal();
}

dom.btnOpenWifi.addEventListener('click', openWifiModal);
dom.btnOverlayWifi.addEventListener('click', openWifiModal);
dom.btnCloseWifi.addEventListener('click', () => dom.wifiModal.close());

dom.wifiModal.addEventListener('click', (e) => {
  if (e.target === dom.wifiModal) dom.wifiModal.close();
});

document.querySelectorAll('.modal-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.mtab;
    document.querySelectorAll('.modal-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.modal-pane').forEach((p) => p.classList.toggle('active', p.id === `mpane-${target}`));
    dom.wifiFeedback.className = 'modal-feedback';
  });
});

dom.btnDoPair.addEventListener('click', async () => {
  const address = dom.pairAddr.value.trim();
  const code = dom.pairCode.value.trim();
  if (!address || !code) return setModalFeedback(false, 'Hãy nhập đủ IP:Port ghép nối và mã 6 chữ số.');

  dom.btnDoPair.disabled = true;
  setModalFeedback(true, 'Đang ghép nối với Samsung S26...');
  try {
    const res = await fetch('/api/adb/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, code }),
    });
    const data = await res.json();
    setModalFeedback(data.ok, data.message);
    if (data.ok) {
      // Pre-fill the IP prefix into step 2 connect box for convenience
      const ipOnly = address.split(':')[0];
      if (ipOnly && !dom.pairConnectAddr.value) {
        dom.pairConnectAddr.value = `${ipOnly}:`;
        dom.pairConnectAddr.focus();
      }
      toast('Ghép nối thành công! Giờ nhập IP:Port chính để kết nối.', 'ok');
    }
  } catch (err) {
    setModalFeedback(false, err.message);
  } finally {
    dom.btnDoPair.disabled = false;
  }
});

async function handleWirelessConnect(address) {
  const clean = String(address || '').trim();
  if (!clean) return setModalFeedback(false, 'Hãy nhập địa chỉ IP:Port (vd: 192.168.1.25:41289).');

  setModalFeedback(true, `Đang kết nối tới ${clean}...`);
  try {
    const res = await fetch('/api/adb/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: clean }),
    });
    const data = await res.json();
    setModalFeedback(data.ok, data.message);
    if (data.ok) {
      await refreshDevices(clean);
      setTimeout(() => {
        dom.wifiModal.close();
        startStream(false);
      }, 450);
    }
  } catch (err) {
    setModalFeedback(false, err.message);
  }
}

dom.btnDoPairConnect.addEventListener('click', () => handleWirelessConnect(dom.pairConnectAddr.value));
dom.btnDoConnect.addEventListener('click', () => handleWirelessConnect(dom.quickConnectAddr.value));

dom.btnDoTcpip.addEventListener('click', async () => {
  const usbDev = state.devices.find((d) => d.transport === 'usb' && d.state === 'device');
  if (!usbDev) {
    return setModalFeedback(false, 'Chưa thấy thiết bị USB nào. Hãy cắm cáp và chọn "Kết nối với Linux" trên ChromeOS.');
  }
  dom.btnDoTcpip.disabled = true;
  setModalFeedback(true, `Đang bật Wi-Fi ADB cho ${usbDev.displayName}...`);
  try {
    const res = await fetch('/api/adb/tcpip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: usbDev.serial, port: 5555 }),
    });
    const data = await res.json();
    setModalFeedback(data.ok, data.ok ? `Đã mở Wi-Fi tại ${data.wifiAddress}! Bạn có thể rút cáp USB.` : (data.stderr || 'Thất bại'));
    if (data.ok && data.wifiAddress) {
      await refreshDevices(data.wifiAddress);
      setTimeout(() => {
        dom.wifiModal.close();
        startStream(false);
      }, 600);
    }
  } catch (err) {
    setModalFeedback(false, err.message);
  } finally {
    dom.btnDoTcpip.disabled = false;
  }
});

// ==========================================================================
// Interactive Samsung S26 Demo Simulator (allows instant UI & Command testing)
// ==========================================================================

const demo = {
  width: 540,
  height: 1170,
  raf: null,
  activeApp: 'Home',
  notifOpen: false,
  scrollY: 0,
  noteText: 'Xin chào từ Chromebook!\nThử gõ phím hoặc chạy lệnh: tap, swipe, key HOME...',
  ripples: [],
  landscape: false,

  start() {
    state.demoMode = true;
    this.landscape = false;
    this.width = 540;
    this.height = 1170;
    dom.canvas.width = this.width;
    dom.canvas.height = this.height;
    updateOrientation(this.width, this.height);
    setConnectionVisual('demo');
    dom.statFps.textContent = '60';
    dom.statLatency.textContent = '4ms';
    dom.statMbps.textContent = 'Demo';
    loadAppsList();
    appendLog('sys', '[Mô phỏng] Đã bật Samsung S26 Simulator. Thử click icon, gõ phím, hoặc chạy lệnh: tap 135 520, swipe 270 900 270 300, key HOME.');

    const draw = () => {
      if (!state.demoMode) return;
      this.render();
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  },

  stop() {
    state.demoMode = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    setConnectionVisual('idle');
  },

  rotate() {
    this.landscape = !this.landscape;
    const tmp = this.width;
    this.width = this.height;
    this.height = tmp;
    dom.canvas.width = this.width;
    dom.canvas.height = this.height;
    updateOrientation(this.width, this.height);
  },

  toggleNotif() {
    this.notifOpen = !this.notifOpen;
  },

  appendText(txt) {
    this.activeApp = 'Samsung Notes';
    this.noteText += txt;
  },

  handleKey(code) {
    if (code === 'Backspace') this.noteText = this.noteText.slice(0, -1);
    else if (code === 'Enter') this.noteText += '\n';
    else if (code === 'Escape') this.handleHardware('BACK');
  },

  handleHardware(name) {
    if (name === 'HOME') { this.activeApp = 'Home'; this.notifOpen = false; }
    else if (name === 'BACK') { if (this.notifOpen) this.notifOpen = false; else this.activeApp = 'Home'; }
    else if (name === 'APP_SWITCH') { this.activeApp = 'Đa nhiệm'; }
  },

  handleScroll(v) {
    this.scrollY = Math.max(0, Math.min(300, this.scrollY - v * 12));
  },

  handleTouch(action, pt) {
    if (action === MOTION_ACTION.DOWN) {
      this.ripples.push({ x: pt.x, y: pt.y, t: performance.now() });
      if (this.activeApp === 'Home' && !this.landscape) {
        if (pt.y > 460 && pt.y < 600) {
          if (pt.x < 180) this.activeApp = 'Samsung Notes';
          else if (pt.x < 360) this.activeApp = 'Chrome';
          else this.activeApp = 'Cài đặt';
        }
      }
    }
  },

  runCommand(cmd, args, raw) {
    if (cmd === 'tap') {
      const x = Number(args[0]) || 270;
      const y = Number(args[1]) || 540;
      this.handleTouch(MOTION_ACTION.DOWN, { x, y });
      return `Simulated tap at (${x}, ${y})`;
    }
    if (cmd === 'swipe') {
      this.ripples.push({ x: Number(args[0]) || 270, y: Number(args[1]) || 800, t: performance.now() });
      this.ripples.push({ x: Number(args[2]) || 270, y: Number(args[3]) || 300, t: performance.now() + 80 });
      return `Simulated swipe (${args.slice(0, 4).join(' -> ')})`;
    }
    if (cmd === 'text' || cmd === 'paste') {
      const txt = raw.slice(cmd.length).trim();
      this.appendText(txt);
      return `Injected text: "${txt}"`;
    }
    if (cmd === 'key') {
      this.handleHardware((args[0] || '').toUpperCase());
      return `Sent key ${args[0]}`;
    }
    if (cmd === 'app') {
      this.activeApp = args[0] || 'App';
      return `Launched ${this.activeApp}`;
    }
    if (cmd === 'screen') {
      state.displayPowerOn = args[0] === 'on';
      dom.hwOled.classList.toggle('is-oled-off', !state.displayPowerOn);
      return `OLED physical display: ${state.displayPowerOn ? 'ON' : 'OFF'}`;
    }
    if (cmd === 'rotate') {
      this.rotate();
      return `Rotated to ${this.width}x${this.height}`;
    }
    if (raw.includes('battery')) {
      return 'level: 88\nstatus: 2 (Charging)\ntemperature: 312 (31.2°C)';
    }
    if (raw.includes('wm size')) {
      return `Physical size: 1440x3120\nStream size: ${this.width}x${this.height}`;
    }
    return `[Demo] Đã thực thi: ${raw}`;
  },

  render() {
    const ctx = dom.canvas.getContext('2d');
    const w = this.width;
    const h = this.height;

    // One UI deep slate-teal organic wallpaper gradient
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0d1b26');
    bg.addColorStop(0.5, '#111824');
    bg.addColorStop(1, '#0a1017');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle light glow
    const orb = ctx.createRadialGradient(w * 0.72, h * 0.24, 10, w * 0.72, h * 0.24, w * 0.75);
    orb.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
    orb.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);

    // Status bar
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    ctx.fillStyle = '#e5ebf5';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillText(timeStr, 28, 38);
    ctx.textAlign = 'right';
    ctx.fillText('Wi-Fi · 5G · 88%', w - 28, 38);
    ctx.textAlign = 'left';

    // Camera punch-hole
    ctx.fillStyle = '#050608';
    ctx.beginPath();
    ctx.arc(w / 2, 32, 11, 0, Math.PI * 2);
    ctx.fill();

    if (this.activeApp === 'Home') {
      // Clock widget
      ctx.fillStyle = '#f8fafc';
      ctx.font = '300 76px Inter, sans-serif';
      ctx.fillText(timeStr, 36, 190);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 20px Inter, sans-serif';
      ctx.fillText('Samsung Galaxy S26 · Chế độ Mô phỏng', 38, 228);

      // Search pill
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      roundRect(ctx, 32, 280, w - 64, 56, 28);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 18px Inter, sans-serif';
      ctx.fillText('Tìm kiếm hoặc bấm vào ứng dụng bên dưới...', 56, 315);

      // App icons row
      const icons = [
        { label: 'Notes', color: '#f59e0b', x: 64 },
        { label: 'Chrome', color: '#38bdf8', x: Math.round(w / 2 - 42) },
        { label: 'Cài đặt', color: '#10b981', x: w - 148 },
      ];
      for (const ic of icons) {
        ctx.fillStyle = ic.color;
        roundRect(ctx, ic.x, 480, 84, 84, 24);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '500 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ic.label, ic.x + 42, 592);
        ctx.textAlign = 'left';
      }
    } else {
      // App surface
      ctx.fillStyle = '#131720';
      roundRect(ctx, 18, 64, w - 36, h - 130, 20);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 22px Inter, sans-serif';
      ctx.fillText(this.activeApp, 42, 114);
      ctx.fillStyle = '#64748b';
      ctx.font = '400 14px Inter, sans-serif';
      ctx.fillText('Nhấn nút Home hoặc chuột phải để quay về màn hình chính', 42, 142);

      if (this.activeApp === 'Samsung Notes') {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '400 19px Inter, sans-serif';
        const lines = this.noteText.split('\n');
        lines.forEach((ln, idx) => {
          ctx.fillText(ln, 42, 200 + idx * 30 - this.scrollY);
        });
      }
    }

    // Notification shade
    if (this.notifOpen) {
      ctx.fillStyle = 'rgba(12, 15, 22, 0.94)';
      roundRect(ctx, 14, 58, w - 28, 250, 22);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 18px Inter, sans-serif';
      ctx.fillText('Thông báo · Gỡ lỗi không dây đang bật', 38, 108);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 15px Inter, sans-serif';
      ctx.fillText('LinkBridge đang đồng bộ clipboard & âm thanh', 38, 142);
    }

    // Gesture bar
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, w / 2 - 70, h - 22, 140, 5, 3);
    ctx.fill();

    // Touch ripples
    const tNow = performance.now();
    this.ripples = this.ripples.filter((r) => tNow - r.t < 420);
    for (const r of this.ripples) {
      const p = Math.max(0, (tNow - r.t) / 420);
      ctx.strokeStyle = `rgba(56, 189, 248, ${1 - p})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 12 + p * 36, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stopDemoMode() {
  if (state.demoMode) demo.stop();
}

dom.btnOverlayDemo.addEventListener('click', () => {
  demo.start();
});

// ==========================================================================
// Boot
// ==========================================================================

appendLog('sys', 'LinkBridge sẵn sàng (scrcpy v5.0.1 + WebCodecs). Gõ "help" để xem các lệnh nhanh.');
if (!ScrcpyWebClient.isWebCodecsSupported()) {
  appendLog('err', 'Cảnh báo: Trình duyệt hiện tại không có WebCodecs VideoDecoder. Hãy mở tại http://localhost:3000 bằng Chrome trên Chromebook.');
}

refreshDevices();
setInterval(() => {
  if (!state.connected && !state.connecting) {
    refreshDevices();
  }
}, 6000);

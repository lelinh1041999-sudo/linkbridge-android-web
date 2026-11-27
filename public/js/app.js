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
import { WebUsbScrcpyDriver } from './webusb-driver.js';

// ==========================================================================
// Bridge Endpoint Resolution (supports both localhost:3000 & GitHub Pages!)
// ==========================================================================

function isLocalHosted() {
  return ['localhost', '127.0.0.1', 'penguin.linux.test'].includes(location.hostname);
}

function getBridgeBase() {
  const saved = localStorage.getItem('lb_bridge_url');
  if (saved !== null) return saved.trim().replace(/\/+$/, '');
  return isLocalHosted() ? '' : 'http://127.0.0.1:3000';
}

function apiUrl(path) {
  return `${getBridgeBase()}${path}`;
}

// ==========================================================================
// State & DOM References
// ==========================================================================

const $ = (id) => document.getElementById(id);

const dom = {
  appShell: $('app-shell'),
  connDot: $('conn-dot'),
  deviceSelect: $('device-select'),
  btnRefreshDevices: $('btn-refresh-devices'),
  btnWebUsb: $('btn-webusb'),
  btnOpenWifi: $('btn-open-wifi'),
  btnConnectToggle: $('btn-connect-toggle'),
  btnInstallPwa: $('btn-install-pwa'),
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
  btnOverlayWebUsb: $('btn-overlay-webusb'),
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
  stageArea: document.querySelector('.stage-area'),
  phoneScreenWrap: document.querySelector('.phone-screen-wrap'),
  btnRatioTop: $('btn-ratio-top'),
  btnFullscreenTop: $('btn-fullscreen-top'),
  fsHud: $('fs-hud'),
  fsHandle: $('fs-handle'),
  fsBack: $('fs-back'),
  fsHome: $('fs-home'),
  fsRecents: $('fs-recents'),
  fsRotate: $('fs-rotate'),
  fsAutoOrient: $('fs-auto-orient'),
  fsFitMode: $('fs-fit-mode'),
  fsFitLabel: $('fs-fit-label'),
  fsOled: $('fs-oled'),
  fsExit: $('fs-exit'),
  ratioPopover: $('ratio-popover'),
  ratioPopTitle: $('ratio-pop-title'),
  ratioPopClose: $('ratio-pop-close'),
  ratioChips: $('ratio-chips'),
  ratioZoom: $('ratio-zoom'),
  ratioZoomVal: $('ratio-zoom-val'),
  ratioSx: $('ratio-sx'),
  ratioSxVal: $('ratio-sx-val'),
  ratioSy: $('ratio-sy'),
  ratioSyVal: $('ratio-sy-val'),
  ratioReset: $('ratio-reset'),

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
  setCodec: $('set-codec'),
  setCodecHint: $('set-codec-hint'),
  setAudio: $('set-audio'),
  setScreenOff: $('set-screenoff'),
  setStayAwake: $('set-stayawake'),
  setRightBack: $('set-rightback'),
  setTouchSwipe: $('set-touchswipe'),
  setInvertSwipe: $('set-invertswipe'),
  btnApplySettings: $('btn-apply-settings'),
  bridgeStatusTag: $('bridge-status-tag'),
  setBridgeUrl: $('set-bridge-url'),
  btnSaveBridge: $('btn-save-bridge'),

  wifiModal: $('wifi-modal'),
  wifiBridgeWarn: $('wifi-bridge-warn'),
  btnCloseWifi: $('btn-close-wifi'),
  pairAddr: $('pair-addr'),
  pairCode: $('pair-code'),
  pairConnectAddr: $('pair-connect-addr'),
  quickConnectAddr: $('quick-connect-addr'),
  btnDoPair: $('btn-do-pair'),
  btnDoPairConnect: $('btn-do-pair-connect'),
  btnWifiAuto: $('btn-wifi-auto'),
  btnWifiHome: $('btn-wifi-home'),
  btnWifiSchool: $('btn-wifi-school'),
  chkAutoTcpip: $('chk-auto-tcpip'),
  btnDoConnect: $('btn-do-connect'),
  btnDoTcpip: $('btn-do-tcpip'),
  wifiFeedback: $('wifi-feedback'),

  toastContainer: $('toast-container'),
};

const PRESETS = {
  wifi720: { maxSize: 720, maxFps: 60, bitRate: 3_000_000 },
  ultra120: { maxSize: 1080, maxFps: 120, bitRate: 12_000_000 },
  balanced60: { maxSize: 1080, maxFps: 60, bitRate: 8_000_000 },
  lowlat720: { maxSize: 720, maxFps: 60, bitRate: 5_000_000 },
  sharp1440: { maxSize: 1440, maxFps: 60, bitRate: 10_000_000 },
  sharp1920: { maxSize: 1920, maxFps: 60, bitRate: 12_000_000 },
  nativeMax: { maxSize: 0, maxFps: 60, bitRate: 16_000_000 },
};

const state = {
  bridgeOnline: false,
  mode: 'idle', // 'idle' | 'bridge' | 'webusb' | 'demo'
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
  webUsbDriver: null,
  deferredInstallPrompt: null,
  options: {
    maxSize: 1080,
    maxFps: 60,
    bitRate: 8_000_000,
    videoCodec: localStorage.getItem('lb_video_codec') === 'h265' ? 'h265' : 'h264',
    audio: true,
    stayAwake: false,
    turnScreenOff: false,
    rightClickBack: true,
    touchSwipeScroll: localStorage.getItem('lb_touch_swipe') !== 'false',
    invertTouchSwipe: localStorage.getItem('lb_invert_swipe') === 'true',
  },
};

// ==========================================================================
// PWA Service Worker & Install Button
// ==========================================================================

if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocalHosted())) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  dom.btnInstallPwa.style.display = 'inline-flex';
});

dom.btnInstallPwa.addEventListener('click', async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  const choice = await state.deferredInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    toast('Đã cài LinhBridge thành ứng dụng riêng!', 'ok');
    dom.btnInstallPwa.style.display = 'none';
  }
  state.deferredInstallPrompt = null;
});

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
  }, 3200);
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
    dom.overlayTitle.textContent = title || 'Điều khiển Samsung Galaxy S26';
    dom.overlayDesc.textContent =
      desc || 'Chọn USB trực tiếp (không cần cài gì trên Chrome) hoặc Wi-Fi không dây (với Bridge chạy ngầm trên Chromebook).';
    dom.screenOverlay.classList.remove('hidden');
    dom.btnConnectToggle.textContent = 'Kết nối';
    dom.btnConnectToggle.classList.remove('btn-danger');
    dom.btnConnectToggle.disabled = !state.selectedSerial;
    dom.statFps.textContent = '--';
    dom.statLatency.textContent = '--ms';
    dom.statRes.textContent = '---';
    dom.statMbps.textContent = '-- Mbps';
  }
  if (typeof updateFullscreenLayout === 'function') {
    requestAnimationFrame(() => updateFullscreenLayout());
  }
}

function updateOrientation(width, height) {
  if (!width || !height) return;
  dom.phoneBezel.classList.toggle('is-landscape', width > height);
  dom.statRes.textContent = `${width}×${height}`;
  updateFullscreenLayout(width, height);
}

// ==========================================================================
// Scrcpy WebCodecs Client (shared by Bridge WS & Direct WebUSB!)
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
      const label = state.mode === 'webusb' ? 'WebUSB trực tiếp' : `Bridge (${state.selectedSerial})`;
      appendLog('sys', `[scrcpy v5] Đã kết nối qua ${label} (WebCodecs Hardware Decode).`);
      toast(`Đã kết nối (${state.mode === 'webusb' ? 'WebUSB trực tiếp' : 'Wi-Fi Bridge'})!`, 'ok');
      loadAppsList();
      setTimeout(focusPhoneKeyboard, 80);
    } else if (status === 'disconnected') {
      const wasConnected = state.connected;
      state.connecting = false;
      state.connected = false;
      if (state.mode !== 'demo') {
        state.mode = 'idle';
        setConnectionVisual('idle');
      }
      if (wasConnected) {
        appendLog('sys', reason || 'Đã ngắt kết nối luồng.');
      }
    }
  },

  onMeta(meta) {
    if (meta.width && meta.height) updateOrientation(meta.width, meta.height);
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
    if (stats.width && stats.height) dom.statRes.textContent = `${stats.width}×${stats.height}`;
  },

  onLocalStats({ localFps, decodeLatencyMs }) {
    dom.statFps.textContent = String(localFps);
    dom.statLatency.textContent = `${decodeLatencyMs}ms`;
  },

  onClipboard(text) {
    dom.clipPhoneBox.value = text;
    if (text) {
      toast('Đã nhận Clipboard từ điện thoại', 'ok');
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
    if (!state.demoMode) {
      state.mode = 'idle';
      setConnectionVisual('idle', 'Kết nối không thành công', message);
    }
    appendLog('err', `[Lỗi] ${message}`);
    toast(message, 'err');
  },
});

// ==========================================================================
// Mode 1: Direct WebUSB Connection (100% Browser-Only, Zero Install!)
// ==========================================================================

async function connectWebUsbDirect(restartOnly = false) {
  if (!WebUsbScrcpyDriver.isSupported()) {
    toast('Trình duyệt hiện tại không hỗ trợ WebUSB. Hãy mở bằng Chrome / Edge.', 'err');
    return;
  }
  stopDemoMode();
  readSettingsFromForm();
  await client.ensureAudioContext();

  try {
    if (restartOnly && state.webUsbDriver && state.webUsbDriver.adb) {
      client.attachWebUsb(state.webUsbDriver, state.options);
      state.mode = 'webusb';
      await state.webUsbDriver.startStream(state.options);
      return;
    }

    await stopStream();
    state.mode = 'webusb';
    state.connecting = true;
    setConnectionVisual('connecting', 'Đang kết nối USB trực tiếp (WebUSB)...', 'Chọn Samsung S26 trong hộp thoại Chrome.');

    const driver = new WebUsbScrcpyDriver({
      onStatus: (s, msg) => client.cb.onStatus?.(s, msg),
      onMeta: (m) => client.applyMeta(m),
      onServerStats: (st) => client.cb.onServerStats?.(st),
      onClipboard: (t) => client.cb.onClipboard?.(t),
      onDisplayPower: (on) => client.cb.onDisplayPower?.(on),
      onVideoPacket: (flags, pts, payload) => client.handleVideoPacket(flags, pts, payload),
      onAudioPacket: (flags, pts, payload) => client.handleAudioPacket(flags, pts, payload),
      onError: (msg) => client.cb.onError?.(msg),
    });

    state.webUsbDriver = driver;
    client.attachWebUsb(driver, state.options);

    const info = await driver.connect(state.options);
    dom.deviceSelect.innerHTML = `<option value="webusb">${info.name} (WebUSB trực tiếp)</option>`;
    dom.deviceSelect.value = 'webusb';
  } catch (err) {
    if (state.webUsbDriver) {
      await state.webUsbDriver.disconnect().catch(() => {});
      state.webUsbDriver = null;
    }
    client.disconnect();
    state.mode = 'idle';
    state.connected = false;
    state.connecting = false;
    setConnectionVisual('idle', 'Chưa kết nối được USB', err.message);
    appendLog('err', `[WebUSB] ${err.message}`);
    toast(err.message, 'err');
  }
}

dom.btnWebUsb.addEventListener('click', () => connectWebUsbDirect(false));
dom.btnOverlayWebUsb.addEventListener('click', () => connectWebUsbDirect(false));

// ==========================================================================
// Mode 2: Local / Crostini Wi-Fi Bridge Device Discovery
// ==========================================================================

function updateBridgeUiStatus(online) {
  state.bridgeOnline = online;
  if (dom.bridgeStatusTag) {
    dom.bridgeStatusTag.textContent = online ? '● Đang chạy' : '○ Chưa bật';
    dom.bridgeStatusTag.style.color = online ? 'var(--signal-live)' : 'var(--signal-warn)';
  }
  if (dom.wifiBridgeWarn) {
    dom.wifiBridgeWarn.style.display = online ? 'none' : 'block';
  }
}

async function refreshDevices(autoSelectSerial = null) {
  if (state.mode === 'webusb' && state.connected) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(apiUrl('/api/devices'), { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    updateBridgeUiStatus(true);

    if (!data.adbAvailable && data.error) {
      dom.deviceSelect.innerHTML = `<option value="">Chưa cài ADB trên Crostini</option>`;
      dom.btnConnectToggle.disabled = true;
      return;
    }

    state.devices = data.devices || [];
    const prev = autoSelectSerial || state.selectedSerial;

    dom.deviceSelect.innerHTML = '';
    if (state.devices.length === 0) {
      dom.deviceSelect.innerHTML = `<option value="">Chưa thấy máy (Bấm USB hoặc Wi-Fi)</option>`;
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
  } catch {
    updateBridgeUiStatus(false);
    if (!state.connected && !state.demoMode) {
      dom.deviceSelect.innerHTML = `<option value="">Chế độ Web (Bấm USB trực tiếp)</option>`;
      state.selectedSerial = '';
      dom.btnConnectToggle.disabled = true;
    }
  }
}

function startBridgeStream(forceRestart = false) {
  if (!state.selectedSerial) {
    toast('Vui lòng ghép nối Wi-Fi hoặc chọn thiết bị trước.', 'err');
    return;
  }
  stopDemoMode();
  if (state.webUsbDriver) {
    state.webUsbDriver.disconnect().catch(() => {});
    state.webUsbDriver = null;
  }
  state.mode = 'bridge';
  readSettingsFromForm();
  client.ensureAudioContext();
  client.connect(state.selectedSerial, state.options, forceRestart, getBridgeBase());
}

async function stopStream() {
  if (state.demoMode) {
    stopDemoMode();
    return;
  }
  if (state.webUsbDriver) {
    const d = state.webUsbDriver;
    state.webUsbDriver = null;
    await d.disconnect().catch(() => {});
  }
  client.disconnect();
  state.mode = 'idle';
  state.connected = false;
  state.connecting = false;
  setConnectionVisual('idle');
  refreshDevices();
}

dom.deviceSelect.addEventListener('change', () => {
  state.selectedSerial = dom.deviceSelect.value;
  if (state.mode === 'bridge' && state.connected) {
    startBridgeStream(false);
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
    startBridgeStream(false);
  }
});

// ==========================================================================
// Pointer, Multi-touch Pinch, Scroll, Coordinate Picker & Macro Recorder
// ==========================================================================

let activePointerDown = false;
let activePointerId = null;
let dragStartPt = null;
let dragStartTime = 0;

function getPhoneCoords(e) {
  const rect = dom.canvas.getBoundingClientRect();
  const wrapRect = dom.canvas.parentElement?.getBoundingClientRect() || rect;
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
    cssX: e.clientX - wrapRect.left,
    cssY: e.clientY - wrapRect.top,
    mirrorCssX: (rect.left - wrapRect.left) + (rect.width - (e.clientX - rect.left)),
    mirrorCssY: (rect.top - wrapRect.top) + (rect.height - (e.clientY - rect.top)),
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
    dom.touchDot2.style.left = `${pt.mirrorCssX}px`;
    dom.touchDot2.style.top = `${pt.mirrorCssY}px`;
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

dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const activeTouchPointers = new Map();

function sendNativeTouch(action, pointerId, pt) {
  if (state.demoMode) {
    demo.handleTouch(action, pt);
    return;
  }
  if (!state.connected) return;
  const pressure = action === MOTION_ACTION.UP ? 0.0 : 1.0;
  client.sendBinary(
    encodeTouchEvent({
      action,
      pointerId: 100n + BigInt(pointerId),
      x: pt.x,
      y: pt.y,
      screenWidth: pt.w,
      screenHeight: pt.h,
      pressure,
    })
  );
}

dom.canvas.addEventListener('pointerdown', (e) => {
  if (!state.connected && !state.demoMode) return;
  e.preventDefault();

  if (state.connected && !state.audioMuted) {
    client.ensureAudioContext();
  }
  lastPointerType = e.pointerType || 'mouse';

  // Native multi-touch passthrough on Chromebook touchscreen (enables real 2-finger pinch-to-zoom!)
  if (e.pointerType === 'touch') {
    dom.imeProxy.readOnly = true;
    if (document.activeElement === dom.imeProxy) dom.imeProxy.blur();

    const pt = getPhoneCoords(e);
    if (!pt) return;
    try { dom.canvas.setPointerCapture(e.pointerId); } catch {}
    activeTouchPointers.set(e.pointerId, { pt, startPt: pt, startTime: Date.now() });
    sendNativeTouch(MOTION_ACTION.DOWN, e.pointerId, pt);
    if (activeTouchPointers.size === 1) showTouchDots(true, pt, false);
    else showTouchDots(false, null);
    return;
  }

  dom.imeProxy.readOnly = false;
  resetImeBuffer();
  dom.imeProxy.focus({ preventScroll: true });

  if (e.button === 1) return triggerHardwareKey('HOME');
  if (e.button === 2 && state.options.rightClickBack) return triggerHardwareKey('BACK');
  if (e.button !== 0) return;

  const pt = getPhoneCoords(e);
  if (!pt) return;

  if (state.coordHudOn && e.shiftKey) {
    dom.consoleInput.value = `tap ${pt.x} ${pt.y}`;
    dom.consoleInput.focus();
    toast(`Đã chép tọa độ: tap ${pt.x} ${pt.y}`, 'ok');
    return;
  }

  try { dom.canvas.setPointerCapture(e.pointerId); } catch {}
  activePointerDown = true;
  activePointerId = e.pointerId;
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

  if (e.pointerType === 'touch') {
    const entry = activeTouchPointers.get(e.pointerId);
    if (!entry || !pt) return;
    entry.pt = pt;
    sendNativeTouch(MOTION_ACTION.MOVE, e.pointerId, pt);
    if (activeTouchPointers.size === 1) showTouchDots(true, pt, false);
    return;
  }

  if (!activePointerDown || !pt) return;
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  showTouchDots(true, pt, e.ctrlKey);
  sendTouch(MOTION_ACTION.MOVE, pt, e.ctrlKey);
});

function finishPointer(e) {
  if (e.pointerType === 'touch') {
    const entry = activeTouchPointers.get(e.pointerId);
    if (!entry) return;
    activeTouchPointers.delete(e.pointerId);
    const pt = getPhoneCoords(e) || entry.pt;
    if (pt) sendNativeTouch(MOTION_ACTION.UP, e.pointerId, pt);
    if (activeTouchPointers.size === 0) showTouchDots(false, null);
    return;
  }

  if (!activePointerDown) return;
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  activePointerDown = false;
  activePointerId = null;
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

// ==========================================================================
// 2-Finger Trackpad Touch-Swipe (opens App Drawer, switches pages, scrolls)
// ==========================================================================

const POINTER_ID_WHEEL_SWIPE = -3n;

const wheelSwipe = {
  active: false,
  startX: 0,
  startY: 0,
  curX: 0,
  curY: 0,
  screenW: 0,
  screenH: 0,
  rectW: 0,
  rectH: 0,
  peakSpeed: 0,
  endTimer: null,
  cooldownUntil: 0,
};

function sendWheelTouch(action, x, y, w, h) {
  client.sendBinary(
    encodeTouchEvent({
      action,
      pointerId: POINTER_ID_WHEEL_SWIPE,
      x,
      y,
      screenWidth: w,
      screenHeight: h,
      pressure: action === MOTION_ACTION.UP ? 0.0 : 1.0,
    })
  );
}

function finishWheelSwipe(fromMomentumSnap = false) {
  if (wheelSwipe.endTimer) {
    clearTimeout(wheelSwipe.endTimer);
    wheelSwipe.endTimer = null;
  }
  if (!wheelSwipe.active) return;
  wheelSwipe.active = false;
  showTouchDots(false, null);

  if (state.connected) {
    sendWheelTouch(
      MOTION_ACTION.UP,
      wheelSwipe.curX,
      wheelSwipe.curY,
      wheelSwipe.screenW,
      wheelSwipe.screenH
    );
  }
  if (fromMomentumSnap) {
    // Swallow ChromeOS trackpad deceleration tail so it does not trigger a second swipe
    wheelSwipe.cooldownUntil = performance.now() + 260;
  }
}

dom.canvas.addEventListener(
  'wheel',
  (e) => {
    if (!state.connected && !state.demoMode) return;
    e.preventDefault();
    const pt = getPhoneCoords(e);
    if (!pt) return;

    if (state.demoMode) {
      const scale = e.deltaMode === 1 ? 1.0 : 1 / 48;
      return demo.handleScroll(Math.max(-16, Math.min(16, -e.deltaY * scale)));
    }

    // Legacy Android mouse scroll mode if user turns off 2-finger touch-swipe in Settings
    if (!state.options.touchSwipeScroll) {
      const scale = e.deltaMode === 1 ? 1.0 : 1 / 48;
      const hScroll = Math.max(-16, Math.min(16, -e.deltaX * scale));
      const vScroll = Math.max(-16, Math.min(16, -e.deltaY * scale));
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
      return;
    }

    // Ignore browser pinch-zoom wheel events (ctrlKey) so page doesn't zoom
    if (e.ctrlKey) return;

    const now = performance.now();
    if (!wheelSwipe.active && now < wheelSwipe.cooldownUntil) {
      return;
    }

    const unit = e.deltaMode === 1 ? 28 : 1;
    const sign = state.options.invertTouchSwipe ? 1 : -1;
    const gain = Math.max(1.5, (pt.h / Math.max(300, pt.rectH)) * 1.25);
    const dx = sign * e.deltaX * unit * gain;
    const dy = sign * e.deltaY * unit * gain;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    if (!wheelSwipe.active) {
      // Pad starting touch slightly inward from screen edges so swipe has ample travel
      const sx = Math.round(Math.max(pt.w * 0.16, Math.min(pt.w * 0.84, pt.x)));
      const sy = Math.round(Math.max(pt.h * 0.18, Math.min(pt.h * 0.82, pt.y)));
      wheelSwipe.active = true;
      wheelSwipe.startX = sx;
      wheelSwipe.startY = sy;
      wheelSwipe.curX = sx;
      wheelSwipe.curY = sy;
      wheelSwipe.screenW = pt.w;
      wheelSwipe.screenH = pt.h;
      wheelSwipe.rectW = pt.rectW;
      wheelSwipe.rectH = pt.rectH;
      wheelSwipe.peakSpeed = 0;

      sendWheelTouch(MOTION_ACTION.DOWN, sx, sy, pt.w, pt.h);
    }

    const nextX = Math.round(Math.max(12, Math.min(wheelSwipe.screenW - 12, wheelSwipe.curX + dx)));
    const nextY = Math.round(Math.max(12, Math.min(wheelSwipe.screenH - 12, wheelSwipe.curY + dy)));
    wheelSwipe.curX = nextX;
    wheelSwipe.curY = nextY;

    sendWheelTouch(MOTION_ACTION.MOVE, nextX, nextY, wheelSwipe.screenW, wheelSwipe.screenH);

    // Visual dot feedback matching current virtual finger position
    showTouchDots(true, {
      cssX: (nextX / Math.max(1, wheelSwipe.screenW)) * wheelSwipe.rectW,
      cssY: (nextY / Math.max(1, wheelSwipe.screenH)) * wheelSwipe.rectH,
      rectW: wheelSwipe.rectW,
      rectH: wheelSwipe.rectH,
    });

    const speed = Math.hypot(dx, dy);
    wheelSwipe.peakSpeed = Math.max(wheelSwipe.peakSpeed, speed);
    const traveled = Math.hypot(nextX - wheelSwipe.startX, nextY - wheelSwipe.startY);
    const hitEdge =
      nextX <= 16 || nextX >= wheelSwipe.screenW - 16 || nextY <= 16 || nextY >= wheelSwipe.screenH - 16;

    // Release crisply at high velocity when user finishes a flick (triggers One UI App Drawer / page snap!)
    const flingDistance = Math.min(wheelSwipe.screenW, wheelSwipe.screenH) * 0.44;
    if ((traveled >= flingDistance && speed < wheelSwipe.peakSpeed * 0.38) || (traveled >= 120 && hitEdge)) {
      finishWheelSwipe(true);
      return;
    }

    if (wheelSwipe.endTimer) clearTimeout(wheelSwipe.endTimer);
    wheelSwipe.endTimer = setTimeout(() => finishWheelSwipe(false), 85);
  },
  { passive: false }
);

// ==========================================================================
// Always-Ready Keyboard & ChromeOS Vietnamese Telex/VNI IME Input
// ==========================================================================

let isComposingIme = false;
let lastImeValue = '';

function isTypingInWebUi(el = document.activeElement) {
  if (!el || el === dom.imeProxy) return false;
  if (el.closest?.('dialog[open]')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

let lastPointerType = 'mouse';

function focusPhoneKeyboard() {
  if (lastPointerType === 'touch') return;
  if (!state.connected && !state.demoMode) return;
  if (document.querySelector('dialog[open]')) return;
  if (isTypingInWebUi()) return;
  dom.imeProxy.focus({ preventScroll: true });
}

function resetImeBuffer() {
  dom.imeProxy.value = '';
  lastImeValue = '';
}

function sendTypedText(text) {
  if (!text) return;
  if (state.demoMode) return demo.appendText(text);
  if (!state.connected) return;
  if (/^[\x20-\x7e]+$/.test(text)) {
    client.sendBinary(encodeInjectText(text));
  } else {
    client.sendJson({ type: 'clipboard', text, paste: true });
  }
}

function sendBackspaceCount(count) {
  for (let i = 0; i < count; i++) {
    if (state.demoMode) {
      demo.handleKey('Backspace');
    } else if (state.connected) {
      sendKeycode(KEY_ACTION.DOWN, 67, 0);
      sendKeycode(KEY_ACTION.UP, 67, 0);
    }
  }
}

function syncImeDiff(curr, allowReset = true) {
  const prev = lastImeValue;
  let k = 0;
  const minLen = Math.min(prev.length, curr.length);
  while (k < minLen && prev[k] === curr[k]) k++;

  const delCount = prev.length - k;
  const added = curr.slice(k);

  if (delCount > 0) sendBackspaceCount(delCount);
  if (added.length > 0) sendTypedText(added);

  if (allowReset && (!curr || /[\s\n]$/.test(curr) || curr.length > 40)) {
    resetImeBuffer();
  } else {
    lastImeValue = curr;
  }
}

dom.imeProxy.addEventListener('compositionstart', () => {
  isComposingIme = true;
});

dom.imeProxy.addEventListener('compositionupdate', () => {
  // Stream each letter + Vietnamese Telex tone mark live as the user types!
  syncImeDiff(dom.imeProxy.value, false);
});

dom.imeProxy.addEventListener('compositionend', (e) => {
  isComposingIme = false;
  const curr = dom.imeProxy.value;
  if (curr) {
    syncImeDiff(curr, true);
  } else if (e.data) {
    syncImeDiff(e.data, true);
  }
});

dom.imeProxy.addEventListener('input', () => {
  // Always sync immediately (even while ChromeOS VI IME is composing)
  syncImeDiff(dom.imeProxy.value, !isComposingIme);
});

const DIRECT_CONTROL_CODES = new Set([
  'Enter', 'NumpadEnter', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

async function handlePhoneKeyDown(e) {
  if (!state.connected && !state.demoMode) return;
  if (isComposingIme || e.isComposing) return;

  // Backspace: let #ime-proxy handle it if buffer has pending word (for Telex), else send directly to phone
  if (e.code === 'Backspace') {
    if (lastImeValue.length > 0) return;
    e.preventDefault();
    if (state.demoMode) return demo.handleKey('Backspace');
    sendKeycode(KEY_ACTION.DOWN, 67, getAndroidMetaState(e));
    return;
  }

  // Ctrl+V -> pull Chromebook clipboard and paste into Samsung S26
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
    e.preventDefault();
    resetImeBuffer();
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        if (state.demoMode) demo.appendText(clipText);
        else client.sendJson({ type: 'clipboard', text: clipText, paste: true });
        toast('Đã dán từ Clipboard máy tính', 'ok');
      }
    } catch {
      sendKeycode(KEY_ACTION.DOWN, 50, 0x1000);
      sendKeycode(KEY_ACTION.UP, 50, 0x1000);
    }
    return;
  }

  const isShortcut = (e.ctrlKey || e.metaKey || e.altKey) && CODE_TO_ANDROID_KEYCODE[e.code];
  if (DIRECT_CONTROL_CODES.has(e.code) || isShortcut) {
    e.preventDefault();
    resetImeBuffer();
    const kc = CODE_TO_ANDROID_KEYCODE[e.code];
    if (!kc) return;
    if (state.demoMode) return demo.handleKey(e.code);
    sendKeycode(KEY_ACTION.DOWN, kc, getAndroidMetaState(e));
    if (state.recordingMacro && DIRECT_CONTROL_CODES.has(e.code)) {
      recordMacroLine(`key ${e.code.toUpperCase()}`);
    }
  }
}

dom.imeProxy.addEventListener('keydown', handlePhoneKeyDown);

dom.imeProxy.addEventListener('keyup', (e) => {
  if (!state.connected || isComposingIme) return;
  if (e.code === 'Backspace' && lastImeValue.length === 0) {
    return sendKeycode(KEY_ACTION.UP, 67, getAndroidMetaState(e));
  }
  const isShortcut = (e.ctrlKey || e.metaKey || e.altKey) && CODE_TO_ANDROID_KEYCODE[e.code];
  if (DIRECT_CONTROL_CODES.has(e.code) || isShortcut) {
    const kc = CODE_TO_ANDROID_KEYCODE[e.code];
    if (kc) sendKeycode(KEY_ACTION.UP, kc, getAndroidMetaState(e));
  }
});

// Global auto-capture: whenever user starts typing while NOT inside a web input box,
// route keyboard immediately to Samsung S26 without requiring a click on the phone canvas!
window.addEventListener('keydown', (e) => {
  if (!state.connected && !state.demoMode) return;
  if (document.activeElement === dom.imeProxy) return;
  if (isTypingInWebUi(e.target) || isTypingInWebUi(document.activeElement)) return;
  if (document.querySelector('dialog[open]')) return;

  // Physical keyboard press: re-enable keyboard proxy immediately
  lastPointerType = 'mouse';

  // Focus hidden IME proxy immediately so this key and all subsequent Telex keys go to phone
  dom.imeProxy.focus({ preventScroll: true });

  // Handle control keys immediately on the first keystroke
  if (e.code === 'Backspace' || DIRECT_CONTROL_CODES.has(e.code) || ((e.ctrlKey || e.metaKey) && CODE_TO_ANDROID_KEYCODE[e.code])) {
    handlePhoneKeyDown(e);
  }
});

// Keep keyboard ready after clicking phone stage with mouse/trackpad or returning to tab (never on touch!)
window.addEventListener('focus', () => setTimeout(focusPhoneKeyboard, 30));
document.querySelector('.stage-area')?.addEventListener('pointerup', (e) => {
  lastPointerType = e.pointerType || 'mouse';
  if (e.pointerType === 'touch') {
    if (document.activeElement === dom.imeProxy) dom.imeProxy.blur();
    return;
  }
  setTimeout(focusPhoneKeyboard, 10);
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
  if (!state.connected) return toast('Hãy kết nối thiết bị trước.', 'err');
  if (name === 'BACK') client.sendJson({ type: 'back_or_screen_on' });
  else client.sendJson({ type: 'key', keycode: name });
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
    toast(next ? 'Đã bật màn hình điện thoại' : 'Đã tắt màn hình OLED trên ĐT', 'ok');
    return;
  }
  if (!state.connected) return toast('Chưa kết nối thiết bị.', 'err');
  client.sendJson({ type: 'display_power', on: next });
  toast(next ? 'Đã bật màn hình vật lý trên ĐT' : 'Đã tắt màn hình OLED trên ĐT (vẫn thao tác trên web)', 'ok');
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

dom.hwScreenshot.addEventListener('click', async () => {
  if (state.demoMode) {
    const a = document.createElement('a');
    a.download = `linhbridge-demo-${Date.now()}.png`;
    a.href = dom.canvas.toDataURL('image/png');
    a.click();
    return toast('Đã lưu ảnh màn hình (PNG)', 'ok');
  }
  if (state.mode === 'webusb' && state.webUsbDriver) {
    try {
      toast('Đang chụp ảnh màn hình gốc qua USB...', 'ok');
      const blob = await state.webUsbDriver.takeScreenshotBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `s26-screenshot-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast(`Lỗi chụp ảnh: ${err.message}`, 'err');
    }
    return;
  }
  if (!state.selectedSerial) return toast('Chưa chọn thiết bị.', 'err');
  const a = document.createElement('a');
  a.href = apiUrl(`/api/device/${encodeURIComponent(state.selectedSerial)}/screenshot`);
  a.download = `s26-screenshot-${Date.now()}.png`;
  a.click();
  toast('Đang tải ảnh chụp màn hình gốc...', 'ok');
});

dom.hwCoord.addEventListener('click', () => {
  state.coordHudOn = !state.coordHudOn;
  dom.hwCoord.classList.toggle('is-active', state.coordHudOn);
  dom.coordHud.classList.toggle('visible', state.coordHudOn);
  if (state.coordHudOn) toast('Bật thước tọa độ: giữ Shift + Click lên màn hình để lấy lệnh tap', 'ok');
});

// ==========================================================================
// Fullscreen Controller (Auto-fit Chromebook screen for Portrait & Landscape)
// ==========================================================================

const FS_MODES = ['fit', 'fill', 'stretch', '16:9', '16:10', '4:3'];
const FS_MODE_LABELS = {
  fit: 'Gốc',
  fill: 'Tràn viền',
  stretch: 'Kéo kín',
  '16:9': '16:9',
  '16:10': '16:10',
  '4:3': '4:3',
};
const FIXED_RATIOS = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '4:3': 4 / 3,
};

let fsHudHideTimer = null;

function isFullscreenActive() {
  return Boolean(document.fullscreenElement && dom.stageArea && document.fullscreenElement === dom.stageArea);
}

function getCurrentVideoSize(overrideW, overrideH) {
  const w = overrideW || (state.demoMode ? demo.width : (client.width || dom.canvas.width || 380));
  const h = overrideH || (state.demoMode ? demo.height : (client.height || dom.canvas.height || 820));
  return { w, h };
}

function getDisplayConfig(isLandscape) {
  const key = isLandscape ? 'linhbridge_display_cfg_land' : 'linhbridge_display_cfg_port';
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: FS_MODES.includes(parsed.mode) ? parsed.mode : 'fit',
        zoom: Math.max(100, Math.min(160, Number(parsed.zoom) || 100)),
        scaleX: Math.max(60, Math.min(150, Number(parsed.scaleX) || 100)),
        scaleY: Math.max(60, Math.min(150, Number(parsed.scaleY) || 100)),
      };
    }
  } catch {}
  // Fallback migration from older linhbridge_fs_mode_* key
  const legacyKey = isLandscape ? 'linhbridge_fs_mode_land' : 'linhbridge_fs_mode_port';
  const legacyMode = localStorage.getItem(legacyKey);
  return {
    mode: FS_MODES.includes(legacyMode) ? legacyMode : 'fit',
    zoom: 100,
    scaleX: 100,
    scaleY: 100,
  };
}

function saveDisplayConfig(isLandscape, cfg) {
  const key = isLandscape ? 'linhbridge_display_cfg_land' : 'linhbridge_display_cfg_port';
  localStorage.setItem(key, JSON.stringify({
    mode: FS_MODES.includes(cfg.mode) ? cfg.mode : 'fit',
    zoom: Math.max(100, Math.min(160, Math.round(Number(cfg.zoom) || 100))),
    scaleX: Math.max(60, Math.min(150, Math.round(Number(cfg.scaleX) || 100))),
    scaleY: Math.max(60, Math.min(150, Math.round(Number(cfg.scaleY) || 100))),
  }));
}

function isCustomDisplayConfig(cfg) {
  return cfg.mode !== 'fit' || cfg.zoom !== 100 || cfg.scaleX !== 100 || cfg.scaleY !== 100;
}

function syncRatioPopoverUi(isLandscape, cfg) {
  if (!dom.ratioPopover) return;
  if (dom.ratioPopTitle) {
    dom.ratioPopTitle.textContent = `Tỉ lệ hiển thị (${isLandscape ? 'Xoay ngang' : 'Xoay dọc'})`;
  }
  dom.ratioChips?.querySelectorAll('.ratio-chip').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.ratioMode === cfg.mode);
  });
  if (dom.ratioZoom) dom.ratioZoom.value = String(cfg.zoom);
  if (dom.ratioZoomVal) dom.ratioZoomVal.textContent = `${cfg.zoom}%`;
  if (dom.ratioSx) dom.ratioSx.value = String(cfg.scaleX);
  if (dom.ratioSxVal) dom.ratioSxVal.textContent = `${cfg.scaleX}%`;
  if (dom.ratioSy) dom.ratioSy.value = String(cfg.scaleY);
  if (dom.ratioSyVal) dom.ratioSyVal.textContent = `${cfg.scaleY}%`;
  dom.btnRatioTop?.classList.toggle('is-active', isCustomDisplayConfig(cfg));
}

function toggleRatioPopover(forceOpen) {
  if (!dom.ratioPopover) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : !dom.ratioPopover.classList.contains('is-open');
  dom.ratioPopover.classList.toggle('is-open', open);
  if (open) {
    const { w, h } = getCurrentVideoSize();
    const isLandscape = w > h;
    syncRatioPopoverUi(isLandscape, getDisplayConfig(isLandscape));
    if (isFullscreenActive()) {
      clearTimeout(fsHudHideTimer);
      dom.fsHud?.classList.remove('is-hidden');
    }
  } else if (isFullscreenActive()) {
    showFsHudTemporarily(2200);
  }
}

// Track pointer type globally (capture phase) so touch vs mouse state is always accurate
window.addEventListener('pointerdown', (e) => {
  lastPointerType = e.pointerType || 'mouse';
  if (e.pointerType === 'touch') {
    dom.imeProxy.readOnly = true;
    if (document.activeElement === dom.imeProxy) dom.imeProxy.blur();
  }
  if (
    dom.ratioPopover?.classList.contains('is-open') &&
    !dom.ratioPopover.contains(e.target) &&
    !dom.btnRatioTop?.contains(e.target) &&
    !dom.fsFitMode?.contains(e.target)
  ) {
    toggleRatioPopover(false);
  }
}, true);

function updateFullscreenLayout(overrideW, overrideH) {
  const active = isFullscreenActive();
  const isLive = Boolean(state.connected || state.demoMode);
  dom.stageArea?.classList.toggle('is-fullscreen', active);
  dom.phoneBezel?.classList.toggle('is-live', isLive);
  dom.hwFullscreen?.classList.toggle('is-active', active);
  dom.btnFullscreenTop?.classList.toggle('is-active', active);

  // When idle (showing onboarding overlay), let CSS size the onboarding card naturally
  if (!active && !isLive) {
    dom.canvas.style.width = '';
    dom.canvas.style.height = '';
    if (dom.phoneScreenWrap) {
      dom.phoneScreenWrap.style.width = '';
      dom.phoneScreenWrap.style.height = '';
    }
    return;
  }

  const { w, h } = getCurrentVideoSize(overrideW, overrideH);
  const stageW = dom.stageArea?.clientWidth || window.innerWidth || screen.width;
  const stageH = dom.stageArea?.clientHeight || window.innerHeight || screen.height;
  if (!w || !h || !stageW || !stageH) return;

  const isLandscape = w > h;
  const cfg = getDisplayConfig(isLandscape);

  let boxW;
  let boxH;
  if (active) {
    boxW = stageW;
    boxH = stageH;
  } else {
    const isPortraitCb = stageH > stageW;
    const hwRailReserve = isPortraitCb ? 56 : 74;
    const bezelPad = isPortraitCb ? 24 : 44;
    const hintReserve = isPortraitCb ? 14 : 42;
    boxW = Math.max(220, stageW - hwRailReserve - bezelPad);
    boxH = Math.max(220, stageH - bezelPad - hintReserve);
  }

  let baseW;
  let baseH;
  if (cfg.mode === 'stretch') {
    baseW = boxW;
    baseH = boxH;
  } else if (cfg.mode === 'fill') {
    const scale = Math.max(boxW / w, boxH / h);
    baseW = w * scale;
    baseH = h * scale;
  } else if (FIXED_RATIOS[cfg.mode]) {
    const r = isLandscape ? FIXED_RATIOS[cfg.mode] : (1 / FIXED_RATIOS[cfg.mode]);
    if (boxW / boxH > r) {
      baseH = boxH;
      baseW = boxH * r;
    } else {
      baseW = boxW;
      baseH = boxW / r;
    }
  } else {
    const scale = Math.min(boxW / w, boxH / h);
    baseW = w * scale;
    baseH = h * scale;
  }

  const cssW = Math.max(120, Math.round(baseW * (cfg.zoom / 100) * (cfg.scaleX / 100)));
  const cssH = Math.max(120, Math.round(baseH * (cfg.zoom / 100) * (cfg.scaleY / 100)));

  dom.canvas.style.width = `${cssW}px`;
  dom.canvas.style.height = `${cssH}px`;

  if (dom.phoneScreenWrap) {
    if (active) {
      dom.phoneScreenWrap.style.width = '';
      dom.phoneScreenWrap.style.height = '';
    } else {
      dom.phoneScreenWrap.style.width = `${Math.min(boxW, cssW)}px`;
      dom.phoneScreenWrap.style.height = `${Math.min(boxH, cssH)}px`;
    }
  }

  const labelSuffix = cfg.zoom !== 100 ? ` ${cfg.zoom}%` : '';
  if (dom.fsFitLabel) {
    dom.fsFitLabel.textContent = `${FS_MODE_LABELS[cfg.mode] || 'Gốc'}${labelSuffix}`;
  }
  if (dom.fsOled) {
    dom.fsOled.classList.toggle('is-oled-off', !state.displayPowerOn);
  }
  syncRatioPopoverUi(isLandscape, cfg);
}

function showFsHudTemporarily(ms = 2600) {
  if (!dom.fsHud || !isFullscreenActive()) return;
  dom.fsHud.classList.remove('is-hidden');
  clearTimeout(fsHudHideTimer);
  fsHudHideTimer = setTimeout(() => {
    const popoverOpen = dom.ratioPopover?.classList.contains('is-open');
    const hoveredWithMouse = lastPointerType !== 'touch' && dom.fsHud.matches(':hover');
    if (isFullscreenActive() && !hoveredWithMouse && !popoverOpen) {
      dom.fsHud.classList.add('is-hidden');
    }
  }, ms);
}

function toggleFullscreen() {
  if (!dom.stageArea) return;
  if (!document.fullscreenElement) {
    dom.stageArea.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

dom.hwFullscreen?.addEventListener('click', toggleFullscreen);
dom.btnFullscreenTop?.addEventListener('click', toggleFullscreen);
dom.fsExit?.addEventListener('click', () => document.exitFullscreen?.().catch(() => {}));

dom.btnRatioTop?.addEventListener('click', () => toggleRatioPopover());
dom.fsFitMode?.addEventListener('click', () => toggleRatioPopover());
dom.ratioPopClose?.addEventListener('click', () => toggleRatioPopover(false));

dom.ratioChips?.addEventListener('click', (e) => {
  const btn = e.target.closest('.ratio-chip');
  if (!btn) return;
  const mode = btn.dataset.ratioMode;
  if (!FS_MODES.includes(mode)) return;
  const { w, h } = getCurrentVideoSize();
  const isLandscape = w > h;
  const cfg = getDisplayConfig(isLandscape);
  cfg.mode = mode;
  saveDisplayConfig(isLandscape, cfg);
  updateFullscreenLayout();
});

function bindRatioSlider(inputEl, prop) {
  inputEl?.addEventListener('input', () => {
    const { w, h } = getCurrentVideoSize();
    const isLandscape = w > h;
    const cfg = getDisplayConfig(isLandscape);
    cfg[prop] = Number(inputEl.value);
    saveDisplayConfig(isLandscape, cfg);
    updateFullscreenLayout();
  });
}
bindRatioSlider(dom.ratioZoom, 'zoom');
bindRatioSlider(dom.ratioSx, 'scaleX');
bindRatioSlider(dom.ratioSy, 'scaleY');

dom.ratioReset?.addEventListener('click', () => {
  const { w, h } = getCurrentVideoSize();
  const isLandscape = w > h;
  saveDisplayConfig(isLandscape, { mode: 'fit', zoom: 100, scaleX: 100, scaleY: 100 });
  updateFullscreenLayout();
  toast('Đã đặt lại tỉ lệ về mặc định (100%).', 'ok');
});

dom.fsBack?.addEventListener('click', () => dom.hwBack?.click());
dom.fsHome?.addEventListener('click', () => dom.hwHome?.click());
dom.fsRecents?.addEventListener('click', () => dom.hwRecents?.click());
dom.fsRotate?.addEventListener('click', () => {
  dom.hwRotate?.click();
  showFsHudTemporarily(2800);
});
dom.fsOled?.addEventListener('click', () => {
  dom.hwOled?.click();
  setTimeout(() => dom.fsOled?.classList.toggle('is-oled-off', !state.displayPowerOn), 120);
  showFsHudTemporarily(2500);
});

document.addEventListener('fullscreenchange', () => {
  updateFullscreenLayout();
  requestAnimationFrame(() => updateFullscreenLayout());
  setTimeout(() => updateFullscreenLayout(), 160);
  setTimeout(() => updateFullscreenLayout(), 360);
  if (isFullscreenActive()) {
    showFsHudTemporarily(3200);
    setTimeout(focusPhoneKeyboard, 80);
  } else {
    clearTimeout(fsHudHideTimer);
    dom.fsHud?.classList.remove('is-hidden');
  }
});

// Observe actual .stage-area dimension changes (fullscreen animations, drawer collapse, Chromebook fold)
if (typeof ResizeObserver !== 'undefined' && dom.stageArea) {
  const stageRo = new ResizeObserver(() => {
    updateFullscreenLayout();
  });
  stageRo.observe(dom.stageArea);
}

let autoOrientOnFold = localStorage.getItem('linhbridge_auto_orient_fold') !== 'false';
let lastCbPortrait = null;
let lastAutoRotateTs = 0;

function syncAutoOrientUi() {
  if (!dom.fsAutoOrient) return;
  dom.fsAutoOrient.classList.toggle('is-accent', autoOrientOnFold);
}
syncAutoOrientUi();

function handleChromebookOrientationChange(fromUserAction = false) {
  const vw = window.innerWidth || screen.width;
  const vh = window.innerHeight || screen.height;
  if (!vw || !vh) return;
  const cbIsPortrait = vh > vw;

  dom.appShell?.classList.toggle('is-tablet-portrait', cbIsPortrait);

  // When Chromebook is folded vertically into Tablet Portrait mode:
  if (cbIsPortrait && lastCbPortrait !== true) {
    // Auto-collapse right drawer so the vertical phone fills the vertical Chromebook
    if (!dom.appShell?.classList.contains('drawer-collapsed')) {
      dom.appShell?.classList.add('drawer-collapsed');
      dom.btnToggleDrawer?.classList.remove('is-active');
    }

    // If phone is currently Landscape, auto-rotate it to Portrait to match the folded Chromebook!
    if (autoOrientOnFold && (state.connected || state.demoMode)) {
      const { w, h } = getCurrentVideoSize();
      const now = Date.now();
      if (w > h && now - lastAutoRotateTs > 1500) {
        lastAutoRotateTs = now;
        if (state.demoMode) demo.rotate();
        else client.sendJson({ type: 'rotate' });
        if (!fromUserAction) {
          toast('Đã phát hiện gập Chromebook dọc → tự xoay điện thoại theo chiều dọc!', 'ok');
        }
      }
    }
  }

  lastCbPortrait = cbIsPortrait;
  if (isFullscreenActive()) {
    updateFullscreenLayout();
  }
}

dom.fsHandle?.addEventListener('click', () => {
  showFsHudTemporarily(4000);
});

dom.fsAutoOrient?.addEventListener('click', () => {
  autoOrientOnFold = !autoOrientOnFold;
  localStorage.setItem('linhbridge_auto_orient_fold', String(autoOrientOnFold));
  syncAutoOrientUi();
  toast(
    autoOrientOnFold
      ? 'Bật tự xoay dọc theo Chromebook khi gập máy'
      : 'Tắt tự xoay theo Chromebook (xoay thủ công)',
    'ok'
  );
  if (autoOrientOnFold) {
    lastCbPortrait = null;
    handleChromebookOrientationChange(true);
  }
  showFsHudTemporarily(2800);
});

window.addEventListener('resize', () => {
  handleChromebookOrientationChange(false);
});

if (screen.orientation && screen.orientation.addEventListener) {
  screen.orientation.addEventListener('change', () => {
    setTimeout(() => handleChromebookOrientationChange(false), 120);
  });
}

// Initialize layout immediately if already opened in vertical folded mode
handleChromebookOrientationChange(true);

dom.stageArea?.addEventListener('pointermove', (e) => {
  if (!isFullscreenActive()) return;
  if (e.clientY <= 56) {
    showFsHudTemporarily(2600);
  }
});

dom.fsHud?.addEventListener('pointerenter', () => {
  clearTimeout(fsHudHideTimer);
  dom.fsHud.classList.remove('is-hidden');
});

dom.fsHud?.addEventListener('pointerleave', () => {
  showFsHudTemporarily(1800);
});

window.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    toggleFullscreen();
  }
});

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
  if (dom.setCodec) {
    state.options.videoCodec = dom.setCodec.value === 'h265' ? 'h265' : 'h264';
    localStorage.setItem('lb_video_codec', state.options.videoCodec);
  }
  state.options.audio = dom.setAudio.checked;
  state.options.turnScreenOff = dom.setScreenOff.checked;
  state.options.stayAwake = dom.setStayAwake.checked;
  state.options.rightClickBack = dom.setRightBack.checked;
  if (dom.setTouchSwipe) state.options.touchSwipeScroll = dom.setTouchSwipe.checked;
  if (dom.setInvertSwipe) state.options.invertTouchSwipe = dom.setInvertSwipe.checked;
}

if (dom.setCodec) {
  dom.setCodec.value = state.options.videoCodec;
  dom.setCodec.addEventListener('change', async () => {
    if (dom.setCodec.value === 'h265') {
      const ok = await ScrcpyWebClient.isHevcSupported();
      if (!ok) {
        toast('Chrome trên máy này báo chưa hỗ trợ giải mã phần cứng H.265 — nếu bị màn hình đen hãy đổi lại H.264.', 'warn');
      } else {
        toast('Chromebook hỗ trợ giải mã phần cứng H.265! Bấm "Áp dụng cài đặt" để dùng.', 'ok');
      }
    }
  });
}

if (dom.setTouchSwipe) {
  dom.setTouchSwipe.checked = state.options.touchSwipeScroll;
  dom.setTouchSwipe.addEventListener('change', () => {
    state.options.touchSwipeScroll = dom.setTouchSwipe.checked;
    localStorage.setItem('lb_touch_swipe', String(state.options.touchSwipeScroll));
  });
}

if (dom.setInvertSwipe) {
  dom.setInvertSwipe.checked = state.options.invertTouchSwipe;
  dom.setInvertSwipe.addEventListener('change', () => {
    state.options.invertTouchSwipe = dom.setInvertSwipe.checked;
    localStorage.setItem('lb_invert_swipe', String(state.options.invertTouchSwipe));
  });
}

dom.setBitrate.addEventListener('input', () => {
  dom.setBitrateVal.textContent = `${dom.setBitrate.value} Mbps`;
});

dom.setRightBack.addEventListener('change', () => {
  state.options.rightClickBack = dom.setRightBack.checked;
});

function reconnectWithNewSettings() {
  if (!state.connected) return;
  if (state.mode === 'webusb') connectWebUsbDirect(true);
  else if (state.mode === 'bridge') startBridgeStream(true);
}

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
    reconnectWithNewSettings();
  }
});

dom.btnApplySettings.addEventListener('click', () => {
  readSettingsFromForm();
  if (state.connected) {
    reconnectWithNewSettings();
    toast('Đã áp dụng cài đặt & tải lại luồng', 'ok');
  } else {
    toast('Đã lưu cài đặt cho lần kết nối tiếp theo', 'ok');
  }
});

dom.setBridgeUrl.value = getBridgeBase() || location.origin;
dom.btnSaveBridge.addEventListener('click', () => {
  const val = dom.setBridgeUrl.value.trim().replace(/\/+$/, '');
  if (!val || val === location.origin) localStorage.removeItem('lb_bridge_url');
  else localStorage.setItem('lb_bridge_url', val);
  refreshDevices();
  toast('Đã lưu địa chỉ Wi-Fi Bridge', 'ok');
});

// ==========================================================================
// Direct Client-Side Touch/Swipe Injector (works on both WebUSB & Bridge!)
// ==========================================================================

async function injectTapDirect(x, y) {
  const w = client.width || dom.canvas.width;
  const h = client.height || dom.canvas.height;
  client.sendBinary(encodeTouchEvent({ action: MOTION_ACTION.DOWN, x, y, screenWidth: w, screenHeight: h, pressure: 1 }));
  await new Promise((r) => setTimeout(r, 25));
  client.sendBinary(encodeTouchEvent({ action: MOTION_ACTION.UP, x, y, screenWidth: w, screenHeight: h, pressure: 0 }));
}

async function injectSwipeDirect(x1, y1, x2, y2, durationMs = 260) {
  const w = client.width || dom.canvas.width;
  const h = client.height || dom.canvas.height;
  const steps = Math.max(4, Math.min(30, Math.round(durationMs / 16)));
  const stepMs = Math.max(8, Math.round(durationMs / steps));
  client.sendBinary(encodeTouchEvent({ action: MOTION_ACTION.DOWN, x: x1, y: y1, screenWidth: w, screenHeight: h, pressure: 1 }));
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, stepMs));
    const t = i / steps;
    client.sendBinary(
      encodeTouchEvent({
        action: MOTION_ACTION.MOVE,
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
        screenWidth: w,
        screenHeight: h,
        pressure: 1,
      })
    );
  }
  client.sendBinary(encodeTouchEvent({ action: MOTION_ACTION.UP, x: x2, y: y2, screenWidth: w, screenHeight: h, pressure: 0 }));
}

// ==========================================================================
// Command Console & Macro Engine (supports WebUSB, Wi-Fi Bridge & Demo!)
// ==========================================================================

const HELP_TEXT = [
  'Các lệnh điều khiển nhanh (< 5ms trên cả WebUSB & Wi-Fi):',
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
  if (cmd === 'wait' || cmd === 'sleep') {
    const ms = Math.min(30000, Math.max(0, Number(parts[1]) || 300));
    appendLog('cmd', line, `${ms}ms`);
    await new Promise((r) => setTimeout(r, ms));
    return;
  }

  if (state.demoMode) {
    appendLog('cmd', line, 'demo · 1ms');
    const out = demo.runCommand(cmd, parts.slice(1), line);
    if (out) appendLog('out', out);
    return;
  }

  // Fast direct-stream commands (work on BOTH WebUSB and Bridge with <5ms latency!)
  if (state.connected) {
    const t0 = performance.now();
    if (cmd === 'tap' && parts.length >= 3) {
      await injectTapDirect(Number(parts[1]), Number(parts[2]));
      appendLog('cmd', line, `${state.mode} · ${Math.round(performance.now() - t0)}ms`);
      return;
    }
    if (cmd === 'swipe' && parts.length >= 5) {
      await injectSwipeDirect(Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]), Number(parts[5]) || 260);
      appendLog('cmd', line, `${state.mode} · ${Math.round(performance.now() - t0)}ms`);
      return;
    }
    if (cmd === 'key' && parts.length >= 2) {
      client.sendJson({ type: 'key', keycode: parts[1] });
      appendLog('cmd', line, `${state.mode} · 1ms`);
      return;
    }
    if ((cmd === 'text' || cmd === 'paste') && parts.length >= 2) {
      sendTypedText(line.slice(cmd.length).trim());
      appendLog('cmd', line, `${state.mode} · 1ms`);
      return;
    }
    if (cmd === 'app' && parts.length >= 2) {
      client.sendJson({ type: 'start_app', package: parts[1] });
      appendLog('cmd', line, state.mode);
      return;
    }
    if (cmd === 'screen' && parts.length >= 2) {
      client.sendJson({ type: 'display_power', on: parts[1].toLowerCase() === 'on' });
      appendLog('cmd', line, state.mode);
      return;
    }
    if (cmd === 'rotate') {
      client.sendJson({ type: 'rotate' });
      appendLog('cmd', line, state.mode);
      return;
    }
    if (cmd === 'notif') {
      client.sendJson({ type: 'expand_notifications' });
      appendLog('cmd', line, state.mode);
      return;
    }
  }

  if (cmd === 'battery' || cmd === 'pin') {
    try {
      const out = await aiBridge.runShellAny('dumpsys battery');
      const raw = (out.stdout || '').split('\n').slice(0, 35).join('\n');
      const getNum = (key) => {
        const m = raw.match(new RegExp(`^\\s*${key}:\\s*(-?\\d+)`, 'm'));
        return m ? Number(m[1]) : null;
      };
      const getBool = (key) => new RegExp(`^\\s*${key}:\\s*true`, 'm').test(raw);
      const level = getNum('level');
      const tempRaw = getNum('temperature');
      const voltRaw = getNum('voltage');
      const status = getNum('status');
      const chargeSrc = getBool('AC powered')
        ? 'Đang sạc nhanh/AC'
        : getBool('USB powered')
          ? 'Đang sạc USB'
          : getBool('Wireless powered')
            ? 'Đang sạc không dây'
            : status === 5
              ? 'Đã đầy pin'
              : 'Đang dùng pin';
      const lines = [
        `Pin: ${level !== null ? `${level}%` : '--'} (${chargeSrc})`,
        `Nhiệt độ: ${tempRaw !== null ? `${(tempRaw / 10).toFixed(1)}°C` : '--'}`,
        `Điện áp: ${voltRaw !== null ? `${(voltRaw / 1000).toFixed(2)}V` : '--'}`,
      ];
      appendLog('cmd', 'battery', `${out.durationMs ?? 0}ms`);
      appendLog('out', lines.join('\n'));
    } catch (err) {
      appendLog('cmd', 'battery');
      appendLog('err', err.message);
    }
    return;
  }

  // Shell execution over Direct WebUSB!
  if (state.mode === 'webusb' && state.webUsbDriver) {
    try {
      const out = await state.webUsbDriver.runShell(line);
      appendLog('cmd', line, `webusb shell · ${out.durationMs}ms`);
      if (out.stdout?.trim()) appendLog('out', out.stdout.trim());
    } catch (err) {
      appendLog('cmd', line);
      appendLog('err', err.message);
    }
    return;
  }

  // Shell / fallback commands over Bridge API
  if (!state.selectedSerial) {
    appendLog('cmd', line);
    appendLog('err', 'Chưa kết nối thiết bị. Bấm "USB trực tiếp", "Wi-Fi", hoặc "Mô phỏng".');
    return;
  }

  const serialEnc = encodeURIComponent(state.selectedSerial);
  try {
    const res = await fetch(apiUrl(`/api/device/${serialEnc}/shell`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: line }),
    });
    const data = await res.json();
    appendLog('cmd', line, `adb shell · ${data.durationMs ?? 0}ms`);
    if (data.stdout?.trim()) appendLog('out', data.stdout.trim());
    if (data.stderr?.trim()) appendLog('err', data.stderr.trim());
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
  if (e.key === 'ArrowUp' && state.cmdHistoryIdx > 0) {
    e.preventDefault();
    dom.consoleInput.value = state.cmdHistory[--state.cmdHistoryIdx];
  } else if (e.key === 'ArrowDown') {
    if (state.cmdHistoryIdx < state.cmdHistory.length - 1) {
      e.preventDefault();
      dom.consoleInput.value = state.cmdHistory[++state.cmdHistoryIdx];
    } else {
      state.cmdHistoryIdx = state.cmdHistory.length;
      dom.consoleInput.value = '';
    }
  }
});

document.querySelectorAll('[data-quick-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => executeCommandLine(btn.dataset.quickCmd));
});

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

dom.btnToggleMacroEditor.addEventListener('click', () => dom.macroPanel.classList.toggle('open'));
dom.btnClearMacro.addEventListener('click', () => { dom.macroEditor.value = ''; });

dom.btnRunMacro.addEventListener('click', async () => {
  const lines = dom.macroEditor.value.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return toast('Chưa có lệnh nào trong kịch bản Macro.', 'err');
  dom.btnRunMacro.disabled = true;
  appendLog('sys', `▶ Bắt đầu chạy Macro (${lines.length} bước)...`);
  for (const line of lines) await executeCommandLine(line);
  appendLog('sys', '✓ Hoàn tất chạy Macro.');
  dom.btnRunMacro.disabled = false;
});

dom.btnCopyCli.addEventListener('click', async () => {
  const lines = dom.macroEditor.value.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
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
    return renderAppsList();
  }
  if (state.mode === 'webusb' && state.webUsbDriver) {
    dom.appsList.innerHTML = `<div class="tip-box">Đang tải danh sách ứng dụng qua USB...</div>`;
    try {
      state.apps = await state.webUsbDriver.listApps();
      renderAppsList();
    } catch (err) {
      dom.appsList.innerHTML = `<div class="tip-box">Lỗi tải ứng dụng: ${err.message}</div>`;
    }
    return;
  }
  if (!state.selectedSerial) return;
  dom.appsList.innerHTML = `<div class="tip-box">Đang tải danh sách ứng dụng...</div>`;
  try {
    const res = await fetch(apiUrl(`/api/device/${encodeURIComponent(state.selectedSerial)}/apps`));
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
    row.innerHTML = `<div class="app-info"><span class="app-name"></span><span class="app-pkg"></span></div><span class="btn btn-sm">Mở</span>`;
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
    return toast('Đã dán vào chế độ Mô phỏng', 'ok');
  }
  if (!state.connected) return toast('Cần kết nối điện thoại trước.', 'err');
  client.sendJson({ type: 'clipboard', text, paste: true });
  toast('Đã gửi & dán vào điện thoại!', 'ok');
});

dom.btnClipCopy.addEventListener('click', () => {
  const text = dom.clipSendInput.value;
  if (!text) return toast('Nhập nội dung cần chép trước.', 'err');
  if (!state.connected) return toast('Cần kết nối điện thoại trước.', 'err');
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
  }
});

// ==========================================================================
// Wireless Debugging Modal & Saved 1-Click Wi-Fi Address
// ==========================================================================

const DEFAULT_HOME_WIFI_ADDR = '10.240.253.97:5555';
const DEFAULT_SCHOOL_WIFI_ADDR = '192.168.3.39:5555';

function classifyWifiProfile(addr) {
  const ip = String(addr || '').split(':')[0];
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.43\.)/.test(ip)) return 'home';
  return 'school';
}

function getHomeWifiAddr() {
  return (localStorage.getItem('lb_wifi_home') || DEFAULT_HOME_WIFI_ADDR).trim();
}

function getSchoolWifiAddr() {
  return (localStorage.getItem('lb_wifi_school') || DEFAULT_SCHOOL_WIFI_ADDR).trim();
}

function getSavedWifiAddr() {
  return (localStorage.getItem('lb_last_wifi_addr') || getSchoolWifiAddr()).trim();
}

function saveWifiAddr(addr, explicitProfile = null) {
  const clean = String(addr || '').trim();
  if (!clean) return;
  localStorage.setItem('lb_last_wifi_addr', clean);
  const profile = explicitProfile || classifyWifiProfile(clean);
  if (profile === 'home') {
    localStorage.setItem('lb_wifi_home', clean);
  } else {
    localStorage.setItem('lb_wifi_school', clean);
  }
  if (dom.quickConnectAddr) dom.quickConnectAddr.value = clean;
  updateSavedWifiUi();
}

function updateSavedWifiUi() {
  const home = getHomeWifiAddr();
  const school = getSchoolWifiAddr();
  const last = getSavedWifiAddr();
  if (dom.quickConnectAddr && !dom.quickConnectAddr.value) {
    dom.quickConnectAddr.value = last;
  }
  if (dom.btnOverlayWifi) {
    dom.btnOverlayWifi.textContent = 'Kết nối Wi-Fi tự động (Nhà & Trường)';
  }
  if (dom.btnWifiHome) {
    dom.btnWifiHome.textContent = `Ở nhà (${home.split(':')[0]})`;
    dom.btnWifiHome.title = `Hotspot: ${home}`;
  }
  if (dom.btnWifiSchool) {
    dom.btnWifiSchool.textContent = `Ở trường (${school.split(':')[0]})`;
    dom.btnWifiSchool.title = `Wi-Fi trường: ${school}`;
  }
}

function selectWifiModalTab(tabName) {
  document.querySelectorAll('.modal-tab').forEach((t) => t.classList.toggle('active', t.dataset.mtab === tabName));
  document.querySelectorAll('.modal-pane').forEach((p) => p.classList.toggle('active', p.id === `mpane-${tabName}`));
}

function setModalFeedback(ok, text) {
  dom.wifiFeedback.className = `modal-feedback ${ok ? 'ok' : 'err'}`;
  dom.wifiFeedback.textContent = text;
}

function openWifiModal() {
  dom.wifiFeedback.className = 'modal-feedback';
  dom.wifiFeedback.textContent = '';
  if (dom.quickConnectAddr) dom.quickConnectAddr.value = getSavedWifiAddr();
  selectWifiModalTab('connect');
  refreshDevices();
  dom.wifiModal.showModal();
}

updateSavedWifiUi();

dom.btnOpenWifi.addEventListener('click', openWifiModal);
async function runAutoWifiConnect(fromOverlay = false) {
  const candidates = [getSavedWifiAddr(), getSchoolWifiAddr(), getHomeWifiAddr()];
  if (fromOverlay) {
    toast('Đang tự dò Samsung S26 (Hotspot & Wi-Fi trường)...', 'ok');
    setConnectionVisual('connecting', 'Đang tự dò Wi-Fi (Nhà & Trường)...', 'Đang tìm Samsung S26 trên Hotspot hoặc Wi-Fi hiện tại.');
  } else {
    setModalFeedback(true, 'Đang tự dò Samsung S26 trên Hotspot & Wi-Fi trường...');
  }
  try {
    const res = await fetch(apiUrl('/api/adb/autoconnect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    const data = await res.json();
    if (data.ok && data.address) {
      saveWifiAddr(data.address, data.profile);
      const label = data.profile === 'home' ? 'Hotspot ở nhà' : 'Wi-Fi ở trường';
      toast(`Đã nối ${label}: ${data.address}`, 'ok');
      await refreshDevices(data.address);
      if (dom.wifiModal.open) dom.wifiModal.close();
      startBridgeStream(false);
      return true;
    }
    if (fromOverlay) {
      setConnectionVisual('idle');
      openWifiModal();
    }
    setModalFeedback(false, data.message || 'Không tìm thấy máy mở cổng 5555.');
    return false;
  } catch {
    if (fromOverlay) {
      setConnectionVisual('idle');
      openWifiModal();
    }
    setModalFeedback(false, 'Không kết nối được Bridge Wi-Fi tại ' + (getBridgeBase() || location.origin));
    return false;
  }
}

// 1-click smart dual-network Wi-Fi reconnect from the main overlay!
dom.btnOverlayWifi.addEventListener('click', async () => {
  if (state.bridgeOnline) {
    await runAutoWifiConnect(true);
  } else {
    openWifiModal();
  }
});
dom.btnCloseWifi.addEventListener('click', () => dom.wifiModal.close());
dom.wifiModal.addEventListener('click', (e) => { if (e.target === dom.wifiModal) dom.wifiModal.close(); });

document.querySelectorAll('.modal-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    selectWifiModalTab(tab.dataset.mtab);
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
    const res = await fetch(apiUrl('/api/adb/pair'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, code }),
    });
    const data = await res.json();
    setModalFeedback(data.ok, data.message);
    if (data.ok) {
      const ipOnly = address.split(':')[0];
      if (ipOnly && !dom.pairConnectAddr.value) {
        dom.pairConnectAddr.value = `${ipOnly}:`;
        dom.pairConnectAddr.focus();
      }
      toast('Ghép nối thành công! Nhập IP:Port chính để kết nối.', 'ok');
    }
  } catch {
    setModalFeedback(false, 'Không kết nối được Bridge Wi-Fi tại ' + (getBridgeBase() || location.origin) + '. Hãy chạy ./install-app.sh trên Chromebook.');
  } finally {
    dom.btnDoPair.disabled = false;
  }
});

async function handleWirelessConnect(address, explicitProfile = null) {
  const clean = String(address || '').trim();
  if (!clean) return setModalFeedback(false, 'Hãy nhập địa chỉ IP:Port (vd: 192.168.3.39:5555).');

  setModalFeedback(true, `Đang kết nối tới ${clean}...`);
  try {
    const res = await fetch(apiUrl('/api/adb/connect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: clean }),
    });
    const data = await res.json();
    if (!data.ok) {
      setModalFeedback(false, data.message);
      return;
    }

    let finalAddr = clean;
    const portPart = clean.includes(':') ? clean.split(':').pop() : '5555';
    if (portPart !== '5555' && dom.chkAutoTcpip && dom.chkAutoTcpip.checked) {
      setModalFeedback(true, `Đã nối ${clean}! Đang tự cố định sang cổng 5555...`);
      try {
        const tcpRes = await fetch(apiUrl('/api/adb/tcpip'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial: clean, port: 5555 }),
        });
        const tcpData = await tcpRes.json();
        if (tcpData.ok && tcpData.wifiAddress) {
          finalAddr = tcpData.wifiAddress;
        }
      } catch {}
    }

    setModalFeedback(true, `Đã kết nối thành công tại ${finalAddr}!`);
    saveWifiAddr(finalAddr, explicitProfile);
    await refreshDevices(finalAddr);
    setTimeout(() => {
      dom.wifiModal.close();
      startBridgeStream(false);
    }, 450);
  } catch {
    setModalFeedback(false, 'Không kết nối được Bridge Wi-Fi. Hãy chạy ./install-app.sh trên Chromebook hoặc dùng chế độ USB trực tiếp.');
  }
}

if (dom.btnWifiAuto) dom.btnWifiAuto.addEventListener('click', () => runAutoWifiConnect(false));
if (dom.btnWifiHome) dom.btnWifiHome.addEventListener('click', () => handleWirelessConnect(getHomeWifiAddr(), 'home'));
if (dom.btnWifiSchool) dom.btnWifiSchool.addEventListener('click', () => handleWirelessConnect(getSchoolWifiAddr(), 'school'));
dom.btnDoPairConnect.addEventListener('click', () => handleWirelessConnect(dom.pairConnectAddr.value));
const runQuickManualConnect = () => {
  let raw = String(dom.quickConnectAddr.value || '').trim();
  if (/^\d{4,5}$/.test(raw)) {
    const baseIp = (getSavedWifiAddr() || getSchoolWifiAddr() || '192.168.3.39:5555').split(':')[0];
    raw = `${baseIp}:${raw}`;
  }
  handleWirelessConnect(raw);
};
dom.btnDoConnect.addEventListener('click', runQuickManualConnect);
dom.quickConnectAddr?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runQuickManualConnect();
  }
});

dom.btnDoTcpip.addEventListener('click', async () => {
  const usbDev = state.devices.find((d) => d.transport === 'usb' && d.state === 'device');
  if (!usbDev) {
    return setModalFeedback(false, 'Chưa thấy thiết bị USB nào trên Bridge Crostini.');
  }
  dom.btnDoTcpip.disabled = true;
  setModalFeedback(true, `Đang bật Wi-Fi ADB cho ${usbDev.displayName}...`);
  try {
    const res = await fetch(apiUrl('/api/adb/tcpip'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: usbDev.serial, port: 5555 }),
    });
    const data = await res.json();
    setModalFeedback(data.ok, data.ok ? `Đã mở Wi-Fi tại ${data.wifiAddress}! Có thể rút cáp USB.` : (data.stderr || 'Thất bại'));
    if (data.ok && data.wifiAddress) {
      saveWifiAddr(data.wifiAddress);
      await refreshDevices(data.wifiAddress);
      setTimeout(() => {
        dom.wifiModal.close();
        startBridgeStream(false);
      }, 600);
    }
  } catch (err) {
    setModalFeedback(false, err.message);
  } finally {
    dom.btnDoTcpip.disabled = false;
  }
});

// ==========================================================================
// Interactive Samsung S26 Demo Simulator
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
    state.mode = 'demo';
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
    appendLog('sys', '[Mô phỏng] Đã bật Samsung S26 Simulator. Thử click icon, gõ phím, hoặc chạy lệnh: tap 135 520, key HOME.');

    const draw = () => {
      if (!state.demoMode) return;
      this.render();
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  },

  stop() {
    state.demoMode = false;
    state.mode = 'idle';
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    setConnectionVisual('idle');
  },

  rotate() {
    this.landscape = !this.landscape;
    [this.width, this.height] = [this.height, this.width];
    dom.canvas.width = this.width;
    dom.canvas.height = this.height;
    updateOrientation(this.width, this.height);
  },

  toggleNotif() { this.notifOpen = !this.notifOpen; },
  appendText(txt) { this.activeApp = 'Samsung Notes'; this.noteText += txt; },

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

  handleScroll(v) { this.scrollY = Math.max(0, Math.min(300, this.scrollY - v * 12)); },

  handleTouch(action, pt) {
    if (action === MOTION_ACTION.DOWN) {
      this.ripples.push({ x: pt.x, y: pt.y, t: performance.now() });
      if (this.activeApp === 'Home' && !this.landscape && pt.y > 460 && pt.y < 600) {
        if (pt.x < 180) this.activeApp = 'Samsung Notes';
        else if (pt.x < 360) this.activeApp = 'Chrome';
        else this.activeApp = 'Cài đặt';
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
    if (cmd === 'key') { this.handleHardware((args[0] || '').toUpperCase()); return `Sent key ${args[0]}`; }
    if (cmd === 'app') { this.activeApp = args[0] || 'App'; return `Launched ${this.activeApp}`; }
    if (cmd === 'screen') {
      state.displayPowerOn = args[0] === 'on';
      dom.hwOled.classList.toggle('is-oled-off', !state.displayPowerOn);
      return `OLED physical display: ${state.displayPowerOn ? 'ON' : 'OFF'}`;
    }
    if (cmd === 'rotate') { this.rotate(); return `Rotated to ${this.width}x${this.height}`; }
    if (raw.includes('battery')) return 'level: 88\nstatus: 2 (Charging)\ntemperature: 312 (31.2°C)';
    if (raw.includes('wm size')) return `Physical size: 1440x3120\nStream size: ${this.width}x${this.height}`;
    return `[Demo] Đã thực thi: ${raw}`;
  },

  render() {
    const ctx = dom.canvas.getContext('2d');
    const w = this.width;
    const h = this.height;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0d1b26');
    bg.addColorStop(0.5, '#111824');
    bg.addColorStop(1, '#0a1017');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const orb = ctx.createRadialGradient(w * 0.72, h * 0.24, 10, w * 0.72, h * 0.24, w * 0.75);
    orb.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
    orb.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);

    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    ctx.fillStyle = '#e5ebf5';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillText(timeStr, 28, 38);
    ctx.textAlign = 'right';
    ctx.fillText('Wi-Fi · 5G · 88%', w - 28, 38);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#050608';
    ctx.beginPath();
    ctx.arc(w / 2, 32, 11, 0, Math.PI * 2);
    ctx.fill();

    if (this.activeApp === 'Home') {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '300 76px Inter, sans-serif';
      ctx.fillText(timeStr, 36, 190);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 20px Inter, sans-serif';
      ctx.fillText('Samsung Galaxy S26 · Chế độ Mô phỏng', 38, 228);

      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      roundRect(ctx, 32, 280, w - 64, 56, 28);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 18px Inter, sans-serif';
      ctx.fillText('Tìm kiếm hoặc bấm vào ứng dụng bên dưới...', 56, 315);

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
        this.noteText.split('\n').forEach((ln, idx) => ctx.fillText(ln, 42, 200 + idx * 30 - this.scrollY));
      }
    }

    if (this.notifOpen) {
      ctx.fillStyle = 'rgba(12, 15, 22, 0.94)';
      roundRect(ctx, 14, 58, w - 28, 250, 22);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 18px Inter, sans-serif';
      ctx.fillText('Thông báo · LinhBridge sẵn sàng', 38, 108);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 15px Inter, sans-serif';
      ctx.fillText('Hỗ trợ cả WebUSB trực tiếp & Wi-Fi Bridge', 38, 142);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, w / 2 - 70, h - 22, 140, 5, 3);
    ctx.fill();

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

function stopDemoMode() { if (state.demoMode) demo.stop(); }
dom.btnOverlayDemo.addEventListener('click', () => demo.start());

// ==========================================================================
// AI Cloud Relay Bridge (lets cloud AI see screen & control phone)
// ==========================================================================

const aiBridge = {
  ws: null,
  pingTimer: null,
  connected: false,
  roomId: localStorage.getItem('lb_ai_room') || `LB-${Math.floor(1000 + Math.random() * 9000)}`,
  token: localStorage.getItem('lb_ai_token') || (() => {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  })(),

  saveCreds() {
    localStorage.setItem('lb_ai_room', this.roomId);
    localStorage.setItem('lb_ai_token', this.token);
  },

  regenerate() {
    this.roomId = `LB-${Math.floor(1000 + Math.random() * 9000)}`;
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    this.token = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    this.saveCreds();
    $('ai-room-id').value = this.roomId;
    $('ai-room-token').value = this.token;
    if (this.connected) {
      this.disconnect();
      this.connect();
    }
  },

  setFeedback(ok, text) {
    const el = $('ai-feedback');
    el.className = `modal-feedback ${ok ? 'ok' : 'err'}`;
    el.textContent = text;
  },

  updateButtonUi() {
    const btn = $('btn-ai-bridge');
    const lbl = $('ai-bridge-btn-label');
    const chip = $('btn-ai-bridge-chip');
    const toggle = $('btn-ai-toggle');
    btn?.classList.toggle('is-active', this.connected);
    if (lbl) lbl.textContent = this.connected ? `AI: ${this.roomId}` : 'AI Bridge';
    if (chip) {
      chip.textContent = this.connected ? `● AI: ${this.roomId}` : 'AI Bridge';
      chip.style.borderColor = this.connected ? 'rgba(16,185,129,0.6)' : 'rgba(56,189,248,0.45)';
      chip.style.color = this.connected ? '#10b981' : 'var(--accent)';
    }
    if (toggle) {
      toggle.textContent = this.connected ? 'Ngắt AI Bridge' : 'Bật AI Bridge';
      toggle.classList.toggle('btn-danger', this.connected);
      toggle.classList.toggle('btn-primary', !this.connected);
    }
  },

  connect() {
    const rawUrl = $('ai-relay-url').value.trim().replace(/\/+$/, '');
    if (!rawUrl) {
      this.setFeedback(false, 'Vui lòng nhập URL Cloud Relay (Cloudflare Worker hoặc Render).');
      return;
    }
    localStorage.setItem('lb_ai_relay_url', rawUrl);
    this.saveCreds();
    this.disconnect();

    const wsBase = rawUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    const wsUrl = `${wsBase}/room/${encodeURIComponent(this.roomId)}?token=${encodeURIComponent(this.token)}`;
    this.setFeedback(true, 'Đang kết nối tới Cloud Relay...');

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.updateButtonUi();
      this.setFeedback(true, `Đã bật AI Bridge! Phòng: ${this.roomId}`);
      toast(`AI Bridge đã bật (${this.roomId})`, 'ok');
      appendLog('sys', `[AI Bridge] Đã kết nối Cloud Relay (Phòng ${this.roomId}).`);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong' || msg.type === 'relay_ready' || !msg.id) return;
        const reply = await this.handleCommand(msg);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: msg.id, ...reply }));
        }
      } catch (err) {
        // Ignore malformed
      }
    };

    ws.onerror = () => {
      this.setFeedback(false, 'Không kết nối được tới Cloud Relay. Kiểm tra lại URL.');
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.connected = false;
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.updateButtonUi();
      }
    };
  },

  disconnect() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try { old.close(); } catch {}
    }
    this.connected = false;
    this.updateButtonUi();
  },

  async runShellAny(command) {
    if (state.demoMode) {
      return { ok: true, stdout: demo.runCommand('shell', [], command), stderr: '' };
    }
    if (state.mode === 'webusb' && state.webUsbDriver) {
      return state.webUsbDriver.runShell(command);
    }
    if (state.selectedSerial) {
      const res = await fetch(apiUrl(`/api/device/${encodeURIComponent(state.selectedSerial)}/shell`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      return res.json();
    }
    throw new Error('Chưa kết nối điện thoại trên LinhBridge.');
  },

  cbStream: null,
  cbVideo: null,

  async toggleChromebookShare() {
    if (this.cbStream) {
      this.stopChromebookShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.setFeedback(false, 'Trình duyệt không hỗ trợ chia sẻ màn hình (getDisplayMedia).');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 }, width: { max: 1920 } },
        audio: false,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      this.cbStream = stream;
      this.cbVideo = video;

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        this.stopChromebookShare();
      });

      const btn = $('btn-cb-share');
      if (btn) {
        btn.textContent = '● Đang chia sẻ màn Chromebook (Bấm để dừng)';
        btn.classList.add('btn-danger');
      }
      toast('Đã bật chia sẻ màn hình Chromebook cho AI xem!', 'ok');
      this.setFeedback(true, 'AI có thể chụp xem màn hình Chromebook khi bạn yêu cầu.');
    } catch (err) {
      this.setFeedback(false, `Đã hủy chia sẻ màn hình: ${err.message}`);
    }
  },

  stopChromebookShare() {
    if (this.cbStream) {
      for (const t of this.cbStream.getTracks()) {
        try { t.stop(); } catch {}
      }
      this.cbStream = null;
    }
    if (this.cbVideo) {
      this.cbVideo.srcObject = null;
      this.cbVideo = null;
    }
    const btn = $('btn-cb-share');
    if (btn) {
      btn.textContent = 'Chia sẻ màn hình Chromebook cho AI xem';
      btn.classList.remove('btn-danger');
    }
  },

  async handleCommand(msg) {
    const action = String(msg.action || '').toLowerCase();
    try {
      if (action === 'chromebook_screen') {
        if (!this.cbVideo || !this.cbStream || this.cbVideo.videoWidth === 0) {
          return {
            ok: false,
            error: 'Chưa bật chia sẻ màn hình Chromebook. Hãy bấm "Chia sẻ màn hình Chromebook" trong AI Bridge.',
          };
        }
        const q = Number(msg.quality) || 0.82;
        const off = document.createElement('canvas');
        off.width = this.cbVideo.videoWidth;
        off.height = this.cbVideo.videoHeight;
        off.getContext('2d').drawImage(this.cbVideo, 0, 0, off.width, off.height);
        const dataUrl = off.toDataURL('image/jpeg', q);
        return {
          ok: true,
          width: off.width,
          height: off.height,
          imageBase64: dataUrl.split(',')[1] || '',
        };
      }

      if (action === 'screenshot') {
        const q = Number(msg.quality) || 0.85;
        const dataUrl = dom.canvas.toDataURL('image/jpeg', q);
        const base64 = dataUrl.split(',')[1] || '';
        return {
          ok: true,
          width: client.width || dom.canvas.width,
          height: client.height || dom.canvas.height,
          imageBase64: base64,
        };
      }

      if (action === 'ui') {
        const res = await this.runShellAny('uiautomator dump /sdcard/.lb_ui.xml >/dev/null 2>&1 && cat /sdcard/.lb_ui.xml');
        const xml = res.stdout || '';
        const elements = [];
        const nodeRe = /<node\s+([^>]+?)\/?>/g;
        let m;
        while ((m = nodeRe.exec(xml)) !== null) {
          const attrs = m[1];
          const getAttr = (k) => {
            const am = attrs.match(new RegExp(`${k}="([^"]*)"`));
            return am ? am[1] : '';
          };
          const text = getAttr('text');
          const desc = getAttr('content-desc');
          const id = getAttr('resource-id').split('/').pop() || '';
          const clickable = getAttr('clickable') === 'true';
          const bounds = getAttr('bounds');
          const bm = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
          if (!bm) continue;
          if (!text && !desc && !clickable) continue;
          const x = Math.round((Number(bm[1]) + Number(bm[3])) / 2);
          const y = Math.round((Number(bm[2]) + Number(bm[4])) / 2);
          elements.push({ text, desc, id, clickable, x, y });
        }
        return { ok: true, elements: elements.slice(0, 120) };
      }

      if (action === 'tap') {
        await executeCommandLine(`tap ${Number(msg.x)} ${Number(msg.y)}`);
        return { ok: true };
      }
      if (action === 'swipe') {
        await executeCommandLine(
          `swipe ${Number(msg.x1)} ${Number(msg.y1)} ${Number(msg.x2)} ${Number(msg.y2)} ${Number(msg.durationMs) || 260}`
        );
        return { ok: true };
      }
      if (action === 'text') {
        await executeCommandLine(`text ${msg.text || ''}`);
        return { ok: true };
      }
      if (action === 'key') {
        await executeCommandLine(`key ${msg.keycode || 'HOME'}`);
        return { ok: true };
      }
      if (action === 'app') {
        await executeCommandLine(`app ${msg.package || ''}`);
        return { ok: true };
      }
      if (action === 'screen') {
        await executeCommandLine(`screen ${msg.on ? 'on' : 'off'}`);
        return { ok: true };
      }
      if (action === 'shell') {
        const out = await this.runShellAny(msg.command || '');
        return { ok: out.ok !== false, stdout: out.stdout || '', stderr: out.stderr || '' };
      }

      return { ok: false, error: `Lệnh không hỗ trợ: ${action}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

const DEFAULT_AI_RELAY_URL = 'https://linhbridge-relay.onrender.com';

function getStartAllCommand() {
  const relayUrl = ($('ai-relay-url')?.value.trim() || localStorage.getItem('lb_ai_relay_url') || DEFAULT_AI_RELAY_URL).replace(/\/+$/, '');
  return `cd ~/linkbridge-android-web && ./start-all.sh ${relayUrl}`;
}

function syncStartAllCmdUi() {
  const cmd = getStartAllCommand();
  document.querySelectorAll('.startall-cmd-text').forEach((el) => {
    el.textContent = cmd;
  });
}

aiBridge.saveCreds();
$('ai-relay-url').value = localStorage.getItem('lb_ai_relay_url') || DEFAULT_AI_RELAY_URL;
$('ai-room-id').value = aiBridge.roomId;
$('ai-room-token').value = aiBridge.token;
syncStartAllCmdUi();

$('ai-relay-url')?.addEventListener('input', syncStartAllCmdUi);

document.querySelectorAll('.btn-copy-startall').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const cmd = getStartAllCommand();
    try {
      await navigator.clipboard.writeText(cmd);
      const orig = btn.textContent;
      btn.textContent = 'Đã copy!';
      toast('Đã copy lệnh mở Local + Phòng AI! Dán vào Terminal Linux là chạy.', 'ok');
      setTimeout(() => { btn.textContent = orig; }, 1600);
    } catch {
      toast('Không tự copy được — hãy bôi đen đoạn lệnh bên dưới để copy.', 'err');
    }
  });
});

const openAiModal = () => {
  syncStartAllCmdUi();
  $('ai-feedback').className = 'modal-feedback';
  $('ai-modal').showModal();
};
$('btn-ai-bridge')?.addEventListener('click', openAiModal);
$('btn-ai-bridge-chip')?.addEventListener('click', openAiModal);
$('btn-close-ai')?.addEventListener('click', () => $('ai-modal').close());
$('ai-modal')?.addEventListener('click', (e) => { if (e.target === $('ai-modal')) $('ai-modal').close(); });

$('btn-ai-toggle').addEventListener('click', () => {
  if (aiBridge.connected) aiBridge.disconnect();
  else aiBridge.connect();
});
$('btn-cb-share')?.addEventListener('click', () => aiBridge.toggleChromebookShare());
$('btn-ai-regen').addEventListener('click', () => aiBridge.regenerate());
$('btn-ai-copy').addEventListener('click', async () => {
  const relayUrl = $('ai-relay-url').value.trim() || DEFAULT_AI_RELAY_URL;
  const info = `Relay: ${relayUrl}\nRoom: ${aiBridge.roomId}\nToken: ${aiBridge.token}`;
  try {
    await navigator.clipboard.writeText(info);
    toast('Đã copy thông tin AI Bridge để gửi cho AI!', 'ok');
  } catch {
    aiBridge.setFeedback(true, info);
  }
});

// ==========================================================================
// Boot
// ==========================================================================

appendLog('sys', 'LinhBridge v2 sẵn sàng (WebUSB trực tiếp + Wi-Fi Bridge + scrcpy v5.0.1). Gõ "help" để xem lệnh.');
if (!ScrcpyWebClient.isWebCodecsSupported()) {
  appendLog('err', 'Cảnh báo: Trình duyệt không hỗ trợ WebCodecs VideoDecoder. Hãy mở bằng Chrome.');
}
if (!WebUsbScrcpyDriver.isSupported()) {
  dom.btnWebUsb.title = 'Trình duyệt không hỗ trợ WebUSB (hãy dùng Chrome / Edge)';
}

refreshDevices();
setInterval(() => {
  if (!state.connected && !state.connecting) refreshDevices();
}, 6000);

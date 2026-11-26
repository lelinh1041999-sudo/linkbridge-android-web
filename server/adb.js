'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ADB_BIN = process.env.ADB_PATH || 'adb';

/**
 * Common Android KeyEvent keycodes so CLI / API / UI can accept names or numbers.
 */
const ANDROID_KEYCODES = {
  UNKNOWN: 0,
  HOME: 3,
  BACK: 4,
  CALL: 5,
  ENDCALL: 6,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  CLEAR: 28,
  TAB: 61,
  SPACE: 62,
  ENTER: 66,
  DEL: 67,
  BACKSPACE: 67,
  MENU: 82,
  SEARCH: 84,
  MEDIA_PLAY_PAUSE: 85,
  MEDIA_STOP: 86,
  MEDIA_NEXT: 87,
  MEDIA_PREVIOUS: 88,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  ESCAPE: 111,
  FORWARD_DEL: 112,
  DELETE: 112,
  MOVE_HOME: 122,
  MOVE_END: 123,
  INSERT: 124,
  VOLUME_MUTE: 164,
  APP_SWITCH: 187,
  RECENTS: 187,
  BRIGHTNESS_DOWN: 220,
  BRIGHTNESS_UP: 221,
  SLEEP: 223,
  WAKEUP: 224,
  CUT: 277,
  COPY: 278,
  PASTE: 279,
};

function resolveKeycode(input) {
  if (typeof input === 'number' && Number.isInteger(input)) return input;
  const str = String(input || '').trim().toUpperCase().replace(/^KEYCODE_/, '');
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (str in ANDROID_KEYCODES) return ANDROID_KEYCODES[str];
  throw new Error(`Không nhận diện được phím: ${input}`);
}

async function execAdb(args, options = {}) {
  const timeout = options.timeout ?? 15000;
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(ADB_BIN, args, {
      timeout,
      maxBuffer,
      encoding: options.encoding ?? 'utf8',
    });
    return {
      ok: true,
      stdout: typeof stdout === 'string' ? stdout : stdout,
      stderr: typeof stderr === 'string' ? stderr : '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : (err.message || 'ADB error'),
      exitCode: typeof err.code === 'number' ? err.code : 1,
      durationMs: Date.now() - startedAt,
      notFound: err.code === 'ENOENT',
    };
  }
}

async function checkAdbAvailable() {
  const res = await execAdb(['version'], { timeout: 5000 });
  if (!res.ok) {
    return { available: false, version: null, error: res.notFound ? 'Chưa cài đặt adb (android-tools-adb)' : res.stderr };
  }
  const firstLine = (res.stdout || '').split('\n')[0]?.trim() || 'adb';
  return { available: true, version: firstLine };
}

async function getDeviceProp(serial, prop) {
  const res = await execAdb(['-s', serial, 'shell', 'getprop', prop], { timeout: 4000 });
  return res.ok ? res.stdout.trim() : '';
}

async function getDeviceMeta(serial) {
  const cmd = [
    'echo "MODEL=$(getprop ro.product.model)"',
    'echo "MFR=$(getprop ro.product.manufacturer)"',
    'echo "MARKET=$(getprop ro.product.marketname)"',
    'echo "ANDROID=$(getprop ro.build.version.release)"',
    'echo "SDK=$(getprop ro.build.version.sdk)"',
    'echo "SIZE=$(wm size 2>/dev/null | tail -n 1)"',
    'echo "BAT=$(dumpsys battery 2>/dev/null | grep -E \"level:|status:\" | tr \"\\n\" \" \")"',
    'echo "IP=$( (ip -4 addr show swlan0 2>/dev/null; ip -4 addr show wlan0 2>/dev/null; ip -4 addr show ap0 2>/dev/null) | awk \'/inet / {sub(/\\/.*/, \"\", $2); print $2; exit}\' )"',
  ].join('; ');

  const res = await execAdb(['-s', serial, 'shell', cmd], { timeout: 5000 });
  const meta = {
    model: '',
    manufacturer: '',
    marketName: '',
    androidVersion: '',
    sdk: '',
    screenSize: '',
    batteryLevel: null,
    charging: false,
    wifiIp: '',
  };

  if (!res.ok) return meta;

  for (const line of res.stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    switch (key) {
      case 'MODEL': meta.model = val; break;
      case 'MFR': meta.manufacturer = val; break;
      case 'MARKET': meta.marketName = val; break;
      case 'ANDROID': meta.androidVersion = val; break;
      case 'SDK': meta.sdk = val; break;
      case 'SIZE': {
        const m = val.match(/(\d+x\d+)/);
        if (m) meta.screenSize = m[1];
        break;
      }
      case 'BAT': {
        const lvl = val.match(/level:\s*(\d+)/);
        const st = val.match(/status:\s*(\d+)/);
        if (lvl) meta.batteryLevel = parseInt(lvl[1], 10);
        if (st) meta.charging = st[1] === '2' || st[1] === '5';
        break;
      }
      case 'IP': meta.wifiIp = val; break;
    }
  }
  return meta;
}

async function listDevices() {
  const res = await execAdb(['devices', '-l'], { timeout: 6000 });
  if (!res.ok) {
    return {
      adbAvailable: !res.notFound,
      error: res.notFound ? 'Chưa cài đặt adb. Chạy ./setup.sh trên Linux Crostini.' : res.stderr.trim(),
      devices: [],
    };
  }

  const lines = res.stdout.split('\n').slice(1);
  const rawDevices = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    const kv = {};
    for (const token of parts.slice(2)) {
      const colon = token.indexOf(':');
      if (colon > 0) kv[token.slice(0, colon)] = token.slice(colon + 1);
    }
    const isWireless = serial.includes(':') || serial.includes('_adb-tls-connect');
    rawDevices.push({
      serial,
      state,
      transport: isWireless ? 'wifi' : 'usb',
      product: kv.product || '',
      model: kv.model || '',
      device: kv.device || '',
      transportId: kv.transport_id || '',
    });
  }

  const enriched = await Promise.all(
    rawDevices.map(async (dev) => {
      if (dev.state !== 'device') {
        return {
          ...dev,
          displayName: dev.model || dev.serial,
          androidVersion: '',
          batteryLevel: null,
          charging: false,
          screenSize: '',
          wifiIp: '',
        };
      }
      const meta = await getDeviceMeta(dev.serial);
      const niceModel = meta.marketName || meta.model || dev.model || dev.serial;
      const mfrPrefix = meta.manufacturer && !niceModel.toLowerCase().startsWith(meta.manufacturer.toLowerCase())
        ? `${meta.manufacturer} `
        : '';
      return {
        ...dev,
        displayName: `${mfrPrefix}${niceModel}`.trim(),
        model: meta.model || dev.model,
        manufacturer: meta.manufacturer,
        androidVersion: meta.androidVersion,
        sdk: meta.sdk,
        screenSize: meta.screenSize,
        batteryLevel: meta.batteryLevel,
        charging: meta.charging,
        wifiIp: meta.wifiIp,
      };
    })
  );

  return { adbAvailable: true, error: null, devices: enriched };
}

async function pairWireless(address, code) {
  const cleanAddr = String(address || '').trim();
  const cleanCode = String(code || '').trim();
  if (!cleanAddr || !cleanCode) {
    throw new Error('Cần nhập đầy đủ IP:Port ghép nối và mã 6 chữ số.');
  }
  return execAdb(['pair', cleanAddr, cleanCode], { timeout: 20000 });
}

async function connectWireless(address) {
  const cleanAddr = String(address || '').trim();
  if (!cleanAddr) {
    throw new Error('Cần nhập địa chỉ IP:Port của điện thoại.');
  }
  const res = await execAdb(['connect', cleanAddr], { timeout: 15000 });
  const combined = `${res.stdout} ${res.stderr}`.trim();
  const connected = res.ok && /connected to|already connected/i.test(combined);
  return {
    ...res,
    ok: connected,
    message: combined,
  };
}

async function disconnectWireless(address) {
  const args = address ? ['disconnect', String(address).trim()] : ['disconnect'];
  return execAdb(args, { timeout: 10000 });
}

async function enableTcpip(serial, port = 5555) {
  const p = Number(port) || 5555;
  const meta = await getDeviceMeta(serial);
  const res = await execAdb(['-s', serial, 'tcpip', String(p)], { timeout: 10000 });
  if (!res.ok) return { ...res, wifiAddress: null };

  let wifiAddress = null;
  const fallbackIp = serial.includes(':') ? serial.split(':')[0] : '';
  const targetIp = meta.wifiIp || fallbackIp;
  if (targetIp) {
    wifiAddress = `${targetIp}:${p}`;
    // Wait briefly for adbd on phone to restart in TCP mode
    await new Promise((r) => setTimeout(r, 1600));
    const conn = await connectWireless(wifiAddress);
    if (conn.ok && serial.includes(':') && serial !== wifiAddress) {
      await disconnectWireless(serial).catch(() => {});
    }
    return {
      ok: conn.ok,
      stdout: `${res.stdout}\n${conn.stdout}`.trim(),
      stderr: conn.stderr,
      wifiAddress,
    };
  }
  return { ...res, wifiAddress: null };
}

function probeTcpPort(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

function getResolvNameservers() {
  try {
    const text = fs.readFileSync('/etc/resolv.conf', 'utf8');
    const ips = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) ips.push(m[1]);
    }
    return ips;
  } catch {
    return [];
  }
}

function classifyWifiProfile(addr) {
  const ip = String(addr || '').split(':')[0];
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.43\.)/.test(ip)) return 'home';
  return 'school';
}

async function autoConnectWireless(candidates = []) {
  // 1) Reuse already connected online wireless device if present
  const existing = await listDevices();
  const readyWifi = (existing.devices || []).find((d) => d.transport === 'wifi' && d.state === 'device');
  if (readyWifi) {
    return {
      ok: true,
      address: readyWifi.serial,
      profile: classifyWifiProfile(readyWifi.serial),
      discovered: false,
      message: `Đã kết nối sẵn tới ${readyWifi.displayName || readyWifi.serial} (${readyWifi.serial})`,
    };
  }

  // 2) Build prioritized candidate list: dynamic Hotspot DNS gateway + saved Home/School addresses
  const seen = new Set();
  const ordered = [];
  const addCandidate = (raw) => {
    const clean = String(raw || '').trim();
    if (!clean) return;
    const normalized = clean.includes(':') ? clean : `${clean}:5555`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      ordered.push(normalized);
    }
  };

  const nameservers = getResolvNameservers();
  for (const ns of nameservers) {
    // On Samsung Mobile Hotspot, the phone itself acts as the DNS/gateway IP!
    addCandidate(`${ns}:5555`);
  }
  for (const c of candidates) addCandidate(c);

  // Fast parallel TCP probe of known candidates
  const probed = await Promise.all(
    ordered.map(async (addr) => {
      const idx = addr.lastIndexOf(':');
      const host = addr.slice(0, idx);
      const port = Number(addr.slice(idx + 1)) || 5555;
      const open = await probeTcpPort(host, port, 800);
      return open ? addr : null;
    })
  );

  for (const addr of probed.filter(Boolean)) {
    const conn = await connectWireless(addr);
    if (conn.ok) {
      return {
        ok: true,
        address: addr,
        profile: classifyWifiProfile(addr),
        discovered: false,
        message: `Đã kết nối Wi-Fi tới ${addr}`,
      };
    }
  }

  // 3) Try ADB mDNS services (works on brand-new Wi-Fi even with random Wireless Debugging port)
  try {
    const mdns = await execAdb(['mdns', 'services'], { timeout: 3000 });
    if (mdns.ok && mdns.stdout) {
      for (const line of mdns.stdout.split(/\r?\n/)) {
        const m = line.match(/_adb-tls-connect\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+:\d+)/);
        if (m) {
          const conn = await connectWireless(m[1]);
          if (conn.ok) {
            return {
              ok: true,
              address: m[1],
              profile: classifyWifiProfile(m[1]),
              discovered: true,
              message: `Tự phát hiện qua mDNS tại ${m[1]} và đã kết nối!`,
            };
          }
        }
      }
    }
  } catch {}

  // 4) Universal current-Wi-Fi subnet scan on port 5555 (works on ANY new /24 or /22 Wi-Fi!)
  const prefixes = new Set();
  const activeIs192 = nameservers.some((ip) => ip.startsWith('192.168.'));
  // Prioritize saved candidate subnets matching current network family
  for (const raw of candidates) {
    const m = String(raw || '').trim().match(/^(\d+\.\d+\.\d+)\.\d+/);
    if (!m) continue;
    if (activeIs192 && !m[1].startsWith('192.168.')) continue;
    if (!activeIs192 && m[1].startsWith('192.168.')) continue;
    prefixes.add(m[1]);
  }
  // Always include current Wi-Fi's own /24 subnet AND its /22 supernet block (e.g. 192.168.1.1 -> .1, .0, .2, .3)
  for (const ns of nameservers) {
    const m = ns.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
    if (!m) continue;
    const baseA = `${m[1]}.${m[2]}`;
    const oct3 = Number(m[3]);
    prefixes.add(`${baseA}.${oct3}`);
    if (m[1] === '192' && m[2] === '168') {
      const blockStart = Math.floor(oct3 / 4) * 4;
      for (let d = 0; d < 4; d++) {
        prefixes.add(`${baseA}.${blockStart + d}`);
      }
    }
  }

  const scanHosts = [];
  for (const pfx of [...prefixes].slice(0, 5)) {
    for (let i = 1; i <= 254; i++) {
      const cand = `${pfx}.${i}:5555`;
      if (!seen.has(cand)) scanHosts.push({ host: `${pfx}.${i}`, addr: cand });
    }
  }

  const openFound = [];
  const BATCH = 128;
  for (let i = 0; i < scanHosts.length && openFound.length === 0; i += BATCH) {
    const batch = scanHosts.slice(i, i + BATCH);
    const res = await Promise.all(
      batch.map(async (item) => ((await probeTcpPort(item.host, 5555, 950)) ? item.addr : null))
    );
    openFound.push(...res.filter(Boolean));
  }

  for (const addr of openFound) {
    const conn = await connectWireless(addr);
    if (conn.ok) {
      return {
        ok: true,
        address: addr,
        profile: classifyWifiProfile(addr),
        discovered: true,
        message: `Tự dò thấy Samsung S26 tại ${addr} và đã kết nối!`,
      };
    }
  }

  return {
    ok: false,
    address: null,
    profile: null,
    discovered: false,
    message: 'Không tìm thấy Samsung S26 mở cổng 5555 trên Hotspot lẫn Wi-Fi trường. Nếu máy vừa khởi động lại, mở Gỡ lỗi không dây và nhập IP:Port mới (app sẽ tự cố định lại cổng 5555).',
  };
}

async function runShell(serial, command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('Lệnh shell không được để trống.');
  return execAdb(['-s', serial, 'shell', cmd], { timeout: 30000 });
}

async function takeScreenshot(serial) {
  return new Promise((resolve, reject) => {
    const child = spawn(ADB_BIN, ['-s', serial, 'exec-out', 'screencap', '-p']);
    const chunks = [];
    let errText = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        return reject(new Error(errText.trim() || `screencap thất bại (exit ${code})`));
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function listApps(serial) {
  // Fetch user-installed packages and key launchable system apps quickly
  const cmd = 'pm list packages -3; pm list packages -s | grep -E "(samsung|android\\.settings|android\\.vending|google\\.android\\.youtube|google\\.android\\.gm|google\\.android\\.apps\\.maps|android\\.chrome|sec\\.android\\.app\\.camera|sec\\.android\\.gallery3d|samsung\\.android\\.messaging|samsung\\.android\\.dialer|sec\\.android\\.app\\.myfiles)"';
  const res = await execAdb(['-s', serial, 'shell', cmd], { timeout: 10000 });
  if (!res.ok) return [];

  const seen = new Set();
  const apps = [];
  for (const line of res.stdout.split('\n')) {
    const pkg = line.trim().replace(/^package:/, '');
    if (!pkg || seen.has(pkg)) continue;
    seen.add(pkg);
    const shortName = prettifyPackageName(pkg);
    apps.push({ package: pkg, label: shortName });
  }
  apps.sort((a, b) => a.label.localeCompare(b.label));
  return apps;
}

function prettifyPackageName(pkg) {
  const KNOWN = {
    'com.android.settings': 'Cài đặt (Settings)',
    'com.android.chrome': 'Google Chrome',
    'com.google.android.youtube': 'YouTube',
    'com.google.android.gm': 'Gmail',
    'com.google.android.apps.maps': 'Google Maps',
    'com.android.vending': 'Google Play Store',
    'com.sec.android.app.camera': 'Camera (Samsung)',
    'com.sec.android.gallery3d': 'Bộ sưu tập (Gallery)',
    'com.sec.android.app.myfiles': 'File của bạn (My Files)',
    'com.samsung.android.messaging': 'Tin nhắn (Samsung)',
    'com.samsung.android.dialer': 'Điện thoại (Phone)',
    'com.samsung.android.app.notes': 'Samsung Notes',
    'com.sec.android.app.sbrowser': 'Samsung Internet',
    'com.facebook.katana': 'Facebook',
    'com.facebook.orca': 'Messenger',
    'com.zing.zalo': 'Zalo',
    'org.telegram.messenger': 'Telegram',
    'com.zhiliaoapp.musically': 'TikTok',
    'com.ss.android.ugc.trill': 'TikTok',
    'com.instagram.android': 'Instagram',
    'com.spotify.music': 'Spotify',
    'com.whatsapp': 'WhatsApp',
    'com.discord': 'Discord',
  };
  if (KNOWN[pkg]) return KNOWN[pkg];
  const segments = pkg.split('.');
  const last = segments[segments.length - 1] || pkg;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/[_-]/g, ' ');
}

async function launchApp(serial, pkg) {
  const cleanPkg = String(pkg || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(cleanPkg)) {
    throw new Error('Tên package không hợp lệ.');
  }
  // Use monkey to resolve default LAUNCHER activity cleanly without knowing class name
  return execAdb(
    ['-s', serial, 'shell', 'monkey', '-p', cleanPkg, '-c', 'android.intent.category.LAUNCHER', '1'],
    { timeout: 8000 }
  );
}

async function pushFile(serial, localPath, remotePath) {
  return execAdb(['-s', serial, 'push', localPath, remotePath], { timeout: 30000 });
}

async function forwardPort(serial, localPort, abstractName) {
  return execAdb(['-s', serial, 'forward', `tcp:${localPort}`, `localabstract:${abstractName}`], { timeout: 6000 });
}

async function removeForward(serial, localPort) {
  return execAdb(['-s', serial, 'forward', '--remove', `tcp:${localPort}`], { timeout: 5000 });
}

module.exports = {
  ADB_BIN,
  ANDROID_KEYCODES,
  resolveKeycode,
  execAdb,
  checkAdbAvailable,
  getDeviceProp,
  getDeviceMeta,
  listDevices,
  pairWireless,
  connectWireless,
  autoConnectWireless,
  disconnectWireless,
  enableTcpip,
  runShell,
  takeScreenshot,
  listApps,
  launchApp,
  pushFile,
  forwardPort,
  removeForward,
};

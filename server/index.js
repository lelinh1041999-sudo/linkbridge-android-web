'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const adb = require('./adb');
const { SessionManager, LOCAL_SERVER_PATH } = require('./scrcpy-session');
const { SCRCPY_VERSION } = require('./scrcpy-protocol');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// Allow hosted HTTPS GitHub Pages PWA to connect to the local Crostini Wi-Fi Bridge
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// Serve static Web UI
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

const sessions = new SessionManager();

// -------------------- Health & Environment --------------------

app.get('/api/health', async (_req, res) => {
  const adbStatus = await adb.checkAdbAvailable();
  const hasScrcpyServer = fs.existsSync(LOCAL_SERVER_PATH);
  res.json({
    ok: true,
    scrcpyVersion: SCRCPY_VERSION,
    hasScrcpyServer,
    adb: adbStatus,
    activeSessions: sessions.listInfos(),
  });
});

// -------------------- Devices & Wireless ADB --------------------

app.get('/api/devices', async (_req, res) => {
  try {
    const result = await adb.listDevices();
    const active = sessions.listInfos();
    const devices = result.devices.map((d) => ({
      ...d,
      streaming: Boolean(active[d.serial]),
      session: active[d.serial] || null,
    }));
    res.json({
      adbAvailable: result.adbAvailable,
      error: result.error,
      devices,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/adb/pair', async (req, res) => {
  try {
    const { address, code } = req.body || {};
    const out = await adb.pairWireless(address, code);
    const message = `${out.stdout} ${out.stderr}`.trim();
    const paired = out.ok && /successfully paired/i.test(message);
    res.status(paired ? 200 : 400).json({
      ok: paired,
      message: message || (paired ? 'Ghép nối thành công!' : 'Ghép nối thất bại.'),
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/adb/connect', async (req, res) => {
  try {
    const { address } = req.body || {};
    const out = await adb.connectWireless(address);
    res.status(out.ok ? 200 : 400).json({
      ok: out.ok,
      message: out.message || (out.ok ? 'Đã kết nối!' : 'Không thể kết nối.'),
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/adb/disconnect', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (address) {
      const s = sessions.get(address);
      if (s) await s.stop();
    }
    const out = await adb.disconnectWireless(address);
    res.json({ ok: out.ok, message: `${out.stdout} ${out.stderr}`.trim() });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/adb/tcpip', async (req, res) => {
  try {
    const { serial, port } = req.body || {};
    if (!serial) return res.status(400).json({ ok: false, message: 'Thiếu serial thiết bị.' });
    const out = await adb.enableTcpip(serial, port || 5555);
    res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// -------------------- Programmatic Control & Command API --------------------

app.post('/api/device/:serial/shell', async (req, res) => {
  const { serial } = req.params;
  const { command } = req.body || {};
  try {
    const out = await adb.runShell(serial, command);
    res.json(out);
  } catch (err) {
    res.status(400).json({ ok: false, stderr: err.message, stdout: '', exitCode: 1 });
  }
});

app.post('/api/device/:serial/tap', async (req, res) => {
  const { serial } = req.params;
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ ok: false, error: 'Tọa độ x, y không hợp lệ.' });
  }
  const startedAt = Date.now();
  try {
    const session = sessions.get(serial);
    if (session && session.state === 'running' && (await session.tap(x, y))) {
      return res.json({ ok: true, via: 'scrcpy', durationMs: Date.now() - startedAt });
    }
    const out = await adb.runShell(serial, `input tap ${Math.round(x)} ${Math.round(y)}`);
    res.json({ ok: out.ok, via: 'adb', durationMs: out.durationMs, stderr: out.stderr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/device/:serial/swipe', async (req, res) => {
  const { serial } = req.params;
  const x1 = Number(req.body?.x1);
  const y1 = Number(req.body?.y1);
  const x2 = Number(req.body?.x2);
  const y2 = Number(req.body?.y2);
  const durationMs = Number(req.body?.durationMs) || 260;
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return res.status(400).json({ ok: false, error: 'Tọa độ swipe (x1, y1, x2, y2) không hợp lệ.' });
  }
  const startedAt = Date.now();
  try {
    const session = sessions.get(serial);
    if (session && session.state === 'running' && (await session.swipe(x1, y1, x2, y2, durationMs))) {
      return res.json({ ok: true, via: 'scrcpy', durationMs: Date.now() - startedAt });
    }
    const out = await adb.runShell(
      serial,
      `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durationMs)}`
    );
    res.json({ ok: out.ok, via: 'adb', durationMs: out.durationMs, stderr: out.stderr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/device/:serial/key', async (req, res) => {
  const { serial } = req.params;
  const startedAt = Date.now();
  try {
    const keycode = adb.resolveKeycode(req.body?.keycode ?? req.body?.key);
    const session = sessions.get(serial);
    if (session && session.state === 'running' && session.pressKey(keycode)) {
      return res.json({ ok: true, via: 'scrcpy', keycode, durationMs: Date.now() - startedAt });
    }
    const out = await adb.runShell(serial, `input keyevent ${keycode}`);
    res.json({ ok: out.ok, via: 'adb', keycode, durationMs: out.durationMs, stderr: out.stderr });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/device/:serial/text', async (req, res) => {
  const { serial } = req.params;
  const text = String(req.body?.text ?? '');
  const startedAt = Date.now();
  try {
    const session = sessions.get(serial);
    if (session && session.state === 'running') {
      session.injectText(text);
      return res.json({ ok: true, via: 'scrcpy', durationMs: Date.now() - startedAt });
    }
    // Fallback over ADB (safe escaping for spaces/shell chars)
    const safe = text.replace(/(['\\"`$])/g, '\\$1').replace(/ /g, '%s');
    const out = await adb.runShell(serial, `input text "${safe}"`);
    res.json({ ok: out.ok, via: 'adb', durationMs: out.durationMs, stderr: out.stderr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/device/:serial/clipboard', async (req, res) => {
  const { serial } = req.params;
  const text = String(req.body?.text ?? '');
  const paste = Boolean(req.body?.paste);
  const session = sessions.get(serial);
  if (!session || session.state !== 'running') {
    return res.status(409).json({ ok: false, error: 'Cần mở luồng kết nối thiết bị để đồng bộ clipboard.' });
  }
  session.setClipboard(text, paste);
  res.json({ ok: true });
});

app.post('/api/device/:serial/display-power', async (req, res) => {
  const { serial } = req.params;
  const on = Boolean(req.body?.on);
  const session = sessions.get(serial);
  if (!session || session.state !== 'running') {
    return res.status(409).json({ ok: false, error: 'Cần mở luồng kết nối thiết bị trước.' });
  }
  session.setDisplayPower(on);
  res.json({ ok: true, on });
});

app.get('/api/device/:serial/apps', async (req, res) => {
  try {
    const apps = await adb.listApps(req.params.serial);
    res.json({ ok: true, apps });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, apps: [] });
  }
});

app.post('/api/device/:serial/app', async (req, res) => {
  const { serial } = req.params;
  const pkg = String(req.body?.package || req.body?.name || '').trim();
  if (!pkg) return res.status(400).json({ ok: false, error: 'Thiếu tên package ứng dụng.' });
  try {
    const session = sessions.get(serial);
    if (session && session.state === 'running') {
      session.startApp(pkg);
      return res.json({ ok: true, via: 'scrcpy', package: pkg });
    }
    const out = await adb.launchApp(serial, pkg);
    res.json({ ok: out.ok, via: 'adb', package: pkg, stdout: out.stdout, stderr: out.stderr });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/device/:serial/screenshot', async (req, res) => {
  try {
    const png = await adb.takeScreenshot(req.params.serial);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="screenshot-${Date.now()}.png"`);
    res.send(png);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/device/:serial/macro', async (req, res) => {
  const { serial } = req.params;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const results = [];
  const startedAt = Date.now();
  const session = sessions.get(serial);

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const action = String(step.action || '').toLowerCase();
      if (action === 'wait' || action === 'sleep') {
        const ms = Math.min(30000, Math.max(0, Number(step.ms) || 300));
        await new Promise((r) => setTimeout(r, ms));
        results.push({ step: i + 1, action, ok: true, ms });
      } else if (action === 'tap') {
        if (session && session.state === 'running') {
          await session.tap(Number(step.x), Number(step.y));
        } else {
          await adb.runShell(serial, `input tap ${Math.round(step.x)} ${Math.round(step.y)}`);
        }
        results.push({ step: i + 1, action, ok: true });
      } else if (action === 'swipe') {
        if (session && session.state === 'running') {
          await session.swipe(Number(step.x1), Number(step.y1), Number(step.x2), Number(step.y2), Number(step.durationMs) || 260);
        } else {
          await adb.runShell(
            serial,
            `input swipe ${Math.round(step.x1)} ${Math.round(step.y1)} ${Math.round(step.x2)} ${Math.round(step.y2)} ${Math.round(step.durationMs || 260)}`
          );
        }
        results.push({ step: i + 1, action, ok: true });
      } else if (action === 'key') {
        const kc = adb.resolveKeycode(step.keycode ?? step.key);
        if (session && session.state === 'running') session.pressKey(kc);
        else await adb.runShell(serial, `input keyevent ${kc}`);
        results.push({ step: i + 1, action, ok: true, keycode: kc });
      } else if (action === 'text') {
        if (session && session.state === 'running') session.injectText(step.text);
        else await adb.runShell(serial, `input text "${String(step.text || '').replace(/ /g, '%s')}"`);
        results.push({ step: i + 1, action, ok: true });
      } else if (action === 'app') {
        if (session && session.state === 'running') session.startApp(step.package);
        else await adb.launchApp(serial, step.package);
        results.push({ step: i + 1, action, ok: true });
      } else if (action === 'shell') {
        const out = await adb.runShell(serial, step.command);
        results.push({ step: i + 1, action, ok: out.ok, stdout: out.stdout.trim(), stderr: out.stderr.trim() });
      }
    }
    res.json({ ok: true, durationMs: Date.now() - startedAt, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message, results });
  }
});

// -------------------- HTTP + Low-Latency WebSocket Server --------------------

const server = http.createServer(app);

// Disable perMessageDeflate! Compressing H.264/Opus adds 10-30ms of useless CPU latency.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

server.on('upgrade', (req, socket, head) => {
  // Disable Nagle's algorithm on client WebSocket TCP connection for lowest touch & video latency
  socket.setNoDelay(true);

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/ws/device/')) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, url);
  });
});

wss.on('connection', async (ws, _req, url) => {
  const serial = decodeURIComponent(url.pathname.slice('/ws/device/'.length));
  const q = url.searchParams;
  const options = {
    maxSize: Number(q.get('maxSize')) || 1080,
    bitRate: Number(q.get('bitRate')) || 8_000_000,
    maxFps: Number(q.get('maxFps')) || 60,
    audio: q.get('audio') !== 'false',
    stayAwake: q.get('stayAwake') === 'true',
    turnScreenOff: q.get('turnScreenOff') === 'true',
    videoCodec: q.get('videoCodec') || 'h264',
  };
  const forceRestart = q.get('restart') === 'true';

  let session = null;

  try {
    ws.send(JSON.stringify({ type: 'status', status: 'connecting', serial }));
    session = await sessions.getOrCreate(serial, options, forceRestart);
    session.addClient(ws);
    ws.send(JSON.stringify({ type: 'status', status: 'connected', serial }));
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
    }
    return;
  }

  ws.on('message', (data, isBinary) => {
    if (!session || session.state !== 'running') return;

    // Fast path: raw scrcpy binary control message straight to phone socket (zero overhead!)
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      session.writeControlRaw(buf);
      return;
    }

    // JSON control path (buttons, clipboard, settings, display power)
    try {
      const msg = JSON.parse(data.toString('utf8'));
      switch (msg.type) {
        case 'key':
          session.pressKey(adb.resolveKeycode(msg.keycode), msg.metaState || 0);
          break;
        case 'text':
          session.injectText(msg.text || '');
          break;
        case 'clipboard':
          session.setClipboard(msg.text || '', Boolean(msg.paste));
          break;
        case 'display_power':
          session.setDisplayPower(Boolean(msg.on));
          break;
        case 'rotate':
          session.rotateDevice();
          break;
        case 'expand_notifications':
          session.expandNotifications();
          break;
        case 'expand_settings':
          session.expandSettings();
          break;
        case 'collapse_panels':
          session.collapsePanels();
          break;
        case 'back_or_screen_on':
          session.backOrScreenOn();
          break;
        case 'reset_video':
          session.resetVideo();
          break;
        case 'start_app':
          if (msg.package) session.startApp(msg.package);
          break;
        default:
          break;
      }
    } catch {
      // Ignore malformed JSON frames
    }
  });

  ws.on('close', () => {
    if (session) session.removeClient(ws);
  });

  ws.on('error', () => {
    if (session) session.removeClient(ws);
  });
});

// Graceful shutdown
async function shutdown() {
  console.log('\n[LinhBridge] Đang đóng các phiên kết nối...');
  await sessions.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`\n┌──────────────────────────────────────────────────────────────┐`);
  console.log(`│  LinhBridge — Android Ultra-Low-Latency Web Remote Control   │`);
  console.log(`│  scrcpy-server v${SCRCPY_VERSION} • WebCodecs Hardware Decode             │`);
  console.log(`├──────────────────────────────────────────────────────────────┤`);
  console.log(`│  Mở trên Chrome (Chromebook):  http://localhost:${PORT}         │`);
  console.log(`│  API / CLI Endpoint:           http://localhost:${PORT}/api     │`);
  console.log(`└──────────────────────────────────────────────────────────────┘\n`);
});

#!/usr/bin/env node
'use strict';

/**
 * LinhBridge Crostini Agent — Connects Linux Crostini (Chromebook) to LinhBridge Cloud Relay.
 * Logs every command received in real time; press Ctrl+C anytime to disconnect immediately.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const WebSocket = require('ws');

const execFileAsync = promisify(execFile);

const RELAY_URL = (process.env.LB_RELAY_URL || 'https://linhbridge-relay.onrender.com').replace(/\/+$/, '');
const ROOM_ID = process.env.LB_CB_ROOM || `CB-${crypto.randomInt(1000, 9999)}`;
const TOKEN = process.env.LB_CB_TOKEN || crypto.randomBytes(12).toString('hex');

const WS_URL =
  RELAY_URL.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://') +
  `/room/${encodeURIComponent(ROOM_ID)}?token=${encodeURIComponent(TOKEN)}`;

function resolveUserPath(p) {
  if (!p) return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

async function runBash(command, cwd, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: cwd ? resolveUserPath(cwd) : os.homedir(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const MAX_OUT = 256 * 1024;
    let killed = false;
    let settled = false;

    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        stdout,
        stderr: killed ? `${stderr}\n[Timeout sau ${timeoutMs}ms]`.trim() : stderr,
        exitCode: killed ? 124 : (code ?? 0),
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch {}
      setTimeout(() => done(124), 150);
    }, Math.min(24000, Math.max(1000, Number(timeoutMs) || 20000)));

    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUT) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUT) stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      stderr += err.message;
      done(1);
    });

    child.on('exit', (code) => {
      setTimeout(() => done(code ?? 0), 150);
    });

    child.on('close', (code) => done(code ?? 0));
  });
}

async function openUrlInChromeOS(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error('URL phải bắt đầu bằng http:// hoặc https://');
  }
  const openers = ['garcon-url-handler', 'xdg-open'];
  for (const bin of openers) {
    try {
      await execFileAsync(bin, [clean], { timeout: 5000 });
      return { ok: true, opener: bin, url: clean };
    } catch {}
  }
  throw new Error('Không tìm thấy garcon-url-handler hay xdg-open.');
}

async function handleAction(msg) {
  const action = String(msg.action || '').toLowerCase();
  const ts = new Date().toLocaleTimeString('vi-VN');
  console.log(`[${ts}] <- AI yêu cầu: ${action}`, msg.command || msg.path || msg.url || '');

  try {
    if (action === 'info') {
      const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
      const memFreeMb = Math.round(os.freemem() / 1024 / 1024);
      const df = await runBash('df -h ~ | tail -n 1', os.homedir(), 4000);
      const adbOut = await runBash('adb devices -l 2>/dev/null || echo "adb chưa cài"', os.homedir(), 4000);
      return {
        ok: true,
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        user: os.userInfo().username,
        home: os.homedir(),
        cpus: os.cpus().length,
        memoryMb: { total: memTotalMb, free: memFreeMb },
        disk: df.stdout.trim(),
        adb: adbOut.stdout.trim(),
        node: process.version,
      };
    }

    if (action === 'exec' || action === 'shell') {
      const cmd = String(msg.command || '').trim();
      if (!cmd) return { ok: false, error: 'Thiếu lệnh command.' };
      return await runBash(cmd, msg.cwd, msg.timeoutMs);
    }

    if (action === 'list_dir' || action === 'ls') {
      const target = resolveUserPath(msg.path);
      const entries = fs.readdirSync(target, { withFileTypes: true }).map((d) => ({
        name: d.name,
        type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'link' : 'file',
      }));
      return { ok: true, path: target, entries: entries.slice(0, 300) };
    }

    if (action === 'read_file' || action === 'cat') {
      const target = resolveUserPath(msg.path);
      const stat = fs.statSync(target);
      if (stat.size > 512 * 1024) {
        return { ok: false, error: `File quá lớn (${stat.size} bytes, giới hạn 512KB).` };
      }
      const content = fs.readFileSync(target, 'utf8');
      return { ok: true, path: target, size: stat.size, content };
    }

    if (action === 'write_file') {
      const target = resolveUserPath(msg.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(msg.content ?? ''), 'utf8');
      return { ok: true, path: target, bytes: Buffer.byteLength(String(msg.content ?? ''), 'utf8') };
    }

    if (action === 'open_url' || action === 'open') {
      return await openUrlInChromeOS(msg.url);
    }

    return { ok: false, error: `Lệnh không hỗ trợ trên Crostini Agent: ${action}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let exiting = false;

function connect() {
  if (exiting) return;
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('\n┌──────────────────────────────────────────────────────────────┐');
    console.log('│  LinhBridge Crostini Agent — ĐÃ KẾT NỐI SẴN SÀNG!            │');
    console.log('├──────────────────────────────────────────────────────────────┤');
    console.log(`│  Relay: ${RELAY_URL}`);
    console.log(`│  Room:  ${ROOM_ID}`);
    console.log(`│  Token: ${TOKEN}`);
    console.log('├──────────────────────────────────────────────────────────────┤');
    console.log('│  Copy 3 dòng Relay / Room / Token trên gửi cho AI!           │');
    console.log('│  Nhấn Ctrl + C bất cứ lúc nào để ngắt quyền truy cập ngay.   │');
    console.log('└──────────────────────────────────────────────────────────────┘\n');

    let awaitingPong = false;
    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (awaitingPong) {
        console.log('[Crostini Agent] Kết nối bị treo, tự động kết nối lại...');
        try { ws.terminate(); } catch {}
        return;
      }
      awaitingPong = true;
      ws.send(JSON.stringify({ type: 'ping' }));
    }, 12000);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        if (msg.type === 'pong') {
          awaitingPong = false;
          return;
        }
        if (msg.type === 'relay_ready' || !msg.id) return;
        const reply = await handleAction(msg);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: msg.id, ...reply }));
        }
      } catch {}
    });
  });

  ws.on('close', () => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (!exiting) {
      console.log('[Crostini Agent] Mất kết nối Relay, thử kết nối lại sau 3 giây...');
      reconnectTimer = setTimeout(connect, 3000);
    }
  });

  ws.on('error', (err) => {
    console.error('[Crostini Agent] Lỗi kết nối:', err.message);
  });
}

function shutdown() {
  exiting = true;
  if (pingTimer) clearInterval(pingTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  console.log('\n[Crostini Agent] Đã ngắt kết nối an toàn.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[Crostini Agent] Đang kết nối tới ${RELAY_URL} (nếu Render đang ngủ sẽ mất ~20-30s để đánh thức)...`);
connect();

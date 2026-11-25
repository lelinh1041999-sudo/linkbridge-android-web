'use strict';

/**
 * LinhBridge Cloud Relay (Node.js)
 * Bridges AI agent HTTP requests -> LinhBridge Browser WebSocket (Chromebook).
 * Deployable in 1 click to Render, Railway, Fly.io, or any VPS.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

// roomId -> { hostWs, token, pending: Map<reqId, { res, timer }> }
const rooms = new Map();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error('Payload quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return sendJson(res, 200, {
      ok: true,
      service: 'LinhBridge Cloud Relay',
      activeRooms: rooms.size,
    });
  }

  const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{3,40})\/(cmd|status)$/);
  if (!match) {
    return sendJson(res, 404, { ok: false, error: 'Endpoint không tồn tại.' });
  }

  const [, roomId, action] = match;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (url.searchParams.get('token') || '');
  const room = rooms.get(roomId);

  if (action === 'status' && req.method === 'GET') {
    const connected = Boolean(room && room.hostWs && room.hostWs.readyState === 1);
    return sendJson(res, 200, { ok: true, roomId, connected });
  }

  if (action === 'cmd' && req.method === 'POST') {
    if (!room || !room.hostWs || room.hostWs.readyState !== 1) {
      return sendJson(res, 404, { ok: false, error: 'Phòng không tồn tại hoặc trình duyệt LinhBridge chưa bật AI Bridge.' });
    }
    if (!bearerToken || bearerToken !== room.token) {
      return sendJson(res, 401, { ok: false, error: 'Sai token xác thực phòng.' });
    }

    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { ok: false, error: 'JSON không hợp lệ.' });
    }

    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = Math.min(30000, Math.max(1000, Number(payload.timeoutMs) || 20000));

    const timer = setTimeout(() => {
      room.pending.delete(reqId);
      sendJson(res, 504, { ok: false, error: 'Timeout chờ trình duyệt LinhBridge phản hồi.' });
    }, timeoutMs);

    room.pending.set(reqId, { res, timer });
    room.hostWs.send(JSON.stringify({ ...payload, id: reqId }));
    return;
  }

  return sendJson(res, 405, { ok: false, error: 'Method không hỗ trợ.' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{3,40})$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const roomId = match[1];
  const token = url.searchParams.get('token') || '';
  if (!token || token.length < 8) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, roomId, token);
  });
});

wss.on('connection', (ws, roomId, token) => {
  const prev = rooms.get(roomId);
  if (prev && prev.hostWs) {
    try { prev.hostWs.close(); } catch {}
    for (const [, p] of prev.pending) {
      clearTimeout(p.timer);
      sendJson(p.res, 503, { ok: false, error: 'Host kết nối lại.' });
    }
  }

  const room = { hostWs: ws, token, pending: new Map() };
  rooms.set(roomId, room);

  ws.send(JSON.stringify({ type: 'relay_ready', roomId }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.id && room.pending.has(msg.id)) {
        const entry = room.pending.get(msg.id);
        room.pending.delete(msg.id);
        clearTimeout(entry.timer);
        sendJson(entry.res, msg.ok === false ? 400 : 200, msg);
      }
    } catch {}
  });

  ws.on('close', () => {
    if (rooms.get(roomId) === room) {
      for (const [, p] of room.pending) {
        clearTimeout(p.timer);
        sendJson(p.res, 503, { ok: false, error: 'Trình duyệt LinhBridge đã ngắt AI Bridge.' });
      }
      rooms.delete(roomId);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`LinhBridge Cloud Relay listening on http://${HOST}:${PORT}`);
});

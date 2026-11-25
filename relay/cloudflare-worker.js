/**
 * LinhBridge Cloud Relay — Cloudflare Workers + Durable Objects (Free Tier)
 * Zero-cost 24/7 global WebSocket + HTTPS relay for AI Bridge.
 */

export class RelayRoom {
  constructor(state) {
    this.state = state;
    this.hostWs = null;
    this.token = null;
    this.pending = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Browser WebSocket connection
    if (request.headers.get('Upgrade') === 'websocket') {
      const token = url.searchParams.get('token') || '';
      if (token.length < 8) {
        return new Response('Missing token', { status: 401 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      if (this.hostWs) {
        try { this.hostWs.close(1000, 'Replaced'); } catch {}
      }
      this.hostWs = server;
      this.token = token;

      server.send(JSON.stringify({ type: 'relay_ready' }));

      server.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ping') {
            server.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            p.resolve(
              new Response(JSON.stringify(msg), {
                status: msg.ok === false ? 400 : 200,
                headers: { 'Content-Type': 'application/json', ...cors },
              })
            );
          }
        } catch {}
      });

      server.addEventListener('close', () => {
        if (this.hostWs === server) {
          this.hostWs = null;
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.resolve(
              new Response(JSON.stringify({ ok: false, error: 'Host disconnected' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', ...cors },
              })
            );
          }
          this.pending.clear();
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/status')) {
      return new Response(JSON.stringify({ ok: true, connected: Boolean(this.hostWs) }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/cmd')) {
      if (!this.hostWs) {
        return new Response(JSON.stringify({ ok: false, error: 'Browser AI Bridge is offline' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const auth = request.headers.get('Authorization') || '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!bearer || bearer !== this.token) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }

      const payload = await request.json().catch(() => ({}));
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutMs = Math.min(25000, Math.max(1000, Number(payload.timeoutMs) || 18000));

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve(
            new Response(JSON.stringify({ ok: false, error: 'Timeout waiting for LinhBridge browser' }), {
              status: 504,
              headers: { 'Content-Type': 'application/json', ...cors },
            })
          );
        }, timeoutMs);
        this.pending.set(id, { resolve, timer });
        this.hostWs.send(JSON.stringify({ ...payload, id }));
      });
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'LinhBridge Cloudflare Relay' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{3,40})(?:\/(cmd|status))?$/);
    if (!match) {
      return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const id = env.RELAY_ROOM.idFromName(match[1]);
    return env.RELAY_ROOM.get(id).fetch(request);
  },
};

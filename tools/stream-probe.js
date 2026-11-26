#!/usr/bin/env node
'use strict';
/**
 * Headless stream probe: connects to the local LinhBridge WS like the browser does
 * and measures video FPS/bitrate + audio/video packet inter-arrival jitter.
 * Usage: node tools/stream-probe.js [serial] [seconds] [maxSize] [bitRateMbps] [fps]
 */
const WebSocket = require('ws');

const serial = process.argv[2];
const seconds = Number(process.argv[3] || 10);
const maxSize = Number(process.argv[4] || 1080);
const bitRate = Number(process.argv[5] || 8) * 1_000_000;
const maxFps = Number(process.argv[6] || 60);
if (!serial) {
  console.error('Usage: node tools/stream-probe.js <serial> [seconds] [maxSize] [Mbps] [fps]');
  process.exit(1);
}

const q = new URLSearchParams({ maxSize, bitRate, maxFps, audio: 'true', videoCodec: 'h264', restart: 'true' });
const ws = new WebSocket(`ws://127.0.0.1:3000/ws/device/${encodeURIComponent(serial)}?${q}`);
ws.binaryType = 'nodebuffer';

const st = { v: [], a: [], vBytes: 0, aBytes: 0, keys: 0, t0: 0 };
function gaps(arr) {
  const g = [];
  for (let i = 1; i < arr.length; i++) g.push(arr[i] - arr[i - 1]);
  g.sort((x, y) => x - y);
  const pct = (p) => (g.length ? g[Math.min(g.length - 1, Math.floor(g.length * p))].toFixed(1) : '-');
  return { n: arr.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: g.length ? g[g.length - 1].toFixed(1) : '-',
    over60: g.filter((x) => x > 60).length, over100: g.filter((x) => x > 100).length };
}

ws.on('message', (data, isBinary) => {
  if (!isBinary) {
    const m = JSON.parse(data.toString());
    if (m.type === 'status' || m.type === 'error') console.log('[status]', JSON.stringify(m));
    return;
  }
  const now = performance.now();
  if (!st.t0) {
    st.t0 = now;
    setTimeout(report, seconds * 1000);
  }
  const type = data[0];
  const flags = data[1];
  if (type === 1) {
    if (flags & 1) return;
    st.v.push(now);
    st.vBytes += data.length;
    if (flags & 2) st.keys++;
  } else if (type === 2) {
    if (flags & 1) return;
    st.a.push(now);
    st.aBytes += data.length;
  }
});

function report() {
  const dur = (performance.now() - st.t0) / 1000;
  const vg = gaps(st.v);
  const ag = gaps(st.a);
  console.log(`Duration ${dur.toFixed(1)}s | settings ${maxSize}p ${bitRate / 1e6}Mbps ${maxFps}fps`);
  console.log(`VIDEO fps=${(vg.n / dur).toFixed(1)} Mbps=${((st.vBytes * 8) / dur / 1e6).toFixed(2)} keyframes=${st.keys} gap(ms) p50=${vg.p50} p95=${vg.p95} p99=${vg.p99} max=${vg.max} >60ms=${vg.over60} >100ms=${vg.over100}`);
  console.log(`AUDIO pkts/s=${(ag.n / dur).toFixed(1)} kbps=${((st.aBytes * 8) / dur / 1e3).toFixed(0)} gap(ms) p50=${ag.p50} p95=${ag.p95} p99=${ag.p99} max=${ag.max} >60ms=${ag.over60} >100ms=${ag.over100}`);
  ws.close();
  process.exit(0);
}

ws.on('error', (e) => { console.error('WS error', e.message); process.exit(1); });
setTimeout(() => { console.error('No data received'); process.exit(1); }, (seconds + 15) * 1000);

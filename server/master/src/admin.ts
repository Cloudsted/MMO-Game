/**
 * Admin web panel: live shard/room table, room restart buttons, and a tail
 * of the master's own logs. Served by the master at /admin, gated by
 * ADMIN_KEY (.env). Plain HTML+JS — no build step, no dependencies.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { logSink } from "@fantasy-mmo/common";
import type { ShardManager } from "./shards.js";

const LOG_LINES = 300;
const logBuffer: string[] = [];
logSink.push = (line) => {
  logBuffer.push(line);
  if (logBuffer.length > LOG_LINES) logBuffer.shift();
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Handles /admin* routes. Returns true when the request was handled. */
export function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  shards: ShardManager,
  adminKey: string
): boolean {
  const path = url.pathname;
  if (!path.startsWith("/admin") && !path.startsWith("/api/admin")) return false;

  if (path === "/admin") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return true;
  }

  // API routes below require the key
  if (url.searchParams.get("key") !== adminKey) {
    json(res, 401, { error: "bad admin key" });
    return true;
  }
  if (path === "/api/admin/logs") {
    json(res, 200, { lines: logBuffer });
    return true;
  }
  if (path === "/api/admin/restart-room" && req.method === "POST") {
    const roomId = url.searchParams.get("roomId") ?? "";
    const ok = shards.closeRoomAdmin(roomId);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "room not assigned" });
    return true;
  }
  json(res, 404, { error: "not found" });
  return true;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>fantasy-mmo admin</title>
<style>
  body { font: 13px/1.5 Consolas, monospace; background: #14151c; color: #d8d8e0; margin: 24px; }
  h1 { font-size: 18px; color: #ffd37a; }
  h2 { font-size: 14px; color: #9fc1ff; margin-top: 24px; }
  table { border-collapse: collapse; margin-top: 8px; }
  td, th { border: 1px solid #33364a; padding: 5px 12px; text-align: left; }
  th { background: #1e2030; color: #9fc1ff; }
  button { background: #3a2f4f; color: #eee; border: 1px solid #665a88; padding: 3px 10px; cursor: pointer; font: inherit; }
  button:hover { background: #4d3f6b; }
  #logs { background: #0d0e13; border: 1px solid #33364a; padding: 10px; margin-top: 8px;
          height: 320px; overflow-y: auto; white-space: pre-wrap; font-size: 12px; }
  .warn { color: #ffcf6e; } .error { color: #ff7a7a; }
  input { background: #1e2030; border: 1px solid #33364a; color: #eee; padding: 4px 8px; font: inherit; }
  .muted { color: #777c92; }
</style></head><body>
<h1>fantasy-mmo — admin</h1>
<div>key <input id="key" type="password" size="24"> <span id="state" class="muted">enter the ADMIN_KEY from .env</span></div>
<h2>shards &amp; rooms</h2>
<div id="status" class="muted">…</div>
<h2>master log</h2>
<div id="logs"></div>
<script>
const keyEl = document.getElementById('key');
keyEl.value = localStorage.getItem('adminKey') || '';
keyEl.addEventListener('change', () => localStorage.setItem('adminKey', keyEl.value));
const k = () => encodeURIComponent(keyEl.value);

async function refreshStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    let html = '';
    for (const shard of s.shards) {
      html += '<table><tr><th colspan="4">' + shard.shardId + ' @ ' + shard.gameHost +
        ' <span class="muted">(capacity ' + shard.capacity + ')</span></th></tr>' +
        '<tr><th>room</th><th>port</th><th>players</th><th></th></tr>';
      for (const r of shard.rooms) {
        html += '<tr><td>' + r.roomId + '</td><td>' + r.port + '</td><td>' + r.players + '</td>' +
          '<td><button onclick="restartRoom(\\'' + r.roomId + '\\')">restart</button></td></tr>';
      }
      html += '</table>';
    }
    const down = s.rooms.filter(r => r.status !== 'open').map(r => r.roomId + ':' + r.status);
    if (down.length) html += '<p class="warn">pending/down: ' + down.join(', ') + '</p>';
    document.getElementById('status').innerHTML = html || 'no shards connected';
  } catch (e) {
    document.getElementById('status').textContent = 'status unavailable: ' + e;
  }
}

async function refreshLogs() {
  if (!keyEl.value) return;
  try {
    const r = await fetch('/api/admin/logs?key=' + k());
    if (!r.ok) { document.getElementById('state').textContent = 'bad key'; return; }
    document.getElementById('state').textContent = 'authorized';
    const data = await r.json();
    const el = document.getElementById('logs');
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.innerHTML = data.lines.map(l => {
      const cls = l.includes(' ERROR ') ? 'error' : l.includes(' WARN ') ? 'warn' : '';
      return '<div class="' + cls + '">' + l.replace(/</g, '&lt;') + '</div>';
    }).join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  } catch (e) { /* master briefly away */ }
}

async function restartRoom(roomId) {
  if (!confirm('Restart room ' + roomId + '? Connected players get evicted (they auto-recover via the hub).')) return;
  await fetch('/api/admin/restart-room?roomId=' + roomId + '&key=' + k(), { method: 'POST' });
  setTimeout(refreshStatus, 800);
}

setInterval(refreshStatus, 2500);
setInterval(refreshLogs, 2500);
refreshStatus();
refreshLogs();
</script></body></html>`;

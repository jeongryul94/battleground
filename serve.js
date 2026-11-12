// GREYHAVEN server: static files + dependency-free WebSocket multiplayer room.
//   node serve.js            -> http://localhost:8123  (LAN: http://<this-PC-IP>:8123)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const root = __dirname, port = +process.env.PORT || 8123;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (!file.startsWith(root) || /^(tools|node_modules|\.git)(\/|$)|^serve\.js$|\.bat$|^Dockerfile$|^\.|_backup/.test(rel)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ───────────────────────── minimal WebSocket (RFC 6455, text frames)
class Conn {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null; this.closed = false;
    sock.on('data', d => { try { this.onData(d); } catch (e) { console.error('ws frame error', e.message); this.close(); } });
    sock.on('close', () => { if (!this.closed) { this.closed = true; this.onclose?.(); } });
    sock.on('error', () => {});
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 15, fin = b0 & 128, masked = b1 & 128;
      let len = b1 & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 4e6) { this.close(); return; }
      const mOff = off; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked) { const m = this.buf.subarray(mOff, mOff + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 0) { this.frag = Buffer.concat([this.frag || Buffer.alloc(0), payload]); if (fin) { const m = this.frag; this.frag = null; this.onmessage?.(m.toString()); } continue; }
      if (op === 1) { if (fin) this.onmessage?.(payload.toString()); else this.frag = payload; }
    }
  }
  frame(op, data) {
    if (this.sock.destroyed) return;
    const len = data.length; let h;
    if (len < 126) h = Buffer.from([128 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([h, data]));
  }
  send(obj) { this.frame(1, Buffer.from(JSON.stringify(obj))); }
  close() { if (this.closed) return; this.closed = true; try { this.frame(8, Buffer.alloc(0)); } catch {} this.sock.end(); this.onclose?.(); }
}
server.on('upgrade', (req, sock) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  onConnect(new Conn(sock));
});

// ───────────────────────── room
let Z = null, terrainH = null; // zone helpers, loaded async (ES module)
const players = new Map();
let nextId = 1, hostId = null, phase = 'lobby', match = null;
const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const lobbyList = () => [...players.values()].map(p => ({ id: p.id, name: p.name, inMatch: p.inMatch }));
function broadcast(obj, except) { const s = Buffer.from(JSON.stringify(obj)); for (const p of players.values()) if (p.id !== except) p.conn.frame(1, s); }
const sendLobby = () => broadcast({ t: 'lobby', players: lobbyList(), hostId, phase });
const host = () => players.get(hostId);
const alivePlayers = () => [...players.values()].filter(p => p.inMatch && p.alive);
const aliveTotal = () => alivePlayers().length + (match ? match.botsAlive : 0);

function onConnect(conn) {
  let me = null;
  conn.onmessage = raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!me) {
      if (m.t !== 'hello') return;
      const name = String(m.name || '').replace(/[<>&"']/g, '').trim().slice(0, 12) || '생존자';
      me = { id: 'p' + nextId++, name, conn, inMatch: false, alive: false, hp: 100, gear: { vest: null, helm: null }, pos: [0, 0, 0], kills: 0 };
      players.set(me.id, me);
      if (!hostId || !players.has(hostId)) hostId = me.id;
      conn.send({ t: 'welcome', id: me.id, hostId, phase, ips: lanIPs(), port });
      sendLobby(); console.log(`+ ${name} (${me.id}) joined — ${players.size} online`);
      return;
    }
    handle(me, m);
  };
  conn.onclose = () => {
    if (!me) return;
    players.delete(me.id); console.log(`- ${me.name} left — ${players.size} online`);
    if (match && me.inMatch && me.alive) { me.alive = false; announceKill({ victim: me.id, victimName: me.name, by: null, byName: null, w: '이탈', pos: me.pos }); }
    if (hostId === me.id) { hostId = players.size ? players.keys().next().value : null; broadcast({ t: 'host', hostId }); }
    broadcast({ t: 'left', id: me.id });
    if (!players.size) endMatch(null, true);
    sendLobby();
  };
}

function handle(p, m) {
  switch (m.t) {
    case 'start': {
      if (p.id !== hostId || phase !== 'lobby' || !Z) return;
      const seed = (Math.random() * 2 ** 31) | 0;
      const bots = Math.max(0, Math.min(40, m.bots | 0));
      match = { seed, plan: Z.zonePlan(seed, terrainH), startAt: Date.now(), bots, botsAlive: bots, opened: new Set(), dropN: 0 };
      phase = 'match';
      for (const q of players.values()) Object.assign(q, { inMatch: true, alive: true, hp: 100, gear: { vest: null, helm: null }, kills: 0 });
      broadcast({ t: 'start', seed, plan: match.plan, bots, hostId, players: lobbyList() });
      match.timer = setInterval(zoneTick, 1000);
      console.log(`match started: ${players.size} players + ${bots} bots`);
      sendLobby();
      break;
    }
    case 'state': if (p.inMatch) { p.pos = m.p; m.id = p.id; broadcast(m, p.id); } break;
    case 'shot': if (p.inMatch) { if (p.id !== hostId || !String(m.s).startsWith('b')) m.s = p.id; broadcast(m, p.id); } break;
    case 'bots': if (p.id === hostId && match) broadcast(m, p.id); break;
    case 'hit': {
      if (!match) return;
      const dmg = Math.max(0, Math.min(250, +m.dmg || 0));
      if (String(m.target).startsWith('p')) {
        const tp = players.get(m.target);
        if (!tp || !tp.alive) return;
        // same armour rule as the client: the piece hit soaks a share and wears down
        let amt = dmg;
        const key = m.head ? 'helm' : 'vest', pc = tp.gear[key];
        if (pc && m.by) {
          const ab = amt * ([0, 0.3, 0.4, 0.55][pc.lvl] || 0);
          pc.d -= ab * (1.6 - 0.3 * pc.lvl); amt -= ab;
          if (pc.d <= 0) tp.gear[key] = null;
        }
        tp.hp -= amt;
        tp.conn.send({ t: 'hp', hp: tp.hp, gear: tp.gear, by: m.by });
        if (tp.hp <= 0) killPlayer(tp, m.by, m.bn, m.w);
      } else {
        host()?.conn.send({ t: 'botHit', target: m.target, dmg, head: !!m.head, w: m.w, by: m.by });
      }
      break;
    }
    case 'botDied': {
      if (p.id !== hostId || !match) return;
      match.botsAlive = Math.max(0, match.botsAlive - 1);
      const killer = players.get(m.by); if (killer) killer.kills++;
      announceKill({ victim: m.id, victimName: m.name, by: m.by, byName: killer ? killer.name : m.bn, w: m.w, pos: m.pos });
      break;
    }
    // first request for an item wins; everyone is told who got it
    case 'take': {
      if (!match) return;
      const key = m.c + ':' + (m.i | 0);
      if (match.opened.has(key)) return;
      match.opened.add(key); broadcast({ t: 'took', c: m.c, i: m.i | 0, by: p.id });
      break;
    }
    case 'drop': case 'deathbox': {
      if (!match || !Array.isArray(m.items) || !Array.isArray(m.pos)) return;
      const items = m.items.slice(0, 24).filter(it => it && typeof it.k === 'string');
      if (!items.length) return;
      broadcast({ t: 'box', id: 'g' + match.dropN++, kind: m.t === 'deathbox' ? 'death' : 'ground', items, pos: m.pos.slice(0, 3).map(Number) });
      break;
    }
    case 'gear': {
      const clean = g => (g && g.lvl >= 1 && g.lvl <= 3 ? { lvl: g.lvl | 0, d: Math.max(0, Math.min(100, +g.d || 0)) } : null);
      p.gear = { vest: clean(m.vest), helm: clean(m.helm) };
      break;
    }
    case 'heal': if (p.alive) { const cap = Math.min(100, +m.cap || 100); if (p.hp < cap) p.hp = Math.min(cap, p.hp + Math.min(100, +m.amt || 0)); p.conn.send({ t: 'hp', hp: p.hp, gear: p.gear }); } break;
    case 'selfdmg': if (p.alive) { p.hp -= Math.max(0, +m.amt || 0); p.conn.send({ t: 'hp', hp: p.hp, gear: p.gear }); if (p.hp <= 0) killPlayer(p, null, null, m.w || '낙하'); } break;
  }
}

function killPlayer(tp, by, bn, w) {
  tp.alive = false; tp.hp = 0;
  const killer = players.get(by); if (killer && killer !== tp) killer.kills++;
  announceKill({ victim: tp.id, victimName: tp.name, by: by || null, byName: killer ? killer.name : bn || null, w: w || '자기장', pos: tp.pos });
}
function announceKill(k) {
  if (!match) return;
  k.alive = aliveTotal();
  k.rank = k.alive + 1;
  broadcast({ t: 'kill', ...k });
  const ap = alivePlayers();
  if (ap.length === 0) endMatch(null);
  else if (ap.length === 1 && match.botsAlive === 0) endMatch(ap[0]);
}
function endMatch(winner, silent) {
  if (!match) return;
  clearInterval(match.timer);
  if (!silent) {
    const board = [...players.values()].filter(p => p.inMatch).map(p => ({ name: p.name, kills: p.kills })).sort((a, b) => b.kills - a.kills);
    broadcast({ t: 'end', winner: winner ? winner.id : null, winnerName: winner ? winner.name : null, board });
    console.log('match ended —', winner ? winner.name + ' wins' : 'no human survivor');
  }
  match = null; phase = 'lobby';
  for (const q of players.values()) q.inMatch = false;
  sendLobby();
}
function zoneTick() {
  if (!match) return;
  const z = Z.zoneAt(match.plan, (Date.now() - match.startAt) / 1000);
  for (const p of alivePlayers()) {
    if (Math.hypot(p.pos[0] - z.cur.x, p.pos[2] - z.cur.z) <= z.cur.r) continue;
    p.hp -= z.dps; p.conn.send({ t: 'hp', hp: p.hp, gear: p.gear, zone: 1 });
    if (p.hp <= 0) killPlayer(p, null, null, '자기장');
  }
}

(async () => {
  Z = await import('./zone.mjs');
  const world = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'world.json'), 'utf8'));
  terrainH = Z.makeTerrainH(world.grid, world.heights);
  server.listen(port, () => {
    console.log(`GREYHAVEN running at http://localhost:${port}`);
    for (const ip of lanIPs()) console.log(`  same network: http://${ip}:${port}`);
  });
})();

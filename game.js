// GREYHAVEN · 최후의 생존 — third-person survival on the exported Blender island.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rig, makeGun, gunIcon } from './rig.js';
import { Rig2, initCharacter, characterReady } from './rig2.js';
import { mulberry32, zonePlan, zoneAt } from './zone.mjs';
import { setupNature } from './nature.js';
import { initBoom, updateBoom, explosionFx, rocketVisual, trailPuff, backblast } from './boom.js';
import { PALETTE, makeHeightTexture, makeCoverMask, makeSky, makeWater, makeGrass, makeComposer } from './env.js';

// ───────────────────────────────────────────── utils
const $ = id => document.getElementById(id);
let RNG = Math.random; // swapped for a seeded generator while placing shared match content
const rand = (a, b) => a + RNG() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = a => a[Math.floor(RNG() * a.length)];
const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const SEA = -0.65;
const BOUND = 840;

// ───────────────────────────────────────────── world data (heightmap + colliders)
const CELL = 16, GOFF = 900, GN = Math.ceil((2 * GOFF) / CELL);
const W = { grid: Array.from({ length: GN * GN }, () => []) };
let qStamp = 0, rStamp = 0;

function initWorld(d) {
  W.n = d.grid.n; W.min = d.grid.min; W.step = d.grid.size / (W.n - 1);
  W.h = Float32Array.from(d.heights);
  const all = [];
  for (const b of d.boxes) all.push({ cyl: false, minX: b[0], minY: b[1], minZ: b[2], maxX: b[3], maxY: b[4], maxZ: b[5], q: 0, r2: 0 });
  for (const c of d.cylinders) all.push({ cyl: true, x: c[0], z: c[1], r: c[2], minY: c[3], maxY: c[4], minX: c[0] - c[2], maxX: c[0] + c[2], minZ: c[1] - c[2], maxZ: c[1] + c[2], q: 0, r2: 0 });
  W.colliders = all;
  for (const c of all) {
    const i0 = Math.floor((c.minX + GOFF) / CELL), i1 = Math.floor((c.maxX + GOFF) / CELL);
    const j0 = Math.floor((c.minZ + GOFF) / CELL), j1 = Math.floor((c.maxZ + GOFF) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(GN - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GN - 1, i1); i++) W.grid[j * GN + i].push(c);
  }
}

function terrainH(x, z) {
  const n = W.n, fi = (x - W.min) / W.step, fj = (-z - W.min) / W.step;
  if (fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) return -6;
  const i = Math.min(n - 2, Math.floor(fi)), j = Math.min(n - 2, Math.floor(fj));
  const tx = fi - i, ty = fj - j, h = W.h;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], e = h[(j + 1) * n + i + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
}

function near(x, z, r, out) {
  out.length = 0; const s = ++qStamp;
  const i0 = Math.floor((x - r + GOFF) / CELL), i1 = Math.floor((x + r + GOFF) / CELL);
  const j0 = Math.floor((z - r + GOFF) / CELL), j1 = Math.floor((z + r + GOFF) / CELL);
  for (let j = Math.max(0, j0); j <= Math.min(GN - 1, j1); j++)
    for (let i = Math.max(0, i0); i <= Math.min(GN - 1, i1); i++)
      for (const c of W.grid[j * GN + i]) if (c.q !== s) { c.q = s; out.push(c); }
  return out;
}

const STEP = 0.6, BODY_H = 1.8;
const _A = [], _B = [];
// highest walkable surface at (x,z) that is not above the feet + step height
function groundAt(x, z, y) {
  let g = terrainH(x, z);
  for (const c of near(x, z, 0, _A)) {
    if (c.cyl || c.maxY > y + STEP || c.maxY <= g) continue;
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) g = c.maxY;
  }
  return g;
}
// push a vertical capsule (feet p, radius r) out of colliders; returns true if blocked
function resolve(p, r) {
  let pushed = false;
  const list = near(p.x, p.z, r + 0.2, _B);
  for (let it = 0; it < 2; it++) {
    for (const c of list) {
      if (c.maxY <= p.y + STEP || c.minY >= p.y + BODY_H) continue;
      if (c.cyl) {
        let dx = p.x - c.x, dz = p.z - c.z; const rr = c.r + r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2); if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr; pushed = true;
      } else {
        const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
        else {
          const l = p.x - c.minX, rt = c.maxX - p.x, f = p.z - c.minZ, bk = c.maxZ - p.z, m = Math.min(l, rt, f, bk);
          if (m === l) p.x = c.minX - r; else if (m === rt) p.x = c.maxX + r; else if (m === f) p.z = c.minZ - r; else p.z = c.maxZ + r;
        }
        pushed = true;
      }
    }
  }
  p.x = clamp(p.x, -BOUND, BOUND); p.z = clamp(p.z, -BOUND, BOUND);
  return pushed;
}
function blockedAt(x, z, y, r) {
  for (const c of near(x, z, r + 0.2, _B)) {
    if (c.maxY <= y + STEP || c.minY >= y + BODY_H) continue;
    if (c.cyl) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true; }
    else if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

// ───────────────────────────────────────────── raycasting
function rayBox(o, d, c) {
  let tmin = 0, tmax = 1e9;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z], mn = [c.minX, c.minY, c.minZ], mx = [c.maxX, c.maxY, c.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ds[a]) < 1e-9) { if (os[a] < mn[a] || os[a] > mx[a]) return -1; continue; }
    let t1 = (mn[a] - os[a]) / ds[a], t2 = (mx[a] - os[a]) / ds[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
function rayCyl(o, d, c) {
  const ox = o.x - c.x, oz = o.z - c.z, a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c.r * c.r;
  if (cc < 0) return -1;
  const disc = b * b - 4 * a * cc; if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) return -1;
  const y = o.y + d.y * t; return y < c.minY || y > c.maxY ? -1 : t;
}
function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
  if (disc < 0) return -1; const t = -b - Math.sqrt(disc); return t >= 0 ? t : -1;
}
function rayTerrain(o, d, maxT) {
  if (o.y < terrainH(o.x, o.z)) return 0;
  const step = 1.5; let prev = 0;
  for (let t = step; ; t += step) {
    const tt = Math.min(t, maxT), y = o.y + d.y * tt;
    if (y > 170 && d.y >= 0) return Infinity;
    if (y < terrainH(o.x + d.x * tt, o.z + d.z * tt)) {
      let lo = prev, hi = tt;
      for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m < terrainH(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
      return hi;
    }
    prev = tt; if (tt >= maxT) return Infinity;
  }
}
const actors = [];
// returns { t, ent, head, world }
function raycast(o, d, maxDist, ignore, entities = true) {
  let best = maxDist, ent = null, head = false, world = false;
  const s = ++rStamp; let last = -1;
  for (let t = 0; t <= best + 3; t += 3) {
    const x = o.x + d.x * t, z = o.z + d.z * t;
    const i = Math.floor((x + GOFF) / CELL), j = Math.floor((z + GOFF) / CELL);
    if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
    const ci = j * GN + i; if (ci === last) continue; last = ci;
    for (const c of W.grid[ci]) {
      if (c.r2 === s) continue; c.r2 = s;
      const tt = c.cyl ? rayCyl(o, d, c) : rayBox(o, d, c);
      if (tt >= 0 && tt < best) { best = tt; world = true; }
    }
  }
  const tt = rayTerrain(o, d, best);
  if (tt < best) { best = tt; world = true; }
  if (entities) {
    for (const a of actors) {
      if (a === ignore || a.dead) continue;
      const p = a.pos;
      if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 > (best + 3) ** 2) continue;
      let th = raySphere(o, d, p.x, p.y + 1.66, p.z, 0.24);
      let tb = Math.min(...[0.5, 1.05].map(h => { const v = raySphere(o, d, p.x, p.y + h, p.z, 0.42); return v < 0 ? 1e9 : v; }));
      if (th >= 0 && th < best && th <= tb) { best = th; ent = a; head = true; world = false; }
      else if (tb < best) { best = tb; ent = a; head = false; world = false; }
    }
  }
  return { t: best, ent, head, world };
}
function hasLOS(a, b) {
  const o = new THREE.Vector3(a.pos.x, a.pos.y + 1.6, a.pos.z);
  const tgt = new THREE.Vector3(b.pos.x, b.pos.y + 1.2, b.pos.z);
  const d = tgt.clone().sub(o); const dist = d.length(); d.divideScalar(dist);
  return raycast(o, d, dist, a, false).t >= dist - 0.3;
}

// ───────────────────────────────────────────── renderer / scene
const canvas = $('view');
const QUALITY = (() => { try { return localStorage.getItem('gh_quality') || 'high'; } catch { return 'high'; } })();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY === 'low' ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const SKY = new THREE.Color(PALETTE.fog);
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 180, 1300);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2500);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.1));
const skyFx = makeSky(scene);
const sky = skyFx.sky;
const sun = new THREE.DirectionalLight(PALETTE.sun, 2.25);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY === 'low' ? 1024 : 2048, QUALITY === 'low' ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 700 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const post = makeComposer(renderer, scene, camera, QUALITY);
initBoom(scene);
let waterFx = null, grassFx = null, natureFx = null;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); post.resize(innerWidth, innerHeight); });

// ───────────────────────────────────────────── loading
async function fetchBuf(url, prog) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; prog(url, got); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
const gltfLoader = new GLTFLoader();
const parseGLB = buf => new Promise((res, rej) => gltfLoader.parse(buf, './assets/', res, rej));

function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v;
}

function setupTerrain(gltf) {
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry; g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const sand = new THREE.Color(0xf2dca0);
    const grassA = new THREE.Color(0x5c9a3e);
    const grassB = new THREE.Color(0x44792f);
    const dirt = new THREE.Color(0xb48a55);
    const rock = new THREE.Color(0xa8a49a);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), ny = nor.getY(k);
      const n = vnoise(x * 0.03, z * 0.03) * 0.6 + vnoise(x * 0.11, z * 0.11) * 0.4;
      c.copy(grassA).lerp(grassB, n);
      if (n > 0.72) c.lerp(dirt, (n - 0.72) * 2.2);
      const rk = clamp((y - 62) / 18, 0, 1) + clamp((0.82 - ny) * 4, 0, 1);
      c.lerp(rock, clamp(rk, 0, 1) * (0.75 + 0.25 * n));
      c.lerp(sand, clamp((3.6 - y) / 2.2, 0, 1));
      col.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    o.receiveShadow = true;
  });
  scene.add(gltf.scene);
}
const STATIC_PALETTE = [
  [/cracked graphite/, 0x8b9099], [/faded paint/, 0xf4efe0], [/aged concrete/, 0xc9c2b2],
  [/oxidised steel/, 0xc4673a], [/dark empty interior/, 0x3a3f46],
  [/Container \| faded 0/, 0x3f9a8c], [/Container \| faded 1/, 0xd8573c], [/Container \| faded 2/, 0x3f78c4], [/Container \| faded 3/, 0xe8b23a],
];
function setupStatic(gltf) {
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of [].concat(o.material)) {
      m.roughness = Math.max(m.roughness ?? 0.8, 0.7); m.metalness = Math.min(m.metalness ?? 0, 0.2);
      // cartoon palette for the Blender-made materials (by material name)
      const re = STATIC_PALETTE.find(([rx]) => rx.test(m.name));
      if (re) m.color.set(re[1]);
    }
  });
  scene.add(gltf.scene);
}
// Kenney trees, rocks and scrub are swapped for stylised MegaKit models (nature.js);
// their placements are returned so the new models land exactly where the colliders are.
function setupProps(gltf, props) {
  gltf.scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4(), m = new THREE.Matrix4();
  const groups = { broad: [], pine: [], rock: [], bush: [] };
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
  for (const [pid, info] of Object.entries(props)) {
    const node = gltf.scene.getObjectByName(pid);
    if (!node) { console.warn('missing prototype', pid); continue; }
    const fam = info.name.includes('reclaimed island tree') ? (/pine/i.test(info.mesh) ? 'pine' : 'broad')
      : info.name.includes('granite outcrop') ? 'rock' : info.name.includes('invasive scrub') ? 'bush' : null;
    if (fam) {
      const box = new THREE.Box3().setFromObject(node), size = box.getSize(new THREE.Vector3());
      for (const arr of info.matrices) {
        m.fromArray(arr).decompose(P, Q, S); E.setFromQuaternion(Q, 'YXZ');
        groups[fam].push({ pos: P.clone(), yaw: E.y, height: size.y * S.y, width: Math.max(size.x, size.z) * S.x });
      }
      continue;
    }
    inv.copy(node.matrixWorld).invert();
    const isBush = false;
    node.traverse(ch => {
      if (!ch.isMesh) return;
      rel.multiplyMatrices(inv, ch.matrixWorld);
      const im = new THREE.InstancedMesh(ch.geometry, ch.material, info.matrices.length);
      info.matrices.forEach((arr, k) => { m.fromArray(arr).multiply(rel); im.setMatrixAt(k, m); });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !isBush; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    });
  }
  return groups;
}

// ───────────────────────────────────────────── maps (minimap / landing picker)
const MAPPX = 512;
const w2m = v => ((v + 850) / 1700) * MAPPX;
const m2w = p => (p / MAPPX) * 1700 - 850;
let baseMap;
function buildBaseMap() {
  baseMap = document.createElement('canvas'); baseMap.width = baseMap.height = MAPPX;
  const ctx = baseMap.getContext('2d'), img = ctx.createImageData(MAPPX, MAPPX);
  for (let py = 0; py < MAPPX; py++) for (let px = 0; px < MAPPX; px++) {
    const x = m2w(px + 0.5), z = m2w(py + 0.5), h = terrainH(x, z);
    const shade = clamp(1 + (terrainH(x - 3, z - 3) - h) * 0.08, 0.6, 1.35);
    let r, g, b;
    if (h < SEA) { const dpt = clamp(-h / 6, 0, 1); r = 28 - dpt * 10; g = 78 - dpt * 20; b = 92 - dpt * 10; }
    else if (h < 3.3) { r = 176; g = 158; b = 112; }
    else if (h > 72) { r = 130; g = 132; b = 124; }
    else { r = 92; g = 116; b = 60; }
    if (h >= SEA) { r *= shade; g *= shade; b *= shade; }
    const k = (py * MAPPX + px) * 4; img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(34,58,28,.75)';
  for (const c of W.colliders) if (c.cyl && c.r > 0.5) ctx.fillRect(w2m(c.x) - 0.6, w2m(c.z) - 0.6, 1.3, 1.3);
  ctx.fillStyle = 'rgba(70,72,74,.95)';
  for (const c of W.colliders) if (!c.cyl && (c.maxX - c.minX) * (c.maxZ - c.minZ) > 6) ctx.fillRect(w2m(c.minX), w2m(c.minZ), Math.max(1, w2m(c.maxX) - w2m(c.minX)), Math.max(1, w2m(c.maxZ) - w2m(c.minZ)));
  ctx.font = 'bold 13px Malgun Gothic, sans-serif'; ctx.textAlign = 'center';
  for (const r of REGIONS) if (r.label) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(r.label, w2m(r.x) + 1, w2m(r.z) + 1); ctx.fillStyle = '#f4efe2'; ctx.fillText(r.label, w2m(r.x), w2m(r.z)); }
}
function drawMap(cv, cx, cz, span, opts = {}) {
  const ctx = cv.getContext('2d'), S = cv.width, sc = S / span;
  const X = x => (x - (cx - span / 2)) * sc, Z = z => (z - (cz - span / 2)) * sc;
  ctx.fillStyle = '#123138'; ctx.fillRect(0, 0, S, S);
  const k = MAPPX / 1700;
  ctx.drawImage(baseMap, (cx - span / 2 + 850) * k, (cz - span / 2 + 850) * k, span * k, span * k, 0, 0, S, S);
  if (opts.zone && zone.cur) {
    ctx.lineWidth = Math.max(2, S / 190);
    ctx.strokeStyle = '#4fb4ff'; ctx.beginPath(); ctx.arc(X(zone.cur.x), Z(zone.cur.z), zone.cur.r * sc, 0, Math.PI * 2); ctx.stroke();
    if (zone.next) { ctx.strokeStyle = '#ffffff'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(X(zone.next.x), Z(zone.next.z), zone.next.r * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  }
  if (opts.player && player) {
    const px = X(player.pos.x), pz = Z(player.pos.z);
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    const s = Math.max(7, S / 40); ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.65, s * 0.7); ctx.lineTo(0, s * 0.35); ctx.lineTo(-s * 0.65, s * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  if (opts.mark) { ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(opts.mark.x), Z(opts.mark.z), 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
}

// ───────────────────────────────────────────── regions / loot spawn
const REGIONS = [
  { label: '폐도시', x: -100, z: 160, rx: 200, rz: 170, loot: 34 },
  { label: '항구', x: 345, z: 330, rx: 110, rz: 70, loot: 18 },
  { label: '발전소', x: 300, z: -110, rx: 110, rz: 95, loot: 14 },
  { label: '언덕 마을', x: -370, z: -250, rx: 100, rz: 90, loot: 14 },
  { label: '등대', x: -590, z: 255, rx: 30, rz: 30, loot: 3 },
  { label: '무선탑', x: 70, z: -400, rx: 30, rz: 30, loot: 3 },
];
function landPoint(cx, cz, rx, rz, minH = 1.5, tries = 40) {
  for (let t = 0; t < tries; t++) {
    const x = cx + rand(-rx, rx), z = cz + rand(-rz, rz);
    if (Math.abs(x) > 820 || Math.abs(z) > 820) continue;
    const th = terrainH(x, z); if (th < minH) continue;
    const y = groundAt(x, z, th + 0.3);
    if (blockedAt(x, z, y, 0.7)) continue;
    return new THREE.Vector3(x, y, z);
  }
  return null;
}

// ───────────────────────────────────────────── weapons
// cross: crosshair style · burst: rounds per trigger pull · splash: explosive radius (m) · speed: projectile m/s
const WEAPONS = {
  pistol:   { id: 'pistol', slot: 2, ammo: 'a9', name: '권총', dmg: 23, rate: 0.22, mag: 14, reload: 1.3, spread: 0.012, pellets: 1, auto: false, range: 160, zoom: 1.35, kick: 0.012, snd: { freq: 2600, len: 0.18, vol: 0.45 }, cross: 'gap' },
  revolver: { id: 'revolver', slot: 2, ammo: 'a762', name: '핸드캐논', dmg: 64, rate: 0.7, mag: 7, reload: 2.2, spread: 0.006, pellets: 1, auto: false, range: 200, zoom: 1.5, kick: 0.05, snd: { freq: 1100, len: 0.45, vol: 0.75 }, cross: 'gap' },
  smg:      { id: 'smg', ammo: 'a9', name: '기관단총', dmg: 14, rate: 0.072, mag: 30, reload: 1.7, spread: 0.028, pellets: 1, auto: true, range: 120, zoom: 1.3, kick: 0.006, snd: { freq: 2300, len: 0.14, vol: 0.4 }, cross: 'gap' },
  tsmg:     { id: 'tsmg', ammo: 'a9', name: '전술 SMG', dmg: 18, rate: 0.1, mag: 25, reload: 1.5, spread: 0.018, pellets: 1, auto: true, range: 140, zoom: 1.35, kick: 0.008, snd: { freq: 2100, len: 0.16, vol: 0.42 }, cross: 'gap' },
  rifle:    { id: 'rifle', ammo: 'a556', name: '돌격소총', dmg: 21, rate: 0.11, mag: 30, reload: 2.1, spread: 0.016, pellets: 1, auto: true, range: 280, zoom: 1.7, kick: 0.009, snd: { freq: 1800, len: 0.25, vol: 0.55 }, cross: 'gap' },
  burst:    { id: 'burst', ammo: 'a556', name: '점사 소총', dmg: 27, rate: 0.42, burst: 3, burstRate: 0.07, mag: 24, reload: 2.2, spread: 0.012, pellets: 1, auto: false, range: 300, zoom: 1.8, kick: 0.008, snd: { freq: 1900, len: 0.22, vol: 0.55 }, cross: 'gap' },
  lmg:      { id: 'lmg', ammo: 'a556', name: '경기관총', dmg: 19, rate: 0.085, mag: 70, reload: 4.0, spread: 0.03, pellets: 1, auto: true, range: 240, zoom: 1.5, kick: 0.007, snd: { freq: 1600, len: 0.24, vol: 0.6 }, cross: 'gap', heavy: true },
  shotgun:  { id: 'shotgun', ammo: 'a12', name: '펌프 샷건', dmg: 12, rate: 0.9, mag: 5, reload: 2.6, spread: 0.075, pellets: 10, auto: false, range: 45, zoom: 1.2, kick: 0.045, snd: { freq: 1200, len: 0.4, vol: 0.7 }, cross: 'circle' },
  tac:      { id: 'tac', ammo: 'a12', name: '전술 샷건', dmg: 8, rate: 0.34, mag: 8, reload: 3.0, spread: 0.065, pellets: 8, auto: false, range: 40, zoom: 1.2, kick: 0.03, snd: { freq: 1350, len: 0.32, vol: 0.62 }, cross: 'circle' },
  dmr:      { id: 'dmr', ammo: 'a556', name: '지정사수소총', dmg: 46, rate: 0.36, mag: 10, reload: 2.4, spread: 0.004, pellets: 1, auto: false, range: 500, zoom: 2.8, kick: 0.025, snd: { freq: 1500, len: 0.4, vol: 0.65 }, cross: 'dot', scope: true },
  sniper:   { id: 'sniper', ammo: 'a762', name: '볼트 저격소총', dmg: 108, rate: 1.4, mag: 5, reload: 3.0, spread: 0.0015, pellets: 1, auto: false, range: 700, zoom: 5, kick: 0.06, snd: { freq: 1000, len: 0.65, vol: 0.85 }, cross: 'dot', scope: true },
  rocket:   { id: 'rocket', ammo: 'rkt', name: '로켓 발사기', dmg: 105, rate: 1.1, mag: 1, reload: 2.8, spread: 0.004, pellets: 1, auto: false, range: 400, zoom: 1.4, kick: 0.07, snd: { freq: 700, len: 0.6, vol: 0.8 }, cross: 'bracket', splash: 6, speed: 70, heavy: true },
};
const RARITY = [
  { name: '일반', color: '#b8bcc4' }, { name: '고급', color: '#5bd15b' }, { name: '희귀', color: '#4aa3ff' },
  { name: '영웅', color: '#b65cff' }, { name: '전설', color: '#ffb52e' },
];
// higher rarity: more damage, tighter spread, faster reload
const newWeapon = (id, mag, r = 0) => {
  const base = WEAPONS[id];
  const def = { ...base, dmg: base.dmg * (1 + 0.07 * r), spread: base.spread * (1 - 0.07 * r), reload: base.reload * (1 - 0.05 * r) };
  return { def, mag: mag ?? base.mag, r };
};
const rollRarity = rng => { const x = rng() * 100; return x < 40 ? 0 : x < 70 ? 1 : x < 88 ? 2 : x < 97 ? 3 : 4; };
const LOOT_WEAPONS = ['pistol', 'pistol', 'revolver', 'smg', 'smg', 'tsmg', 'rifle', 'rifle', 'rifle', 'burst', 'lmg', 'shotgun', 'shotgun', 'tac', 'dmr', 'sniper', 'rocket'];


// ───────────────────────────────────────────── audio
let AC = null, noiseBuf = null;
function initAudio() {
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.6, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  } catch { AC = null; }
}
function sound(s, pos) {
  if (!AC) return;
  const dist = pos ? pos.distanceTo(player.pos) : 0, vol = s.vol / (1 + dist / 30);
  if (vol < 0.008) return;
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = s.freq / (1 + dist / 120);
  const g = AC.createGain(), t = AC.currentTime; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + s.len);
  src.connect(f).connect(g).connect(AC.destination); src.start(t); src.stop(t + s.len + 0.05);
}
let windGain = null;
function setWind(v) {
  if (!AC) return;
  if (!windGain) {
    const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    windGain = AC.createGain(); windGain.gain.value = 0;
    src.connect(f).connect(windGain).connect(AC.destination); src.start();
  }
  windGain.gain.setTargetAtTime(v, AC.currentTime, 0.15);
}
function beep(freq, len = 0.08, vol = 0.15, type = 'square') {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + len + 0.02);
}

// ───────────────────────────────────────────── characters
const BOT_NAMES = ['까마귀', '늑대', '독수리', '여우', '표범', '매', '불곰', '살쾡이', '올빼미', '코브라', '하이에나', '들개', '멧돼지', '전갈', '상어', '박쥐', '부엉이', '족제비', '고라니'];
const OUTFITS = [
  { shirt: '#e8604c', pants: '#7a2a24', vest: '#3a3f4a', vest2: '#4a5060', pack: '#5a4636', helmet: '#f2c14e', accent: '#7ff0ff' },
  { shirt: '#4a9be8', pants: '#1f4a7a', vest: '#2f3a48', vest2: '#3e4a5a', pack: '#c98a3a', helmet: '#e8e2d0', accent: '#ffd36a' },
  { shirt: '#f2c14e', pants: '#8a5a1a', vest: '#3b4a3a', vest2: '#4a5a48', pack: '#6a4a8a', helmet: '#4fd1c5', accent: '#ff7ab0' },
  { shirt: '#6cc46a', pants: '#2a5a2a', vest: '#4a3a2e', vest2: '#5a4a3a', pack: '#e8604c', helmet: '#3a4250', accent: '#9ff7ff' },
  { shirt: '#b072e0', pants: '#4a2a6a', vest: '#2e2a36', vest2: '#3e3a48', pack: '#f2c14e', helmet: '#f08bb5', accent: '#c8ff7a' },
  { shirt: '#f08bb5', pants: '#7a2a4a', vest: '#3a3a44', vest2: '#4a4a56', pack: '#4a9be8', helmet: '#ffffff', accent: '#ffe27a' },
  { shirt: '#4fd1c5', pants: '#1a5a54', vest: '#3a3036', vest2: '#4a4048', pack: '#e8604c', helmet: '#f2c14e', accent: '#ff9a3c' },
  { shirt: '#ff9a3c', pants: '#7a3a10', vest: '#2f3640', vest2: '#3f4650', pack: '#3a7a5a', helmet: '#4a9be8', accent: '#7fffb0' },
];
const SKINS = ['#e3c3a3', '#c99f7c', '#a77b58', '#8a5f40', '#f0d2b5'];
const botOutfit = () => ({ ...pick(OUTFITS), skin: pick(SKINS) });

class Actor {
  constructor(name, colors) {
    this.name = name; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.vy = 0; this.yaw = 0; this.pitch = 0; this.hp = 100; this.gear = { vest: null, helm: null }; this.dead = false; this.kills = 0;
    this.onGround = false; this.speedNow = 0; this.fireT = 0; this.mode = 'ground'; this.slide = false; this.sprinting = false;
    this.reloadP = -1; this.healing = false; this.id = null;
    this.rig = characterReady() ? new Rig2(scene, colors) : new Rig(scene, colors);
    this.rig.onStep = run => footstep(this, run);
    actors.push(this);
  }
  physics(dt, mx, mz, gravity = 24) {
    const len = Math.hypot(mx, mz), steps = Math.max(1, Math.ceil(len / 0.35));
    let blocked = false;
    for (let s = 0; s < steps; s++) {
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x += mx / steps; this.pos.z += mz / steps;
      const g2 = groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (g2 > this.pos.y + STEP + Math.hypot(mx / steps, mz / steps)) { this.pos.x = ox; this.pos.z = oz; blocked = true; }
      if (resolve(this.pos, 0.42)) blocked = true;
    }
    const g = groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.vy -= gravity * dt; this.pos.y += this.vy * dt;
    let impact = 0;
    if (this.pos.y <= g || (this.onGround && this.vy <= 0 && this.pos.y - g < 0.5)) {
      if (!this.onGround) impact = -this.vy;
      this.pos.y = g; this.vy = 0; this.onGround = true;
    } else this.onGround = false;
    this.swimming = false;
    if (terrainH(this.pos.x, this.pos.z) < SEA - 1.25 && this.pos.y < SEA - 1.25) {
      this.pos.y = SEA - 1.25; this.vy = 0; this.onGround = true; this.swimming = true;
    }
    this.speedNow = len / Math.max(dt, 1e-4);
    return { blocked, impact };
  }
  animate(dt) {
    const far = this !== player && this.pos.distanceToSquared(player.pos) > 480 * 480;
    if (this !== player) this.rig.root.visible = !far;
    if (far) { this.rig.root.position.copy(this.pos); return; }
    this.rig.update(dt, {
      pos: this.pos, yaw: this.yaw, pitch: this.pitch, vx: this.vel.x, vz: this.vel.z, onGround: this.onGround,
      sprint: this.sprinting, slide: this.slide, swim: this.swimming, mode: this.mode, reload: this.reloadP, heal: this.healing,
    });
  }
  muzzle(out) { return this.rig.muzzleWorld(out); }
}

// ───────────────────────────────────────────── effects
const UP = new THREE.Vector3(0, 1, 0);
const tracers = [];
const tracerGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1, true); tracerGeo.translate(0, 0.5, 0);
const _tv = new THREE.Vector3();
function tracer(a, b, w = 1) {
  let t = tracers.find(t => t.life <= 0);
  if (!t) {
    t = { m: new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), life: 0 };
    t.m.frustumCulled = false; scene.add(t.m); tracers.push(t);
  }
  _tv.copy(b).sub(a); const len = _tv.length(); if (len < 0.5) return;
  t.m.position.copy(a); t.m.scale.set(w, len, w); t.m.quaternion.setFromUnitVectors(UP, _tv.divideScalar(len));
  t.life = 0.06; t.m.visible = true; t.m.material.opacity = 1;
}
const puffs = [];
const puffGeo = new THREE.IcosahedronGeometry(0.09, 0);
function puff(p, color, n = 5, spd = 3) {
  for (let i = 0; i < n; i++) {
    let q = puffs.find(q => q.life <= 0);
    if (!q) { q = { m: new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true })), v: new THREE.Vector3(), life: 0, max: 1 }; scene.add(q.m); puffs.push(q); }
    q.m.material.color.set(color); q.m.position.copy(p); q.v.set(rand(-1, 1) * spd, rand(0.4, 1.3) * spd, rand(-1, 1) * spd);
    q.life = q.max = rand(0.3, 0.55); q.m.visible = true; q.m.scale.setScalar(rand(0.7, 1.6));
  }
}
const dmgNums = [];
function dmgNum(pos, val, head) {
  const el = document.createElement('div'); el.className = 'dn' + (head ? ' head' : ''); el.textContent = Math.max(1, Math.round(val));
  $('dmgnums').append(el); dmgNums.push({ el, pos: pos.clone(), t: 0, dx: rand(-20, 20) });
}
const _proj = new THREE.Vector3();
function updateFx(dt) {
  updateRockets(dt); updateShells(dt); updateBoom(dt);
  for (const t of tracers) if (t.life > 0) { t.life -= dt; t.m.material.opacity = clamp(t.life / 0.06, 0, 1); if (t.life <= 0) t.m.visible = false; }
  for (const q of puffs) if (q.life > 0) {
    q.life -= dt; q.v.y -= 9 * dt; q.v.multiplyScalar(Math.exp(-2.5 * dt)); q.m.position.addScaledVector(q.v, dt);
    q.m.material.opacity = clamp(q.life / q.max, 0, 1); if (q.life <= 0) q.m.visible = false;
  }
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i]; d.t += dt;
    if (d.t > 0.9) { d.el.remove(); dmgNums.splice(i, 1); continue; }
    _proj.copy(d.pos); _proj.y += 2 + d.t * 1.4; _proj.project(camera);
    if (_proj.z > 1) { d.el.style.opacity = 0; continue; }
    d.el.style.opacity = 1 - Math.max(0, d.t - 0.5) / 0.4;
    d.el.style.transform = `translate(${(_proj.x * 0.5 + 0.5) * innerWidth + d.dx * d.t}px, ${(-_proj.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.15 - d.t) * 4})`;
  }
}
function footstep(a, run) {
  if (!AC || !player) return;
  if (a !== player && a.pos.distanceToSquared(player.pos) > 45 * 45) return;
  sound({ freq: 420 + run * 520, len: 0.06 + run * 0.02, vol: (a === player ? 0.07 : 0.12) + run * 0.06 }, a === player ? null : a.pos);
}

// ───────────────────────────────────────────── combat
const BOT_DMG = 0.55;
const isBotId = id => typeof id === 'string' && id.startsWith('b');
// rockets fly as projectiles and explode with falloff damage
const rockets = [];
const rocketGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8); rocketGeo.rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0xd9483b, emissive: 0xff7a30, emissiveIntensity: 0.6 });
function spawnRocket(shooter, origin, dir, def, visualOnly) {
  const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.copy(origin); m.lookAt(origin.clone().add(dir)); scene.add(m);
  const flicker = rocketVisual(m);
  backblast(origin, dir);
  whoosh(origin);
  if (shooter === player) { shake(0.35); cam.fovKick += 6; }
  rockets.push({ m, pos: origin.clone(), vel: dir.clone().multiplyScalar(def.speed), shooter, def, life: 6, visualOnly, trail: 0, flicker, age: 0 });
}
function whoosh(pos) {
  if (!AC) return;
  const d = pos.distanceTo(player.pos), vol = 0.5 / (1 + d / 25); if (vol < 0.01) return;
  const t = AC.currentTime, src = AC.createBufferSource(); src.buffer = boomBuf();
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  src.connect(f).connect(g).connect(AC.destination); src.start(t); src.stop(t + 1);
}
let _boomBuf = null;
function boomBuf() {
  if (_boomBuf) return _boomBuf;
  _boomBuf = AC.createBuffer(1, AC.sampleRate * 2.5, AC.sampleRate);
  const d = _boomBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return _boomBuf;
}
// layered explosion: low boom + crack + sub rumble, delayed by distance like real sound
function boomSound(pos) {
  if (!AC) return;
  const dist = pos.distanceTo(player.pos), vol = 1.3 / (1 + dist / 40);
  if (vol < 0.01) return;
  const t = AC.currentTime + Math.min(1, dist / 340);
  const layer = (type, freq, len, v) => {
    const src = AC.createBufferSource(); src.buffer = boomBuf();
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = AC.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    src.connect(f).connect(g).connect(AC.destination); src.start(t, Math.random()); src.stop(t + len + 0.05);
  };
  layer('lowpass', 160, 2.2, vol);
  layer('lowpass', 900, 0.7, vol * 0.7);
  if (dist < 120) layer('highpass', 1800, 0.18, vol * 0.5);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
  g.gain.setValueAtTime(vol * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 1.6);
}
function explode(pos, shooter, def, visualOnly) {
  const gy = groundAt(pos.x, pos.z, pos.y + 1);
  explosionFx(pos, gy, 1);
  boomSound(pos);
  const dpl = player ? pos.distanceTo(player.pos) : 999;
  if (dpl < 70) { shake(Math.min(1, 1.1 - dpl / 70)); cam.fovKick += Math.max(0, 14 - dpl * 0.3); }
  if (dpl < 30) { const fl = $('flash'); fl.style.transition = 'none'; fl.style.opacity = Math.min(0.85, 1 - dpl / 30); requestAnimationFrame(() => { fl.style.transition = 'opacity .45s'; fl.style.opacity = 0; }); }
  // knockback (also lets a player rocket-jump off their own blast)
  for (const a of actors) {
    if (a.dead || (a !== player && !(a instanceof Bot))) continue;
    const d = a.pos.distanceTo(pos); if (d > def.splash * 1.3) continue;
    const f = 1 - d / (def.splash * 1.3);
    const dir = a.pos.clone().sub(pos); dir.y = 0; if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0); dir.normalize();
    a.vy = Math.max(a.vy, 5 + 9 * f); a.onGround = false;
    if (a === player) { a.vel.addScaledVector(dir, 16 * f); a.slide = false; }
    else a.pos.addScaledVector(dir, 1.5 * f);
  }
  if (visualOnly) return;
  for (const a of actors) {
    if (a.dead) continue;
    const d = a.pos.distanceTo(pos) - 0.3;
    if (d > def.splash) continue;
    const f = 1 - Math.max(0, d) / def.splash;
    damage(a, def.dmg * f * (a === shooter ? 0.5 : 1) * (shooter === player || shooter.remoteHuman ? 1 : BOT_DMG), shooter, def.name, false, a.pos.clone().setY(a.pos.y + 1.2));
  }
}
function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.vel.y -= 4 * dt; r.life -= dt;
    const step = r.vel.length() * dt, d = r.vel.clone().normalize();
    const h = raycast(r.pos, d, step, r.shooter);
    r.trail -= dt;
    r.age += dt; r.flicker(r.age);
    if (r.trail <= 0) { r.trail = 0.016; trailPuff(r.pos.clone()); }
    if (h.t < step || r.life <= 0) {
      r.pos.addScaledVector(d, Math.min(h.t, step));
      explode(r.pos, r.shooter, r.def, r.visualOnly);
      if (NET.on && !r.visualOnly && (r.shooter === player || (NET.isHost && r.shooter instanceof Bot)))
        NET.send({ t: 'shot', s: r.shooter.id, w: r.def.id, o: [+r.pos.x.toFixed(2), +r.pos.y.toFixed(2), +r.pos.z.toFixed(2)], e: [], boom: 1 });
      scene.remove(r.m); rockets.splice(i, 1); continue;
    }
    r.pos.addScaledVector(d, step); r.m.position.copy(r.pos); r.m.lookAt(r.pos.clone().add(d));
  }
}
// brass shells kicked out to the right of the gun
const shells = [];
const shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.6, roughness: 0.35 });
const shellRed = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
function ejectShell(o, yaw, def) {
  if (def.splash) return;
  let sh = shells.find(x => x.life <= 0);
  if (!sh) { if (shells.length > 60) return; sh = { m: new THREE.Mesh(shellGeo, shellMat), v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; scene.add(sh.m); shells.push(sh); }
  sh.m.material = def.ammo === 'a12' ? shellRed : shellMat;
  sh.m.scale.setScalar(def.ammo === 'a12' ? 1.8 : 1);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  sh.m.position.copy(o).addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 0.25);
  sh.v.set(rx * rand(1.5, 2.6), rand(1.6, 2.6), rz * rand(1.5, 2.6));
  sh.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20)); sh.life = 1.4; sh.m.visible = true;
}
function updateShells(dt) {
  for (const sh of shells) {
    if (sh.life <= 0) continue;
    sh.life -= dt; sh.v.y -= 14 * dt;
    sh.m.position.addScaledVector(sh.v, dt);
    sh.m.rotation.x += sh.w.x * dt; sh.m.rotation.z += sh.w.z * dt;
    const g = terrainH(sh.m.position.x, sh.m.position.z) + 0.02;
    if (sh.m.position.y < g) { sh.m.position.y = g; sh.v.multiplyScalar(0.35); sh.v.y = Math.abs(sh.v.y) * 0.4; sh.w.multiplyScalar(0.5); }
    if (sh.life <= 0) sh.m.visible = false;
  }
}
function fireWeapon(shooter, origin, dir, def, spread) {
  sound(def.snd, shooter === player ? null : origin);
  shooter.rig.fire();
  if (def.splash) {
    const d = dir.clone(); d.x += rand(-1, 1) * spread; d.y += rand(-1, 1) * spread; d.z += rand(-1, 1) * spread; d.normalize();
    spawnRocket(shooter, origin.clone(), d, def, false);
    if (NET.on && (shooter === player || (NET.isHost && shooter instanceof Bot)))
      NET.send({ t: 'shot', s: shooter.id, w: def.id, o: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)], e: [], rk: [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)] });
    return;
  }
  const end = new THREE.Vector3(), d = new THREE.Vector3(), ends = [];
  for (let k = 0; k < def.pellets; k++) {
    d.copy(dir);
    d.x += rand(-1, 1) * spread; d.y += rand(-1, 1) * spread; d.z += rand(-1, 1) * spread; d.normalize();
    const h = raycast(origin, d, def.range, shooter);
    end.copy(origin).addScaledVector(d, Math.min(h.t, def.range));
    if (k < 3) { tracer(_v3.copy(origin).addScaledVector(d, 0.3), end, def.id === 'dmr' ? 1.6 : 1); ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2), h.ent ? 1 : h.t < def.range ? 2 : 0]); }
    if (h.ent) {
      let dmg = def.dmg * (h.head ? 1.8 : 1) * (shooter === player || shooter.remoteHuman ? 1 : BOT_DMG);
      if (def.id === 'shotgun') dmg *= clamp(1.3 - h.t / 40, 0.25, 1);
      puff(end, 0xa01818, 6, 2.5);
      damage(h.ent, dmg, shooter, def.name, h.head, end);
    } else if (h.t < def.range) puff(end, 0xc9c0aa, 4, 2);
  }
  if (NET.on && (shooter === player || (NET.isHost && shooter instanceof Bot)))
    NET.send({ t: 'shot', s: shooter.id, w: def.id, o: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)], e: ends });
}
function damage(t, amount, by, wname, head, at) {
  if (t.dead || state !== 'play') return;
  // ── multiplayer: player HP lives on the server, bot HP on the host
  if (NET.on && (t === player || t.remoteHuman || (isBotId(t.id) && !NET.isHost))) {
    NET.send({ t: 'hit', target: t.id, dmg: +amount.toFixed(1), head: !!head, w: wname, by: by?.id || null, bn: by?.name || null });
    if (by === player) { hud.hitT = 0.15; hud.hitHead = head; beep(head ? 1500 : 1100, 0.05, 0.08, 'triangle'); dmgNum(at || t.pos, amount, head); }
    t.rig.hit(Math.random() < 0.5 ? -1 : 1);
    return;
  }
  if (by) amount = armorAbsorb(t.gear, amount, head);
  t.hp -= amount;
  t.rig.hit(Math.random() < 0.5 ? -1 : 1);
  if (t === player) {
    hud.hurt = 0.6; shake(0.28);
    if (by) { hud.dmgAng = Math.atan2(-(by.pos.x - player.pos.x), -(by.pos.z - player.pos.z)); hud.dmgT = 1; }
    healCancel();
  } else {
    if (by === player) { hud.hitT = 0.15; hud.hitHead = head; beep(head ? 1500 : 1100, 0.05, 0.08, 'triangle'); dmgNum(at || t.pos, amount, head); }
    t.onHurt?.(by);
  }
  if (t.hp <= 0) kill(t, by, wname);
}
function deathVisual(t, by) {
  if (t.rig.dead) return;
  let dir = Math.random() < 0.5 ? 1 : -1;
  if (by) { const bx = t.pos.x - by.pos.x, bz = t.pos.z - by.pos.z; dir = (bx * -Math.sin(t.yaw) + bz * -Math.cos(t.yaw)) < 0 ? 1 : -1; }
  t.dead = true; t.hp = 0; t.rig.die(dir);
}
const deathText = (byName, wname, victim) => byName ? `${byName} <small>[${wname}]</small> ▸ ${victim}` : `${victim} — ${wname === '낙하' ? '낙하로' : wname === '이탈' ? '접속 종료로' : '자기장에서'} 사망`;
function kill(t, by, wname) {
  if (NET.on) {
    // host-owned bot died: report it, the server announces the kill to everyone
    if (t instanceof Bot && NET.isHost && !t.reported) {
      t.reported = true; deathVisual(t, by);
      NET.send({ t: 'botDied', id: t.id, name: t.name, by: by?.id || null, bn: by?.name || null, w: wname, pos: [t.pos.x, groundAt(t.pos.x, t.pos.z, t.pos.y + 0.5), t.pos.z] });
      placeBox('death', groundPos(t.pos, 0.2), botLoot(t));
    }
    return;
  }
  deathVisual(t, by);
  if (by && by !== t) by.kills++;
  feed(deathText(by?.name, wname, t.name), by === player || t === player);
  if (t === player) { endGame(false); return; }
  placeBox('death', groundPos(t.pos, 0.2), botLoot(t));
  if (by === player) killBanner(t.name);
  if (aliveCount() === 1 && !player.dead) endGame(true);
}
function killBanner(name) { banner(`${name} 처치`); beep(700, 0.12, 0.1, 'sine'); setTimeout(() => beep(1050, 0.16, 0.1, 'sine'), 90); }
const aliveCount = () => (NET.on ? NET.alive : actors.filter(a => !a.dead).length);

// ───────────────────────────────────────────── items, armour, containers
const ITEMS = {
  a9: { name: '9mm 탄', type: 'ammo', color: '#e0b84a' },
  a556: { name: '5.56mm 탄', type: 'ammo', color: '#8cc65a' },
  a12: { name: '12게이지 탄', type: 'ammo', color: '#e0684a' },
  a762: { name: '7.62mm 탄', type: 'ammo', color: '#5aa0e0' },
  rkt: { name: '로켓', type: 'ammo', color: '#d9483b' },
  band: { name: '붕대', type: 'heal', amt: 15, cap: 75, time: 2.5, color: '#efe6d0' },
  med: { name: '구급상자', type: 'heal', amt: 100, cap: 100, time: 6, color: '#e05050' },
};
const GEAR_COLORS = ['', '#8a9474', '#5c7aa0', '#2f3a48'];
for (let l = 1; l <= 3; l++) {
  ITEMS['vest' + l] = { name: `방탄조끼 Lv.${l}`, type: 'vest', lvl: l, color: GEAR_COLORS[l] };
  ITEMS['helm' + l] = { name: `헬멧 Lv.${l}`, type: 'helm', lvl: l, color: GEAR_COLORS[l] };
}
const ARMOR_PCT = [0, 0.3, 0.4, 0.55];
const itemName = it => (it.k === 'w' ? WEAPONS[it.w].name : ITEMS[it.k].name);
const itemRarityColor = it => (it.k === 'w' ? RARITY[it.r || 0].color : null);
const itemColor = it => (it.k === 'w' ? RARITY[it.r || 0].color : ITEMS[it.k].color);
const itemLabel = it => (it.k === 'w' ? `<b style="color:${RARITY[it.r || 0].color}">${RARITY[it.r || 0].name}</b> ` : '') + itemName(it) + (it.n ? ` ×${it.n}` : '') + (it.k === 'w' ? ` <small>${it.m}/${WEAPONS[it.w].mag}</small>` : '') + (it.d != null ? ` <small>${Math.round(it.d)}%</small>` : '');
// armour soaks a share of the damage and wears down; returns the damage that gets through
function armorAbsorb(gear, dmg, head) {
  const key = head ? 'helm' : 'vest', pc = gear && gear[key];
  if (!pc) return dmg;
  const ab = dmg * ARMOR_PCT[pc.lvl];
  pc.d -= ab * (1.6 - 0.3 * pc.lvl);
  if (pc.d <= 0) gear[key] = null;
  return dmg - ab;
}

const containers = new Map();
let ctrSeq = 0;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6236, roughness: 0.8 });
const crateEdge = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.5, metalness: 0.5 });
const deathMat = new THREE.MeshStandardMaterial({ color: 0x2e3230, roughness: 0.7 });
const bandMat = new THREE.MeshBasicMaterial({ color: 0x7ff0ff });
const deathBand = new THREE.MeshBasicMaterial({ color: 0xffa040 });
const beamGeo = new THREE.CylinderGeometry(0.06, 0.18, 6, 8, 1, true);
const beamMat = new THREE.MeshBasicMaterial({ color: 0x9ff5ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
const ringGeo = new THREE.RingGeometry(0.35, 0.5, 24); ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const ringMats = [];
const ringMatFor = r => (ringMats[r] ||= new THREE.MeshBasicMaterial({ color: RARITY[r].color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
function itemMesh(it) {
  const g = new THREE.Group();
  if (it.k === 'w') {
    const gun = makeGun(it.w, it.r || 0); gun.scale.setScalar(1.6); gun.rotation.set(0, 0, Math.PI / 2); gun.position.y = 0.08; g.add(gun);
  } else {
    const d = ITEMS[it.k], mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.6 });
    const m = new THREE.Mesh(boxGeo, mat);
    if (d.type === 'ammo') m.scale.set(0.3, 0.18, 0.2); else if (d.type === 'heal') m.scale.set(0.34, 0.14, 0.26); else m.scale.set(0.45, 0.32, 0.18);
    m.position.y = m.scale.y / 2; m.castShadow = true; g.add(m);
  }
  const ring = new THREE.Mesh(ringGeo, it.k === 'w' ? ringMatFor(it.r || 0) : ringMat); ring.position.y = 0.03; g.add(ring);
  return g;
}
function spawnContainer(kind, pos, items, id) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = (pos.x * 7.13 + pos.z * 3.7) % Math.PI;
  const add = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(boxGeo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  if (kind === 'crate') {
    add(crateMat, 1.0, 0.6, 0.64, 0, 0.3, 0);
    for (const x of [-0.47, 0.47]) add(crateEdge, 0.08, 0.64, 0.68, x, 0.3, 0);
    add(crateEdge, 1.04, 0.07, 0.68, 0, 0.6, 0); add(bandMat, 0.7, 0.03, 0.69, 0, 0.45, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 3.6; g.add(beam);
  } else if (kind === 'death') {
    add(deathMat, 0.9, 0.5, 0.6, 0, 0.25, 0); add(deathBand, 0.92, 0.06, 0.62, 0, 0.38, 0);
  } else g.add(itemMesh(items[0]));
  scene.add(g);
  const c = { id: id ?? 'l' + ctrSeq++, kind, pos: pos.clone(), items, taken: new Set(), g };
  containers.set(c.id, c); return c;
}
function removeContainer(c) {
  if (!containers.has(c.id)) return;
  containers.delete(c.id); scene.remove(c.g);
  if (c.kind !== 'ground') puff(c.pos.clone().setY(c.pos.y + 0.5), c.kind === 'crate' ? 0x9ff5ff : 0xffa040, 8, 2.5);
}
// crate contents are a pure function of (match seed, crate index) so every client sees the same loot
function crateItems(rng) {
  const P = a => a[Math.floor(rng() * a.length)], items = [];
  if (rng() < 0.6) { const w = P(LOOT_WEAPONS); items.push({ k: 'w', w, m: WEAPONS[w].mag, r: rollRarity(rng) }); items.push({ k: WEAPONS[w].ammo, n: w === 'rocket' ? 3 : WEAPONS[w].mag * 2 }); }
  if (rng() < 0.5) items.push({ k: P(['a9', 'a556', 'a556', 'a12', 'a762']), n: P([10, 20, 30, 40]) });
  if (rng() < 0.55) items.push(rng() < 0.7 ? { k: 'band', n: 2 + Math.floor(rng() * 3) } : { k: 'med', n: 1 });
  if (rng() < 0.35) items.push({ k: (rng() < 0.5 ? 'vest' : 'helm') + (1 + Math.floor(rng() * rng() * 3)), d: 100 });
  if (!items.length) items.push({ k: 'band', n: 3 });
  return items;
}
function placeCrates(seed) {
  for (const c of [...containers.values()]) removeContainer(c);
  ctrSeq = 0;
  RNG = mulberry32(seed);
  const spots = [];
  for (const r of REGIONS) for (let i = 0; i < r.loot; i++) { const p = landPoint(r.x, r.z, r.rx, r.rz); if (p) spots.push(p); }
  for (let i = 0; i < 40; i++) { const p = landPoint(0, 0, 720, 720, 4); if (p) spots.push(p); }
  spots.forEach((p, i) => spawnContainer('crate', p, crateItems(mulberry32(seed ^ Math.imul(i + 1, 2654435761))), 'c' + i));
  RNG = Math.random;
}
function botLoot(b) {
  const items = [{ k: 'w', w: b.weapon.def.id, m: b.weapon.mag, r: b.weapon.r }, { k: b.weapon.def.ammo, n: 20 + Math.floor(Math.random() * 40) }, { k: 'band', n: 1 + Math.floor(Math.random() * 3) }];
  if (Math.random() < 0.3) items.push({ k: 'med', n: 1 });
  for (const key of ['vest', 'helm']) if (b.gear[key]) items.push({ k: key + b.gear[key].lvl, d: b.gear[key].d });
  return items;
}
function playerLoot() {
  const p = player, inv = p.inv, items = [];
  for (const w of inv.slots) if (w) items.push({ k: 'w', w: w.def.id, m: w.mag, r: w.r });
  for (const [k, n] of Object.entries(inv.ammo)) if (n > 0) items.push({ k, n });
  for (const k of ['band', 'med']) if (inv[k] > 0) items.push({ k, n: inv[k] });
  for (const key of ['vest', 'helm']) if (p.gear[key]) items.push({ k: key + p.gear[key].lvl, d: p.gear[key].d });
  return items;
}
const groundPos = (around, spread = 0.9) => {
  const p = around.clone(); p.x += rand(-spread, spread); p.z += rand(-spread, spread);
  p.y = groundAt(p.x, p.z, around.y + 0.5); return p;
};
// shared by single player and multiplayer: drop a box of items into the world
function placeBox(kind, pos, items) {
  if (!items.length) return;
  if (NET.on) NET.send({ t: kind === 'death' ? 'deathbox' : 'drop', items, pos: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)] });
  else spawnContainer(kind, pos, items);
}

// ───────────────────────────────────────────── player inventory
const newInv = () => ({ slots: [null, null, null], ammo: { a9: 0, a556: 0, a12: 0, a762: 0, rkt: 0 }, band: 0, med: 0 });
const slotsFor = id => (WEAPONS[id].slot === 2 ? [2] : [0, 1]);
const SLOT_NAMES = ['주무기 1', '주무기 2', '권총'];
function sendGear() { if (NET.on) NET.send({ t: 'gear', vest: player.gear.vest, helm: player.gear.helm }); }
function dropItem(it) { placeBox('ground', groundPos(player.pos), [it]); }
function addItem(it) {
  const p = player, inv = p.inv;
  if (it.k === 'w') {
    const cand = slotsFor(it.w);
    let s = cand.find(i => !inv.slots[i]);
    if (s == null) { s = cand.includes(p.cur) ? p.cur : cand[0]; const old = inv.slots[s]; dropItem({ k: 'w', w: old.def.id, m: old.mag, r: old.r }); toast(`${old.def.name}을(를) 내려놓았습니다`); }
    inv.slots[s] = newWeapon(it.w, it.m, it.r || 0);
    if (!inv.slots[p.cur] || (p.cur === 2 && s !== 2)) { p.cur = s; p.reloadT = 0; }
    return;
  }
  const d = ITEMS[it.k];
  if (d.type === 'ammo') inv.ammo[it.k] += it.n;
  else if (d.type === 'heal') inv[it.k] += it.n;
  else {
    const old = p.gear[d.type];
    if (old) dropItem({ k: d.type + old.lvl, d: old.d });
    p.gear[d.type] = { lvl: d.lvl, d: it.d ?? 100 }; sendGear();
  }
}
function takeItem(c, i) {
  if (!c || c.taken.has(i) || player.dead) return;
  if (NET.on) { const key = c.id + ':' + i; if (!c.req) c.req = new Set(); if (c.req.has(key)) return; c.req.add(key); NET.send({ t: 'take', c: c.id, i }); return; }
  markTaken(c, i, true);
}
function markTaken(c, i, mine) {
  if (!c || c.taken.has(i)) return;
  c.taken.add(i);
  if (mine) { const it = c.items[i]; addItem(it); toast('+ ' + itemName(it) + (it.n ? ` ×${it.n}` : '')); beep(880, 0.05, 0.07, 'sine'); }
  if (c.taken.size >= c.items.length) removeContainer(c);
  if (invOpen) renderInv();
}
const nearbyContainers = (r = 2.8) => [...containers.values()].filter(c => c.pos.distanceTo(player.pos) < r).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
function takeAllNearby() {
  for (const c of nearbyContainers()) c.items.forEach((it, i) => { if (!c.taken.has(i) && it.k !== 'w') takeItem(c, i); });
}
function dropWeapon(s) {
  const p = player, w = p.inv.slots[s]; if (!w) return;
  p.inv.slots[s] = null; dropItem({ k: 'w', w: w.def.id, m: w.mag, r: w.r }); toast(`${w.def.name} 버림`);
  if (p.cur === s) { p.reloadT = 0; const n = [0, 1, 2].find(i => p.inv.slots[i]); if (n != null) p.cur = n; }
  if (invOpen) renderInv();
}
function dropStack(k, all) {
  const inv = player.inv, d = ITEMS[k];
  if (d.type === 'ammo') { const n = all ? inv.ammo[k] : Math.min(inv.ammo[k], k === 'rkt' ? 1 : 30); if (n <= 0) return; inv.ammo[k] -= n; dropItem({ k, n }); }
  else if (d.type === 'heal') { const n = all ? inv[k] : 1; if (n <= 0) return; inv[k] -= n; dropItem({ k, n }); }
  else { const pc = player.gear[d.type]; if (!pc) return; player.gear[d.type] = null; dropItem({ k: d.type + pc.lvl, d: pc.d }); sendGear(); }
  if (invOpen) renderInv();
}
function useHeal(k) {
  const p = player, d = ITEMS[k];
  if (!d || p.inv[k] <= 0 || p.healT > 0 || p.dropping || p.dead) return false;
  if (p.hp >= d.cap) { toast(`${d.name}는 체력 ${d.cap}까지만 회복됩니다`); return false; }
  p.healItem = k; p.healT = p.healTotal = d.time; p.reloadT = 0; return true;
}
function quickHeal() {
  const p = player;
  if (p.hp < 75 && p.inv.band > 0 && (p.hp > 45 || p.inv.med === 0)) return useHeal('band');
  if (p.inv.med > 0 && p.hp < 100) return useHeal('med');
  if (p.inv.band > 0 && p.hp < 75) return useHeal('band');
  toast(p.hp >= 100 ? '체력이 가득 찼습니다' : '회복 아이템이 없습니다');
}

// ───────────────────────────────────────────── inventory window
let invOpen = false;
function openInv() {
  if (invOpen || state !== 'play' || player.dead || player.dropping) return;
  invOpen = true; $('invwin').classList.remove('hidden'); firing = false; aiming = false; mouseDX = mouseDY = 0;
  document.exitPointerLock(); renderInv();
}
function closeInv(relock = true) {
  if (!invOpen) return;
  invOpen = false; $('invwin').classList.add('hidden');
  mouseDX = mouseDY = 0;
  if (relock) {
    const r = canvas.requestPointerLock();
    // Chrome refuses a re-lock right after leaving one: fall back to the click-to-resume card
    if (r && r.catch) r.catch(() => { if (state === 'play' && !player.dead) $('pause').classList.remove('hidden'); });
  } else if (state === 'play' && !player.dead) $('pause').classList.remove('hidden');
}
const row = (label, color, act, btns = '') => `<div class="irow" ${act}><i style="background:${color}"></i><span>${label}</span>${btns}</div>`;
function renderInv() {
  if (!invOpen) return;
  const p = player, inv = p.inv;
  // nearby
  let h = '';
  for (const c of nearbyContainers()) {
    const title = c.kind === 'crate' ? '보급 상자' : c.kind === 'death' ? '사망 상자' : '바닥';
    const rows = c.items.map((it, i) => c.taken.has(i) ? '' : row(itemLabel(it), itemColor(it), `data-take="${c.id}|${i}"`)).join('');
    if (rows) h += `<div class="igroup">${title}</div>` + rows;
  }
  $('invnear').innerHTML = h || '<div class="iempty">근처에 주울 물건이 없습니다</div>';
  // backpack
  let b = '';
  for (const k of ['a9', 'a556', 'a12', 'a762', 'rkt']) if (inv.ammo[k] > 0) b += row(`${ITEMS[k].name} ×${inv.ammo[k]}`, ITEMS[k].color, '', `<button data-drop="${k}|30">30 버리기</button><button data-drop="${k}|all">모두</button>`);
  for (const k of ['band', 'med']) if (inv[k] > 0) b += row(`${ITEMS[k].name} ×${inv[k]} <small>클릭해서 사용</small>`, ITEMS[k].color, `data-use="${k}"`, `<button data-drop="${k}|1">버리기</button>`);
  $('invbag').innerHTML = b || '<div class="iempty">가방이 비어 있습니다</div>';
  // gear + weapons
  let g = '';
  for (const key of ['helm', 'vest']) {
    const pc = p.gear[key];
    g += pc ? row(`${ITEMS[key + pc.lvl].name} <small>내구도 ${Math.round(pc.d)}%</small>`, GEAR_COLORS[pc.lvl], '', `<button data-drop="${key}${pc.lvl}|1">버리기</button>`)
      : `<div class="iempty">${key === 'helm' ? '헬멧' : '방탄조끼'} 없음</div>`;
  }
  $('invgear').innerHTML = g;
  $('invweap').innerHTML = inv.slots.map((w, s) => `<div class="wcard ${s === p.cur ? 'on' : ''}" data-equip="${s}" style="--rc:${w ? RARITY[w.r].color : '#5b647a'}">${w ? `<img src="${gunIcon(w.def.id, w.r)}" alt="">` : ''}
      <div class="wslot">${s + 1} · ${SLOT_NAMES[s]}</div>
      ${w ? `<div class="wname" style="color:${RARITY[w.r].color}">${w.def.name}</div><div class="wsub">${w.mag}/${w.def.mag} · ${ITEMS[w.def.ammo].name} ${inv.ammo[w.def.ammo]}</div><button data-dropw="${s}">버리기 [G]</button>` : '<div class="wsub">비어 있음</div>'}
    </div>`).join('');
}
$('invwin').addEventListener('click', e => {
  const t = e.target.closest('[data-take],[data-use],[data-drop],[data-dropw],[data-equip],#takeall,#invclose');
  if (!t) return;
  if (t.id === 'takeall') takeAllNearby();
  else if (t.id === 'invclose') closeInv();
  else if (t.dataset.dropw != null) dropWeapon(+t.dataset.dropw);
  else if (t.dataset.drop) { const [k, n] = t.dataset.drop.split('|'); dropStack(k, n === 'all'); }
  else if (t.dataset.take) { const [cid, i] = t.dataset.take.split('|'); takeItem(containers.get(cid), +i); }
  else if (t.dataset.use) { if (useHeal(t.dataset.use)) closeInv(); }
  else if (t.dataset.equip != null) switchTo(+t.dataset.equip);
  renderInv();
});
setInterval(() => { if (invOpen) renderInv(); }, 400);

// ───────────────────────────────────────────── zone (pure function of match time, same on every client and the server)
let zplan = null;
const zone = { phase: 0, stage: 'wait', t: 0, cur: { x: 0, z: 0, r: 900 }, next: null, dps: 0.5, tick: 0 };
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 500, 128, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fa0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
zoneWall.position.y = 150; scene.add(zoneWall);
function updateZone(dt) {
  if (!zplan) return;
  const z = zoneAt(zplan, now);
  if (z.phase !== zone.phase || z.stage !== zone.stage) {
    if (z.stage === 'shrink') { banner('자기장 축소 시작'); beep(420, 0.3, 0.1, 'sawtooth'); }
    else if (z.stage === 'wait' && z.phase > 0) { banner('자기장이 곧 좁혀집니다'); beep(520, 0.2, 0.1, 'sawtooth'); }
    if (z.phase !== zone.phase) for (const b of bots) b.zoneGoal = null;
  }
  Object.assign(zone, { phase: z.phase, stage: z.stage, t: z.left, cur: z.cur, next: z.next, dps: z.dps });
  zoneWall.position.x = zone.cur.x; zoneWall.position.z = zone.cur.z;
  zoneWall.scale.set(Math.max(zone.cur.r, 0.5), 1, Math.max(zone.cur.r, 0.5));
  zone.tick += dt;
  if (zone.tick >= 1) {
    zone.tick -= 1;
    // players are damaged by the server in multiplayer; the host handles bots
    const victims = NET.on ? (NET.isHost ? bots : []) : actors;
    for (const a of victims) if (!a.dead && outsideZone(a.pos)) { a.hp -= zone.dps; if (a === player) { hud.hurt = Math.max(hud.hurt, 0.3); shake(0.08); } if (a.hp <= 0) kill(a, null, '자기장'); }
  }
}
const outsideZone = p => Math.hypot(p.x - zone.cur.x, p.z - zone.cur.z) > zone.cur.r;

// ───────────────────────────────────────────── bots
const bots = [];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const BOT_RANGE = { pistol: 22, revolver: 30, smg: 18, tsmg: 22, shotgun: 8, tac: 10, rifle: 45, burst: 50, lmg: 40, dmr: 90, sniper: 120, rocket: 40 };
class Bot extends Actor {
  constructor(name, id, weaponId) {
    super(name, botOutfit());
    this.id = id; actorById.set(id, this);
    this.weapon = newWeapon(weaponId || pick(['pistol', 'pistol', 'revolver', 'smg', 'tsmg', 'shotgun', 'tac', 'rifle', 'rifle', 'burst', 'lmg', 'dmr', 'sniper']), undefined, rollRarity(Math.random));
    this.rig.setWeapon(this.weapon.def.id, this.weapon.r);
    this.gear = { vest: Math.random() < 0.45 ? { lvl: pick([1, 1, 2, 2, 3]), d: 100 } : null, helm: Math.random() < 0.4 ? { lvl: pick([1, 1, 2, 3]), d: 100 } : null };
    this.rig.setGear?.(this.gear);
    this.target = null; this.seenAt = -99; this.lastSeen = new THREE.Vector3();
    this.think = rand(0, 0.4); this.react = 0; this.strafe = 1; this.strafeT = 0;
    this.wander = null; this.zoneGoal = null; this.stuckT = 0; this.stuckFrom = new THREE.Vector3(); this.reloadT = 0;
    this.skill = rand(0.75, 1.25); this.prev = new THREE.Vector3();
  }
  onHurt(by) {
    if (by && !by.dead && (!this.target || this.target.dead || Math.random() < 0.6)) {
      if (this.target !== by) this.react = rand(0.25, 0.5) * this.skill;
      this.target = by; this.seenAt = now; this.lastSeen.copy(by.pos);
    }
  }
  acquire() {
    const rng = this.weapon.def.id === 'dmr' ? 220 : this.weapon.def.id === 'rifle' ? 170 : 120;
    const cands = actors.filter(a => a !== this && !a.dead && a.pos.distanceToSquared(this.pos) < rng * rng)
      .sort((a, b) => a.pos.distanceToSquared(this.pos) - b.pos.distanceToSquared(this.pos)).slice(0, 3);
    let best = null;
    for (const c of cands) {
      const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
      const ang = Math.atan2(-(c.pos.x - this.pos.x), -(c.pos.z - this.pos.z));
      const diff = Math.abs(((ang - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > 1.95 && d > 15) continue;
      if (!hasLOS(this, c)) continue;
      if (!best || (c === player && d < 1.4 * best.d)) best = { a: c, d };
    }
    if (best) {
      if (this.target !== best.a) this.react = rand(0.5, 0.95) * this.skill;
      this.target = best.a; this.seenAt = now; this.lastSeen.copy(best.a.pos);
    } else if (this.target && (this.target.dead || now - this.seenAt > 5)) this.target = null;
  }
  pickWander() {
    const z = zone.next || zone.cur;
    for (let t = 0; t < 10; t++) {
      const r = Math.min(z.r * 0.8, 260), a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * r;
      let cx = z.x + Math.cos(a) * d, cz = z.z + Math.sin(a) * d;
      if (z.r > 300) { cx = this.pos.x + rand(-160, 160); cz = this.pos.z + rand(-160, 160); if (Math.hypot(cx - z.x, cz - z.z) > z.r * 0.85) continue; }
      if (terrainH(cx, cz) > 1.5) { this.wander = new THREE.Vector3(cx, 0, cz); return; }
    }
    this.wander = new THREE.Vector3(z.x, 0, z.z);
  }
  zonePoint() {
    const z = zone.next || zone.cur;
    for (let t = 0; t < 12; t++) {
      const a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * z.r * 0.6;
      const x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d;
      if (terrainH(x, zz) > 1.5) return new THREE.Vector3(x, 0, zz);
    }
    return new THREE.Vector3(z.x, 0, z.z);
  }
  steer(dx, dz) {
    const len = Math.hypot(dx, dz); if (len < 1e-3) return null; dx /= len; dz /= len;
    for (const a of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6]) {
      const ca = Math.cos(a), sa = Math.sin(a), rx = dx * ca - dz * sa, rz = dx * sa + dz * ca;
      const px = this.pos.x + rx * 1.8, pz = this.pos.z + rz * 1.8;
      if (terrainH(px, pz) < SEA - 0.4) continue;
      if (groundAt(px, pz, this.pos.y) > this.pos.y + 1.5) continue;
      if (blockedAt(px, pz, this.pos.y, 0.5)) continue;
      return [rx, rz];
    }
    return null;
  }
  update(dt) {
    if (this.dead) { this.animate(dt); return; }
    this.think -= dt; this.react -= dt; this.fireT -= dt; this.strafeT -= dt;
    if (this.think <= 0) { this.think = rand(0.3, 0.45); this.acquire(); }
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.weapon.mag = this.weapon.def.mag; }
    const def = this.weapon.def;
    let goal = null, faceTo = null, speed = 5.6, strafe = 0;
    const out = zone.cur && Math.hypot(this.pos.x - zone.cur.x, this.pos.z - zone.cur.z) > zone.cur.r - 8;
    const nextOut = zone.next && Math.hypot(this.pos.x - zone.next.x, this.pos.z - zone.next.z) > zone.next.r * 0.9;
    const tgt = this.target && !this.target.dead ? this.target : null;
    const visible = tgt && now - this.seenAt < 0.6;
    if (tgt) {
      faceTo = visible ? tgt.pos : this.lastSeen;
      const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z), want = BOT_RANGE[def.id];
      if (!visible) { goal = this.lastSeen; speed = 7; }
      else if (d > want * 1.3) { goal = tgt.pos; speed = 6.5; }
      else if (d < want * 0.45) goal = _v3.set(this.pos.x * 2 - tgt.pos.x, 0, this.pos.z * 2 - tgt.pos.z);
      else { strafe = this.strafe; speed = 4.6; }
      if (this.strafeT <= 0) { this.strafeT = rand(0.6, 1.6); this.strafe = Math.random() < 0.5 ? -1 : 1; }
      if (out || (nextOut && zone.stage === 'shrink')) { this.zoneGoal ||= this.zonePoint(); goal = this.zoneGoal; strafe = 0; speed = 8.5; }
    } else {
      if (out || nextOut) { this.zoneGoal ||= this.zonePoint(); goal = this.zoneGoal; speed = out ? 9 : 7.5; }
      else { if (!this.wander || Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 4) this.pickWander(); goal = this.wander; }
    }
    let mx = 0, mz = 0;
    if (goal) { const s = this.steer(goal.x - this.pos.x, goal.z - this.pos.z); if (s) { mx = s[0]; mz = s[1]; } }
    else if (strafe && faceTo) {
      const fx = faceTo.x - this.pos.x, fz = faceTo.z - this.pos.z, l = Math.hypot(fx, fz) || 1;
      const s = this.steer((-fz / l) * strafe, (fx / l) * strafe); if (s) { mx = s[0]; mz = s[1]; } else this.strafe *= -1;
      if (this.onGround && !this.swimming && Math.random() < dt * 0.45) this.vy = 7;
    }
    if (this.swimming) speed = 3;
    this.sprinting = !visible && speed >= 7.5 && (mx || mz);
    this.prev.copy(this.pos);
    this.physics(dt, mx * speed * dt, mz * speed * dt);
    const vx = (this.pos.x - this.prev.x) / dt, vz = (this.pos.z - this.prev.z) / dt, kv = 1 - Math.exp(-12 * dt);
    this.vel.x += (vx - this.vel.x) * kv; this.vel.z += (vz - this.vel.z) * kv;
    // facing / aim
    const fp = faceTo || (mx || mz ? _v2.set(this.pos.x + mx, 0, this.pos.z + mz) : null);
    if (fp) {
      const want = Math.atan2(-(fp.x - this.pos.x), -(fp.z - this.pos.z));
      const diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += clamp(diff, -8 * dt, 8 * dt);
    }
    const wantPitch = tgt && visible ? Math.atan2(tgt.pos.y + 1.1 - (this.pos.y + 1.5), Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z)) : 0;
    this.pitch += (clamp(wantPitch, -1, 1) - this.pitch) * (1 - Math.exp(-8 * dt));
    this.stuckT += dt;
    if (this.stuckT > 2) {
      if ((mx || mz) && this.stuckFrom.distanceTo(this.pos) < 1.2) { this.wander = null; this.zoneGoal = this.zoneGoal ? this.zonePoint() : null; this.strafe *= -1; this.yaw += rand(-2, 2); if (this.onGround) this.vy = 7; }
      this.stuckT = 0; this.stuckFrom.copy(this.pos);
    }
    this.reloadP = this.reloadT > 0 ? 1 - this.reloadT / (def.reload * 1.2) : -1;
    if (visible && this.react <= 0 && this.fireT <= 0 && this.reloadT <= 0) {
      const want = Math.atan2(-(tgt.pos.x - this.pos.x), -(tgt.pos.z - this.pos.z));
      const diff = Math.abs(((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const dist = tgt.pos.distanceTo(this.pos);
      if (diff < 0.25 && dist < def.range) {
        const o = this.muzzle(_v1);
        const aim = _v2.set(tgt.pos.x, tgt.pos.y + (Math.random() < 0.12 ? 1.62 : 1.05), tgt.pos.z).sub(o).normalize();
        const moving = tgt.speedNow > 2 ? 0.02 : 0;
        const spread = (def.spread + 0.028 + moving + dist * 0.00012) * this.skill;
        fireWeapon(this, o.clone(), aim.clone(), def, spread);
        this.fireT = def.rate * (def.auto ? 1.5 : 1.35) * this.skill + (def.auto && Math.random() < 0.25 ? 0.5 : 0);
        if (--this.weapon.mag <= 0) this.reloadT = def.reload * 1.2;
      }
    }
    this.animate(dt);
  }
}

// ───────────────────────────────────────────── player
let player;
const keys = {};
let mouseDX = 0, mouseDY = 0, firing = false, aiming = false, sens = 1.2, now = 0;
const MOVE = { walk: 6.4, sprint: 10.2, ads: 3.8, heal: 2.6, swim: 3.2, jump: 7.4, slideBoost: 13.5 };
const PLAYER_OUTFITS = [
  { shirt: '#b8682a', vest: '#2f342c', vest2: '#3e4438', pack: '#5a4a35', pants: '#2c3138', skin: '#e0b892', helmet: '#d88a34', accent: '#e8c06a' },
  { shirt: '#2f6fb0', vest: '#26303a', vest2: '#35414e', pack: '#3d4a57', pants: '#2a2f36', skin: '#d6ab84', helmet: '#3b8ad8', accent: '#9fd0ff' },
  { shirt: '#a33b3b', vest: '#2e2a2a', vest2: '#3d3434', pack: '#4f3a3a', pants: '#2b2b2e', skin: '#c99f7c', helmet: '#c84a4a', accent: '#ffb0a0' },
  { shirt: '#7a4fa3', vest: '#2d2836', vest2: '#3b3447', pack: '#4a405a', pants: '#2b2833', skin: '#e3c3a3', helmet: '#9a68cc', accent: '#d6b8ff' },
  { shirt: '#2f8f6a', vest: '#26332e', vest2: '#33443d', pack: '#3c5249', pants: '#29302d', skin: '#a77b58', helmet: '#3fb488', accent: '#a8f0d0' },
  { shirt: '#c9b23a', vest: '#33302a', vest2: '#45402f', pack: '#5a523a', pants: '#2e2d29', skin: '#f0d2b5', helmet: '#e0c840', accent: '#fff2a0' },
];
const outfitFor = id => PLAYER_OUTFITS[(parseInt(String(id).slice(1)) || 0) % PLAYER_OUTFITS.length];
function addCanopy(a) {
  const canopy = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.SphereGeometry(3.4, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: a.chuteColor || 0xe8893a, side: THREE.DoubleSide, roughness: 0.7 }));
  cloth.scale.y = 0.5; cloth.castShadow = true; canopy.add(cloth);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    canopy.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(ang) * 3.0, 0.6, Math.sin(ang) * 3.0), new THREE.Vector3(0, -3.7, 0.05)]), lineMat));
  }
  canopy.position.y = 5.6; canopy.visible = false; a.rig.root.add(canopy); a.canopy = canopy;
}
// name tag: dark pill with the player's colour as border; stays the same size on screen at any distance
function nameTag(a, text, color) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), H = 96, font = '900 52px "Noto Sans KR", "Malgun Gothic", sans-serif';
  x.font = font; const tw = Math.ceil(x.measureText(text).width);
  c.width = tw + 90; c.height = H;
  const W = c.width, r = 34;
  x.beginPath(); x.moveTo(r + 6, 6); x.arcTo(W - 6, 6, W - 6, H - 6, r); x.arcTo(W - 6, H - 6, 6, H - 6, r); x.arcTo(6, H - 6, 6, 6, r); x.arcTo(6, 6, W - 6, 6, r); x.closePath();
  x.fillStyle = 'rgba(14,20,36,.88)'; x.fill(); x.lineWidth = 8; x.strokeStyle = color; x.stroke();
  x.beginPath(); x.arc(40, H / 2, 11, 0, Math.PI * 2); x.fillStyle = color; x.fill();
  x.font = font; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = '#0d1322'; x.strokeText(text, 62, H / 2 + 3); x.fillStyle = '#ffffff'; x.fillText(text, 62, H / 2 + 3);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  const h = 0.034; sp.scale.set(h * W / H, h, 1); sp.center.set(0.5, 0);
  sp.position.y = 2.15; sp.renderOrder = 20; a.rig.root.add(sp); a.tag = sp; a.tagLos = true; a.tagT = Math.random() * 0.3;
}
// re-check line of sight a few times a second so tags never reveal people behind walls
function updateTags(dt) {
  for (const a of actors) {
    if (!a.tag) continue;
    if (a.dead || !player) { a.tag.visible = false; continue; }
    const d = a.pos.distanceTo(player.pos);
    a.tagT -= dt;
    if (a.tagT <= 0) { a.tagT = 0.3; a.tagLos = d < 40 || (d < 350 && hasLOS(player, a)); }
    a.tag.visible = a.tagLos && a.rig.root.visible !== false;
  }
}
// crosshair target readout: name, distance and whether it is a bot
let aimT = 0, aimHold = 0;
function updateAimName(dt) {
  aimT -= dt; aimHold -= dt;
  const el = $('aimname');
  if (aimT <= 0 && player && !player.dead && !player.dropping) {
    aimT = 0.12;
    camera.getWorldDirection(camFwd);
    const o = camera.position.clone().addScaledVector(camFwd, camera.position.distanceTo(player.pos) * 0.9);
    const h = raycast(o, camFwd, 300, player);
    if (h.ent && !h.ent.dead) {
      const e = h.ent, human = e.remoteHuman;
      el.innerHTML = `<b>${escapeHtml(e.name)}</b>${human ? '' : '<i>봇</i>'}<span>${Math.round(h.t)}m</span>`;
      el.style.setProperty('--tc', human ? new THREE.Color(outfitFor(e.id).helmet).getStyle() : '#ff6b6b');
      aimHold = 0.35;
    }
  }
  el.classList.toggle('hidden', aimHold <= 0);
}
function createPlayer(spawn, id = 'p0', name = '나') {
  const outfit = NET.on ? outfitFor(id) : PLAYER_OUTFITS[0];
  player = new Actor(name, outfit);
  player.id = id; player.chuteColor = new THREE.Color(outfit.helmet).getHex();
  player.pos.set(spawn.x, 300, spawn.z);
  player.pitch = -0.35; player.inv = newInv(); player.inv.slots[2] = newWeapon('pistol'); player.inv.ammo.a9 = 36; player.cur = 2; player.reloadT = 0;
  player.gear = { vest: null, helm: null }; player.healT = 0; player.healTotal = 1; player.dropping = true; player.mode = 'free';
  player.slideT = 0; player.slideCD = 0; player.wantSlide = false; player.dropVy = -10;
  player.rig.setWeapon('pistol');
  addCanopy(player);
  player.muzzleLight = new THREE.PointLight(0xffc070, 0, 14); scene.add(player.muzzleLight);
}

// ───────────────────────────────────────────── remote actors (other players, and bots on non-host clients)
const FLAG = { ground: 1, sprint: 2, slide: 4, swim: 8, free: 16, chute: 32, heal: 64, dead: 128 };
const WEAPON_IDS = Object.keys(WEAPONS);
const actorById = new Map();
function packState(a) {
  const f = (a.onGround ? FLAG.ground : 0) | (a.sprinting ? FLAG.sprint : 0) | (a.slide ? FLAG.slide : 0) | (a.swimming ? FLAG.swim : 0)
    | (a.mode === 'free' ? FLAG.free : 0) | (a.mode === 'chute' ? FLAG.chute : 0) | (a.healing ? FLAG.heal : 0) | (a.dead ? FLAG.dead : 0);
  const r = v => Math.round(v * 100) / 100;
  return { id: a.id, p: [r(a.pos.x), r(a.pos.y), r(a.pos.z)], y: r(a.yaw), pt: r(a.pitch), v: [r(a.vel.x), r(a.vel.z)], f, rl: r(a.reloadP), w: WEAPON_IDS.indexOf(a.rig.weaponId), wr: a.rig.weaponRarity || 0 };
}
class RemoteActor extends Actor {
  constructor(id, name, human) {
    super(name, human ? outfitFor(id) : botOutfit());
    this.id = id; this.remoteHuman = human; this.snaps = []; this.seen = false; this.rig.root.visible = false;
    this.onGround = true; actorById.set(id, this);
    if (human) { this.chuteColor = new THREE.Color(outfitFor(id).helmet).getHex(); addCanopy(this); nameTag(this, name, outfitFor(id).helmet); }
  }
  push(s) {
    this.snaps.push({ t: performance.now(), p: s.p, y: s.y, pt: s.pt, v: s.v, f: s.f, rl: s.rl, w: s.w, wr: s.wr, hp: s.hp });
    if (this.snaps.length > 12) this.snaps.shift();
    if (!this.seen) { this.seen = true; this.pos.set(...s.p); this.yaw = s.y; }
  }
  update(dt) {
    if (!this.seen) return;
    if (this.dead) { this.animate(dt); return; }
    const rt = performance.now() - 110, S = this.snaps;
    let a = S[0], b = S[S.length - 1];
    for (let i = 0; i < S.length - 1; i++) if (S[i].t <= rt && S[i + 1].t >= rt) { a = S[i]; b = S[i + 1]; break; }
    const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    this.pos.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
    let dy = b.y - a.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.y + dy * k; this.pitch = a.pt + (b.pt - a.pt) * k;
    this.vel.set(b.v[0], 0, b.v[1]); this.speedNow = Math.hypot(b.v[0], b.v[1]);
    const f = b.f;
    this.onGround = !!(f & FLAG.ground); this.sprinting = !!(f & FLAG.sprint); this.slide = !!(f & FLAG.slide); this.swimming = !!(f & FLAG.swim);
    this.mode = f & FLAG.free ? 'free' : f & FLAG.chute ? 'chute' : 'ground'; this.healing = !!(f & FLAG.heal); this.reloadP = b.rl;
    if (b.hp != null) this.hp = b.hp;
    if (b.w >= 0) this.rig.setWeapon(WEAPON_IDS[b.w], b.wr || 0);
    if (this.canopy) this.canopy.visible = this.mode === 'chute';
    this.rig.root.visible = true;
    this.animate(dt);
  }
}
const curW = () => player.inv.slots[player.cur];
const ammoOf = w => player.inv.ammo[w.def.ammo];
function healCancel() { if (player && player.healT > 0) { player.healT = 0; toast('치료 취소'); } }
function tryReload() {
  const w = curW(); if (!w || player.reloadT > 0 || w.mag >= w.def.mag || ammoOf(w) <= 0) return;
  player.reloadT = w.def.reload; healCancel(); beep(300, 0.05, 0.05);
}
function switchTo(i) { if (player.inv.slots[i] && player.cur !== i) { player.cur = i; player.reloadT = 0; player.fireT = 0.25; player.burstLeft = 0; beep(500, 0.04, 0.04); } }

const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3();
function updatePlayer(dt) {
  const p = player;
  const zoomS = aiming ? 1 / Math.sqrt(curW()?.def.zoom || 1) : 1;
  p.yaw -= mouseDX * 0.0022 * sens * zoomS;
  p.pitch = clamp(p.pitch - mouseDY * 0.0022 * sens * zoomS, -1.3, 1.1);
  mouseDX = mouseDY = 0;
  if (p.dead) { p.animate(dt); return; }
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let ix = 0, iz = 0;
  if (keys.KeyW) { ix += fx; iz += fz; } if (keys.KeyS) { ix -= fx; iz -= fz; }
  if (keys.KeyA) { ix += fz; iz -= fx; } if (keys.KeyD) { ix -= fz; iz += fx; }
  const il = Math.hypot(ix, iz); if (il > 0) { ix /= il; iz /= il; }

  // ── skydive / parachute
  if (p.dropping) {
    const g = groundAt(p.pos.x, p.pos.z, p.pos.y);
    if (p.mode === 'free' && (p.pos.y - g < 60 || keys.Space && p.pos.y - g < 200)) { p.mode = 'chute'; p.canopy.visible = true; beep(200, 0.25, 0.08, 'triangle'); shake(0.35); keys.Space = false; }
    const free = p.mode === 'free', diving = free && keys.KeyW;
    const hs = free ? (diving ? 26 : 18) : 12;
    const vyT = free ? (diving ? -55 : -38) : -7;
    p.dropVy += (vyT - p.dropVy) * (1 - Math.exp(-(free ? 1.5 : 3) * dt));
    p.vel.x += (ix * hs - p.vel.x) * (1 - Math.exp(-3 * dt)); p.vel.z += (iz * hs - p.vel.z) * (1 - Math.exp(-3 * dt));
    p.pos.x = clamp(p.pos.x + p.vel.x * dt, -BOUND, BOUND); p.pos.z = clamp(p.pos.z + p.vel.z * dt, -BOUND, BOUND);
    p.pos.y += p.dropVy * dt; p.speedNow = 0;
    resolve(p.pos, 0.42);
    if (p.mode === 'chute') p.canopy.rotation.z = Math.sin(now * 1.7) * 0.06 + clamp(-(p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw)) * 0.02, -0.25, 0.25);
    if (p.pos.y <= groundAt(p.pos.x, p.pos.z, p.pos.y)) {
      p.dropping = false; p.mode = 'ground'; p.canopy.visible = false; p.vy = 0; p.onGround = true;
      p.rig.land(10); shake(0.4); puff(p.pos.clone().setY(p.pos.y + 0.1), 0xb8ad90, 10, 3);
      toast('착지! 보급 상자를 찾으세요');
    }
    p.animate(dt); return;
  }

  // ── actions
  p.fireT -= dt; p.slideCD -= dt;
  const w = curW();
  if (w && (p.rig.weaponId !== w.def.id || p.rig.weaponRarity !== w.r)) p.rig.setWeapon(w.def.id, w.r);
  if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0 && w) { const n = Math.min(w.def.mag - w.mag, ammoOf(w)); w.mag += n; p.inv.ammo[w.def.ammo] -= n; beep(420, 0.05, 0.05); } }
  if (p.healT > 0) {
    p.healT -= dt;
    if (p.healT <= 0) {
      const d = ITEMS[p.healItem]; p.inv[p.healItem]--;
      if (NET.on) NET.send({ t: 'heal', amt: d.amt, cap: d.cap }); else p.hp = Math.max(p.hp, Math.min(d.cap, p.hp + d.amt));
      toast(d.name + ' 사용 완료'); beep(660, 0.12, 0.08, 'sine');
    }
  }
  const hsp = Math.hypot(p.vel.x, p.vel.z);
  const fwdInput = iz * fz + ix * fx;
  p.sprinting = !!keys.ShiftLeft && !aiming && !firing && p.healT <= 0 && fwdInput > 0.3 && !p.slide && !p.swimming;

  // ── slide (C while running)
  if (p.wantSlide) {
    p.wantSlide = false;
    if (p.onGround && !p.swimming && hsp > 6.5 && p.slideCD <= 0 && !p.slide) {
      p.slide = true; p.slideT = 0.9; const k = Math.max(hsp, MOVE.slideBoost) / hsp;
      p.vel.x *= k; p.vel.z *= k; shake(0.12); healCancel();
      sound({ freq: 900, len: 0.5, vol: 0.18 }, null);
    }
  }
  if (p.slide) {
    p.slideT -= dt;
    const decay = Math.exp(-1.15 * dt); p.vel.x *= decay; p.vel.z *= decay;
    const gx = (terrainH(p.pos.x + 1, p.pos.z) - terrainH(p.pos.x - 1, p.pos.z)) / 2, gz = (terrainH(p.pos.x, p.pos.z + 1) - terrainH(p.pos.x, p.pos.z - 1)) / 2;
    p.vel.x -= gx * 16 * dt; p.vel.z -= gz * 16 * dt;
    p.vel.x += ix * 3 * dt; p.vel.z += iz * 3 * dt;
    if (p.slideT <= 0 || Math.hypot(p.vel.x, p.vel.z) < 4.5 || !p.onGround) { p.slide = false; p.slideCD = 0.45; }
  } else {
    let speed = MOVE.walk;
    if (p.sprinting) speed = MOVE.sprint; if (aiming) speed = MOVE.ads; if (p.healT > 0) speed = MOVE.heal; if (p.swimming) speed = MOVE.swim;
    if (curW()?.def.heavy) speed *= 0.88;
    if (p.onGround) {
      const k = 1 - Math.exp(-(il > 0 ? 14 : 10) * dt);
      p.vel.x += (ix * speed - p.vel.x) * k; p.vel.z += (iz * speed - p.vel.z) * k;
    } else {
      // air control keeps momentum: only accelerate toward input, never brake hard
      const k = 1 - Math.exp(-2.2 * dt), tx = ix * Math.max(speed, hsp), tz = iz * Math.max(speed, hsp);
      if (il > 0) { p.vel.x += (tx - p.vel.x) * k; p.vel.z += (tz - p.vel.z) * k; }
    }
  }
  if (keys.Space && p.onGround && !p.swimming) {
    p.vy = MOVE.jump; p.onGround = false; keys.Space = false;
    if (p.slide) { p.slide = false; p.slideCD = 0.3; const k = 1.08; p.vel.x *= k; p.vel.z *= k; }
    sound({ freq: 380, len: 0.08, vol: 0.06 }, null);
  }
  const r = p.physics(dt, p.vel.x * dt, p.vel.z * dt);
  if (r.blocked && p.slide) { p.vel.multiplyScalar(0.6); }
  if (r.impact > 5) {
    p.rig.land(r.impact); shake(Math.min(0.5, r.impact * 0.022));
    if (r.impact > 9) puff(p.pos.clone().setY(p.pos.y + 0.1), 0xb8ad90, 6, 2);
    sound({ freq: 300, len: 0.12, vol: 0.12 + r.impact * 0.01 }, null);
  }
  if (r.impact > 17) {
    const dmg = (r.impact - 17) * 5; hud.hurt = 0.6; toast(`낙하 피해 -${Math.round(dmg)}`);
    if (NET.on) NET.send({ t: 'selfdmg', amt: Math.round(dmg), w: '낙하' });
    else { p.hp -= dmg; if (p.hp <= 0) kill(p, null, '낙하'); }
  }

  // ── shooting (burst weapons keep firing their queued rounds after the click)
  p.burstT -= dt;
  const wantShot = (firing && p.fireT <= 0) || (p.burstLeft > 0 && p.burstT <= 0);
  if (wantShot && w && p.reloadT <= 0 && p.healT <= 0 && !p.sprinting) {
    if (w.mag <= 0) {
      p.burstLeft = 0;
      if (ammoOf(w) <= 0) { toast(ITEMS[w.def.ammo].name + '이 없습니다'); beep(180, 0.05, 0.05); firing = false; p.fireT = 0.3; }
      else { tryReload(); if (!w.def.auto) firing = false; }
    } else {
      const def = w.def;
      if (def.burst && !(p.burstLeft > 0)) p.burstLeft = def.burst;
      camera.getWorldDirection(camFwd);
      const camDist = camera.position.distanceTo(p.pos) * 0.9;
      const camOrigin = camera.position.clone().addScaledVector(camFwd, camDist);
      const h = raycast(camOrigin, camFwd, def.range, p);
      const target = camOrigin.clone().addScaledVector(camFwd, Math.min(h.t, def.range));
      const o = p.muzzle(new THREE.Vector3());
      const dir = target.sub(o).normalize();
      const spread = def.spread * (aiming ? 0.45 : 1) + (p.speedNow > 1 ? 0.012 : 0) + (p.onGround ? 0 : 0.05) + (p.slide ? 0.02 : 0);
      fireWeapon(p, o, dir, def, spread);
      ejectShell(o, p.yaw, def);
      p.muzzleLight.position.copy(o); p.muzzleLight.intensity = 40; setTimeout(() => (p.muzzleLight.intensity = 0), 40);
      w.mag--;
      if (def.burst) { p.burstLeft--; p.burstT = def.burstRate; if (p.burstLeft <= 0) p.fireT = def.rate; } else p.fireT = def.rate;
      p.pitch += def.kick * (aiming ? 0.6 : 1); p.yaw += rand(-0.4, 0.4) * def.kick;
      hud.bloom = Math.min(1, hud.bloom + 0.3);
      shake(def.kick * (def.pellets > 1 ? 6 : 3.5)); cam.fovKick += def.kick * 35;
      if (!def.auto) firing = false;
      if (w.mag === 0) { p.burstLeft = 0; tryReload(); }
    }
  }
  p.reloadP = p.reloadT > 0 && w ? 1 - p.reloadT / w.def.reload : -1;
  p.rig.setGear?.(p.gear);
  p.healing = p.healT > 0;
  p.animate(dt);
  p.nearBox = nearbyContainers(2.6)[0] || null;
}

// ───────────────────────────────────────────── camera
const cam = { pivot: new THREE.Vector3(), init: false, trauma: 0, fovKick: 0, roll: 0, back: 3.3 };
function shake(a) { cam.trauma = Math.min(1, cam.trauma + a); }
function updateCamera(dt) {
  const p = player;
  const def = curW()?.def;
  const ads = aiming && !p.dropping && !p.dead;
  const hsp = Math.hypot(p.vel.x, p.vel.z);
  let fov = 72;
  if (p.mode === 'free') fov = keys.KeyW ? 98 : 90; else if (p.mode === 'chute') fov = 80;
  else if (p.slide) fov = 90; else if (p.sprinting) fov = 84; else fov = 72 + clamp(hsp - 6.5, 0, 6) * 1.2;
  if (ads) fov = 72 / (def?.zoom || 1);
  cam.fovKick *= Math.exp(-10 * dt);
  camera.fov += (fov + cam.fovKick - camera.fov) * Math.min(1, 9 * dt); camera.updateProjectionMatrix();
  const pivotH = p.slide ? 1.05 : p.swimming ? 0.65 : p.mode !== 'ground' ? 1.3 : 1.62;
  const tx = p.pos.x, ty = p.pos.y + pivotH, tz = p.pos.z;
  if (!cam.init) { cam.pivot.set(tx, ty, tz); cam.init = true; }
  const kh = 1 - Math.exp(-30 * dt), kv = 1 - Math.exp(-14 * dt);
  cam.pivot.x += (tx - cam.pivot.x) * kh; cam.pivot.z += (tz - cam.pivot.z) * kh;
  cam.pivot.y += (ty - cam.pivot.y) * (p.dropping ? kh : kv);
  // roll into strafes and slides
  camRight.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const strafe = (p.vel.x * camRight.x + p.vel.z * camRight.z) / 10;
  cam.roll += ((-strafe * 0.035 + (p.slide ? 0.06 : 0)) - cam.roll) * (1 - Math.exp(-6 * dt));
  // shake
  cam.trauma = Math.max(0, cam.trauma - dt * 1.7);
  const tr = cam.trauma * cam.trauma, t = performance.now() / 1000;
  const n1 = Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3) * 0.5, n2 = Math.sin(t * 41.3 + 1) + Math.sin(t * 19.1) * 0.5, n3 = Math.sin(t * 31.7 + 2);
  let bob = 0;
  if (p.onGround && !p.slide && hsp > 1) bob = Math.sin(p.rig.phase * 2) * (p.sprinting ? 0.045 : 0.018);
  camera.rotation.set(p.pitch + n2 * 0.03 * tr, p.yaw + n1 * 0.03 * tr, cam.roll + n3 * 0.04 * tr);
  camera.getWorldDirection(camFwd);
  const backT = p.mode === 'free' ? 7.5 : p.mode === 'chute' ? 7 : ads ? 1.55 : p.dead ? 6 : p.slide ? 2.9 : p.sprinting ? 3.8 : 3.3;
  cam.back += (backT - cam.back) * (1 - Math.exp(-8 * dt));
  const side = p.mode !== 'ground' ? 0 : ads ? 0.55 : 0.68;
  const pivot = _v1.copy(cam.pivot);
  pivot.y += bob;
  const want = _v2.copy(pivot).addScaledVector(camRight, side).addScaledVector(camFwd, -cam.back);
  want.y += ads ? 0.1 : 0.28;
  const dir = _v3.copy(want).sub(pivot); const len = dir.length(); dir.divideScalar(len);
  const h = raycast(pivot, dir, len, null, false);
  const dist = Math.max(0.3, Math.min(len, h.t - 0.25));
  camera.position.copy(pivot).addScaledVector(dir, dist);
  camera.position.addScaledVector(camRight, n1 * 0.12 * tr); camera.position.y += n2 * 0.1 * tr;
  const th = terrainH(camera.position.x, camera.position.z) + 0.3;
  if (camera.position.y < th) camera.position.y = th;
  p.rig.root.visible = dist > 0.9 || p.dropping;
  sun.position.copy(p.pos).addScaledVector(SUN_DIR, 350); sun.target.position.copy(p.pos);
  sky.position.copy(camera.position);
  // speed effects
  let sfx = clamp((hsp - 8.5) / 5, 0, 1);
  if (p.mode === 'free') sfx = keys.KeyW ? 1 : 0.7; else if (p.mode === 'chute') sfx = 0.1;
  if (p.slide) sfx = Math.max(sfx, 0.75);
  if (ads || p.dead) sfx = 0;
  cam.speedFx = (cam.speedFx || 0) + (sfx - (cam.speedFx || 0)) * (1 - Math.exp(-6 * dt));
  drawSpeedLines(cam.speedFx);
  setWind(p.mode === 'free' ? (keys.KeyW ? 0.22 : 0.15) : p.mode === 'chute' ? 0.04 : cam.speedFx * 0.06);
}
const speedCv = $('speed'), sctx = speedCv.getContext('2d');
function sizeSpeed() { speedCv.width = Math.round(innerWidth / 2); speedCv.height = Math.round(innerHeight / 2); }
sizeSpeed(); addEventListener('resize', sizeSpeed);
function drawSpeedLines(k) {
  const Wd = speedCv.width, Ht = speedCv.height;
  if (k < 0.03) { if (speedCv.dataset.on) { sctx.clearRect(0, 0, Wd, Ht); delete speedCv.dataset.on; } return; }
  speedCv.dataset.on = 1; sctx.clearRect(0, 0, Wd, Ht);
  const cx = Wd / 2, cy = Ht / 2, R = Math.hypot(cx, cy), n = Math.floor(20 + 70 * k);
  sctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r0 = R * (0.42 + Math.random() * 0.3), r1 = r0 + R * (0.08 + Math.random() * 0.3) * k;
    sctx.strokeStyle = `rgba(235,245,255,${(0.05 + Math.random() * 0.22) * k})`; sctx.lineWidth = 0.6 + Math.random() * 1.6;
    sctx.beginPath(); sctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); sctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); sctx.stroke();
  }
}

// ───────────────────────────────────────────── HUD
const COMPASS_STEP = 15, COMPASS_PX = 40;
(function buildCompass() {
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let h = '';
  for (let k = 0; k < 3; k++) for (let d = 0; d < 360; d += COMPASS_STEP) h += names[d] ? `<span class="card">${names[d]}</span>` : `<span>${d % 45 === 0 ? d : '·'}</span>`;
  $('compassStrip').innerHTML = h;
})();
function updateCompass(yaw) {
  const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  const px = (heading / COMPASS_STEP) * COMPASS_PX + COMPASS_PX / 2 + (360 / COMPASS_STEP) * COMPASS_PX;
  $('compassStrip').style.transform = `translateX(${$('compass').clientWidth / 2 - px}px)`;
}
const hud = { hurt: 0, hitT: 0, hitHead: false, dmgT: 0, dmgAng: 0, bloom: 0, slow: 0 };
function feed(html, mine) {
  const d = document.createElement('div'); d.innerHTML = html; if (mine) d.className = 'me';
  $('feed').prepend(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 6000);
  while ($('feed').children.length > 6) $('feed').lastChild.remove();
}
let toastTO, bannerTO;
function toast(t) { const e = $('toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toastTO); toastTO = setTimeout(() => (e.style.opacity = 0), 1800); }
function banner(t) { const e = $('banner'); e.textContent = t; e.style.opacity = 1; e.animate([{ transform: 'translateX(-50%) scale(1.5)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,1.6,.4,1)' }); clearTimeout(bannerTO); bannerTO = setTimeout(() => (e.style.opacity = 0), 2200); }
function updateHUD(dt) {
  const p = player;
  hud.slow -= dt; hud.hurt = Math.max(0, hud.hurt - dt); hud.hitT -= dt; hud.dmgT -= dt * 0.8; hud.bloom = Math.max(0, hud.bloom - dt * 3);
  $('vignette').style.boxShadow = `inset 0 0 ${120 + (1 - p.hp / 100) * 120}px rgba(255,30,20,${Math.max(hud.hurt, p.hp < 35 ? 0.35 : 0)})`;
  const hit = $('hit'); hit.style.opacity = hud.hitT > 0 ? 1 : 0; hit.className = hud.hitHead ? 'head' : '';
  const di = $('dmgdir').firstElementChild;
  di.style.opacity = clamp(hud.dmgT, 0, 1);
  di.style.transform = `rotate(${(-(hud.dmgAng - p.yaw) * 180) / Math.PI}deg)`;
  const w = curW();
  $('scope').style.opacity = aiming && w?.def.scope && !p.dropping ? 1 : 0;
  const cxc = 'cx-' + (w?.def.cross || 'gap'); const cr = $('cross'); if (cr.className !== cxc) cr.className = cxc;
  updateCompass(p.yaw);
  cr.style.transform = `translate(-50%,-50%) scale(${1 + hud.bloom * 0.6 + (p.speedNow > 1 ? 0.3 : 0) + (p.onGround ? 0 : 0.5)})`; cr.style.opacity = p.dropping || p.sprinting ? 0 : 1;
  $('zonetint').style.opacity = zone.cur && !p.dead && outsideZone(p.pos) ? 1 : 0;
  $('action').classList.toggle('hidden', !(p.healT > 0 || p.reloadT > 0));
  if (p.healT > 0) { $('actiontxt').textContent = ITEMS[p.healItem].name + ' 사용 중'; $('actionbar').style.width = (1 - p.healT / p.healTotal) * 100 + '%'; }
  else if (p.reloadT > 0 && w) { $('actiontxt').textContent = '재장전'; $('actionbar').style.width = (1 - p.reloadT / w.def.reload) * 100 + '%'; }
  const pr = $('prompt');
  if (p.nearBox && !p.dropping && !invOpen && !p.dead) {
    const c = p.nearBox, left = c.items.length - c.taken.size;
    const first = c.items.find((_, i) => !c.taken.has(i)) || c.items[0];
    pr.classList.remove('hidden');
    pr.innerHTML = c.kind === 'ground' ? `<b>[F]</b> 줍기: ${itemLabel(first)} · <b>[E]</b> 인벤토리` : `<b>[E]</b> ${c.kind === 'crate' ? '보급 상자' : '사망 상자'} 열기 (${left}개) · <b>[F]</b> 바로 줍기`;
  }
  else if (p.mode === 'free') { pr.classList.remove('hidden'); pr.innerHTML = `<b>[W]</b> 급강하 · <b>[Space]</b> 낙하산 펼치기 · 고도 ${Math.round(p.pos.y - groundAt(p.pos.x, p.pos.z, p.pos.y))}m`; }
  else pr.classList.add('hidden');
  if (hud.slow > 0) return;
  hud.slow = 0.1;
  $('alive').textContent = aliveCount(); $('kills').textContent = p.kills; $('myname').textContent = p.name;
  $('hpbar').firstElementChild.style.width = clamp(p.hp, 0, 100) + '%'; $('hpbar').classList.toggle('low', p.hp < 35);
  $('hptxt').textContent = Math.max(0, Math.ceil(p.hp));
  $('arbar').firstElementChild.style.width = (p.gear.vest ? p.gear.vest.d : 0) + '%';
  $('shieldtxt').textContent = p.gear.vest ? Math.round(p.gear.vest.d) : '';
  const cw = curW();
  $('ammobig').innerHTML = cw ? `${cw.mag}<small> / ${ammoOf(cw)}</small><em>${RARITY[cw.r].name} · ${ITEMS[cw.def.ammo].name}</em>` : '';
  $('band').textContent = p.inv.band; $('meds').textContent = p.inv.med;
  $('armor').textContent = p.gear.vest ? 'Lv.' + p.gear.vest.lvl : '-'; $('helm').textContent = p.gear.helm ? 'Lv.' + p.gear.helm.lvl : '-';
  $('spd').textContent = Math.round(Math.hypot(p.vel.x, p.vel.z) * 3.6);
  for (let i = 0; i < 3; i++) {
    const ww = p.inv.slots[i], el = $('slot' + i), img = el.querySelector('img');
    el.classList.toggle('on', i === p.cur); el.classList.toggle('empty', !ww);
    el.style.setProperty('--rc', ww ? RARITY[ww.r].color : '#5b647a');
    const src = ww ? gunIcon(ww.def.id, ww.r) : '';
    if (img.dataset.src !== src) { img.dataset.src = src; if (src) img.src = src; else img.removeAttribute('src'); }
    $('wname' + i).textContent = ww ? ww.def.name : SLOT_NAMES[i];
    $('wammo' + i).innerHTML = ww ? `${ww.mag}<small>/${ammoOf(ww)}</small>` : '';
  }
  const zm = $('zonemsg');
  if (zone.stage === 'final') { zm.textContent = '최종 자기장'; zm.className = 'warn'; }
  else if (zone.stage === 'wait') { zm.textContent = `자기장 축소까지 ${fmt(zone.t)}`; zm.className = ''; }
  else { zm.textContent = `자기장 축소 중 ${fmt(zone.t)}`; zm.className = 'warn'; }
  if (outsideZone(p.pos) && !p.dropping) zm.textContent += '  ·  안전구역 밖!';
  drawMap($('mini'), p.pos.x, p.pos.z, 420, { zone: true, player: true });
  if (!$('bigmap').classList.contains('hidden')) drawMap($('bigmap'), 0, 0, 1700, { zone: true, player: true });
}

// ───────────────────────────────────────────── game flow
let state = 'loading', landing = null, endT = 0, matchStart = 0, matchTotal = 20;
function spawnBots(n, spawn) {
  for (let i = 0; i < n; i++) {
    const b = new Bot(BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ' ' + (i + 1) : ''), 'b' + i);
    let p = null;
    for (let t = 0; t < 60 && !p; t++) { const c = landPoint(0, 0, 700, 700, 2, 1); if (c && c.distanceTo(spawn) > 110) p = c; }
    b.pos.copy(p || landPoint(0, 0, 600, 600, 2, 200)); b.yaw = rand(0, Math.PI * 2); b.onGround = true;
    bots.push(b);
  }
}
function pickSpawn() { return landing || landPoint(0, 0, 500, 500, 4, 200) || new THREE.Vector3(-100, 17, 160); }
function beginPlay() {
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  state = 'play'; canvas.requestPointerLock();
}
// single player
function startGame() {
  if (state !== 'start') return; // ignore double clicks
  state = 'starting';
  NET.on = false; initAudio();
  const seed = (Math.random() * 2 ** 31) | 0;
  zplan = zonePlan(seed, terrainH); placeCrates(seed);
  const spawn = pickSpawn();
  createPlayer(spawn);
  const nb = clamp(+$('spbots').value || 19, 1, 59);
  spawnBots(nb, spawn); matchTotal = nb + 1;
  now = 0; beginPlay();
}
function endGame(win) {
  if (state === 'end') return;
  state = 'ending'; endT = 1.8;
  const rank = win ? 1 : aliveCount() + 1;
  $('endtitle').textContent = win ? '최후의 생존자!' : '사망';
  $('endtitle').style.color = win ? 'var(--accent)' : 'var(--bad)';
  $('endstats').innerHTML = `순위 <b>#${rank}</b> / ${matchTotal}<br>처치 <b>${player.kills}</b><br>생존 시간 <b>${fmt(now)}</b>`;
  if (win) banner('승리!');
}

// ───────────────────────────────────────────── multiplayer
const NET = {
  on: false, ws: null, connected: false, id: null, hostId: null, isHost: false, alive: 0, lobby: [], phase: 'lobby',
  names: new Map(), ips: [], port: location.port || 80, sendT: 0, botT: 0,
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const myName = () => ($('pname').value.trim() || '생존자' + Math.floor(Math.random() * 900 + 100)).slice(0, 12);
function connectNet() {
  if (NET.ws || location.protocol === 'file:') return;
  store.set('gh_name', $('pname').value.trim());
  let ws;
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch { $('lobbyinfo').textContent = '서버에 연결할 수 없습니다.'; return; }
  NET.ws = ws; $('lobby').classList.remove('hidden'); $('lobbyinfo').textContent = '서버에 연결하는 중…';
  ws.onopen = () => NET.send({ t: 'hello', name: myName() });
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
  ws.onclose = () => {
    NET.connected = false; NET.ws = null;
    if (NET.leaving) { NET.leaving = false; $('lobby').classList.add('hidden'); return; }
    renderLobby();
    if (NET.on && state === 'play') banner('서버 연결이 끊겼습니다');
  };
}
function renderLobby() {
  const info = $('lobbyinfo'), list = $('lobbylist');
  if (!NET.connected) { info.innerHTML = '서버와 연결되지 않았습니다. <b>start_game.bat</b>(node serve.js)로 실행했는지 확인하세요.'; list.innerHTML = ''; $('hostctl').classList.add('hidden'); return; }
  const local = /^(localhost|127\.|192\.168\.|10\.|172\.)/.test(location.hostname);
  if (local) {
    const addrs = NET.ips.map(ip => `<code>http://${ip}:${NET.port}</code>`).join(' · ');
    info.innerHTML = `같은 네트워크의 친구는 ${addrs || '이 PC의 IP 주소'} 로 접속하면 됩니다.<br>인터넷 친구와 하려면 <b>start_online.bat</b>로 실행하세요.`;
  } else info.innerHTML = `친구에게 이 주소를 보내세요: <code>${location.origin}</code>`;
  list.innerHTML = NET.lobby.map(p => `<li>${p.id === NET.hostId ? '👑 ' : ''}${escapeHtml(p.name)}${p.id === NET.id ? ' <small>(나)</small>' : ''}${p.inMatch ? ' <small>· 경기 중</small>' : ''}</li>`).join('');
  const amHost = NET.id === NET.hostId;
  $('hostctl').classList.toggle('hidden', !amHost || NET.phase !== 'lobby');
  $('waitmsg').textContent = NET.phase === 'match' ? '경기가 진행 중입니다. 끝나면 다음 경기에 참가할 수 있습니다.' : amHost ? '' : '방장이 경기를 시작하기를 기다리는 중…';
  if (amHost && !$('botn').dataset.touched) { const v = Math.max(0, (+store.get('gh_bots') || 20) - NET.lobby.length); $('botn').value = v; $('botnv').textContent = v; }
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function getRemote(id, name, human) { return actorById.get(id) || new RemoteActor(id, name || id, human); }
function startMatch(m) {
  if (state === 'play' || state === 'ending') return;
  NET.on = true; NET.hostId = m.hostId; NET.isHost = m.hostId === NET.id; NET.alive = m.players.length + m.bots; matchTotal = NET.alive;
  NET.names = new Map(m.players.map(p => [p.id, p.name]));
  initAudio();
  zplan = m.plan; placeCrates(m.seed);
  const spawn = pickSpawn();
  createPlayer(spawn, NET.id, NET.names.get(NET.id) || '나'); actorById.set(NET.id, player);
  for (const p of m.players) if (p.id !== NET.id) getRemote(p.id, p.name, true);
  if (NET.isHost) spawnBots(m.bots, spawn);
  matchStart = performance.now(); now = 0;
  beginPlay();
  toast(NET.isHost ? '방장: 봇 계산을 이 PC가 맡습니다' : `${m.players.length}명 + 봇 ${m.bots}명 경기 시작`);
}
// the new host takes over the bots it has been mirroring
function promoteBots() {
  for (const a of [...actors]) {
    if (!(a instanceof RemoteActor) || a.remoteHuman || a.dead || !a.seen) continue;
    const last = a.snaps[a.snaps.length - 1];
    const b = new Bot(a.name, a.id, WEAPON_IDS[last?.w] || 'rifle');
    b.pos.copy(a.pos); b.yaw = a.yaw; b.hp = last?.hp ?? 100; b.onGround = true;
    scene.remove(a.rig.root); actors.splice(actors.indexOf(a), 1);
    bots.push(b);
  }
}
function onLocalDeath(rank) {
  deathVisual(player, null);
  document.exitPointerLock();
  $('endtitle').textContent = '사망'; $('endtitle').style.color = 'var(--bad)';
  $('endstats').innerHTML = `순위 <b>#${rank}</b> / ${matchTotal}<br>처치 <b>${player.kills}</b><br>생존 시간 <b>${fmt(now)}</b><br><small>경기는 계속 진행 중입니다</small>`;
  $('spectate').classList.remove('hidden');
  setTimeout(() => $('end').classList.remove('hidden'), 1500);
}
function onNet(m) {
  switch (m.t) {
    case 'welcome': NET.connected = true; NET.id = m.id; NET.hostId = m.hostId; NET.phase = m.phase; NET.ips = m.ips || []; NET.port = m.port; renderLobby(); break;
    case 'lobby': NET.lobby = m.players; NET.hostId = m.hostId; NET.phase = m.phase; renderLobby(); break;
    case 'host': {
      const was = NET.isHost; NET.hostId = m.hostId; NET.isHost = NET.on && m.hostId === NET.id;
      if (NET.isHost && !was) { promoteBots(); toast('방장이 되었습니다 — 봇 계산을 이어받습니다'); }
      renderLobby(); break;
    }
    case 'start': startMatch(m); break;
    case 'state': if (NET.on && m.id !== NET.id) getRemote(m.id, NET.names.get(m.id), true).push(m); break;
    case 'bots': if (NET.on && !NET.isHost) for (const s of m.b) getRemote(s.id, s.n, false).push(s); break;
    case 'shot': {
      if (!NET.on) return;
      const a = actorById.get(m.s); if (!a || a === player) return;
      const def = WEAPONS[m.w]; if (!def) return;
      const o = new THREE.Vector3(...m.o);
      if (m.boom) { explode(o, a, def, true); break; }
      a.rig.fire(); sound(def.snd, o);
      if (m.rk) { spawnRocket(a, o, new THREE.Vector3(...m.rk), def, true); break; }
      for (const e of m.e) {
        const end = new THREE.Vector3(e[0], e[1], e[2]);
        tracer(_v3.copy(end).sub(o).normalize().multiplyScalar(0.3).add(o), end, def.id === 'dmr' ? 1.6 : 1);
        if (e[3] === 1) puff(end, 0xa01818, 6, 2.5); else if (e[3] === 2) puff(end, 0xc9c0aa, 4, 2);
      }
      break;
    }
    case 'hp': {
      if (!player) return;
      const prev = player.hp; player.hp = m.hp;
      // server-side armour wear: keep the local gear in sync (null = broken)
      if (m.gear) for (const key of ['vest', 'helm']) {
        const pc = player.gear[key], sv = m.gear[key];
        if (!sv) { if (pc) toast(ITEMS[key + pc.lvl].name + '이(가) 파괴되었습니다'); player.gear[key] = null; }
        else if (pc && pc.lvl === sv.lvl) pc.d = sv.d;
      }
      if (m.hp < prev - 0.01) {
        hud.hurt = m.zone ? Math.max(hud.hurt, 0.3) : 0.6; shake(m.zone ? 0.08 : 0.28);
        const a = m.by && actorById.get(m.by);
        if (a) { hud.dmgAng = Math.atan2(-(a.pos.x - player.pos.x), -(a.pos.z - player.pos.z)); hud.dmgT = 1; }
        if (!m.zone) { healCancel(); player.rig.hit(Math.random() < 0.5 ? -1 : 1); }
      }
      break;
    }
    case 'botHit': {
      if (!NET.isHost) return;
      const b = actorById.get(m.target); if (!(b instanceof Bot)) return;
      damage(b, m.dmg, actorById.get(m.by) || null, m.w, m.head);
      break;
    }
    case 'kill': {
      if (!NET.on) return;
      NET.alive = m.alive;
      const v = actorById.get(m.victim), by = m.by ? actorById.get(m.by) : null;
      if (v) deathVisual(v, by);
      if (m.by === NET.id && m.victim !== NET.id) { player.kills++; killBanner(m.victimName); }
      const hn = (id, n) => (n && String(id).startsWith('p') ? `<b class="hn">${escapeHtml(n)}</b>` : n && escapeHtml(n));
      feed(deathText(hn(m.by, m.byName), m.w, hn(m.victim, m.victimName)), m.by === NET.id || m.victim === NET.id);
      if (m.victim === NET.id) { placeBox('death', groundPos(player.pos, 0.2), playerLoot()); onLocalDeath(m.rank); }
      break;
    }
    case 'took': markTaken(containers.get(m.c), m.i, m.by === NET.id); break;
    case 'box': if (NET.on) spawnContainer(m.kind, new THREE.Vector3(...m.pos), m.items, m.id); break;
    case 'end': {
      if (!NET.on) return;
      const win = m.winner === NET.id;
      $('endtitle').textContent = win ? '최후의 생존자!' : m.winnerName ? `${m.winnerName} 승리` : '경기 종료 — 생존한 플레이어 없음';
      $('endtitle').style.color = win ? 'var(--accent)' : 'var(--fg)';
      $('endstats').innerHTML = `처치 순위<br>` + (m.board || []).map((r, i) => `${i + 1}. <b>${escapeHtml(r.name)}</b> — ${r.kills}킬`).join('<br>') + `<br><br>내 생존 시간 <b>${fmt(now)}</b>`;
      $('spectate').classList.add('hidden');
      if (win) banner('승리!');
      state = 'end'; document.exitPointerLock(); drawSpeedLines(0); setWind(0);
      setTimeout(() => { $('hud').classList.add('hidden'); $('end').classList.remove('hidden'); }, win ? 1800 : 300);
      break;
    }
  }
}
function netTick(dt) {
  NET.sendT -= dt;
  if (NET.sendT <= 0) { NET.sendT = 1 / 15; NET.send({ t: 'state', ...packState(player) }); }
  if (NET.isHost) {
    NET.botT -= dt;
    if (NET.botT <= 0) { NET.botT = 0.1; NET.send({ t: 'bots', b: bots.filter(b => !b.dead || !b.sentDead).map(b => { if (b.dead) b.sentDead = true; return { ...packState(b), n: b.name, hp: Math.round(b.hp) }; }) }); }
  }
}

canvas.addEventListener('click', () => { if (state === 'play' && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
$('resume').addEventListener('click', () => canvas.requestPointerLock());
$('pause').addEventListener('click', e => { if (e.target.tagName !== 'INPUT') canvas.requestPointerLock(); });
let lockChangeT = 0;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  lockChangeT = performance.now();
  $('pause').classList.toggle('hidden', locked || invOpen || state !== 'play' || (player && player.dead));
  $('pausenote').textContent = NET.on ? '멀티 경기 중에는 게임이 멈추지 않습니다!' : '';
  if (!locked) { firing = false; aiming = false; if (!invOpen) for (const k in keys) keys[k] = false; }
});
// keys released while the window lost focus never send keyup: clear them so nobody runs on by themselves
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; aiming = false; });
for (const id of ['sens', 'sens2']) $(id).addEventListener('input', e => { sens = +e.target.value; $('sens').value = $('sens2').value = sens; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  if (performance.now() - lockChangeT < 120) return;
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  mouseDX += e.movementX; mouseDY += e.movementY;
});
addEventListener('mousedown', e => {
  if (document.pointerLockElement !== canvas || state !== 'play') return;
  if (e.button === 0) { firing = true; if (player.healT > 0) healCancel(); }
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', e => { if (e.button === 0) firing = false; if (e.button === 2) aiming = false; });
addEventListener('contextmenu', e => e.preventDefault());
let wheelT = 0;
addEventListener('wheel', e => {
  if (invOpen) return;
  if (state !== 'play' || !player || performance.now() - wheelT < 250) return;
  wheelT = performance.now();
  for (let k = 1; k <= 3; k++) { const n = (player.cur + (e.deltaY > 0 ? k : 3 - k)) % 3; if (player.inv.slots[n]) { switchTo(n); break; } }
});
addEventListener('keydown', e => {
  if (state !== 'play' || !player || player.dead) return;
  if (invOpen && !['Tab', 'KeyE', 'Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'].includes(e.code)) return;
  if (e.repeat && e.code !== 'KeyW') { if (['Space', 'KeyC'].includes(e.code)) e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'Digit1') switchTo(0);
  if (e.code === 'Digit2') switchTo(1);
  if (e.code === 'KeyC') player.wantSlide = true;
  if (e.code === 'Digit3') switchTo(2);
  if (e.code === 'Tab') { e.preventDefault(); invOpen ? closeInv() : openInv(); }
  if (e.code === 'KeyE') { if (invOpen) closeInv(); else if (player.nearBox && !player.dropping) openInv(); }
  if (e.code === 'KeyF' && player.nearBox && !player.dropping) { const c = player.nearBox, i = c.items.findIndex((_, j) => !c.taken.has(j)); if (i >= 0) takeItem(c, i); }
  if (e.code === 'KeyG' && !player.dropping) dropWeapon(player.cur);
  if (e.code === 'KeyQ' && !player.dropping) quickHeal();
  if (e.code === 'Escape' && invOpen) closeInv(false);
  if (e.code === 'KeyM') $('bigmap').classList.toggle('hidden');
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

const pickCv = $('pickmap');
pickCv.addEventListener('click', e => {
  const r = pickCv.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 1700 - 850, z = ((e.clientY - r.top) / r.height) * 1700 - 850;
  if (terrainH(x, z) < 0.5) { landing = null; drawMap(pickCv, 0, 0, 1700); return; }
  landing = new THREE.Vector3(x, 0, z); drawMap(pickCv, 0, 0, 1700, { mark: landing });
});
$('go').addEventListener('click', startGame);
// headcount sliders remember their value
for (const [id, key, def] of [['spbots', 'gh_spbots', 19], ['botn', 'gh_bots', 19]]) {
  const el = $(id), out = $(id + 'v'), saved = +store.get(key);
  if (saved && !Number.isNaN(saved)) { el.value = saved; if (id === 'botn') el.dataset.touched = 1; }
  out.textContent = el.value;
  el.addEventListener('input', () => { out.textContent = el.value; store.set(key, el.value); });
}
$('leavelobby').addEventListener('click', () => { if (NET.ws) { NET.leaving = true; NET.ws.close(); } else $('lobby').classList.add('hidden'); });
// two-step confirm so a stray click does not end the match
let quitArm = 0;
$('quit').addEventListener('click', e => {
  e.stopPropagation();
  if (performance.now() - quitArm > 3000) { quitArm = performance.now(); $('quit').textContent = '한 번 더 누르면 나갑니다'; setTimeout(() => ($('quit').textContent = '경기 나가기'), 3000); return; }
  try { sessionStorage.setItem('gh_rejoin', NET.on || NET.connected ? '1' : ''); } catch {}
  if (NET.ws) NET.ws.close();
  location.reload();
});
$('join').addEventListener('click', connectNet);
$('mstart').addEventListener('click', () => NET.send({ t: 'start', bots: +$('botn').value }));
$('botn').addEventListener('input', e => { e.target.dataset.touched = 1; });
$('spectate').addEventListener('click', () => { $('end').classList.add('hidden'); });
$('again').addEventListener('click', () => { try { sessionStorage.setItem('gh_rejoin', NET.connected || NET.on ? '1' : ''); } catch {} location.reload(); });
$('pname').value = store.get('gh_name') || '';

// ───────────────────────────────────────────── main loop
const clock = new THREE.Clock();
// ?test : run without pointer lock and expose internals for automated checks
const TEST = new URLSearchParams(location.search).has('test');
if (TEST) window.__g = { NET, actorById, get player() { return player; }, bots, zone, containers, actors, addItem, openInv, closeInv, dropWeapon, takeItem, nearbyContainers, keys, terrainH, groundAt, setFiring: v => (firing = v), setAiming: v => (aiming = v), get state() { return state; }, startGame, camera };
function loop() {
  requestAnimationFrame(loop);
  const _t0 = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);
  const running = (state === 'play' && (NET.on || TEST || invOpen || document.pointerLockElement === canvas)) || state === 'ending';
  if (state === 'play' || state === 'ending') {
    if (running) {
      now = NET.on ? (performance.now() - matchStart) / 1000 : now + dt;
      updatePlayer(dt);
      for (const b of bots) b.update(dt);
      for (const a of actors) if (a instanceof RemoteActor) a.update(dt);
      if (NET.on && state === 'play') netTick(dt);
      updateZone(dt);
      updateHUD(dt);
      updateTags(dt); updateAimName(dt);
      if (state === 'ending') { endT -= dt; if (endT <= 0) { state = 'end'; document.exitPointerLock(); $('hud').classList.add('hidden'); $('end').classList.remove('hidden'); drawSpeedLines(0); setWind(0); } }
    }
    updateCamera(dt);
    updateFx(running ? dt : 0);
  } else if (state === 'start' || state === 'end') {
    const t = performance.now() * 0.00004;
    camera.position.set(Math.cos(t) * 700, 380, Math.sin(t) * 700); camera.lookAt(0, 20, 0);
    sun.position.set(0, 0, 0).addScaledVector(SUN_DIR, 400); sun.target.position.set(0, 0, 0);
    sky.position.copy(camera.position);
  }
  const tt = performance.now() / 1000;
  skyFx.update(tt, camera.position);
  waterFx?.update(tt); grassFx?.update(tt, camera.position);
  natureFx?.update(tt, camera.position.x, camera.position.z);
  post.render();
  if (TEST) { const ms = performance.now() - _t0; window.__perf = { ms, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; }
}

// ───────────────────────────────────────────── boot
(async function boot() {
  const sizes = { 'assets/world.json': 0.55e6, 'assets/terrain.glb': 1.37e6, 'assets/static.glb': 1.95e6, 'assets/props.glb': 3.55e6, 'assets/nature.glb': 2.6e6, 'assets/character.glb': 1.7e6 };
  const got = {}; const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const prog = (u, n) => { got[u] = n; const f = Object.values(got).reduce((a, b) => a + b, 0) / total; $('loadbar').firstElementChild.style.width = Math.min(100, f * 100) + '%'; };
  try {
    const [wbuf, tbuf, sbuf, pbuf, nbuf, cbuf] = await Promise.all(Object.keys(sizes).map(u => fetchBuf(u, prog)));
    const world = JSON.parse(new TextDecoder().decode(wbuf));
    $('loadtxt').textContent = '섬을 조립하는 중…';
    initWorld(world);
    const [tg, sg, pg, ng, cg] = await Promise.all([parseGLB(tbuf), parseGLB(sbuf), parseGLB(pbuf), parseGLB(nbuf), parseGLB(cbuf)]);
    initCharacter(cg);
    setupTerrain(tg); setupStatic(sg);
    natureFx = setupNature(scene, ng, setupProps(pg, world.props));
    const hTex = makeHeightTexture(W);
    const cover = [sg.scene, ...scene.children.filter(o => o.isInstancedMesh)];
    const mask = makeCoverMask(renderer, cover);
    waterFx = makeWater(scene, hTex, SEA);
    if (QUALITY !== 'low') grassFx = makeGrass(scene, hTex, mask, QUALITY === 'high' ? 120000 : 60000);
    buildBaseMap(); drawMap(pickCv, 0, 0, 1700);
    $('loading').classList.add('hidden'); $('start').classList.remove('hidden');
    state = 'start';
    let rejoin = ''; try { rejoin = sessionStorage.getItem('gh_rejoin'); sessionStorage.removeItem('gh_rejoin'); } catch {}
    if (rejoin) connectNet();
  } catch (err) {
    console.error(err);
    $('loadtxt').innerHTML = `불러오기 실패: ${err.message}<br><small>index.html을 파일로 직접 열면 안 됩니다. 폴더의 <b>start_game.bat</b>(로컬 서버)로 실행하세요.</small>`;
  }
  loop();
})();

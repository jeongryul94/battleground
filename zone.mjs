// Shared by the browser (game.js) and the Node server (serve.js):
// seeded RNG, deterministic zone plan, and zone state as a pure function of match time.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PHASES = [
  [45, 35, 520, 1], [35, 30, 300, 2], [30, 25, 170, 4],
  [25, 22, 90, 7], [20, 18, 40, 10], [15, 22, 0, 15],
]; // wait s, shrink s, radius m, damage per second

// terrainH(x, z) -> height; centres are kept on land
export function zonePlan(seed, terrainH) {
  const rng = mulberry32(seed ^ 0x5eed);
  let cur = { x: 0, z: 0, r: 900 };
  const out = [];
  for (const [wait, shrink, r, dps] of PHASES) {
    let nx = cur.x, nz = cur.z;
    for (let t = 0; t < 60; t++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * Math.max(0, cur.r - r) * 0.9;
      const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      if (terrainH(x, z) > 3 || t === 59) { nx = x; nz = z; break; }
    }
    out.push({ wait, shrink, r, dps, x: Math.round(nx * 10) / 10, z: Math.round(nz * 10) / 10 });
    cur = { x: nx, z: nz, r };
  }
  return out;
}

export function zoneAt(plan, t) {
  let cur = { x: 0, z: 0, r: 900 }, dps = 0.5;
  for (let i = 0; i < plan.length; i++) {
    const ph = plan[i], next = { x: ph.x, z: ph.z, r: ph.r };
    if (t < ph.wait) return { phase: i, stage: 'wait', left: ph.wait - t, cur, next, dps };
    t -= ph.wait; dps = ph.dps;
    if (t < ph.shrink) {
      const k = t / ph.shrink;
      return { phase: i, stage: 'shrink', left: ph.shrink - t, next, dps,
        cur: { x: cur.x + (next.x - cur.x) * k, z: cur.z + (next.z - cur.z) * k, r: cur.r + (next.r - cur.r) * k } };
    }
    t -= ph.shrink; cur = next;
  }
  return { phase: plan.length, stage: 'final', left: 0, cur, next: null, dps };
}

// same bilinear lookup the client uses
export function makeTerrainH(grid, heights) {
  const n = grid.n, min = grid.min, step = grid.size / (n - 1);
  return (x, z) => {
    const fi = (x - min) / step, fj = (-z - min) / step;
    if (fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) return -6;
    const i = Math.min(n - 2, Math.floor(fi)), j = Math.min(n - 2, Math.floor(fj)), tx = fi - i, ty = fj - j;
    const a = heights[j * n + i], b = heights[j * n + i + 1], c = heights[(j + 1) * n + i], e = heights[(j + 1) * n + i + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
  };
}

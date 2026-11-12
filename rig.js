// Procedural character rig: rounded low-poly soldier, per-weapon gun models,
// gait cycle, upper/lower body split, two-bone arm IK onto the gun, recoil,
// reload / heal / sprint poses, freefall + parachute poses and a ragdoll-style death.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const rand = (a, b) => a + Math.random() * (b - a);

// ───────────────────────── shared geometry / materials
const gc = {};
const G = {
  rbox: (w, h, d, r = 0.03) => (gc[`rb${w},${h},${d},${r}`] ||= new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))),
  cap: (r, l) => (gc[`cp${r},${l}`] ||= new THREE.CapsuleGeometry(r, l, 4, 10)),
  sph: r => (gc[`sp${r}`] ||= new THREE.SphereGeometry(r, 18, 14)),
  cyl: (r1, r2, h, s = 10) => (gc[`cy${r1},${r2},${h},${s}`] ||= new THREE.CylinderGeometry(r1, r2, h, s)),
  helmet: () => (gc.helmet ||= new THREE.SphereGeometry(0.138, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)),
};
const mc = {};
export const M = (c, r = 0.75, m = 0.05) => (mc[`${c}|${r}|${m}`] ||= new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const grp = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

// muzzle flash texture
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,200,90,.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter'; x.strokeStyle = 'rgba(255,220,140,.8)'; x.lineWidth = 3;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); x.stroke(); }
  return new THREE.CanvasTexture(c);
})();
const flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

// ───────────────────────── weapons (chunky cartoon guns, rarity-coloured accents)
export const RARITY_COLORS = ['#b8bcc4', '#5bd15b', '#4aa3ff', '#b65cff', '#ffb52e'];
export const HOLD = {
  pistol: [0.05, -0.02, -0.44], revolver: [0.05, -0.02, -0.44],
  smg: [0.11, -0.07, -0.3], tsmg: [0.11, -0.07, -0.3],
  rifle: [0.11, -0.07, -0.27], burst: [0.11, -0.07, -0.27], lmg: [0.12, -0.09, -0.24],
  shotgun: [0.11, -0.07, -0.27], tac: [0.11, -0.07, -0.27],
  dmr: [0.11, -0.07, -0.26], sniper: [0.11, -0.07, -0.25], rocket: [0.13, 0.02, -0.12],
};
export function makeGun(id, rarity = 0) {
  const g = new THREE.Group();
  const body = M('#3b414d', 0.5, 0.25), dark = M('#22262d', 0.4, 0.4), mid = M('#5d6573', 0.55, 0.2);
  const wood = M('#a8683a', 0.7), tan = M('#c9a46a', 0.75), olive = M('#5d7a46', 0.7), red = M('#d9483b', 0.6);
  const rar = M(RARITY_COLORS[rarity] || RARITY_COLORS[0], 0.35, 0.15);
  const box = (w, h, d, x, y, z, m = body, rx = 0) => mesh(g, G.rbox(w, h, d, Math.min(w, h, d) * 0.32), m, x, y, z, rx);
  const tube = (r, len, x, y, z, m = dark) => mesh(g, G.cyl(r, r, len, 12), m, x, y, z, Math.PI / 2);
  const anchor = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); g.add(o); return o; };
  let u;
  switch (id) {
    case 'pistol':
      box(0.04, 0.055, 0.21, 0, 0.055, -0.07, mid); box(0.036, 0.04, 0.18, 0, 0.022, -0.06);
      box(0.036, 0.12, 0.055, 0, -0.035, 0.0, rar, 0.25); tube(0.01, 0.03, 0, 0.056, -0.19);
      u = { r: anchor(0, -0.03, 0.01), l: anchor(-0.03, -0.04, -0.01), muzzle: anchor(0, 0.056, -0.21), mag: anchor(0, -0.1, 0.02) };
      break;
    case 'revolver':
      tube(0.016, 0.24, 0, 0.06, -0.15); box(0.05, 0.05, 0.1, 0, 0.05, -0.02, mid);
      mesh(g, G.cyl(0.035, 0.035, 0.07, 8), rar, 0, 0.045, -0.035, Math.PI / 2);
      box(0.038, 0.12, 0.05, 0, -0.03, 0.04, wood, 0.35); box(0.02, 0.03, 0.04, 0, 0.09, -0.24, dark);
      u = { r: anchor(0, -0.04, 0.05), l: anchor(-0.03, -0.05, 0.03), muzzle: anchor(0, 0.06, -0.28), mag: anchor(0, 0.04, -0.03) };
      break;
    case 'smg':
      box(0.055, 0.085, 0.3, 0, 0.04, -0.08); box(0.036, 0.19, 0.05, 0, -0.09, -0.13, rar, -0.12);
      box(0.034, 0.1, 0.05, 0, -0.04, 0.03, dark, 0.25); tube(0.016, 0.14, 0, 0.05, -0.29);
      box(0.02, 0.045, 0.2, 0, 0.03, 0.15, dark); box(0.045, 0.085, 0.025, 0, 0.02, 0.25, dark);
      u = { r: anchor(0, -0.05, 0.04), l: anchor(0, -0.03, -0.2), muzzle: anchor(0, 0.05, -0.37), mag: anchor(0, -0.18, -0.14) };
      break;
    case 'tsmg':
      box(0.06, 0.1, 0.26, 0, 0.04, -0.06, mid); box(0.05, 0.05, 0.16, 0, 0.07, -0.24); box(0.04, 0.16, 0.06, 0, -0.08, -0.06, rar, -0.3);
      box(0.034, 0.1, 0.05, 0, -0.03, 0.06, dark, 0.25); box(0.03, 0.05, 0.12, 0, 0.13, -0.06, dark); tube(0.014, 0.08, 0, 0.07, -0.34);
      u = { r: anchor(0, -0.05, 0.07), l: anchor(0, 0.02, -0.24), muzzle: anchor(0, 0.07, -0.39), mag: anchor(0, -0.16, -0.08) };
      break;
    case 'rifle':
      box(0.055, 0.09, 0.42, 0, 0.04, -0.1); box(0.062, 0.072, 0.25, 0, 0.035, -0.38, olive);
      tube(0.013, 0.22, 0, 0.045, -0.6); tube(0.024, 0.06, 0, 0.045, -0.72);
      box(0.038, 0.18, 0.065, 0, -0.09, -0.15, rar, 0.3); box(0.034, 0.11, 0.05, 0, -0.05, 0.05, dark, 0.3);
      box(0.05, 0.105, 0.23, 0, 0.02, 0.22, olive); box(0.034, 0.04, 0.11, 0, 0.11, -0.08, dark);
      u = { r: anchor(0, -0.07, 0.06), l: anchor(0, -0.02, -0.4), muzzle: anchor(0, 0.045, -0.77), mag: anchor(0, -0.19, -0.18) };
      break;
    case 'burst':
      box(0.065, 0.1, 0.5, 0, 0.04, -0.12, mid); box(0.07, 0.06, 0.2, 0, 0.1, -0.12, rar);
      tube(0.015, 0.16, 0, 0.04, -0.45); box(0.04, 0.14, 0.06, 0, -0.07, 0.0, dark, 0.15);
      box(0.034, 0.1, 0.05, 0, -0.06, 0.1, dark, 0.3); box(0.055, 0.1, 0.18, 0, 0.03, 0.24, body);
      u = { r: anchor(0, -0.06, 0.1), l: anchor(0, -0.01, -0.3), muzzle: anchor(0, 0.04, -0.54), mag: anchor(0, -0.15, 0.0) };
      break;
    case 'lmg':
      box(0.08, 0.12, 0.46, 0, 0.04, -0.08); tube(0.02, 0.4, 0, 0.05, -0.5); tube(0.03, 0.06, 0, 0.05, -0.72);
      mesh(g, G.cyl(0.07, 0.07, 0.08, 16), rar, 0.0, -0.08, -0.08, 0, 0, Math.PI / 2);
      box(0.04, 0.11, 0.05, 0, -0.05, 0.08, dark, 0.3); box(0.06, 0.12, 0.24, 0, 0.02, 0.26, olive);
      box(0.012, 0.16, 0.012, 0.03, -0.06, -0.62, dark, 0.4); box(0.012, 0.16, 0.012, -0.03, -0.06, -0.62, dark, 0.4);
      u = { r: anchor(0, -0.06, 0.1), l: anchor(0, -0.0, -0.36), muzzle: anchor(0, 0.05, -0.76), mag: anchor(0, -0.12, -0.08) };
      break;
    case 'shotgun':
      tube(0.024, 0.64, 0, 0.065, -0.36); tube(0.018, 0.46, 0, 0.028, -0.3, mid);
      box(0.07, 0.07, 0.17, 0, 0.03, -0.42, rar); box(0.06, 0.1, 0.22, 0, 0.05, 0.0);
      box(0.052, 0.13, 0.3, 0, 0.0, 0.25, wood, 0.12); box(0.036, 0.1, 0.05, 0, -0.04, 0.08, wood, 0.3);
      u = { r: anchor(0, -0.06, 0.08), l: anchor(0, 0.0, -0.42), muzzle: anchor(0, 0.065, -0.69), mag: anchor(0, -0.02, -0.1) };
      break;
    case 'tac':
      box(0.07, 0.11, 0.42, 0, 0.04, -0.1, mid); tube(0.026, 0.3, 0, 0.06, -0.42);
      box(0.05, 0.16, 0.08, 0, -0.08, -0.12, rar, 0.1); box(0.036, 0.1, 0.05, 0, -0.05, 0.07, dark, 0.3);
      box(0.06, 0.1, 0.2, 0, 0.02, 0.22, body); box(0.08, 0.03, 0.2, 0, 0.11, -0.12, dark);
      u = { r: anchor(0, -0.06, 0.08), l: anchor(0, 0.0, -0.32), muzzle: anchor(0, 0.06, -0.58), mag: anchor(0, -0.16, -0.12) };
      break;
    case 'dmr':
      box(0.055, 0.09, 0.48, 0, 0.04, -0.09, tan); tube(0.014, 0.46, 0, 0.045, -0.55); tube(0.024, 0.06, 0, 0.045, -0.79);
      tube(0.032, 0.28, 0, 0.14, -0.07, dark); tube(0.04, 0.05, 0, 0.14, -0.22, rar); tube(0.038, 0.05, 0, 0.14, 0.08, dark);
      box(0.038, 0.11, 0.08, 0, -0.05, -0.13, dark); box(0.034, 0.11, 0.05, 0, -0.05, 0.06, dark, 0.3); box(0.055, 0.12, 0.28, 0, 0.01, 0.25, tan);
      u = { r: anchor(0, -0.07, 0.07), l: anchor(0, -0.02, -0.36), muzzle: anchor(0, 0.045, -0.83), mag: anchor(0, -0.12, -0.13) };
      break;
    case 'sniper':
      box(0.06, 0.09, 0.42, 0, 0.04, -0.05, olive); tube(0.016, 0.66, 0, 0.05, -0.6); tube(0.03, 0.08, 0, 0.05, -0.95);
      tube(0.04, 0.34, 0, 0.15, -0.05, dark); tube(0.05, 0.06, 0, 0.15, -0.24, rar); tube(0.048, 0.06, 0, 0.15, 0.13, dark);
      box(0.012, 0.05, 0.03, 0.05, 0.07, 0.06, mid); box(0.034, 0.11, 0.05, 0, -0.05, 0.08, dark, 0.3); box(0.06, 0.13, 0.3, 0, 0.0, 0.3, olive);
      u = { r: anchor(0, -0.07, 0.09), l: anchor(0, -0.02, -0.32), muzzle: anchor(0, 0.05, -1.0), mag: anchor(0, -0.08, -0.1) };
      break;
    case 'rocket':
      mesh(g, G.cyl(0.075, 0.075, 0.9, 14), olive, 0, 0.04, -0.15, Math.PI / 2);
      mesh(g, G.cyl(0.09, 0.075, 0.1, 14), rar, 0, 0.04, -0.62, Math.PI / 2);
      mesh(g, G.cyl(0.085, 0.085, 0.08, 14), dark, 0, 0.04, 0.32, Math.PI / 2);
      box(0.04, 0.12, 0.05, 0, -0.07, -0.05, dark, 0.2); box(0.04, 0.1, 0.05, 0, -0.06, -0.3, dark, 0.2);
      box(0.03, 0.05, 0.12, 0.08, 0.1, -0.15, dark); mesh(g, G.sph(0.06), red, 0, 0.04, -0.66);
      u = { r: anchor(0, -0.1, -0.03), l: anchor(0, -0.09, -0.3), muzzle: anchor(0, 0.04, -0.72), mag: anchor(0, 0.04, 0.38) };
      break;
    default: return makeGun('pistol', rarity);
  }
  g.userData = u;
  return g;
}

// side-view icon (data URL) for the HUD, rendered once per weapon+rarity
let iconRenderer = null, iconScene, iconCam;
const iconCache = {};
export function gunIcon(id, rarity = 0) {
  const key = id + ':' + rarity;
  if (iconCache[key]) return iconCache[key];
  if (!iconRenderer) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    iconRenderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    iconRenderer.setClearColor(0x000000, 0); iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
    iconScene = new THREE.Scene();
    iconScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 2); iconScene.add(d);
    iconCam = new THREE.OrthographicCamera(-0.62, 0.62, 0.31, -0.31, 0.01, 10);
    iconCam.position.set(3, 0.4, 0); iconCam.lookAt(0, 0, 0);
  }
  const gun = makeGun(id, rarity);
  const box = new THREE.Box3().setFromObject(gun), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const s = 1.1 / Math.max(size.z, size.y * 2);
  gun.scale.setScalar(s); gun.position.copy(ctr).multiplyScalar(-s);
  iconScene.add(gun); iconRenderer.render(iconScene, iconCam); iconScene.remove(gun);
  return (iconCache[key] = iconRenderer.domElement.toDataURL());
}

// ───────────────────────── two-bone IK
const DOWN = new THREE.Vector3(0, -1, 0);
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _qi = new THREE.Quaternion();
function solveArm(arm, targetWorld, pole) {
  const chest = arm.sh.parent;
  _t.copy(targetWorld); chest.worldToLocal(_t);
  _d.copy(_t).sub(arm.sh.position);
  const L1 = arm.L1, L2 = arm.L2;
  const dist = clamp(_d.length(), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.002);
  _d.normalize();
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(_d).multiplyScalar(Math.cos(a) * L1).addScaledVector(_p, Math.sin(a) * L1);
  arm.sh.quaternion.setFromUnitVectors(DOWN, _f.copy(_e).normalize());
  _f.copy(_d).multiplyScalar(dist).sub(_e).normalize();
  _qi.copy(arm.sh.quaternion).invert(); _f.applyQuaternion(_qi);
  arm.el.quaternion.setFromUnitVectors(DOWN, _f);
}
const POLE_R = new THREE.Vector3(0.75, -1, 0.35).normalize();
const POLE_L = new THREE.Vector3(-0.85, -1, 0.1).normalize();

// ───────────────────────── rig
const L1 = 0.29, L2 = 0.27;
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _eul = new THREE.Euler();
const lerp = (a, b, k) => a + (b - a) * k;

export class Rig {
  constructor(parent, c) {
    const root = this.root = new THREE.Group(); root.rotation.order = 'YXZ'; parent.add(root);
    const hips = this.hips = grp(root, 0, 0.92, 0);
    mesh(hips, G.rbox(0.3, 0.19, 0.2, 0.06), M(c.pants), 0, 0, 0);
    mesh(hips, G.rbox(0.33, 0.05, 0.23, 0.02), M('#2a2723', 0.6), 0, 0.075, 0);
    mesh(hips, G.rbox(0.07, 0.08, 0.05, 0.015), M(c.vest), 0.13, 0.05, -0.1);
    this.legs = [];
    for (const s of [-1, 1]) {
      const th = grp(hips, 0.095 * s, -0.03, 0);
      mesh(th, G.cap(0.078, 0.28), M(c.pants), 0, -0.21, 0);
      mesh(th, G.rbox(0.06, 0.12, 0.1, 0.02), M(c.vest), 0.075 * s, -0.2, 0);
      const kn = grp(th, 0, -0.44, 0);
      mesh(kn, G.cap(0.064, 0.3), M(c.pants), 0, -0.2, 0);
      mesh(kn, G.rbox(0.1, 0.11, 0.06, 0.025), M('#2b2e2c', 0.6), 0, -0.02, -0.06);
      const an = grp(kn, 0, -0.42, 0);
      mesh(an, G.rbox(0.115, 0.1, 0.26, 0.035), M('#26221e', 0.9), 0, -0.015, -0.05);
      mesh(an, G.rbox(0.12, 0.03, 0.27, 0.01), M('#151515', 0.95), 0, -0.06, -0.05);
      this.legs.push({ th, kn, an, s });
    }
    const spine = this.spine = grp(hips, 0, 0.08, 0);
    mesh(spine, G.cap(0.128, 0.1), M(c.shirt), 0, 0.08, 0);
    const chest = this.chest = grp(spine, 0, 0.18, 0);
    mesh(chest, G.rbox(0.37, 0.37, 0.22, 0.09), M(c.shirt), 0, 0.12, 0);
    mesh(chest, G.rbox(0.4, 0.31, 0.27, 0.06), M(c.vest), 0, 0.09, 0);
    for (const x of [-0.105, 0, 0.105]) mesh(chest, G.rbox(0.085, 0.11, 0.05, 0.015), M(c.vest2), x, 0.0, -0.15);
    mesh(chest, G.rbox(0.07, 0.06, 0.04, 0.012), M(c.accent), -0.12, 0.17, -0.145);
    mesh(chest, G.rbox(0.31, 0.4, 0.17, 0.06), M(c.pack), 0, 0.1, 0.205);
    mesh(chest, G.rbox(0.24, 0.14, 0.05, 0.02), M(c.pack), 0, 0.0, 0.3);
    mesh(chest, G.cyl(0.065, 0.065, 0.32, 12), M(c.accent), 0, 0.33, 0.2, 0, 0, Math.PI / 2);
    const neck = this.neck = grp(chest, 0, 0.33, 0);
    mesh(neck, G.cyl(0.05, 0.056, 0.09, 10), M(c.skin), 0, 0.03, 0);
    mesh(neck, G.cyl(0.07, 0.08, 0.05, 12), M(c.accent), 0, 0.0, 0);
    const head = this.head = grp(neck, 0, 0.1, 0);
    mesh(head, G.sph(0.11), M(c.skin, 0.6), 0, 0.01, 0, 0, 0, 0, 1, 1.12, 1.05);
    mesh(head, G.rbox(0.21, 0.055, 0.05, 0.02), M('#0d1216', 0.15, 0.6), 0, 0.035, -0.1);
    mesh(head, G.rbox(0.16, 0.035, 0.03, 0.01), M('#5fb8d8', 0.1, 0.4), 0, 0.037, -0.124);
    mesh(head, G.helmet(), M(c.helmet, 0.55), 0, 0.035, 0.008, 0, 0, 0, 1, 1, 1.07);
    mesh(head, G.rbox(0.29, 0.03, 0.31, 0.012), M(c.helmet, 0.55), 0, 0.035, 0.01);
    mesh(head, G.rbox(0.045, 0.04, 0.05, 0.01), M('#1a1a1a'), 0.13, 0.07, -0.01);
    mesh(head, G.rbox(0.06, 0.035, 0.035, 0.01), M('#1a1a1a'), 0, 0.13, -0.11);
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = grp(chest, 0.215 * s, 0.29, 0);
      mesh(sh, G.sph(0.078), M(c.vest), 0, -0.01, 0);
      mesh(sh, G.cap(0.057, 0.2), M(c.shirt), 0, -0.145, 0);
      const el = grp(sh, 0, -L1, 0);
      mesh(el, G.cap(0.051, 0.18), M(c.shirt), 0, -0.12, 0);
      mesh(el, G.cyl(0.056, 0.05, 0.06, 10), M('#2a2a28'), 0, -0.2, 0);
      mesh(el, G.rbox(0.075, 0.1, 0.09, 0.03), M('#2a2a28', 0.85), 0, -L2 + 0.025, 0);
      this.arms.push({ sh, el, L1, L2, s });
    }
    this.armL = this.arms[0]; this.armR = this.arms[1];
    this.aim = grp(chest, 0, 0.27, 0);
    this.holder = grp(this.aim, 0.11, -0.07, -0.27);
    this.flash = new THREE.Sprite(flashMat); this.flash.visible = false; this.flash.scale.setScalar(0.5);
    // animation state
    this.phase = 0; this.t = Math.random() * 10; this.legYaw = 0; this.sprintK = 0; this.healK = 0; this.reloadK = 0;
    this.kick = 0; this.dip = 0; this.flinch = 0; this.flinchZ = 0; this.flashT = 0; this.prevSn = 0;
    this.dead = false; this.weaponId = null;
    this.onStep = null;
  }
  setWeapon(id, rarity = 0) {
    if (this.weaponId === id && this.weaponRarity === rarity) return;
    if (this.gun) this.holder.remove(this.gun);
    this.gun = makeGun(id, rarity); this.holder.add(this.gun); this.weaponId = id; this.weaponRarity = rarity;
    this.gun.userData.muzzle.add(this.flash);
    const h = HOLD[id]; this.holdPos = new THREE.Vector3(h[0], h[1], h[2]);
    this.holder.position.copy(this.holdPos);
  }
  muzzleWorld(out) { this.root.updateMatrixWorld(true); return this.gun.userData.muzzle.getWorldPosition(out); }
  fire() { this.kick = 1; this.flashT = 0.05; this.flash.material.rotation = Math.random() * 6; this.flash.scale.setScalar(rand(0.35, 0.65)); }
  hit(side) { this.flinch = -0.28; this.flinchZ = side * 0.2; }
  land(v) { this.dip = Math.min(0.32, this.dip + v * 0.022); }
  die(dir) {
    this.dead = true; this.deathT = 0; this.fallA = 0; this.fallW = rand(1.2, 2.4); this.fallSign = dir;
    this.limp = { knL: rand(-1.6, -0.2), knR: rand(-1.6, -0.2), thL: rand(-0.4, 0.8), thR: rand(-0.4, 0.8), shL: rand(0.6, 1.8), shR: rand(-1.8, -0.6), head: rand(-0.5, 0.5) };
  }

  // s: {pos, yaw, pitch, vx, vz, onGround, sprint, slide, swim, mode('ground'|'free'|'chute'), reload(0..1|-1), heal}
  update(dt, s) {
    const r = this.root;
    r.position.copy(s.pos);
    r.rotation.y = s.yaw;
    if (this.dead) { this.ragdoll(dt); return; }
    this.t += dt;
    const k = 1 - Math.exp(-16 * dt), kq = 1 - Math.exp(-28 * dt);
    const sp = Math.hypot(s.vx, s.vz);
    // lower body faces the movement direction (±60°), upper body keeps aiming
    let la = 0, dir = 1;
    if (sp > 0.6) {
      la = wrap(Math.atan2(-s.vx, -s.vz) - s.yaw);
      if (Math.abs(la) > 1.75) { dir = -1; la = wrap(la - Math.PI); }
    }
    this.legYaw = lerp(this.legYaw, sp > 0.6 && s.onGround && !s.slide ? clamp(la, -1.05, 1.05) : 0, k * 0.7);
    const moveK = clamp(sp / 3, 0, 1) * (s.onGround ? 1 : 0), runK = clamp((sp - 5) / 4, 0, 1);
    const stride = 1.45 + 1.25 * runK;
    this.phase += dir * Math.PI * 2 * sp * dt / stride;
    const sn = Math.sin(this.phase), cs = Math.cos(this.phase);
    if (s.onGround && !s.slide && moveK > 0.4 && Math.sign(sn) !== Math.sign(this.prevSn)) this.onStep?.(runK);
    this.prevSn = sn;
    this.sprintK = lerp(this.sprintK, s.sprint ? 1 : 0, k * 0.8);
    this.healK = lerp(this.healK, s.heal ? 1 : 0, k * 0.6);
    this.reloadK = lerp(this.reloadK, s.reload >= 0 ? 1 : 0, k);
    this.kick *= Math.exp(-16 * dt); this.dip *= Math.exp(-7 * dt);
    this.flinch *= Math.exp(-9 * dt); this.flinchZ *= Math.exp(-9 * dt);

    // ── targets
    const ta = (0.4 + 0.45 * runK) * moveK, kb = 0.05 + 0.15 * runK * moveK, ka = (0.42 + 0.85 * runK) * moveK;
    let thL = sn * ta, thR = -sn * ta;
    let knL = -(kb + ka * Math.max(0, cs * dir)), knR = -(kb + ka * Math.max(0, -cs * dir));
    let hipsY = 0.92 - (0.02 + 0.06 * runK) * moveK * Math.abs(sn) - this.dip;
    let lean = -(0.07 * moveK + 0.24 * runK + 0.1 * this.sprintK), roll = sn * (0.035 + 0.03 * runK) * moveK;
    let twist = -sn * (0.08 + 0.12 * runK) * moveK;
    let neckX = 0, armsPose = null;
    if (!s.onGround && s.mode === 'ground' && !s.swim) {
      thL = 0.75; thR = -0.2; knL = -1.2; knR = -0.55; lean = -0.12; hipsY = 0.92; twist = 0;
    }
    if (s.slide) { hipsY = 0.42; thL = 1.4; knL = -0.12; thR = 0.55; knR = -1.75; lean = 0.42; twist = 0; roll = 0; }
    if (s.swim) { hipsY = -0.15; lean = -0.95; thL = Math.sin(this.t * 7) * 0.3 + 0.15; thR = -Math.sin(this.t * 7) * 0.3 + 0.15; knL = knR = -0.35; twist = 0; }
    if (s.mode === 'free') {
      hipsY = 0.92; lean = -1.3; thL = 0.15 + Math.sin(this.t * 9) * 0.05; thR = -0.15; knL = -0.7; knR = -0.45; neckX = 1.0;
      armsPose = [[-0.4, 0, -1.25], [-0.4, 0, 1.25], 0.5];
    }
    if (s.mode === 'chute') {
      hipsY = 0.92; lean = 0.05; thL = 0.3 + Math.sin(this.t * 2.2) * 0.18; thR = 0.12 - Math.sin(this.t * 2.2) * 0.18; knL = -0.4; knR = -0.3;
      armsPose = [[0.1, 0, -2.75], [0.1, 0, 2.75], 0.35];
    }
    const L = this.legs;
    L[0].th.rotation.x = lerp(L[0].th.rotation.x, thL, kq); L[1].th.rotation.x = lerp(L[1].th.rotation.x, thR, kq);
    L[0].kn.rotation.x = lerp(L[0].kn.rotation.x, knL, kq); L[1].kn.rotation.x = lerp(L[1].kn.rotation.x, knR, kq);
    for (const l of L) { l.an.rotation.x = -(l.th.rotation.x + l.kn.rotation.x) * 0.8; l.th.rotation.z = 0.04 * l.s * (1 - moveK); }
    this.hips.position.y = lerp(this.hips.position.y, hipsY, kq);
    this.hips.rotation.y = this.legYaw;
    this.hips.rotation.z = lerp(this.hips.rotation.z, roll, k);
    this.spine.rotation.x = lerp(this.spine.rotation.x, lean + this.flinch, k);
    this.spine.rotation.y = lerp(this.spine.rotation.y, -this.legYaw + twist, kq);
    this.spine.rotation.z = lerp(this.spine.rotation.z, -roll * 0.6 + this.flinchZ, k);
    const breathe = Math.sin(this.t * 1.9) * 0.007 * (1 - moveK);
    this.chest.position.y = 0.18 + breathe;
    this.chest.rotation.x = s.pitch * 0.35;
    this.neck.rotation.x = lerp(this.neck.rotation.x, s.pitch * 0.25 - this.spine.rotation.x * 0.6 + neckX, k);
    // aim pivot: compensate lean so the gun stays on the crosshair
    const spX = this.spine.rotation.x;
    const reloadP = s.reload >= 0 ? s.reload : 0;
    this.aim.rotation.x = s.pitch * 0.65 - spX - 0.85 * this.sprintK - 0.5 * this.healK - 0.35 * this.reloadK + this.kick * 0.13;
    this.aim.rotation.y = 0.6 * this.sprintK + 0.25 * this.healK;
    this.aim.rotation.z = 0.5 * this.reloadK + 0.35 * this.sprintK;
    if (this.holdPos) {
      this.holder.position.set(this.holdPos.x - 0.05 * this.sprintK, this.holdPos.y + sn * 0.012 * moveK - 0.04 * this.reloadK, this.holdPos.z + this.kick * 0.075 + 0.08 * this.sprintK);
    }
    this.flashT -= dt; this.flash.visible = this.flashT > 0;
    if (this.gun) this.gun.visible = !armsPose;

    // ── arms
    if (armsPose) {
      for (let i = 0; i < 2; i++) {
        _q.setFromEuler(_eul.set(...armsPose[i]));
        this.arms[i].sh.quaternion.slerp(_q, k);
        _q.setFromEuler(_eul.set(-armsPose[2], 0, 0));
        this.arms[i].el.quaternion.slerp(_q, k);
      }
      return;
    }
    r.updateMatrixWorld(true);
    const u = this.gun.userData;
    u.r.getWorldPosition(_w1); solveArm(this.armR, _w1, POLE_R);
    u.l.getWorldPosition(_w1);
    if (this.reloadK > 0.02) {
      // hand drops to the magazine, pulls it, slaps it back
      u.mag.getWorldPosition(_w2);
      const pull = Math.sin(clamp(reloadP, 0, 1) * Math.PI) * 0.16;
      _w2.y -= pull;
      _w1.lerp(_w2, this.reloadK);
    }
    if (this.healK > 0.02) { this.chest.localToWorld(_w2.set(0.02, 0.12, -0.2)); _w2.y += Math.sin(this.t * 14) * 0.02; _w1.lerp(_w2, this.healK); }
    solveArm(this.armL, _w1, POLE_L);
  }

  ragdoll(dt) {
    this.deathT += dt;
    const r = this.root, k = 1 - Math.exp(-10 * dt), lp = this.limp;
    if (this.fallA < 1.52 || Math.abs(this.fallW) > 0.01) {
      this.fallW += 14 * Math.sin(this.fallA + 0.25) * dt;
      this.fallA += this.fallW * dt;
      if (this.fallA >= 1.52) { this.fallA = 1.52; this.fallW = -this.fallW * 0.22; if (Math.abs(this.fallW) < 0.4) this.fallW = 0; }
    }
    r.rotation.x = this.fallSign * this.fallA;
    r.position.y += 0.13 * (this.fallA / 1.52);
    this.hips.position.y = lerp(this.hips.position.y, 0.92, k);
    const L = this.legs;
    L[0].kn.rotation.x = lerp(L[0].kn.rotation.x, lp.knL, k); L[1].kn.rotation.x = lerp(L[1].kn.rotation.x, lp.knR, k);
    L[0].th.rotation.x = lerp(L[0].th.rotation.x, lp.thL * this.fallSign, k); L[1].th.rotation.x = lerp(L[1].th.rotation.x, lp.thR * this.fallSign, k);
    this.spine.rotation.x = lerp(this.spine.rotation.x, 0.25 * this.fallSign, k);
    this.neck.rotation.x = lerp(this.neck.rotation.x, lp.head, k);
    _q.setFromEuler(_eul.set(-0.6 * this.fallSign, 0, lp.shL)); this.armL.sh.quaternion.slerp(_q, k);
    _q.setFromEuler(_eul.set(-0.6 * this.fallSign, 0, lp.shR)); this.armR.sh.quaternion.slerp(_q, k);
    _q.setFromEuler(_eul.set(-0.5, 0, 0)); this.armL.el.quaternion.slerp(_q, k); this.armR.el.quaternion.slerp(_q, k);
    this.aim.rotation.x = lerp(this.aim.rotation.x, -1.2, k);
    this.flash.visible = false;
  }
}

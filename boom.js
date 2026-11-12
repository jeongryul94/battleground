// Explosion + rocket visual effects: fireball, flash light, shockwave, smoke column, debris, sparks, scorch mark.
import * as THREE from 'three';

const tex = (draw, size = 128) => { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const glowTex = tex((x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,220,120,.95)'); g.addColorStop(0.55, 'rgba(255,120,30,.55)'); g.addColorStop(1, 'rgba(255,60,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});
const smokeTex = tex((x, s) => {
  for (let i = 0; i < 7; i++) {
    const cx = s / 2 + (Math.random() - 0.5) * s * 0.3, cy = s / 2 + (Math.random() - 0.5) * s * 0.3, r = s * (0.22 + Math.random() * 0.18);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
});
const scorchTex = tex((x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(10,8,6,.9)'); g.addColorStop(0.6, 'rgba(20,14,10,.55)'); g.addColorStop(1, 'rgba(20,14,10,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});

let scene = null, light = null;
const live = [];
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = k => 1 - Math.pow(1 - k, 3);

export function initBoom(sc) {
  scene = sc;
  light = new THREE.PointLight(0xffa040, 0, 60, 1.6); scene.add(light);
}
function add(obj, life, fn) { scene.add(obj); live.push({ obj, t: 0, life, fn }); }
const sprite = (map, color, blending = THREE.AdditiveBlending, opacity = 1) => new THREE.Sprite(new THREE.SpriteMaterial({ map, color, blending, transparent: true, depthWrite: false, opacity }));

export function updateBoom(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i]; e.t += dt;
    const k = e.t / e.life;
    if (k >= 1) { scene.remove(e.obj); e.obj.material?.dispose?.(); live.splice(i, 1); continue; }
    e.fn(e.obj, k, dt);
  }
  if (light && light.intensity > 0) light.intensity = Math.max(0, light.intensity - dt * 2600);
}

// big = 1 for a rocket hit; groundY lets the shockwave and scorch sit on the terrain
export function explosionFx(pos, groundY, big = 1) {
  const R = 6 * big;
  light.position.copy(pos).y += 1.5; light.intensity = 900 * big;
  // fireball: several overlapping glows that bloom out then sink to red
  for (let i = 0; i < 6; i++) {
    const s = sprite(glowTex, new THREE.Color(1, 0.85, 0.5));
    const off = new THREE.Vector3(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).multiplyScalar(R * 0.25);
    s.position.copy(pos).add(off);
    const max = R * rand(1.1, 1.7), life = rand(0.45, 0.75);
    add(s, life, (o, k) => {
      const e = easeOut(Math.min(1, k * 2.2));
      o.scale.setScalar(max * (0.25 + 0.75 * e));
      o.material.opacity = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
      o.material.color.setRGB(1, 0.85 - k * 0.55, 0.5 - k * 0.45);
      o.position.y += 0.02;
    });
  }
  // white-hot core flash
  const core = sprite(glowTex, 0xffffff); core.position.copy(pos);
  add(core, 0.18, (o, k) => { o.scale.setScalar(R * (1.2 + k * 1.5)); o.material.opacity = 1 - k; });
  // ground shockwave ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, groundY + 0.25, pos.z);
  add(ring, 0.55, (o, k) => { o.scale.setScalar(1 + easeOut(k) * R * 2.6); o.material.opacity = (1 - k) * 0.9; });
  // second, slower dust ring
  const dust = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), new THREE.MeshBasicMaterial({ color: 0xc8b69a, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  dust.rotation.x = -Math.PI / 2; dust.position.set(pos.x, groundY + 0.15, pos.z);
  add(dust, 1.4, (o, k) => { o.scale.setScalar(1 + easeOut(k) * R * 1.8); o.material.opacity = (1 - k) * 0.55; });
  // smoke column
  for (let i = 0; i < 16; i++) {
    const g = rand(0.18, 0.42), s = sprite(smokeTex, new THREE.Color(g, g * 0.95, g * 0.9), THREE.NormalBlending, 0);
    s.position.copy(pos).add(new THREE.Vector3(rand(-1, 1) * R * 0.3, rand(0, R * 0.3), rand(-1, 1) * R * 0.3));
    const v = new THREE.Vector3(rand(-1.5, 1.5), rand(2.5, 6.5), rand(-1.5, 1.5)), s0 = rand(1.5, 3) * big, s1 = rand(7, 12) * big;
    const delay = rand(0, 0.25), life = rand(2.6, 4.2);
    s.material.rotation = rand(0, 6);
    add(s, life, (o, k, dt) => {
      const t = Math.max(0, k * life - delay) / (life - delay);
      o.position.addScaledVector(v, dt); v.multiplyScalar(Math.exp(-0.9 * dt));
      o.scale.setScalar(s0 + (s1 - s0) * easeOut(t));
      o.material.opacity = t <= 0 ? 0 : Math.min(0.85, t * 6) * (1 - t);
      o.material.rotation += dt * 0.3;
    });
  }
  // debris chunks and sparks
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(debrisGeo, new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0x3a3530 : 0x6a5a48, roughness: 0.9 }));
    const sc = rand(0.08, 0.3) * big; m.scale.setScalar(sc); m.position.copy(pos); m.castShadow = true;
    const v = new THREE.Vector3(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(8, 20) * big);
    const w = new THREE.Vector3(rand(-15, 15), rand(-15, 15), rand(-15, 15));
    add(m, rand(1.4, 2.4), (o, k, dt) => {
      v.y -= 22 * dt; o.position.addScaledVector(v, dt);
      if (o.position.y < groundY) { o.position.y = groundY; v.multiplyScalar(0.35); v.y = Math.abs(v.y) * 0.5; w.multiplyScalar(0.5); }
      o.rotation.x += w.x * dt; o.rotation.y += w.y * dt; o.rotation.z += w.z * dt;
      if (k > 0.8) o.scale.setScalar(sc * (1 - (k - 0.8) / 0.2));
    });
  }
  for (let i = 0; i < 26; i++) {
    const s = sprite(glowTex, 0xffd080); s.position.copy(pos);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(14, 32) * big);
    add(s, rand(0.35, 0.8), (o, k, dt) => {
      v.y -= 18 * dt; v.multiplyScalar(Math.exp(-1.5 * dt)); o.position.addScaledVector(v, dt);
      o.scale.setScalar(0.45 * (1 - k)); o.material.opacity = 1 - k;
    });
  }
  // scorch mark that lingers
  const scorch = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.3, R * 1.3), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  scorch.rotation.x = -Math.PI / 2; scorch.rotation.z = rand(0, 6); scorch.position.set(pos.x, groundY + 0.06, pos.z);
  add(scorch, 12, (o, k) => { o.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25; });
}

// rocket flight look: flame + glow at the nozzle, chunky smoke trail
export function rocketVisual(mesh) {
  const flame = sprite(glowTex, 0xffb050); flame.scale.setScalar(1.3); flame.position.set(0, 0, -0.42); mesh.add(flame);
  const flame2 = sprite(glowTex, 0xffffff); flame2.scale.setScalar(0.6); flame2.position.set(0, 0, -0.32); mesh.add(flame2);
  return t => { flame.scale.setScalar(1.1 + Math.sin(t * 80) * 0.25 + Math.random() * 0.3); };
}
export function trailPuff(pos) {
  const g = rand(0.75, 0.95), s = sprite(smokeTex, new THREE.Color(g, g, g), THREE.NormalBlending, 0.6);
  s.position.copy(pos); s.material.rotation = rand(0, 6);
  const v = new THREE.Vector3(rand(-0.4, 0.4), rand(0.3, 0.9), rand(-0.4, 0.4));
  add(s, rand(1.0, 1.6), (o, k, dt) => { o.position.addScaledVector(v, dt); o.scale.setScalar(0.5 + k * 2.4); o.material.opacity = 0.6 * (1 - k); });
}
export function backblast(pos, dir) {
  for (let i = 0; i < 10; i++) {
    const s = sprite(smokeTex, new THREE.Color(0.85, 0.85, 0.85), THREE.NormalBlending, 0.7); s.position.copy(pos);
    const v = dir.clone().multiplyScalar(-rand(3, 8)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(0, 1.5), rand(-1.5, 1.5)));
    add(s, rand(0.7, 1.2), (o, k, dt) => { o.position.addScaledVector(v, dt); v.multiplyScalar(Math.exp(-3 * dt)); o.scale.setScalar(0.6 + k * 3); o.material.opacity = 0.7 * (1 - k); });
  }
  const f = sprite(glowTex, 0xffc070); f.position.copy(pos).addScaledVector(dir, 0.8);
  add(f, 0.12, (o, k) => { o.scale.setScalar(2.2 * (1 - k * 0.5)); o.material.opacity = 1 - k; });
}

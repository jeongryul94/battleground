// Skinned cartoon character (Quaternius Universal Animation Library mannequin, CC0) with the same
// interface as rig.js: animation blending, upper-body aim, two-bone arm IK onto the gun,
// outline shell, helmet/vest/backpack gear and a death animation.
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { makeGun, HOLD } from './rig.js';

let BASE = null, CLIPS = {}, FWD = 1;
export const characterReady = () => !!BASE;
export function initCharacter(gltf) {
  BASE = gltf.scene;
  for (const c of gltf.animations) CLIPS[c.name] = c;
  BASE.updateMatrixWorld(true);
  const f = BASE.getObjectByName('foot_l'), b = BASE.getObjectByName('ball_l');
  const pf = f.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3());
  FWD = pb.z > pf.z ? 1 : -1; // +1: the model faces +Z and must be turned to face -Z
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const lerp = (a, b, k) => a + (b - a) * k;
const V = () => new THREE.Vector3();
const _A = V(), _B = V(), _C = V(), _E = V(), _d = V(), _p = V(), _t = V(), _f = V(), _g = V();
const _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);

function rotateWorld(bone, q) {
  bone.parent.getWorldQuaternion(_qp); bone.getWorldQuaternion(_qw);
  _qw.premultiply(q);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}
function rotateAxis(bone, axis, angle) { if (Math.abs(angle) > 1e-4) rotateWorld(bone, _qa.setFromAxisAngle(axis, angle)); }
function alignBone(bone, from, to) {
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  rotateWorld(bone, _qa.setFromUnitVectors(from.normalize(), to.normalize()));
}
function ikArm(upper, lower, hand, target, pole) {
  upper.getWorldPosition(_A); lower.getWorldPosition(_B); hand.getWorldPosition(_C);
  const l1 = _A.distanceTo(_B), l2 = _B.distanceTo(_C);
  _d.copy(target).sub(_A);
  const dist = clamp(_d.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.003);
  _d.normalize();
  const a = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _E.copy(_A).addScaledVector(_d, Math.cos(a) * l1).addScaledVector(_p, Math.sin(a) * l1);
  alignBone(upper, _f.copy(_B).sub(_A), _g.copy(_E).sub(_A));
  lower.getWorldPosition(_B); hand.getWorldPosition(_C);
  alignBone(lower, _f.copy(_C).sub(_B), _g.copy(_A).addScaledVector(_d, dist).sub(_B));
}

// cartoon outline: an inflated back-face shell that follows the skin
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x14161c, side: THREE.BackSide });
outlineMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * 0.014;'); };

const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,210,90,.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const mcache = {};
const toon = (c, r = 0.55) => (mcache[c + r] ||= new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 }));
const LOCO = ['Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Walk_Loop'];

export class Rig2 {
  constructor(parent, c) {
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ'; parent.add(this.root);
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    const model = this.model = skClone(BASE);
    model.rotation.y = FWD > 0 ? Math.PI : 0;
    this.tilt.add(model);
    const bodyMat = toon(c.shirt, 0.5), jointMat = toon(c.pants, 0.6);
    this.skinned = [];
    model.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.material = /Joint/i.test(o.material.name) ? jointMat : bodyMat;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      this.skinned.push(o);
    });
    for (const m of this.skinned) {
      const sh = new THREE.SkinnedMesh(m.geometry, outlineMat); sh.bind(m.skeleton, m.bindMatrix);
      sh.frustumCulled = false; m.parent.add(sh);
    }
    const B = n => model.getObjectByName(n);
    this.b = {
      pelvis: B('pelvis'), s1: B('spine_01'), s2: B('spine_02'), s3: B('spine_03'), neck: B('neck_01'), head: B('Head'),
      uaR: B('upperarm_r'), laR: B('lowerarm_r'), hR: B('hand_r'), uaL: B('upperarm_l'), laL: B('lowerarm_l'), hL: B('hand_l'),
    };
    this.rest = {};
    for (const [k, bone] of Object.entries(this.b)) this.rest[k] = bone.quaternion.clone();
    // gear, placed in the rest pose then parented to bones
    model.updateMatrixWorld(true);
    const back = new THREE.Vector3(0, 0, -FWD); // model-space "behind"
    const add = (bone, geo, mat, offset) => {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      const p = bone.getWorldPosition(V()).add(offset); m.position.copy(model.worldToLocal(p.clone()));
      model.add(m); bone.attach(m); return m;
    };
    const headPos = this.b.head.getWorldPosition(V()), chestPos = this.b.s3.getWorldPosition(V());
    this.helmet = add(this.b.head, new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), toon(c.helmet, 0.45), new THREE.Vector3(0, headPos.y * 0 + 0.13, 0));
    this.helmet.scale.set(1, 0.9, 1.08);
    // goggles give the faceless mannequin a face
    const fwd = new THREE.Vector3(0, 0, FWD);
    const goggle = add(this.b.head, new THREE.BoxGeometry(0.2, 0.065, 0.06), toon('#1b2230', 0.2), fwd.clone().multiplyScalar(0.1).add(new THREE.Vector3(0, 0.09, 0)));
    const lens = add(this.b.head, new THREE.BoxGeometry(0.17, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 0.6, roughness: 0.2 }), fwd.clone().multiplyScalar(0.13).add(new THREE.Vector3(0, 0.09, 0)));
    void goggle; void lens;
    this.vest = add(this.b.s3, new THREE.BoxGeometry(0.42, 0.34, 0.3), toon(c.vest, 0.7), new THREE.Vector3(0, 0.0, 0));
    this.pack = add(this.b.s3, new THREE.BoxGeometry(0.32, 0.4, 0.17), toon(c.pack, 0.75), back.clone().multiplyScalar(0.2).add(new THREE.Vector3(0, -0.02, 0)));
    const roll = add(this.b.s3, new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), toon(c.accent, 0.7), back.clone().multiplyScalar(0.2).add(new THREE.Vector3(0, 0.23, 0)));
    roll.rotation.z = Math.PI / 2;
    this.helmet.visible = this.vest.visible = false;
    void chestPos;
    // animation
    this.mixer = new THREE.AnimationMixer(model);
    this.act = {}; this.w = {};
    for (const n of LOCO) {
      if (!CLIPS[n]) continue;
      const a = this.mixer.clipAction(CLIPS[n]); a.play(); a.setEffectiveWeight(0); this.act[n] = a; this.w[n] = 0;
    }
    this.w.Idle_Loop = 1; this.act.Idle_Loop?.setEffectiveWeight(1);
    // aim frame + gun
    this.aim = new THREE.Group(); this.root.add(this.aim);
    this.holder = new THREE.Group(); this.aim.add(this.holder);
    this.flash = new THREE.Sprite(flashMat); this.flash.visible = false;
    this.phase = 0; this.prevSn = 0; this.legYaw = 0; this.sprintK = 0; this.reloadK = 0; this.healK = 0;
    this.kick = 0; this.dip = 0; this.flinch = 0; this.flashT = 0; this.t = Math.random() * 10;
    this.dead = false; this.weaponId = null; this.onStep = null;
  }
  setWeapon(id, rarity = 0) {
    if (this.weaponId === id && this.weaponRarity === rarity) return;
    if (this.gun) this.holder.remove(this.gun);
    this.gun = makeGun(id, rarity); this.gun.scale.setScalar(1.25); this.holder.add(this.gun); this.weaponId = id; this.weaponRarity = rarity;
    this.gun.userData.muzzle.add(this.flash);
    const h = HOLD[id]; this.holdPos = new THREE.Vector3(h[0] * 1.1, h[1], h[2] * 1.1 - 0.05);
  }
  setGear(g) { this.helmet.visible = !!g?.helm; this.vest.visible = !!g?.vest; }
  muzzleWorld(out) { this.root.updateMatrixWorld(true); return this.gun.userData.muzzle.getWorldPosition(out); }
  fire() { this.kick = 1; this.flashT = 0.05; this.flash.material.rotation = Math.random() * 6; this.flash.scale.setScalar(0.4 + Math.random() * 0.35); }
  hit(side) { this.flinch = 0.3 * (side || 1); }
  land(v) { this.dip = Math.min(0.25, this.dip + v * 0.016); }
  die() {
    if (this.dead) return; this.dead = true;
    for (const a of Object.values(this.act)) a.fadeOut(0.15);
    const d = this.mixer.clipAction(CLIPS.Death01); d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.fadeIn(0.12).play();
    if (this.gun) this.gun.visible = false; this.flash.visible = false; this.tilt.rotation.x = 0;
  }
  weight(name, target, k) { this.w[name] = lerp(this.w[name] ?? 0, target, k); this.act[name]?.setEffectiveWeight(this.w[name]); }

  // s: {pos, yaw, pitch, vx, vz, onGround, sprint, slide, swim, mode, reload, heal}
  update(dt, s) {
    const r = this.root;
    r.position.copy(s.pos);
    if (this.dead) { r.rotation.y = s.yaw; this.mixer.update(dt); return; }
    this.t += dt;
    const k = 1 - Math.exp(-12 * dt);
    const sp = Math.hypot(s.vx, s.vz);
    let la = 0, dir = 1;
    if (sp > 0.6) { la = wrap(Math.atan2(-s.vx, -s.vz) - s.yaw); if (Math.abs(la) > 1.75) { dir = -1; la = wrap(la - Math.PI); } }
    const moving = sp > 0.6 && s.onGround && !s.slide && s.mode === 'ground' && !s.swim;
    this.legYaw = lerp(this.legYaw, moving ? clamp(la, -1.0, 1.0) : 0, 1 - Math.exp(-10 * dt));
    r.rotation.y = s.yaw + this.legYaw;
    this.sprintK = lerp(this.sprintK, s.sprint ? 1 : 0, k);
    this.reloadK = lerp(this.reloadK, s.reload >= 0 ? 1 : 0, k);
    this.healK = lerp(this.healK, s.heal ? 1 : 0, k);
    this.kick *= Math.exp(-16 * dt); this.dip *= Math.exp(-7 * dt); this.flinch *= Math.exp(-9 * dt);

    // ── pick the full-body animation layer
    const T = {}; for (const n of LOCO) T[n] = 0;
    let holdGun = true, tilt = 0;
    if (s.swim) { T[sp > 1 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop'] = 1; holdGun = false; }
    else if (s.mode === 'free') { T.Jump_Loop = 1; tilt = -1.25; holdGun = false; }
    else if (s.mode === 'chute') { T.Jump_Loop = 1; holdGun = false; }
    else if (!s.onGround) T.Jump_Loop = 1;
    else if (s.slide) T.Crouch_Idle_Loop = 1;
    else if (sp < 0.6) T.Idle_Loop = 1;
    else if (s.sprint) T.Sprint_Loop = 1;
    else { const j = clamp((sp - 1.2) / 2.5, 0, 1); T.Jog_Fwd_Loop = j; T.Walk_Loop = 1 - j; }
    for (const n of LOCO) this.weight(n, T[n], 1 - Math.exp(-14 * dt));
    const jog = this.act.Jog_Fwd_Loop, spr = this.act.Sprint_Loop, walk = this.act.Walk_Loop;
    if (jog) jog.timeScale = dir * clamp(sp / 4.2, 0.6, 1.8);
    if (walk) walk.timeScale = dir * clamp(sp / 1.6, 0.6, 1.8);
    if (spr) spr.timeScale = clamp(sp / 7.8, 0.8, 1.5);
    if (this.act.Swim_Fwd_Loop) this.act.Swim_Fwd_Loop.timeScale = 1.2;
    this.tilt.rotation.x = lerp(this.tilt.rotation.x, tilt, k);
    this.tilt.position.y = -this.dip;
    this.mixer.update(dt);

    // footsteps from the dominant cycle
    const cyc = (s.sprint ? spr : this.w.Jog_Fwd_Loop > 0.5 ? jog : walk);
    if (cyc) {
      this.phase = (cyc.time / cyc.getClip().duration) * Math.PI * 2;
      const sn = Math.sin(this.phase * 2);
      if (moving && Math.sign(sn) !== Math.sign(this.prevSn)) this.onStep?.(clamp((sp - 5) / 4, 0, 1));
      this.prevSn = sn;
    }

    // ── aim: twist the spine back toward the aim yaw and bend it with pitch
    r.updateMatrixWorld(true);
    const yaw = s.yaw, right = _t.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const pitch = holdGun ? clamp(s.pitch, -1.1, 1.0) : 0;
    const b = this.b;
    for (const bone of [b.s1, b.s2, b.s3]) {
      rotateAxis(bone, UPV, -this.legYaw / 3);
      rotateAxis(bone, right, (pitch * 0.55 - this.flinch * 0.4) / 3);
    }
    rotateAxis(b.neck, right, pitch * 0.25);

    if (this.gun) this.gun.visible = holdGun;
    this.flashT -= dt; this.flash.visible = this.flashT > 0 && holdGun;
    if (!holdGun || !this.gun) return;

    // ── gun frame at the chest, oriented by aim; sprint/heal/reload poses lower it
    b.s3.getWorldPosition(_C);
    this.aim.position.copy(this.root.worldToLocal(_C.add(_A.set(0, 0.12, 0))));
    this.aim.rotation.order = 'YXZ';
    this.aim.rotation.set(pitch - 0.85 * this.sprintK - 0.5 * this.healK - 0.3 * this.reloadK + this.kick * 0.12, -this.legYaw + 0.6 * this.sprintK + 0.25 * this.healK, 0.45 * this.reloadK + 0.3 * this.sprintK);
    const h = this.holdPos;
    this.holder.position.set(h.x - 0.05 * this.sprintK, h.y + Math.sin(this.phase * 2) * 0.01 - 0.03 * this.reloadK, h.z + this.kick * 0.08 + 0.08 * this.sprintK);
    this.root.updateMatrixWorld(true);
    const u = this.gun.userData;
    const fwd = _f.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const poleR = _E.copy(right).multiplyScalar(0.8).add(_B.set(0, -1, 0)).addScaledVector(fwd, -0.4).normalize();
    u.r.getWorldPosition(_g);
    ikArm(b.uaR, b.laR, b.hR, _g.clone(), poleR.clone());
    u.l.getWorldPosition(_g);
    if (this.reloadK > 0.02) { u.mag.getWorldPosition(_p); _p.y -= Math.sin(clamp(s.reload, 0, 1) * Math.PI) * 0.16; _g.lerp(_p, this.reloadK); }
    if (this.healK > 0.02) { b.s3.getWorldPosition(_p); _p.addScaledVector(fwd, 0.2); _g.lerp(_p, this.healK); }
    const poleL = _E.copy(right).multiplyScalar(-0.9).add(_B.set(0, -1, 0)).addScaledVector(fwd, -0.2).normalize();
    ikArm(b.uaL, b.laL, b.hL, _g.clone(), poleL.clone());
  }
}

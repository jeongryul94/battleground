// Stylised vegetation from the Quaternius Stylized Nature MegaKit (CC0).
// Trees use two levels of detail: full textured models near the player, cheap low-poly blobs far away.
import * as THREE from 'three';

const FAMILIES = {
  broad: ['tree1', 'tree2', 'tree3', 'tree4', 'tree5'],
  pine: ['pine1', 'pine2', 'pine3', 'pine4', 'pine5'],
  rock: ['rock1', 'rock2', 'rock3'],
  bush: ['bush1', 'bush2'],
};
const NEAR_R = 150, wind = { value: 0 };

function prepMaterial(m) {
  if (!m || m.userData.prepped) return;
  m.userData.prepped = true;
  const leafy = /Leaves|Flowers/.test(m.name);
  if (m.map) m.map.anisotropy = 4;
  if (leafy) {
    m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.depthWrite = true;
    m.onBeforeCompile = sh => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uWind * 1.6 + ip.x * 0.11 + ip.z * 0.07) * 0.6 + sin(uWind * 3.3 + ip.x * 0.4) * 0.25;
        transformed.x += sway * 0.035 * max(position.y, 0.0);
        transformed.z += sway * 0.02 * max(position.y, 0.0);`);
    };
    m.customProgramCacheKey = () => 'leafwind';
  }
  m.roughness = Math.max(m.roughness ?? 0.8, 0.75); m.metalness = 0;
}

function protoOf(gltf, name) {
  const node = gltf.scene.getObjectByName(name);
  if (!node) throw new Error('nature model missing: ' + name);
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const parts = [], box = new THREE.Box3();
  node.traverse(o => {
    if (!o.isMesh) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (const m of [].concat(o.material)) prepMaterial(m);
    parts.push({ geo: o.geometry, mat: o.material, rel });
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(rel));
  });
  const size = box.getSize(new THREE.Vector3());
  return { name, parts, minY: box.min.y, height: size.y, width: Math.max(size.x, size.z) };
}

// low-poly far trees, built once, vertex-coloured
function farGeometry(kind) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.5, 5); trunk.translate(0, 0.25, 0); parts.push([trunk, 0x7a5636]);
  if (kind === 'pine') {
    for (const [y, r, h] of [[0.32, 0.26, 0.42], [0.55, 0.2, 0.36], [0.76, 0.13, 0.3]]) { const c = new THREE.ConeGeometry(r, h, 7); c.translate(0, y + h / 2 - 0.05, 0); parts.push([c, 0x3f8a4c]); }
  } else {
    const a = new THREE.IcosahedronGeometry(0.3, 1); a.scale(1, 0.85, 1); a.translate(0, 0.66, 0); parts.push([a, 0x5ea845]);
    const b = new THREE.IcosahedronGeometry(0.2, 1); b.translate(0.14, 0.55, 0.08); parts.push([b, 0x6cb84e]);
  }
  const geos = parts.map(([g, col]) => {
    g = g.toNonIndexed(); const c = new THREE.Color(col), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv'); return g;
  });
  // manual merge
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

const _p2 = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _off = new THREE.Matrix4();
function placeMatrix(out, proto, inst, scale) {
  _q.setFromEuler(_e.set(0, inst.yaw, 0));
  _off.makeTranslation(0, -proto.minY, 0);
  return out.compose(inst.pos, _q, _s.setScalar(scale)).multiply(_off);
}

// groups: { broad|pine|rock|bush: [{ pos: Vector3, yaw, height?, width? }] }
export function setupNature(scene, gltf, groups) {
  const protos = {};
  for (const list of Object.values(FAMILIES)) for (const n of list) protos[n] = protoOf(gltf, n);
  const meshes = [];
  // static families (rocks, bushes): full models everywhere
  for (const fam of ['rock', 'bush']) {
    const names = FAMILIES[fam], buckets = names.map(() => []);
    (groups[fam] || []).forEach((inst, i) => buckets[i % names.length].push(inst));
    names.forEach((n, k) => {
      const pr = protos[n], list = buckets[k]; if (!list.length) return;
      for (const part of pr.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((inst, i) => { placeMatrix(_m, pr, inst, (inst.width || 2) / pr.width).multiply(part.rel); im.setMatrixAt(i, _m); });
        im.castShadow = fam === 'rock'; im.receiveShadow = true; im.computeBoundingSphere();
        scene.add(im); meshes.push(im);
      }
    });
  }
  // trees: per-instance model choice + LOD
  const trees = [];
  for (const fam of ['broad', 'pine']) (groups[fam] || []).forEach((inst, i) => {
    const pr =protos[FAMILIES[fam][Math.abs(i * 7 + Math.floor(inst.pos.x)) % FAMILIES[fam].length]];
    trees.push({ fam, pr, inst, scale: (inst.height || 10) / pr.height, near: false });
  });
  const nearMeshes = {};
  for (const fam of ['broad', 'pine']) for (const n of FAMILIES[fam]) {
    const pr = protos[n], cap = trees.filter(t => t.pr === pr).length; if (!cap) continue;
    nearMeshes[n] = pr.parts.map(part => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, cap); im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false; scene.add(im); return { im, rel: part.rel };
    });
  }
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const far = {};
  for (const fam of ['broad', 'pine']) {
    const cap = trees.filter(t => t.fam === fam).length;
    far[fam] = new THREE.InstancedMesh(farGeometry(fam), farMat, Math.max(1, cap)); far[fam].count = 0; far[fam].frustumCulled = false;
    far[fam].receiveShadow = true; scene.add(far[fam]);
  }
  let lastX = 1e9, lastZ = 1e9;
  function update(px, pz, force) {
    if (!force && (px - lastX) ** 2 + (pz - lastZ) ** 2 < 16) return;
    lastX = px; lastZ = pz;
    for (const list of Object.values(nearMeshes)) for (const p of list) p.im.count = 0;
    far.broad.count = 0; far.pine.count = 0;
    for (const t of trees) {
      const d2 = (t.inst.pos.x - px) ** 2 + (t.inst.pos.z - pz) ** 2;
      if (d2 < NEAR_R * NEAR_R) {
        const list = nearMeshes[t.pr.name];
        placeMatrix(_m, t.pr, t.inst, t.scale);
        for (const p of list) { const k = p.im.count++; p.im.setMatrixAt(k, _p2.copy(_m).multiply(p.rel)); }
      } else {
        const fm = far[t.fam], k = fm.count++;
        _q.setFromEuler(_e.set(0, t.inst.yaw, 0));
        fm.setMatrixAt(k, _m.compose(t.inst.pos, _q, _s.setScalar(t.inst.height || 10)));
      }
    }
    for (const list of Object.values(nearMeshes)) for (const p of list) p.im.instanceMatrix.needsUpdate = true;
    far.broad.instanceMatrix.needsUpdate = true; far.pine.instanceMatrix.needsUpdate = true;
  }
  update(-1e6, -1e6, true); // everything starts "far" (used for the grass mask)
  return {
    trees: trees.length, staticMeshes: meshes, farMeshes: [far.broad, far.pine],
    update(t, px, pz) { wind.value = t; update(px, pz); },
  };
}

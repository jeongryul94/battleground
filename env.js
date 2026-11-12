// Stylised environment: cartoon sky + clouds, shoreline water, wind-blown grass field,
// and the post-processing stack (bloom + colour grade). All driven from the island heightmap.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PALETTE = {
  skyTop: 0x3a8be0, skyHorizon: 0xcfeaf8, fog: 0xc4e2f2,
  sun: 0xfff1d6, hemiSky: 0xcfe8ff, hemiGround: 0x6f8f4a,
  sea: SEA_COLORS(),
};
function SEA_COLORS() { return { shallow: new THREE.Color(0x4fe0d0), mid: new THREE.Color(0x1aa6c8), deep: new THREE.Color(0x13609e), foam: new THREE.Color(0xffffff) }; }

// ───────────────────────── heightmap texture (half-float so it filters linearly everywhere)
export function makeHeightTexture(W) {
  const n = W.n, data = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = THREE.DataUtils.toHalfFloat(W.h[i]);
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
const HMAP_GLSL = /* glsl */`
  uniform sampler2D uHeight;
  float hAt(vec2 xz) {
    vec2 uv = (vec2(xz.x, -xz.y) + 850.0) / 1700.0;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -6.0;
    return texture2D(uHeight, uv).r;
  }`;

// ───────────────────────── top-down coverage mask: roads, slabs, buildings, props => no grass there
export function makeCoverMask(renderer, objects, size = 1024) {
  const rt = new THREE.WebGLRenderTarget(size, size);
  const cam = new THREE.OrthographicCamera(-850, 850, 850, -850, 1, 1200);
  cam.position.set(0, 600, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x000000);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  sc.overrideMaterial = white;
  const parents = objects.map(o => [o, o.parent]);
  for (const o of objects) sc.add(o);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.setRenderTarget(prev);
  for (const [o, p] of parents) p ? p.add(o) : sc.remove(o);
  if (new URLSearchParams(location.search).has('test')) window.__mask = { rt, renderer };
  return rt.texture;
}

// ───────────────────────── sky dome + clouds
export function makeSky(scene) {
  const sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(PALETTE.skyTop) }, horizon: { value: new THREE.Color(PALETTE.skyHorizon) }, sunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.55, pow(h, 0.7)));
        if (d.y < 0.0) c = horizon;
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.9, 0.7) * (smoothstep(0.9975, 0.9985, s) * 2.5 + pow(s, 24.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // puffy clouds: clusters of soft spheres in one instanced mesh
  const puffs = [], rnd = mulberry(7);
  for (let c = 0; c < 46; c++) {
    const cx = (rnd() - 0.5) * 2600, cz = (rnd() - 0.5) * 2600, cy = 300 + rnd() * 140, s = 18 + rnd() * 26;
    const n = 6 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      puffs.push([cx + Math.cos(a) * s * (0.8 + rnd()), cy + rnd() * s * 0.35, cz + Math.sin(a) * s * 0.5 * (0.6 + rnd()), s * (0.55 + rnd() * 0.5)]);
    }
    puffs.push([cx, cy + s * 0.35, cz, s * 1.05]);
  }
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc8dcf0, emissiveIntensity: 0.55, roughness: 1, fog: false });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), cloudMat, puffs.length);
  const m = new THREE.Matrix4();
  puffs.forEach((p, i) => { m.makeScale(p[3], p[3] * 0.62, p[3]).setPosition(p[0], p[1], p[2]); clouds.setMatrixAt(i, m); });
  clouds.frustumCulled = false; scene.add(clouds);
  return { sky, clouds, update(t, camPos) { sky.position.copy(camPos); clouds.position.set(Math.sin(t * 0.004) * 260, 0, Math.cos(t * 0.003) * 120); } };
}
function mulberry(a) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ───────────────────────── water: depth-tinted, shoreline foam, sparkle
export function makeWater(scene, hTex, sea) {
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uHeight: { value: hTex }, uTime: { value: 0 }, uSea: { value: sea },
      cShallow: { value: PALETTE.sea.shallow }, cMid: { value: PALETTE.sea.mid }, cDeep: { value: PALETTE.sea.deep },
      uSun: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
    }]),
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uSea; uniform vec3 cShallow; uniform vec3 cMid; uniform vec3 cDeep; uniform vec3 uSun;
      varying vec3 vWorld;
      ${HMAP_GLSL}
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float depth = uSea - hAt(vWorld.xz);
        vec3 col = mix(cShallow, cMid, smoothstep(0.0, 3.0, depth));
        col = mix(col, cDeep, smoothstep(3.0, 14.0, depth));
        // ripples and sun glints
        vec2 p = vWorld.xz * 0.12;
        float n = noise(p + uTime * 0.35) * 0.6 + noise(p * 2.3 - uTime * 0.5) * 0.4;
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 nrm = normalize(vec3((n - 0.5) * 0.35, 1.0, (noise(p.yx * 1.7 + uTime * 0.4) - 0.5) * 0.35));
        float spec = pow(max(dot(reflect(-uSun, nrm), view), 0.0), 90.0);
        col += vec3(1.0, 0.97, 0.88) * spec * 1.4;
        col = mix(col, vec3(0.86, 0.95, 1.0), pow(1.0 - max(view.y, 0.0), 4.0) * 0.35);
        // toon foam bands along the shore
        float band = depth - (sin(uTime * 1.3 + vWorld.x * 0.05 + vWorld.z * 0.04) * 0.25 + 0.3);
        float foam = 1.0 - smoothstep(0.0, 0.25, band);
        float ring = smoothstep(0.55, 0.62, depth + n * 0.3 - 0.35 * sin(uTime * 0.9)) - smoothstep(0.66, 0.74, depth + n * 0.3 - 0.35 * sin(uTime * 0.9));
        foam = max(foam, ring * (1.0 - smoothstep(0.6, 1.6, depth)) * 0.9);
        foam *= step(0.45, n) * 0.4 + 0.6;
        col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uHeight.value = hTex;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 1, 1), mat);
  water.rotation.x = -Math.PI / 2; water.position.y = sea;
  scene.add(water);
  return { mesh: water, update(t) { mat.uniforms.uTime.value = t; } };
}

// ───────────────────────── grass: a field of blade clumps that wraps around the camera (no CPU work per frame)
export function makeGrass(scene, hTex, maskTex, count = 120000, size = 110) {
  // one clump = 5 short curved blades fanned around the centre
  const pos = [], idx = [], ht = [], nrm = [];
  const BL = 5, SEG = 3;
  for (let b = 0; b < BL; b++) {
    const rot = (b / BL) * Math.PI * 2 + b * 0.7, c = Math.cos(rot), s = Math.sin(rot);
    const lean = 0.08 + (b % 3) * 0.05, ox = Math.cos(rot * 1.7) * 0.07, oz = Math.sin(rot * 1.3) * 0.07;
    const h = 0.38 + (b % 3) * 0.09, w = 0.028;
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG, ww = w * (1 - t * 0.85), y = h * t, bend = lean * t * t;
      for (const side of [-1, 1]) {
        const lx = side * ww, lz = bend;
        pos.push(ox + lx * c - lz * s, y, oz + lx * s + lz * c); ht.push(t);
        nrm.push(-s * 0.6, 0.8, c * 0.6);
      }
    }
    for (let k = 0; k < SEG; k++) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(ht, 1));
  geo.setIndex(idx);
  const off = new Float32Array(count * 4), rnd = mulberry(99);
  for (let i = 0; i < count; i++) { off[i * 4] = rnd() * size; off[i * 4 + 1] = rnd() * size; off[i * 4 + 2] = rnd(); off[i * 4 + 3] = 0.6 + rnd() * 0.6; }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uHeight: { value: hTex }, uMask: { value: maskTex }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSize: { value: size },
      // base matches the terrain's grass colour so clumps melt into the ground
      cBase: { value: new THREE.Color(0x44792f) }, cTip: { value: new THREE.Color(0x9ccf5c) }, cDry: { value: new THREE.Color(0xc2bf62) },
      uSun: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
    }]),
    vertexShader: `
      attribute vec4 aOff; attribute float aH;
      uniform sampler2D uMask; uniform float uTime; uniform vec3 uCam; uniform float uSize; uniform vec3 uSun;
      varying float vH; varying float vTint; varying float vLight;
      ${HMAP_GLSL}
      #include <fog_pars_vertex>
      float covered(vec2 p){ return texture2D(uMask, (vec2(p.x, -p.y) + 850.0) / 1700.0).r; }
      void main(){
        vec2 base = uCam.xz + mod(aOff.xy - uCam.xz + uSize * 0.5, uSize) - uSize * 0.5;
        float h = hAt(base);
        float hx = hAt(base + vec2(1.5, 0.0)) - h, hz = hAt(base + vec2(0.0, 1.5)) - h;
        float slope = length(vec2(hx, hz)) / 1.5;
        // roads, slabs and buildings (plus a 2 m margin) stay clear of grass
        float cov = max(covered(base), max(max(covered(base + vec2(2.0, 0.0)), covered(base - vec2(2.0, 0.0))), max(covered(base + vec2(0.0, 2.0)), covered(base - vec2(0.0, 2.0)))));
        float d = distance(base, uCam.xz);
        float s = aOff.w * smoothstep(2.0, 3.5, h) * (1.0 - smoothstep(62.0, 70.0, h)) * (1.0 - smoothstep(0.75, 1.05, slope)) * (1.0 - step(0.2, cov));
        s *= 1.0 - smoothstep(uSize * 0.3, uSize * 0.47, d);
        float ang = aOff.z * 6.2831, ca = cos(ang), sa = sin(ang);
        vec3 p = position * s;
        p.xz = mat2(ca, -sa, sa, ca) * p.xz;
        float wind = sin(uTime * 1.6 + base.x * 0.07 + base.y * 0.05) * 0.6 + sin(uTime * 2.9 + base.x * 0.31 + base.y * 0.2) * 0.25;
        p.x += wind * aH * aH * 0.16 * s; p.z += wind * aH * aH * 0.09 * s;
        vec3 wp = vec3(base.x + p.x, h + p.y - 0.04, base.y + p.z);
        // blades right in front of the lens would fill the screen: fade them out near the camera
        float near = smoothstep(2.0, 4.5, distance(wp, cameraPosition));
        wp.y = mix(h - 0.2, wp.y, near);
        vec3 n = normal; n.xz = mat2(ca, -sa, sa, ca) * n.xz;
        vLight = 0.55 + 0.45 * abs(dot(normalize(n), uSun));
        vH = aH; vTint = fract(aOff.z * 13.7);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 cBase; uniform vec3 cTip; uniform vec3 cDry;
      varying float vH; varying float vTint; varying float vLight;
      #include <fog_pars_fragment>
      void main(){
        vec3 tip = mix(cTip, cDry, smoothstep(0.8, 1.0, vTint) * 0.5);
        vec3 col = mix(cBase * 0.8, tip, smoothstep(0.0, 1.0, vH));
        col *= mix(0.75, 1.0, vH) * vLight * 1.15;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // UniformsUtils.merge clones textures, which detaches a render-target texture: re-attach the originals
  mat.uniforms.uMask.value = maskTex; mat.uniforms.uHeight.value = hTex;
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  return { mesh, update(t, camPos) { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(camPos); } };
}

// ───────────────────────── post-processing: bloom + saturation/contrast/vignette grade
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.1 }, uContrast: { value: 1.06 }, uVignette: { value: 0.28 }, uWarm: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.18) * uContrast + 0.18;
      c.rgb += vec3(uWarm, uWarm * 0.4, -uWarm) * l;
      float v = smoothstep(0.85, 0.25, distance(vUv, vec2(0.5)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = max(c, 0.0); }`,
};
export function makeComposer(renderer, scene, camera, quality) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (quality !== 'low') { bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92); composer.addPass(bloom); }
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
  return {
    composer,
    resize(w, h) { composer.setSize(w, h); },
    render() { composer.render(); },
  };
}

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as L from './layout.js';
import * as T from './textures.js';
import { FOG_UNIFORMS, HEIGHT_FOG, patchFog } from './fog.js';
import { rope, hang, step } from './rope.js';

export const FOG_COLOR = '#121826';
export const FOG_DENSITY = 0.0085;

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/* How much of a chapter is on screen: 1 at its shot, 0 one chapter away. */
const on = (p, chapter, reach = 1) => smooth(0, 1, 1 - Math.abs(p - chapter) / reach);

function rep(tex, x, y) {
  const t = tex.clone();
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

/* ---------- glowing points: candle flames, lamps, fireflies, lanterns ---------- */
const GLOW_VS = /* glsl */`
  attribute float aSize; attribute vec3 aColor; attribute float aPhase; attribute float aFlicker; attribute float aDrift;
  uniform float uTime; uniform float uScale; uniform float uFogDensity;
  varying vec3 vColor; varying float vFade;
  void main() {
    vec3 p = position + aDrift * vec3(sin(uTime * 0.7 + aPhase * 6.0), sin(uTime * 0.9 + aPhase * 4.0) * 0.6, cos(uTime * 0.6 + aPhase * 5.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float flick = 0.5 + 0.5 * sin(uTime * (6.0 + aPhase * 3.0) + aPhase * 40.0) * sin(uTime * 13.0 + aPhase * 17.0);
    vColor = aColor * (1.0 - aFlicker * flick);
    float d = -mv.z;
    vFade = exp(-uFogDensity * uFogDensity * d * d);
    gl_PointSize = aSize * uScale / max(d, 0.1);
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FS = /* glsl */`
  uniform sampler2D uMap; uniform float uAmount;
  varying vec3 vColor; varying float vFade;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * a * vFade * uAmount, 1.0);
  }`;

function glowPoints(list, map) {
  const n = list.length;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const size = new Float32Array(n), phase = new Float32Array(n), flick = new Float32Array(n), drift = new Float32Array(n);
  list.forEach((d, i) => {
    pos.set(d.p, i * 3);
    col.set([d.color.r, d.color.g, d.color.b], i * 3);
    size[i] = d.size; phase[i] = d.phase ?? i * 0.37; flick[i] = d.flicker ?? 0; drift[i] = d.drift ?? 0;
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aFlicker', new THREE.BufferAttribute(flick, 1));
  g.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uTime: { value: 0 }, uScale: { value: 500 }, uAmount: { value: 1 }, uFogDensity: { value: FOG_DENSITY } },
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/* ---------- light in the air and on the ground ---------- */
const additive = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };

/* A cone of lamplight in the fog: bright down its middle and near the lamp, gone at its edges. */
function coneMaterial(color) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uColor: { value: color }, uAmount: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAmount; varying vec3 vN; varying vec3 vV; varying float vH;
      void main() { gl_FragColor = vec4(uColor * pow(abs(dot(vN, vV)), 2.0) * pow(clamp(vH, 0.0, 1.0), 1.6) * uAmount, 1.0); }`,
  });
}

/* A soft pool of light on the ground; `long` stretches it away from its source along v. */
function poolMaterial(color, long = false) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uColor: { value: color }, uAmount: { value: 1 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAmount; varying vec2 vUv;
      void main() {
        ${long
          ? 'float a = pow(max(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0), 1.5) * pow(clamp(vUv.y, 0.0, 1.0), 1.8);'
          : 'float a = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 2.2);'}
        gl_FragColor = vec4(uColor * a * uAmount, 1.0);
      }`,
  });
}

/* Lamps smeared on wet stone: one strip per lamp, lying on the ground and running toward the eye. */
function streaks(centers, color) {
  const pos = [], ctr = [], idx = [];
  centers.forEach((c, i) => {
    for (const [x, y] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(x, y, 0); ctr.push(...c); }
    const k = i * 4;
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: color }, uAmount: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 aCenter; varying vec2 vC;
      void main() {
        vec2 d = cameraPosition.xz - aCenter.xz;
        float len = length(d);
        vec2 dir = d / max(len, 1e-3), side = vec2(-dir.y, dir.x);
        vec2 xz = aCenter.xz + side * position.x * 0.35 + dir * position.y * min(9.0, len * 0.85);
        vC = position.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, aCenter.y, xz.y, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAmount; uniform float uTime; varying vec2 vC;
      void main() {
        float across = pow(max(1.0 - abs(vC.x), 0.0), 2.0);
        float along = pow(max(1.0 - vC.y, 0.0), 1.4) * smoothstep(0.0, 0.06, vC.y);
        float ripple = 0.75 + 0.25 * sin(vC.y * 46.0 - uTime * 5.0);
        gl_FragColor = vec4(uColor * across * along * ripple * uAmount, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------- the lake: a real reflection, rippled in the shader ---------- */
/* One table of ripples, [x freq, z freq, speed, height]. The water shader draws them; the boat rides them. */
const WAVES = [[0.55, 0, 0.9, 1], [0, 0.8, -0.7, 0.8], [1.9, -1.9, 1.6, 0.35], [1.3, 2.9, 2.3, 0.2], [4.1, -3.3, 3.1, 0.12]];
const f3 = (v) => v.toFixed(3);
const WAVES_GLSL = WAVES.map(([a, b, w, k]) => `${f3(k)} * sin(p.x * ${f3(a)} + p.y * ${f3(b)} + uTime * ${f3(w)})`).join(' + ');
export const wavesAt = (x, z, t) => WAVES.reduce((s, [a, b, w, k]) => s + k * Math.sin(x * a + z * b + t * w), 0);

const WaterShader = {
  name: 'GabiWater',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uTime: { value: 0 }, uFogColor: { value: new THREE.Color(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonColor: { value: new THREE.Color('#fff1d6') },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime;
    uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uMoonDir; uniform vec3 uMoonColor;
    varying vec4 vUv; varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    ${HEIGHT_FOG}
    float waves(vec2 p) { return ${WAVES_GLSL}; }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      float h = waves(p);
      vec2 g = vec2(waves(p + vec2(0.04, 0.0)) - h, waves(p + vec2(0.0, 0.04)) - h) / 0.04;
      vec4 uv = vUv;
      uv.x += g.x * 0.004 * uv.w;
      uv.y += g.y * 0.008 * uv.w;   // stretch lights into columns, the way water does
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = 0.3 + 0.7 * pow(1.0 - max(v.y, 0.0), 4.0);
      vec3 col = color + refl * fres * 0.8;
      // the moon path: glints off each ripple that faces the moon
      vec3 n = normalize(vec3(-g.x * 0.06, 1.0, -g.y * 0.06));
      float m = max(dot(reflect(-v, n), uMoonDir), 0.0);
      col += uMoonColor * (pow(m, 900.0) * 6.0 + pow(m, 90.0) * 0.12);
      float d = distance(vWorld, cameraPosition);
      col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * d * d));
      col = mix(col, fogMist, heightFog(cameraPosition, vWorld));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const SKY = {
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uMoonDir;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(uHorizon, uTop, pow(max(d.y, 0.0), 0.5));
      float m = max(dot(d, uMoonDir), 0.0);
      c += uGlow * (pow(m, 24.0) * 0.8 + pow(m, 5.0) * 0.18);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function buildWorld(scene, { reflectScale = 0.5 } = {}) {
  const updates = [];
  let dt = 0, lastT = 0; // seconds since the last update; 0 while the town is held still
  const glows = [];
  const add = (o) => { scene.add(o); return o; };
  const glowMap = T.glow();
  const addGlow = (list) => { const p = add(glowPoints(list, glowMap)); glows.push(p.material); return p; };
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); };

  /* ---------- sky, stars, far hills ---------- */
  const moonDir = new THREE.Vector3(L.MOON.x, L.MOON.y, L.MOON.z).normalize();
  const sky = add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    ...SKY, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color('#03050a') }, uHorizon: { value: new THREE.Color('#151c2b') }, uGlow: { value: new THREE.Color('#4a5878') }, uMoonDir: { value: moonDir } },
  })));
  sky.renderOrder = -2;

  const r = T.rng(41);
  const starPos = [], starPhase = [];
  while (starPos.length < 1300 * 3) {
    const v = new THREE.Vector3(r() * 2 - 1, r(), r() * 2 - 1);
    if (v.lengthSq() > 1 || v.y < 0.06) continue;
    v.normalize().multiplyScalar(820);
    starPos.push(v.x, v.y, v.z);
    starPhase.push(r());
  }
  const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(starPhase, 1));
  const starMat = new THREE.ShaderMaterial({ // each star breathes on its own clock, a few brighter than the rest
    ...additive,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aPhase; uniform float uTime; uniform float uPx; varying float vB;
      void main() {
        vB = (0.6 + 0.4 * sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 40.0)) * (0.5 + aPhase * 0.7);
        gl_PointSize = (1.3 + aPhase * aPhase * 1.8) * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vB;
      void main() { float a = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vec3(0.79, 0.82, 0.9) * vB * a, 1.0); }`,
  });
  const stars = add(new THREE.Points(starGeo, starMat));
  stars.renderOrder = -1.5;
  stars.frustumCulled = false;

  /* a few long clouds drifting across the moon's side of the sky */
  const sky2 = add(new THREE.Group());
  {
    const tex = T.mist(), rc = T.rng(97);
    const base = Math.atan2(L.MOON.z, L.MOON.x);
    for (let i = 0; i < 6; i++) {
      const a = base + (rc() - 0.5) * 1.6, h = 70 + rc() * 120;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#5a6684', transparent: true, opacity: 0.32 + rc() * 0.2, depthWrite: false, fog: false }));
      s.position.set(Math.cos(a) * 640, h, Math.sin(a) * 640);
      s.scale.set(260 + rc() * 200, 46 + rc() * 30, 1);
      s.renderOrder = -1;
      sky2.add(s);
    }
  }
  updates.push((t, p, cam) => {
    sky.position.copy(cam.position); stars.position.copy(cam.position);
    sky2.position.copy(cam.position);
    sky2.rotation.y = t * 0.0035;
    starMat.uniforms.uTime.value = t;
  });

  { // far hills: one ring of ridges around the whole lake basin
    const pts = [], N = 220;
    const R = 560, cx = -40, cz = 60;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = cx + R * Math.cos(a), z = cz + R * Math.sin(a);
      const h = 12 + 10 * Math.sin(i * 0.21) * Math.sin(i * 0.07 + 1) + 6 * Math.sin(i * 0.53) + 3 * r();
      pts.push(x, -4, z, x, Math.max(5, h), z);
    }
    const idx = [];
    for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#0b0f19', fog: false, side: THREE.DoubleSide })));
  }

  /* ---------- volcano island and moon ---------- */
  {
    const prof = [[46, -1], [41, 2], [31, 8.5], [19, 17], [14.5, 20], [12, 19.2], [8, 15], [0, 14]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(prof, 72);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { // gullies down the flanks, ridges between them
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i), ang = Math.atan2(z, x);
      const k = 1 + 0.05 * Math.sin(ang * 9) + 0.03 * Math.sin(ang * 23 + 1.3) + 0.015 * Math.sin(ang * 61 + y);
      a.setX(i, x * k); a.setZ(i, z * k);
      if (y > 1 && y < 19) a.setY(i, y + 0.5 * Math.sin(ang * 17 + y * 0.7) * Math.sin(y * 0.9));
    }
    g.computeVertexNormals();
    const v = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#171a21', roughness: 1, flatShading: true })));
    v.position.set(L.VOLCANO.x, 0, L.VOLCANO.z);

    // Taal still breathes: a slow plume of steam off the crater, lit by the moon
    const tex = T.mist(), puffs = [], rv = T.rng(13);
    for (let i = 0; i < 10; i++) {
      const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#8a96ac', transparent: true, depthWrite: false, opacity: 0 })));
      s.userData.phase = i / 10 + rv() * 0.05;
      puffs.push(s);
    }
    updates.push((t) => {
      for (const s of puffs) {
        const f = (t * 0.018 + s.userData.phase) % 1;
        s.position.set(L.VOLCANO.x + 3 + f * 14, L.VOLCANO.h - 1 + f * 30, L.VOLCANO.z - f * 4);
        s.scale.set(10 + f * 46, 7 + f * 22, 1);
        s.material.opacity = Math.sin(Math.PI * f) * 0.22;
      }
    });
  }
  const moon = add(new THREE.Mesh(new THREE.SphereGeometry(L.MOON.r, 48, 24),
    new THREE.MeshBasicMaterial({ map: T.moon(), color: hdr('#fff3dc', 1.7), fog: false })));
  moon.position.set(L.MOON.x, L.MOON.y, L.MOON.z);
  moon.layers.set(1); // the main camera sees it; the water's mirror does not, so the shader draws a moon path instead

  /* ---------- lights ---------- */
  add(new THREE.HemisphereLight('#2c3856', '#0b0c10', 1.1));
  const moonLight = add(new THREE.DirectionalLight('#a8bce4', 1.1));
  moonLight.position.copy(moonDir).multiplyScalar(100);
  const point = (hex, i, d, x, y, z) => { const l = new THREE.PointLight(hex, i, d, 2); l.position.set(x, y, z); return add(l); };

  /* ---------- water ---------- */
  const water = new Reflector(new THREE.PlaneGeometry(1400, 1400), {
    shader: WaterShader, color: '#05070c', textureWidth: 512, textureHeight: 512, clipBias: 0.003, multisample: 0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(L.BANK_X - 700, 0, 0);
  water.material.uniforms.uMoonDir.value.copy(moonDir);
  Object.assign(water.material.uniforms, FOG_UNIFORMS); // Reflector clones uniforms; share the live ones back
  add(water);
  updates.push((t) => { water.material.uniforms.uTime.value = t; });

  /* ---------- land: shore strip, terrace, stair ---------- */
  const stoneTex = T.stone();
  const coral = T.stone({ base: [150, 138, 118], seed: 9, rows: 10 });
  const mat = (map, x, y, extra = {}) => { const t = rep(map, x, y); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 2.5, roughness: 0.95, ...extra }); };
  const earth = new THREE.MeshStandardMaterial({ color: '#11150f', roughness: 1 });
  box(696, 3.6, 776, earth, L.BANK_X + 348, L.LOW_Y - 1.8, 372);
  box(8, 3.7, 76, mat(stoneTex, 2, 18), L.BANK_X + 4, L.LOW_Y - 1.75, 22); // the sea wall promenade
  box(86, 13, 124, mat(stoneTex, 22, 6), L.BANK_X + 43, L.PLATEAU_Y - 6.5, -78);

  /* wind: a breeze that gusts, plus a push when the walk speeds up. Palms, parols and rain all feel it. */
  const wind = new THREE.Vector3(), windDir = new THREE.Vector3(0.35, 0, 1).normalize();
  const windU = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() } };

  /* coconut palms on the shore, kept clear of the camera's path */
  {
    const rp = T.rng(83);
    const trunks = [], fronds = [];
    const frond = (() => { // a rib with leaflets, drooping toward its tip
      const v = [], len = 4.2, n = 22;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1.4) / n, w = 0.25 + 1.0 * Math.sin(Math.PI * Math.min(1, t0 * 1.15));
        for (const s of [-1, 1]) v.push(0, t0 * len, 0, 0, Math.min(t1, 1) * len, 0, s * w, t0 * len + 0.5, 0);
      }
      const sway = [];
      for (let i = 0; i < v.length; i += 3) { const y = v[i + 1]; v[i + 2] = -0.18 * y * y; sway.push(y / len); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1)); // 0 at the crown, 1 at the tip
      g.computeVertexNormals();
      return g;
    })();
    const spots = [[8, 30], [12, 44], [15, 72], [9, 90], [20, 104], [30, 4], [34, -6], [40, 14], [27, 26], [46, 34]];
    for (const [x, z] of spots) {
      const h = 7 + rp() * 5, lx = (rp() - 0.5) * 3, lz = (rp() - 0.5) * 3;
      const top = new THREE.Vector3(x + lx, L.LOW_Y + h, z + lz);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, L.LOW_Y - 0.5, z), new THREE.Vector3(x + lx * 0.2, L.LOW_Y + h * 0.5, z + lz * 0.2), top);
      trunks.push(new THREE.TubeGeometry(curve, 10, 0.17, 6));
      for (let k = 0; k < 9; k++) {
        const g = frond.clone();
        g.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.55 - rp() * 0.5)); // tip outward and down
        g.applyMatrix4(new THREE.Matrix4().makeRotationY((k / 9) * Math.PI * 2 + rp() * 0.4));
        g.translate(top.x, top.y, top.z);
        fronds.push(g);
      }
    }
    add(new THREE.Mesh(mergeGeometries(trunks), new THREE.MeshStandardMaterial({ color: '#1d1712', roughness: 1 })));
    const frondMat = new THREE.MeshStandardMaterial({ color: '#0f160e', roughness: 1, side: THREE.DoubleSide });
    frondMat.onBeforeCompile = (shader) => { // tips bend downwind and flutter; the crown holds
      Object.assign(shader.uniforms, windU);
      shader.vertexShader = 'attribute float aSway; uniform float uTime; uniform vec3 uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aSway * aSway;
        transformed += uWind * sw * (0.65 + 0.35 * sin(uTime * 1.9 + position.x * 0.5 + position.z * 0.3));
        transformed.y -= length(uWind) * sw * 0.25;`);
    };
    frondMat.customProgramCacheKey = () => 'gabi-frond';
    add(new THREE.Mesh(mergeGeometries(fronds), frondMat));
  }

  const S = L.STAIR;
  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(coral, 2, 0.4), S.steps);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < S.steps; i++) {
    const h = (i + 1) * L.stairRise;
    m4.compose(new THREE.Vector3(S.x, S.yBottom + h / 2, S.zBottom - (i + 0.5) * L.stairRun), new THREE.Quaternion(), new THREE.Vector3(S.w, h, L.stairRun));
    steps.setMatrixAt(i, m4);
  }
  add(steps);
  const run = S.zBottom - S.zTop;
  const cheekShape = new THREE.Shape([[0, S.yBottom], [0, S.yBottom + 0.9], [run, S.yTop + 0.9], [run, S.yBottom]].map(([a, b]) => new THREE.Vector2(a, b)));
  const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.5, bevelEnabled: false }).rotateY(Math.PI / 2);
  const cheekMat = mat(stoneTex, 0.6, 0.6);
  const cheekX = [S.x - S.w / 2 - 0.5, S.x + S.w / 2];
  for (const x of cheekX) {
    const c = new THREE.Mesh(cheekGeo, cheekMat);
    c.position.set(x, 0, S.zBottom);
    add(c);
  }

  /* candles on every third step, both sides */
  const wax = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#d8ccb4', roughness: 0.6 }), L.CANDLE_COUNT);
  const flames = [];
  let k = 0;
  for (const i of L.CANDLE_STEPS) {
    const s = (i + 0.5) * L.stairRun;
    const y = S.yBottom + 0.9 + s * ((S.yTop - S.yBottom) / run);
    for (const x of cheekX) {
      m4.makeTranslation(x + 0.25, y + 0.15, S.zBottom - s);
      wax.setMatrixAt(k++, m4);
      flames.push({ p: [x + 0.25, y + 0.38, S.zBottom - s], size: 0.22, color: hdr('#ffb65c', 3.2), flicker: 0.35 });
      flames.push({ p: [x + 0.25, y + 0.4, S.zBottom - s], size: 1.3, color: hdr('#ff8f3a', 0.22), flicker: 0.25 });
    }
  }
  add(wax);
  addGlow(flames);
  point('#ffa452', 18, 14, S.x, 2.6, -1);
  point('#ffa452', 18, 14, S.x, 7.6, -11);

  /* ---------- houses ---------- */
  const H = L.HOUSE;
  const houseStone = mat(stoneTex, 1.4, 0.8);
  const woodMat = mat(T.wood(), 3, 1, { roughness: 0.85 });
  const roofMat = mat(T.tiles(), 3, 2, { roughness: 0.8 });
  const capizTex = T.capiz();
  // three lamps' worth of lit windows, each breathing on its own, so the street looks lived in
  const lit = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ map: capizTex, color: hdr('#ffcf93', 1.9) }));
  updates.push((t) => lit.forEach((m, k) => m.color.copy(hdr('#ffcf93', 1.9 * (0.9 + 0.1 * Math.sin(t * (1.1 + k * 0.7) + k * 2) * Math.sin(t * 3.3 + k))))));
  const darkMat = new THREE.MeshStandardMaterial({ map: capizTex, color: '#4d4740', roughness: 0.6 });
  const doorMat = new THREE.MeshStandardMaterial({ color: '#1a120c', roughness: 0.9 });
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  const winGeo = new THREE.PlaneGeometry(1.5, 1.7);
  const doorGeo = new THREE.PlaneGeometry(1.6, 2.6);
  const rh = T.rng(77);
  for (const h of L.houses) {
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const toStreet = -h.side; // +x for houses on the west side
    const face = h.side < 0 ? h.x1 : h.x0;
    box(H.depth, H.ground, H.length, houseStone, cx, L.PLATEAU_Y + H.ground / 2, cz);
    const ux = cx + toStreet * H.overhang / 2;
    box(H.depth + H.overhang, H.upper, H.length, woodMat, ux, L.PLATEAU_Y + H.ground + H.upper / 2, cz);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.scale.set(H.depth + H.overhang + 0.8, H.roof, H.length + 0.8);
    roof.position.set(ux, L.PLATEAU_Y + H.ground + H.upper + H.roof / 2, cz);
    add(roof);
    const upperFace = face + toStreet * (H.overhang + 0.02);
    for (const dz of [-1.9, 0, 1.9]) {
      const w = new THREE.Mesh(winGeo, rh() < 0.62 ? lit[Math.floor(rh() * 3)] : darkMat);
      w.position.set(upperFace, L.PLATEAU_Y + H.ground + H.upper / 2, cz + dz);
      w.rotation.y = toStreet * Math.PI / 2;
      add(w);
    }
    const d = new THREE.Mesh(doorGeo, doorMat);
    d.position.set(face + toStreet * 0.02, L.PLATEAU_Y + 1.3, cz + (rh() - 0.5) * 2);
    d.rotation.y = toStreet * Math.PI / 2;
    add(d);
  }

  /* ---------- street, plaza, lamps ---------- */
  const street = new THREE.Mesh(new THREE.PlaneGeometry(L.STREET_W, 48), mat(stoneTex, 2, 16, { roughness: 0.32, metalness: 0.15 }));
  street.rotation.x = -Math.PI / 2;
  street.position.set(L.STREET_X, L.PLATEAU_Y + 0.01, -40);
  add(street);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), mat(coral, 6, 3, { roughness: 0.4, metalness: 0.1 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(L.STREET_X, L.PLATEAU_Y + 0.01, (L.PLAZA.z0 + L.PLAZA.z1) / 2);
  add(plaza);

  const iron = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6, metalness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8);
  const lamps = [];
  const LAMPS = [[15.4, -30], [20.6, -41], [15.4, -52], [20.6, -62], [9.5, -70], [26.5, -70]];
  const coneGeo = new THREE.CylinderGeometry(0.12, 2.3, 4.1, 24, 1, true);
  const coneMat = coneMaterial(hdr('#ff9c4f', 0.09));
  const poolGeo = new THREE.PlaneGeometry(5.6, 5.6).rotateX(-Math.PI / 2);
  const poolMat = poolMaterial(hdr('#ffa458', 0.5));
  for (const [x, z] of LAMPS) {
    const c = new THREE.Mesh(coneGeo, coneMat); c.position.set(x, L.PLATEAU_Y + 4.15 - 2.05, z); add(c);
    const pool = new THREE.Mesh(poolGeo, poolMat); pool.position.set(x, L.PLATEAU_Y + 0.03, z); add(pool);
  }
  const wet = add(streaks(LAMPS.map(([x, z]) => [x, L.PLATEAU_Y + 0.04, z]), hdr('#ffb066', 0.9)));
  updates.push((t, p) => {
    wet.material.uniforms.uTime.value = t;
    wet.material.uniforms.uAmount.value = Math.max(on(p, 3, 1.2), 0.35 * on(p, 4, 1));
  });
  for (const [x, z] of LAMPS) {
    const post = new THREE.Mesh(postGeo, iron);
    post.position.set(x, L.PLATEAU_Y + 2.1, z);
    add(post);
    box(0.34, 0.4, 0.34, iron, x, L.PLATEAU_Y + 4.35, z);
    lamps.push({ p: [x, L.PLATEAU_Y + 4.3, z], size: 0.7, color: hdr('#ffc27a', 3.4), flicker: 0.05 });
    lamps.push({ p: [x, L.PLATEAU_Y + 4.3, z], size: 3.6, color: hdr('#ff9c4f', 0.28) });
  }
  addGlow(lamps);
  point('#ffb066', 30, 16, 15.6, L.PLATEAU_Y + 4, -30);
  point('#ffb066', 30, 16, 20.4, L.PLATEAU_Y + 4, -52);

  /* ---------- the church ---------- */
  {
    const C = L.CHURCH, F = C.facade;
    const facadeMat = mat(coral, 5, 5);
    const fw = F.x1 - F.x0, fh = F.top - L.PLATEAU_Y;
    box(fw, fh, 2, facadeMat, L.STREET_X, L.PLATEAU_Y + fh / 2, (F.z0 + F.z1) / 2);
    const tri = (w, h) => new THREE.Shape([[-w / 2, 0], [w / 2, 0], [0, h]].map(([a, b]) => new THREE.Vector2(a, b)));
    const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(tri(fw, F.peak - F.top), { depth: 2, bevelEnabled: false }), facadeMat);
    ped.position.set(L.STREET_X, F.top, F.z0);
    add(ped);
    for (const y of [L.PLATEAU_Y + 10.6, F.top - 0.2]) box(fw + 1, 0.5, 2.6, facadeMat, L.STREET_X, y, -76.9);
    const colGeo = new THREE.CylinderGeometry(0.42, 0.46, 10.4, 16);
    for (const x of [9.5, 12, 24, 26.5]) { const c = new THREE.Mesh(colGeo, facadeMat); c.position.set(x, L.PLATEAU_Y + 5.2, -75.6); add(c); }
    const colGeo2 = new THREE.CylinderGeometry(0.34, 0.38, 10.8, 16);
    for (const x of [10.5, 13, 23, 25.5]) { const c = new THREE.Mesh(colGeo2, facadeMat); c.position.set(x, L.PLATEAU_Y + 16.3, -75.7); add(c); }
    const arch = (w, h) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2);
      s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0);
      return new THREE.ShapeGeometry(s, 16);
    };
    const doorLight = new THREE.Mesh(arch(4.4, 7.4), new THREE.MeshBasicMaterial({ color: hdr('#ffad66', 1.6) }));
    doorLight.position.set(L.STREET_X, L.PLATEAU_Y + 0.01, -75.95);
    add(doorLight);
    const niche = new THREE.MeshStandardMaterial({ color: '#17130f', roughness: 1 });
    for (const [x, y, w, h] of [[10.75, 2.6, 1.4, 3.4], [25.25, 2.6, 1.4, 3.4], [11.75, 13.2, 1.3, 3], [24.25, 13.2, 1.3, 3]]) {
      const n = new THREE.Mesh(arch(w, h), niche); n.position.set(x, L.PLATEAU_Y + y, -75.95); add(n);
    }
    const ocu = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ color: hdr('#ffcf8a', 1.1) }));
    ocu.position.set(L.STREET_X, L.PLATEAU_Y + 16.4, -75.95);
    add(ocu);
    const N = C.nave;
    box(N.x1 - N.x0, N.top - L.PLATEAU_Y, N.z1 - N.z0, mat(coral, 8, 4), L.STREET_X, (N.top + L.PLATEAU_Y) / 2, (N.z0 + N.z1) / 2);
    const nr = new THREE.Mesh(new THREE.ExtrudeGeometry(tri(N.x1 - N.x0 + 0.8, 5), { depth: N.z1 - N.z0, bevelEnabled: false }), roofMat);
    nr.position.set(L.STREET_X, N.top, N.z0);
    add(nr);
    const W = C.tower, tx = (W.x0 + W.x1) / 2, tz = (W.z0 + W.z1) / 2;
    box(7, 20, 7, facadeMat, tx, L.PLATEAU_Y + 10, tz);
    box(7.6, 0.5, 7.6, facadeMat, tx, L.PLATEAU_Y + 20.2, tz);
    box(6, 6, 6, facadeMat, tx, L.PLATEAU_Y + 23.4, tz);
    for (const [x, z, ry] of [[tx, W.z1 + 0.49, 0], [W.x0 + 0.49, tz, -Math.PI / 2]]) {
      const o = new THREE.Mesh(arch(2.2, 3.6), niche); o.position.set(x, L.PLATEAU_Y + 21.6, z); o.rotation.y = ry; add(o);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(stoneTex, 2, 1));
    dome.position.set(tx, L.PLATEAU_Y + 26.4, tz);
    add(dome);
    box(0.14, 2.2, 0.14, iron, tx, L.PLATEAU_Y + 30.4, tz);
    box(1, 0.14, 0.14, iron, tx, L.PLATEAU_Y + 30.9, tz);
    addGlow([{ p: [L.STREET_X, L.PLATEAU_Y + 3.6, -74.5], size: 9, color: hdr('#ff9b4f', 0.25) }]);
    // the open doors throw a long warm spill down the plaza, and a glow into the air in front of them
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(6, 16).rotateX(-Math.PI / 2), poolMaterial(hdr('#ffa458', 0.55), true));
    spill.position.set(L.STREET_X, L.PLATEAU_Y + 0.03, -76 + 8); // uv.y runs toward -z, so the bright end meets the door
    add(spill);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 4.2, 7, 24, 1, true).rotateX(-Math.PI / 2), coneMaterial(hdr('#ff9b4f', 0.06)));
    shaft.position.set(L.STREET_X, L.PLATEAU_Y + 3.2, -72.4);
    add(shaft);
    point('#ffa358', 60, 26, L.STREET_X, L.PLATEAU_Y + 3, -71);
  }

  /* ---------- parols: star lanterns on strings across the street and the plaza ---------- */
  {
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? 0.19 : 0.46, a = Math.PI / 2 + (i * Math.PI) / 5;
      i ? star.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : star.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const geo = new THREE.ExtrudeGeometry(star, { depth: 0.1, bevelEnabled: false }).center();
    // each string is a rope; each parol hangs half a metre below it on its own cord, so it swings
    const ropes = L.PAROL_STRINGS.map((d) => {
      const r = rope([d.x0, d.y, d.z], [d.x1, d.y, d.z], 12, d.sag);
      const nodes = [], weights = [];
      for (let i = 1; i <= d.n; i++) { const node = Math.round((12 * i) / (d.n + 1)); nodes.push(node); weights.push(hang(r, node, 0.5, 3)); }
      for (let k = 0; k < 240; k++) step(r, 1 / 60); // settle before the first frame
      return { r, nodes, weights };
    });
    const parols = ropes.flatMap(({ r, nodes, weights }) => weights.map((w, i) => ({ r, w, node: nodes[i] })));
    const lineMat = new THREE.LineBasicMaterial({ color: '#0c0c0c' });
    const strings = ropes.map(({ r }) => add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(r.pos.slice(0, 13 * 3), 3)), lineMat)));
    const cords = add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(parols.length * 6), 3)), lineMat));
    cords.frustumCulled = false;
    strings.forEach((l) => { l.frustumCulled = false; });
    for (const x of [9.5, 26.5]) box(0.1, 5.4, 0.1, iron, x, L.PLATEAU_Y + 2.7, -69);

    const at = (r, i, v) => v.set(r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]);
    const mesh = add(new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), parols.length));
    mesh.frustumCulled = false;
    const hues = ['#f2a03d', '#e4573d', '#f3e2bf', '#f2a03d', '#d94a3a'].map((h) => new THREE.Color(h));
    // they come on from the plaza back down the street, the way the camera sees them
    const order = parols.map(({ r, w }) => 4.15 + 0.7 * (r.pos[w * 3 + 2] + 72) / 50);
    const glow = addGlow(parols.map(({ r, w }, i) => ({ p: r.pos.slice(w * 3, w * 3 + 3), size: 2.4, color: hues[i % hues.length].clone().multiplyScalar(0.5) })));
    const glowCol = glow.geometry.attributes.aColor, glowPos = glow.geometry.attributes.position, cordPos = cords.geometry.attributes.position;
    const q = new THREE.Quaternion(), twist = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), Y = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1), c = new THREE.Color(), a = new THREE.Vector3(), b = new THREE.Vector3();
    updates.push((t, p) => {
      if (dt > 0) for (const { r } of ropes) step(r, dt, [wind.x, 0, wind.z]);
      ropes.forEach(({ r }, k) => { strings[k].geometry.attributes.position.array.set(r.pos.slice(0, 13 * 3)); strings[k].geometry.attributes.position.needsUpdate = true; });
      parols.forEach(({ r, w, node }, i) => {
        const lit = smooth(order[i], order[i] + 0.08, p);
        at(r, w, a); at(r, node, b);
        q.setFromUnitVectors(Y, up.subVectors(b, a).normalize()); // hang along the cord
        q.multiply(twist.setFromAxisAngle(Y, Math.sin(t * 0.4 + i) * 0.3)); // and turn a little on it
        m4.compose(a, q, one);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, c.copy(hues[i % hues.length]).multiplyScalar(0.06 + lit * 2.6));
        glowCol.setXYZ(i, ...c.copy(hues[i % hues.length]).multiplyScalar(lit * 0.55).toArray());
        glowPos.setXYZ(i, a.x, a.y, a.z);
        cordPos.setXYZ(i * 2, b.x, b.y, b.z);
        cordPos.setXYZ(i * 2 + 1, a.x, a.y + 0.45, a.z);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      glowCol.needsUpdate = true; glowPos.needsUpdate = true; cordPos.needsUpdate = true;
    });
  }

  /* ---------- the bangka ---------- */
  {
    const B = L.BANGKA;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: '#2d2119', roughness: 0.8 }));
    hull.scale.set(0.55, 0.32, 3.1);
    boat.add(hull);
    const pole = new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 0.9 });
    for (const x of [-2.3, 2.3]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.4, 6).rotateX(Math.PI / 2), pole);
      k.position.set(x, 0.06, 0); boat.add(k);
    }
    for (const z of [-0.9, 0.9]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.8, 6).rotateZ(Math.PI / 2), pole);
      b.position.set(0, 0.42, z); boat.add(b);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), pole);
    mast.position.set(0, 0.85, 2.1); boat.add(mast);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), new THREE.MeshBasicMaterial({ color: hdr('#ffbf73', 2.4) }));
    lantern.position.set(0, 1.5, 2.1); boat.add(lantern);
    boat.position.set(B.x, 0, B.z);
    boat.rotation.y = B.heading;
    add(boat);
    const lp = lantern.getWorldPosition(new THREE.Vector3());
    boat.updateMatrixWorld(true);
    lantern.getWorldPosition(lp);
    addGlow([{ p: lp.toArray(), size: 0.5, color: hdr('#ffc27a', 3), flicker: 0.1 }, { p: lp.toArray(), size: 4, color: hdr('#ff9c4f', 0.3) }]);
    point('#ffb066', 22, 18, lp.x, lp.y, lp.z);
    // it rides the same ripples the water draws: read them under bow, stern and both outriggers,
    // and let a damped spring follow, so the hull lags and settles like something with weight
    const fwd = [Math.sin(B.heading), Math.cos(B.heading)], side = [fwd[1], -fwd[0]];
    const under = (t, f, s) => wavesAt(B.x + fwd[0] * f + side[0] * s, B.z + fwd[1] * f + side[1] * s, t);
    const dof = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
    updates.push((t) => {
      const bow = under(t, 2.6, 0), stern = under(t, -2.6, 0), port = under(t, 0, 2.3), star = under(t, 0, -2.3);
      const goal = [(bow + stern + port + star) * 0.012, (stern - bow) * 0.008, (port - star) * 0.01];
      dof.forEach((d, i) => { d.v += (goal[i] - d.x) * 14 * dt; d.v *= Math.exp(-3 * dt); d.x += d.v * dt; });
      boat.position.y = dof[0].x;
      boat.rotation.x = dof[1].x;
      boat.rotation.z = dof[2].x;
    });
  }

  /* ---------- mist on the lake ---------- */
  {
    const tex = T.mist();
    const sprites = [];
    const rm = T.rng(53);
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#7f8ca6', transparent: true, depthWrite: false, opacity: 0 }));
      s.position.set(-50 + rm() * 50, 0.7 + rm() * 0.6, 24 + rm() * 70);
      s.scale.set(34 + rm() * 22, 4.5 + rm() * 2.5, 1);
      s.userData.x = s.position.x;
      sprites.push(add(s));
    }
    updates.push((t, p) => {
      const o = 0.22 * Math.max(on(p, 0, 1.4), on(p, 1, 1.2));
      sprites.forEach((s, i) => { s.material.opacity = o; s.position.x = s.userData.x + Math.sin(t * 0.04 + i) * 3; });
    });
  }

  /* ---------- rain over the street (chapter 3) ---------- */
  {
    const n = 1500, rr = T.rng(61);
    const pos = new Float32Array(n * 6), end = new Float32Array(n * 2), speed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = 9 + rr() * 18, y = 10 + rr() * 22, z = -18 - rr() * 48, v = 14 + rr() * 6;
      pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2); speed.set([v, v], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uSlant: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */`
        attribute float aEnd; attribute float aSpeed; uniform float uTime; uniform vec2 uSlant;
        void main() {
          vec3 p = position;
          p.y = 10.0 + mod(p.y - 10.0 - uTime * aSpeed, 22.0) - aEnd * 0.6;
          p.xz += aEnd * (vec2(0.06, 0.0) + uSlant);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform float uAmount; void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.76) * uAmount * 0.55, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const rain = add(new THREE.LineSegments(g, m));
    rain.frustumCulled = false;
    // where it lands: small rings that open and fade on the stones, each landing somewhere new
    const ns = 140, seeds = new Float32Array(ns);
    for (let i = 0; i < ns; i++) seeds[i] = rr();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ns * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const sm = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uScale: { value: 500 } },
      vertexShader: /* glsl */`
        attribute float aSeed; uniform float uTime; uniform float uScale; varying float vF;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float c = uTime * (1.6 + aSeed) + aSeed * 7.0, k = floor(c);
          vF = fract(c);
          vec3 p = vec3(15.3 + h(k * 12.9 + aSeed * 78.2) * 5.4, ${f3(L.PLATEAU_Y + 0.05)}, -18.0 - h(k * 4.1 + aSeed * 37.7) * 58.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.1 + vF * 0.2) * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uAmount; varying float vF;
        void main() {
          vec2 q = (gl_PointCoord - 0.5) * vec2(2.0, 5.0); // flattened: a ring lying on the ground
          float ring = 1.0 - smoothstep(0.0, 0.18, abs(length(q) - mix(0.15, 0.9, vF)));
          gl_FragColor = vec4(vec3(0.6, 0.68, 0.82) * ring * (1.0 - vF) * uAmount * 0.32, 1.0);
        }`,
    });
    const splashes = add(new THREE.Points(sg, sm));
    splashes.frustumCulled = false;
    updates.push((t, p, cam, scale) => {
      const a = on(p, 3, 0.9);
      rain.visible = splashes.visible = a > 0.01;
      m.uniforms.uTime.value = sm.uniforms.uTime.value = t;
      m.uniforms.uAmount.value = sm.uniforms.uAmount.value = a;
      m.uniforms.uSlant.value.set(wind.x, wind.z).multiplyScalar(0.03);
      sm.uniforms.uScale.value = scale;
    });
  }

  /* ---------- fireflies by the stair (chapter 2) ---------- */
  {
    const rf = T.rng(71), list = [];
    for (let i = 0; i < 70; i++) {
      const x = 10 + rf() * 16, z = -14 + rf() * 24;
      list.push({ p: [x, L.groundAt(x, z) + 0.8 + rf() * 4, z], size: 0.16, color: hdr('#d6ee86', 2.4), flicker: 0.95, drift: 0.5 + rf() * 0.8, phase: rf() * 10 });
    }
    const ff = addGlow(list);
    updates.push((t, p) => { ff.material.uniforms.uAmount.value = on(p, 2, 1.1); ff.visible = ff.material.uniforms.uAmount.value > 0.01; });
  }

  patchFog(scene);
  const fogCool = new THREE.Color(FOG_COLOR), fogWarm = new THREE.Color('#1c1814');

  return {
    water,
    /* `gust` is 0 to 1: how fast the visitor is walking right now. */
    update(t, p, camera, bufferH, gust = 0) {
      dt = Math.min(Math.max(t - lastT, 0), 0.05);
      lastT = t;
      const breeze = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
      wind.copy(windDir).multiplyScalar(0.8 + 1.8 * breeze * breeze + 6 * gust);
      windU.uTime.value = t;
      windU.uWind.value.copy(windDir).multiplyScalar(0.12 + 0.12 * breeze + 0.45 * gust);
      FOG_UNIFORMS.fogTime.value = t;
      // the lamplit streets warm the fog a little
      scene.fog.color.lerpColors(fogCool, fogWarm, 0.7 * Math.max(on(p, 3, 1.3), on(p, 4, 1.3)));
      water.material.uniforms.uFogColor.value.copy(scene.fog.color);
      starMat.uniforms.uPx.value = bufferH / window.innerHeight;
      const scale = bufferH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      for (const m of glows) { m.uniforms.uTime.value = t; m.uniforms.uScale.value = scale; }
      for (const u of updates) u(t, p, camera, scale);
    },
    setSize(w, h) { water.getRenderTarget().setSize(Math.round(w * reflectScale), Math.round(h * reflectScale)); },
  };
}

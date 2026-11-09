import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as L from './layout.js';
import * as T from './textures.js';

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

/* ---------- the lake: a real reflection, rippled in the shader ---------- */
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
    float waves(vec2 p) {
      return sin(p.x * 0.55 + uTime * 0.9) + 0.8 * sin(p.y * 0.8 - uTime * 0.7)
           + 0.35 * sin((p.x - p.y) * 1.9 + uTime * 1.6) + 0.2 * sin(p.x * 1.3 + p.y * 2.9 + uTime * 2.3)
           + 0.12 * sin(p.x * 4.1 - p.y * 3.3 + uTime * 3.1);
    }
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
  const starPos = [];
  while (starPos.length < 1300 * 3) {
    const v = new THREE.Vector3(r() * 2 - 1, r(), r() * 2 - 1);
    if (v.lengthSq() > 1 || v.y < 0.06) continue;
    v.normalize().multiplyScalar(820);
    starPos.push(v.x, v.y, v.z);
  }
  const stars = add(new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: '#c9d2e6', size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75, depthWrite: false }),
  ));
  stars.renderOrder = -1;
  updates.push((t, p, cam) => { sky.position.copy(cam.position); stars.position.copy(cam.position); });

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
    for (let i = 0; i < a.count; i++) { // gullies down the flanks
      const x = a.getX(i), z = a.getZ(i), ang = Math.atan2(z, x);
      const k = 1 + 0.05 * Math.sin(ang * 9) + 0.03 * Math.sin(ang * 23 + 1.3);
      a.setX(i, x * k); a.setZ(i, z * k);
    }
    g.computeVertexNormals();
    const v = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#1d2028', roughness: 1, flatShading: true })));
    v.position.set(L.VOLCANO.x, 0, L.VOLCANO.z);
  }
  const moon = add(new THREE.Mesh(new THREE.SphereGeometry(L.MOON.r, 48, 24),
    new THREE.MeshBasicMaterial({ map: T.moon(), color: hdr('#fff3dc', 1.7), fog: false })));
  moon.position.set(L.MOON.x, L.MOON.y, L.MOON.z);
  moon.layers.set(1); // the main camera sees it; the water's mirror does not, so the shader draws a moon path instead

  /* ---------- lights ---------- */
  add(new THREE.HemisphereLight('#2c3856', '#0d0b09', 1.1));
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
  add(water);
  updates.push((t) => { water.material.uniforms.uTime.value = t; });

  /* ---------- land: shore strip, terrace, stair ---------- */
  const stoneTex = T.stone();
  const coral = T.stone({ base: [150, 138, 118], seed: 9, rows: 10 });
  const mat = (map, x, y, extra = {}) => new THREE.MeshStandardMaterial({ map: rep(map, x, y), roughness: 0.95, ...extra });
  const earth = new THREE.MeshStandardMaterial({ color: '#11150f', roughness: 1 });
  box(696, 3.6, 776, earth, L.BANK_X + 348, L.LOW_Y - 1.8, 372);
  box(8, 3.7, 76, mat(stoneTex, 2, 18), L.BANK_X + 4, L.LOW_Y - 1.75, 22); // the sea wall promenade
  box(86, 13, 124, mat(stoneTex, 22, 6), L.BANK_X + 43, L.PLATEAU_Y - 6.5, -78);

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
      for (let i = 0; i < v.length; i += 3) { const y = v[i + 1]; v[i + 2] = -0.18 * y * y; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
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
    add(new THREE.Mesh(mergeGeometries(fronds), new THREE.MeshStandardMaterial({ color: '#0f160e', roughness: 1, side: THREE.DoubleSide })));
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
  const wax = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#d8ccb4', roughness: 0.6 }), 24);
  const flames = [];
  let k = 0;
  for (let i = 1; i < S.steps; i += 3) {
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
  const litMat = new THREE.MeshBasicMaterial({ map: capizTex, color: hdr('#ffcf93', 1.9) });
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
      const w = new THREE.Mesh(winGeo, rh() < 0.62 ? litMat : darkMat);
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
  for (const [x, z] of [[15.4, -30], [20.6, -41], [15.4, -52], [20.6, -62], [9.5, -70], [26.5, -70]]) {
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
    const parols = [];
    const strings = [];
    const hang = (ax, bx, y, z, n, sag) => {
      const line = [];
      for (let i = 0; i <= 12; i++) { const u = i / 12; line.push(ax + (bx - ax) * u, y - sag * 4 * u * (1 - u), z); }
      strings.push(line);
      for (let i = 1; i <= n; i++) {
        const u = i / (n + 1);
        parols.push(new THREE.Vector3(ax + (bx - ax) * u, y - sag * 4 * u * (1 - u) - 0.5, z));
      }
    };
    const upperY = L.PLATEAU_Y + H.ground + H.upper - 0.2;
    for (let i = 0; i < 6; i++) hang(L.STREET_X - 2.9, L.STREET_X + 2.9, upperY, -23 - i * 7.2, 3, 0.5);
    for (const z of [-66.5, -71.5]) hang(9.5, 26.5, L.PLATEAU_Y + 5.4, z, 5, 0.8);
    const lineMat = new THREE.LineBasicMaterial({ color: '#0c0c0c' });
    for (const s of strings) add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(s, 3)), lineMat));
    for (const x of [9.5, 26.5]) box(0.1, 5.4, 0.1, iron, x, L.PLATEAU_Y + 2.7, -69);

    const mesh = add(new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), parols.length));
    const hues = ['#f2a03d', '#e4573d', '#f3e2bf', '#f2a03d', '#d94a3a'].map((h) => new THREE.Color(h));
    // they come on from the plaza back down the street, the way the camera sees them
    const order = parols.map((p) => 4.15 + 0.7 * (p.z + 72) / 50);
    const glow = addGlow(parols.map((p, i) => ({ p: p.toArray(), size: 2.4, color: hues[i % hues.length].clone().multiplyScalar(0.5) })));
    const glowCol = glow.geometry.attributes.aColor;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    updates.push((t, p) => {
      parols.forEach((pos, i) => {
        const lit = smooth(order[i], order[i] + 0.08, p);
        e.set(0, Math.sin(t * 0.4 + i) * 0.25, Math.sin(t * 1.3 + i * 1.7) * 0.08);
        m4.compose(pos, q.setFromEuler(e), one);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, c.copy(hues[i % hues.length]).multiplyScalar(0.06 + lit * 2.6));
        glowCol.setXYZ(i, ...c.copy(hues[i % hues.length]).multiplyScalar(lit * 0.55).toArray());
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      glowCol.needsUpdate = true;
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
    updates.push((t) => {
      boat.position.y = Math.sin(t * 1.1) * 0.04;
      boat.rotation.z = Math.sin(t * 0.9) * 0.03;
      boat.rotation.x = Math.sin(t * 0.7) * 0.02;
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
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aEnd; attribute float aSpeed; uniform float uTime;
        void main() {
          vec3 p = position;
          p.y = 10.0 + mod(p.y - 10.0 - uTime * aSpeed, 22.0) - aEnd * 0.6;
          p.x += aEnd * 0.06;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform float uAmount; void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.76) * uAmount * 0.55, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const rain = add(new THREE.LineSegments(g, m));
    rain.frustumCulled = false;
    updates.push((t, p) => {
      const a = on(p, 3, 0.9);
      rain.visible = a > 0.01;
      m.uniforms.uTime.value = t;
      m.uniforms.uAmount.value = a;
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

  return {
    water,
    update(t, p, camera, bufferH) {
      const scale = bufferH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      for (const m of glows) { m.uniforms.uTime.value = t; m.uniforms.uScale.value = scale; }
      for (const u of updates) u(t, p, camera);
    },
    setSize(w, h) { water.getRenderTarget().setSize(Math.round(w * reflectScale), Math.round(h * reflectScale)); },
  };
}

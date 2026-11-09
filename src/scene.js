import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildWorld, FOG_COLOR, FOG_DENSITY } from './world.js';
import { anchorsFor, progressAt, poseAt, damp, clamp, NOTES } from './path.js';

/*
 * The grade, in linear light before tone mapping: cool shadows and warm highlights (moonlight and
 * lamplight), a trace of colour fringing toward the corners as a real lens has, grain and a vignette.
 */
const Grade = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 o = (vUv - 0.5) * 0.004 * length(vUv - 0.5);
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(0.9, 0.97, 1.1), vec3(1.07, 1.0, 0.9), smoothstep(0.02, 0.5, l));
      vec2 q = (vUv - 0.5) * vec2(1.15, 1.0);
      c *= mix(0.5, 1.0, 1.0 - smoothstep(0.22, 0.82, length(q)));
      c += (hash(vUv * 1024.0 + fract(uTime * 7.3) * 91.0) - 0.5) * 0.03 * (0.25 + c);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/*
 * `still`: for reduced motion. The camera never moves; each chapter is one held shot, cut to as you
 * scroll, and a frame is drawn only when the shot changes.
 */
export function start(canvas, sections, { onFirstFrame, onLost, still = false } = {}) {
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  let dpr = Math.min(window.devicePixelRatio || 1, weak ? 1.25 : 1.75);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let stopped = false;
  canvas.addEventListener('webglcontextlost', () => { stopped = true; onLost?.(); });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1400);
  camera.layers.enable(1); // the moon lives on layer 1, out of the water's mirror
  const world = buildWorld(scene, { reflectScale: weak ? 0.35 : 0.5 });

  // multisampled, so roof edges and stair nosings don't crawl; weak GPUs keep their pixels for the scene
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: weak ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.92));
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  let anchors = [0, 1];
  let bufferH = 1;
  let dirty = true;
  const measure = () => {
    dirty = true;
    const y = window.scrollY;
    anchors = anchorsFor(
      sections.map((s) => { const r = s.getBoundingClientRect(); return { top: r.top + y, height: r.height }; }),
      window.innerHeight,
      Math.max(1, document.documentElement.scrollHeight - window.innerHeight),
    );
  };
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    bufferH = h * dpr;
    world.setSize(w * dpr, h * dpr);
    measure();
  };
  window.addEventListener('resize', resize);
  new ResizeObserver(measure).observe(document.body);
  resize();

  /* A hand-held drift that follows a mouse, never a finger. */
  let tx = 0, ty = 0, mx = 0, my = 0;
  if (!still && matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; });
  }

  const pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  let p = progressAt(window.scrollY, anchors);
  let t = 0, last = performance.now(), first = true;
  let slow = 0; // net seconds spent under 40 fps; enough of them and the GPU gets fewer pixels
  let gust = 0; // how fast the walk is going, 0 to 1: it stirs the wind
  function frame(now) {
    if (stopped) return;
    requestAnimationFrame(frame);
    const gap = (now - last) / 1000, dt = Math.min(gap, 0.05);
    last = now;
    if (still) {
      const shot = Math.round(progressAt(window.scrollY, anchors));
      if (shot === p && !dirty) return;
      p = shot;
    } else {
      t += dt;
      const before = p;
      p = damp(p, progressAt(window.scrollY, anchors), 4.5, dt);
      if (dt > 0) gust = damp(gust, clamp(Math.abs(p - before) / dt * 0.9, 0, 1), 2.5, dt);
      // a gap of a quarter second or more is a throttled background window, not a slow GPU
      if (gap < 0.25) slow = dt > 1 / 40 ? slow + dt : Math.max(0, slow - dt / 2);
      if (slow > 3 && dpr > 0.75) { dpr = Math.max(0.75, dpr * 0.75); slow = 0; resize(); }
    }
    dirty = false;
    poseAt(p, camera.aspect, pose);
    mx = damp(mx, tx, 2.4, dt); my = damp(my, ty, 2.4, dt);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.translateX(mx * 0.35);
    camera.translateY(-my * 0.2);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    world.update(t, p, camera, bufferH, gust);
    grade.uniforms.uTime.value = t;
    composer.render(dt);
    if (first) { first = false; onFirstFrame?.(); }
  }
  requestAnimationFrame(frame);

  /*
   * Field notes: frame each close look, render it, and copy the centre of the frame into its card
   * straight away (the drawing buffer is only readable in the same task). The next frame puts the
   * walk back.
   */
  function drawNotes(canvases) {
    const gl = renderer.domElement, W = gl.width, H = gl.height;
    for (const n of NOTES) {
      const card = canvases.find((c) => c.dataset.note === n.id);
      if (!card) continue;
      const ar = card.clientWidth / Math.max(card.clientHeight, 1);
      const cw = Math.min(W, H * ar), ch = cw / ar;
      card.width = Math.round(cw); card.height = Math.round(ch);
      camera.position.fromArray(n.p);
      camera.lookAt(n.t[0], n.t[1], n.t[2]);
      camera.fov = n.fov;
      camera.updateProjectionMatrix();
      world.update(t, n.at, camera, bufferH, 0);
      composer.render(0);
      card.getContext('2d').drawImage(gl, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, card.width, card.height);
    }
    dirty = true;
  }
  return { measure, drawNotes };
}

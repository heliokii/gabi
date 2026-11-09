import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildWorld, FOG_COLOR, FOG_DENSITY } from './world.js';
import { anchorsFor, progressAt, poseAt, damp } from './path.js';

/* Film grain and a soft vignette, applied in linear light before tone mapping. */
const Grade = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = (vUv - 0.5) * vec2(1.15, 1.0);
      c *= mix(0.5, 1.0, smoothstep(0.82, 0.22, length(q)));
      c += (hash(vUv * 1024.0 + fract(uTime * 7.3) * 91.0) - 0.5) * 0.03 * (0.25 + c);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function start(canvas, sections, { onFirstFrame } = {}) {
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const dpr = Math.min(window.devicePixelRatio || 1, weak ? 1.25 : 1.75);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1400);
  camera.layers.enable(1); // the moon lives on layer 1, out of the water's mirror
  const world = buildWorld(scene, { reflectScale: weak ? 0.35 : 0.5 });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.92));
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  let anchors = [0, 1];
  let bufferH = 1;
  const measure = () => {
    const y = window.scrollY;
    anchors = anchorsFor(
      sections.map((s) => { const r = s.getBoundingClientRect(); return { top: r.top + y, height: r.height }; }),
      window.innerHeight,
      Math.max(1, document.documentElement.scrollHeight - window.innerHeight),
    );
  };
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
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
  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; });
  }

  const pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  let p = progressAt(window.scrollY, anchors);
  let t = 0, last = performance.now(), first = true;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now; t += dt;
    p = damp(p, progressAt(window.scrollY, anchors), 4.5, dt);
    poseAt(p, camera.aspect, pose);
    mx = damp(mx, tx, 2.4, dt); my = damp(my, ty, 2.4, dt);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.translateX(mx * 0.35);
    camera.translateY(-my * 0.2);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    world.update(t, p, camera, bufferH);
    grade.uniforms.uTime.value = t;
    composer.render(dt);
    if (first) { first = false; onFirstFrame?.(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { measure };
}

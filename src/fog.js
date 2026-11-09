import { Color, ShaderChunk, Vector3 } from 'three';

/*
 * Mist that lies on the water and thins with height, on top of the usual distance fog. It drifts:
 * noise in the density moves with time, so banks roll over the lake and settle between the houses.
 * Every built-in material picks this up through three's fog chunks; patchFog() hands them the shared
 * uniforms. Custom shaders (the water) include HEIGHT_FOG themselves.
 */
export const FOG_UNIFORMS = {
  fogTime: { value: 0 },
  fogHeight: { value: new Vector3(0.022, 0.12, 0.7) }, // density at the water, falloff per metre, patchiness
  fogMist: { value: new Color('#3a4560') },
};

export const HEIGHT_FOG = /* glsl */`
  uniform float fogTime; uniform vec3 fogHeight; uniform vec3 fogMist;
  float fogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fogNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fogHash(i), fogHash(i + vec2(1, 0)), f.x), mix(fogHash(i + vec2(0, 1)), fogHash(i + vec2(1, 1)), f.x), f.y);
  }
  // The density a * exp(-b * y), integrated along the ray from the eye to the point.
  float heightFog(vec3 eye, vec3 wp) {
    vec3 rd = wp - eye;
    float t = length(rd);
    rd /= max(t, 1e-4);
    float k = rd.y * fogHeight.y;
    float along = abs(k) < 1e-4 ? t : (1.0 - exp(-clamp(k * t, -30.0, 30.0))) / k;
    float amount = fogHeight.x * exp(-fogHeight.y * eye.y) * along;
    vec2 q = wp.xz;
    float n = fogNoise(q * 0.045 + vec2(fogTime * 0.05, fogTime * 0.02)) * 0.6 + fogNoise(q * 0.12 - fogTime * 0.04) * 0.4;
    amount *= mix(1.0, n * 2.0, fogHeight.z);
    return 1.0 - exp(-amount);
  }
`;

ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif`;
ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${HEIGHT_FOG}
#endif`;
ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogMist, heightFog( cameraPosition, vFogWorld ) );
#endif`;

/* Give every fogged built-in material under `root` the shared mist uniforms, keeping its own onBeforeCompile. */
export function patchFog(root) {
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      if (!m.fog || m.isShaderMaterial || m.userData.mist) continue;
      m.userData.mist = true;
      const before = m.onBeforeCompile;
      m.onBeforeCompile = function (shader, renderer) {
        Object.assign(shader.uniforms, FOG_UNIFORMS);
        before.call(this, shader, renderer);
      };
    }
  });
}

import { CatmullRomCurve3, Vector3 } from 'three';

/*
 * One camera walk through the town. Each chapter of the page has a waypoint (where the camera
 * stands, what it looks at, its lens). Scroll gives a float chapter index, and the pose is read
 * off two splines through the waypoints, so every frame follows from the scroll position alone.
 */
export const WAYPOINTS = [
  { id: 'top',      p: [2, 3.2, 40],     t: [-18, 13.2, 140], fov: 40 }, // the lake, the volcano, the moon
  { id: 'lawa',     p: [-8, 1.8, 18],    t: [-22, 2, 50],    fov: 44 }, // down by the bangka, facing the moon
  { id: 'hagdan',   p: [17, 4.5, 11],    t: [18, 9, -14],    fov: 46 }, // foot of the stair
  { id: 'bahay',    p: [18, 12.6, -22],  t: [18, 12.2, -56], fov: 48 }, // the street of stone houses
  { id: 'simbahan', p: [18, 13, -50],    t: [18, 22, -76],   fov: 46 }, // the church
  { id: 'liwanag',  p: [18, 30, -71],    t: [30, 8, 21],     fov: 48 }, // above the plaza, down the street to the lake
];
/* Field notes: three close looks, drawn once from the live town. `p` is the chapter whose weather they wear. */
export const NOTES = [
  { id: 'bangka', p: [-7.5, 4.2, 21], t: [-18, 0.4, 31.5], fov: 36, at: 2 }, // above the mist, so the hull reads
  { id: 'capiz', p: [19.6, 14.2, -21.2], t: [15.1, 14.9, -23.4], fov: 42, at: 3 },
  { id: 'parols', p: [18, 12.4, -57], t: [18, 15.6, -69], fov: 48, at: 5 },
];

const N = WAYPOINTS.length - 1;
const v3 = (a) => new Vector3(a[0], a[1], a[2]);
const curveP = new CatmullRomCurve3(WAYPOINTS.map((w) => v3(w.p)), false, 'centripetal');
const curveT = new CatmullRomCurve3(WAYPOINTS.map((w) => v3(w.t)), false, 'centripetal');

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
/* Frame-rate independent easing toward a target: the same feel at 30 or 144 fps. */
export const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

/*
 * Scroll positions at which each chapter is "the" shot: where the section's centre meets the
 * viewport's centre, or the bottom of the page if it never gets there. The first is the top.
 * Always increasing. Past the last one (the footer) the camera holds the final shot.
 */
export function anchorsFor(sections, viewportH, maxScroll) {
  const a = sections.map((s, i) => (i === 0 ? 0 : clamp(s.top + s.height / 2 - viewportH / 2, 0, maxScroll)));
  for (let i = 1; i < a.length; i++) a[i] = Math.max(a[i], a[i - 1] + 1);
  return a;
}

/* Scroll position to a float chapter index, 0 to N. */
export function progressAt(y, anchors) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (y <= anchors[i + 1]) return i + (y - anchors[i]) / (anchors[i + 1] - anchors[i]);
  }
  return anchors.length - 1;
}

/*
 * Camera pose for a float chapter index. Every shot is framed for a wide screen, so on a tall one
 * the camera steps back along its own view line and opens the lens rather than crop the subject.
 */
export function poseAt(progress, aspect = 16 / 9, out = { position: new Vector3(), target: new Vector3(), fov: 0 }) {
  const p = clamp(progress, 0, N);
  curveP.getPoint(p / N, out.position);
  curveT.getPoint(p / N, out.target);
  const i = Math.min(Math.floor(p), N - 1);
  let fov = lerp(WAYPOINTS[i].fov, WAYPOINTS[i + 1].fov, p - i);
  const tall = clamp((1.5 - aspect) / 1.05, 0, 1);
  if (tall > 0) {
    const back = out.position.clone().sub(out.target).normalize();
    out.position.addScaledVector(back, tall * 2);
    out.position.y += tall * 0.8;
    fov *= 1 + tall * 0.55;
  }
  out.fov = fov;
  return out;
}

export const CHAPTER_COUNT = WAYPOINTS.length;

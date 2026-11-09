/*
 * A Verlet rope: points that remember where they were, joined by fixed-length links. Ends can be
 * pinned, and weights can hang from any point on a short link of their own, so they swing.
 * Positions live in one flat array, [x, y, z, x, y, z, ...].
 */
const G = -9.8;
const STEP = 1 / 60;
const DAMP = 0.985;

/* A rope from a to b in n segments, hanging in a parabola `sag` deep. Its links keep that shape's lengths. */
export function rope(a, b, n, sag) {
  const pos = [], links = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pos.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u);
  }
  const r = { pos, prev: [], pinned: [], area: [], links, n: n + 1, carry: 0 };
  for (let i = 0; i <= n; i++) { r.pinned.push(i === 0 || i === n); r.area.push(1); }
  for (let i = 0; i < n; i++) links.push([i, i + 1, dist(r, i, i + 1)]);
  r.prev = pos.slice();
  return r;
}

/* Hang a weight `drop` below point i. It catches `area` times the wind a rope point does. Returns its index. */
export function hang(r, i, drop, area = 1) {
  const k = r.n++;
  r.pos.push(r.pos[i * 3], r.pos[i * 3 + 1] - drop, r.pos[i * 3 + 2]);
  r.prev.push(r.pos[i * 3], r.pos[i * 3 + 1] - drop, r.pos[i * 3 + 2]);
  r.pinned.push(false);
  r.area.push(area);
  r.links.push([i, k, drop]);
  return k;
}

function dist(r, i, j) {
  const p = r.pos;
  return Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
}

/* Advance by dt seconds in fixed steps. `wind` is an acceleration [x, y, z], scaled by each point's area. */
export function step(r, dt, wind = [0, 0, 0], iterations = 8) {
  r.carry = Math.min(r.carry + dt, STEP * 4);
  const { pos: p, prev: q } = r;
  while (r.carry >= STEP) {
    r.carry -= STEP;
    for (let i = 0; i < r.n; i++) {
      if (r.pinned[i]) continue;
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const v = (p[k + c] - q[k + c]) * DAMP;
        q[k + c] = p[k + c];
        p[k + c] += v + (wind[c] * r.area[i] + (c === 1 ? G : 0)) * STEP * STEP;
      }
    }
    for (let it = 0; it < iterations; it++) {
      for (const [i, j, len] of r.links) {
        const d = dist(r, i, j) || 1e-6, diff = (d - len) / d;
        const wi = r.pinned[i] ? 0 : 1, wj = r.pinned[j] ? 0 : 1;
        if (!wi && !wj) continue;
        const s = diff / (wi + wj);
        for (let c = 0; c < 3; c++) {
          const delta = (p[j * 3 + c] - p[i * 3 + c]) * s;
          p[i * 3 + c] += delta * wi;
          p[j * 3 + c] -= delta * wj;
        }
      }
    }
  }
}

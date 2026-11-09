import { rng } from './rng.js';

/*
 * Near-camera silhouettes for some chapters: cogon grass, banana leaves, bamboo, a tiled eave. Drawn as SVG paths from a seed, so the page ships no cut-out images.
 */
const n = (v) => v.toFixed(1);
const svg = (box, body, fit = 'xMidYMax slice') =>
  `<svg viewBox="${box}" preserveAspectRatio="${fit}" focusable="false">${body}</svg>`;

function grass(seed, tallest) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < 190; i++) {
    const x = r() * 1600, h = tallest * (0.3 + r() * 0.7), lean = (r() - 0.5) * h * 0.8, w = 2.5 + r() * 4.5;
    const cx = x + lean * 0.3, cy = 280 - h * 0.6;
    d += `M${n(x - w)},280Q${n(cx - w * 0.4)},${n(cy)} ${n(x + lean)},${n(280 - h)}Q${n(cx + w * 0.4)},${n(cy)} ${n(x + w)},280Z`;
  }
  return svg('0 0 1600 280', `<path d="${d}"/>`);
}

/* A banana leaf: a drooping midrib and a blade torn into strips, the way wind leaves them. */
function leaf(r, bx, by, angle, len, wid, droop) {
  const steps = 26, pts = [];
  let x = bx, y = by, a = angle;
  for (let i = 0; i <= steps; i++) { pts.push([x, y, a]); x += Math.cos(a) * (len / steps); y += Math.sin(a) * (len / steps); a += droop / steps; }
  const width = (t) => wid * (t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 2.4));
  let d = '';
  for (let i = 1; i < steps; i++) {
    const [x0, y0, a0] = pts[i], [x1, y1, a1] = pts[i + 1];
    for (const s of [-1, 1]) {
      if (r() < 0.07) continue; // a tear
      const w0 = width(i / steps), w1 = width((i + 1) / steps) * 0.97;
      const lean = len / steps * 0.9; // tears run out toward the tip
      const e0 = [x0 - Math.sin(a0) * s * w0 + Math.cos(a0) * lean, y0 + Math.cos(a0) * s * w0 + Math.sin(a0) * lean];
      const e1 = [x1 - Math.sin(a1) * s * w1 + Math.cos(a1) * lean, y1 + Math.cos(a1) * s * w1 + Math.sin(a1) * lean];
      d += `M${n(x0)},${n(y0)}L${n(x1)},${n(y1)}L${n(e1[0])},${n(e1[1])}L${n(e0[0])},${n(e0[1])}Z`;
    }
  }
  const rib = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${n(px)},${n(py)}`).join('');
  return `<path d="${d}"/><path d="${rib}" fill="none" stroke="currentColor" stroke-width="5"/>`;
}

function banana(seed) {
  const r = rng(seed);
  let body = '';
  for (const [bx, by, a, len, droop] of [[-40, 760, -0.9, 520, 1.3], [-60, 820, -0.35, 600, 0.9], [-20, 900, -1.3, 420, 1.7]]) body += leaf(r, bx, by, a, len, 70, droop);
  for (const [bx, by, a, len, droop] of [[1640, 780, Math.PI + 0.85, 540, -1.2], [1660, 880, Math.PI + 0.3, 560, -0.8]]) body += leaf(r, bx, by, a, len, 66, droop);
  return svg('0 0 1600 900', body, 'xMidYMax slice');
}

function bamboo(seed) {
  const r = rng(seed);
  let body = '';
  for (let i = 0; i < 5; i++) {
    const x = 1240 + i * 70 + r() * 30, w = 16 + r() * 10, lean = (r() - 0.4) * 60;
    body += `<path d="M${n(x)},1000L${n(x + w)},1000L${n(x + w + lean)},-20L${n(x + lean)},-20Z"/>`;
    for (let y = 960; y > 0; y -= 100 + r() * 30) { // nodes
      const k = (1000 - y) / 1020;
      body += `<rect x="${n(x + lean * k - 2.5)}" y="${n(y)}" width="${n(w + 5)}" height="5" rx="2"/>`;
      if (y < 560 && r() < 0.7) { // a spray of narrow leaves at the node
        for (let j = 0; j < 4; j++) {
          const lx = x + lean * k + w / 2, a = -2.6 + r() * 1.6, L = 60 + r() * 50;
          const tx = lx + Math.cos(a) * L, ty = y + Math.sin(a) * L + 30, mx = lx + Math.cos(a) * L * 0.5, my = y + Math.sin(a) * L * 0.5 + 6;
          body += `<path d="M${n(lx)},${n(y)}Q${n(mx - 6)},${n(my - 6)} ${n(tx)},${n(ty)}Q${n(mx + 6)},${n(my + 6)} ${n(lx)},${n(y)}Z"/>`;
        }
      }
    }
  }
  return svg('0 0 1600 1000', body, 'xMaxYMax slice');
}

/* A tiled eave seen from under it, with the rafter ends showing. */
function eave() {
  let body = '<rect x="0" y="0" width="1600" height="74"/>';
  for (let x = 0; x < 1600; x += 38) body += `<path d="M${x},70h38v10a19,19 0 0 1 -38,0Z"/>`;
  for (let x = 20; x < 1600; x += 152) body += `<rect x="${x}" y="70" width="14" height="40" rx="2"/>`;
  return svg('0 0 1600 140', body, 'xMidYMin slice');
}

const DRAW = {
  grass: () => grass(13, 250),
  banana: () => banana(29),
  bamboo: () => bamboo(31),
  eave,
};

export function drawForeground(root = document) {
  for (const el of root.querySelectorAll('[data-fg]')) el.innerHTML = DRAW[el.dataset.fg]();
}

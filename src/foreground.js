import { rng } from './rng.js';

/*
 * The near things at the bottom (and top) of each chapter, drawn as SVG from a seed so the page ships
 * no cut-out images. Each is lit the way its chapter is: moonlight on the rims of leaves at the lake,
 * candlelight on the stair, lamplight on the walls, the parol's own glow at the end.
 */
const n = (v) => v.toFixed(1);
const svg = (box, body, fit = 'xMidYMax slice') =>
  `<svg viewBox="${box}" preserveAspectRatio="${fit}" focusable="false">${body}</svg>`;
/* A gradient. `stops` is [[offset, color, opacity?], ...]; `to` is the end point in the box, [x2, y2]. */
const lin = (id, stops, to = [0, 1]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${to[0]}" y2="${to[1]}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const rad = (id, stops) =>
  `<radialGradient id="${id}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const glow = (id, x, y, r) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="url(#${id})"/>`;

/* A blade of grass as a closed curve from its foot to its tip. */
function blade(x, base, h, lean, w) {
  const cx = x + lean * 0.3, cy = base - h * 0.6;
  return `M${n(x - w)},${base}Q${n(cx - w * 0.4)},${n(cy)} ${n(x + lean)},${n(base - h)}Q${n(cx + w * 0.4)},${n(cy)} ${n(x + w)},${base}Z`;
}

/* Cogon grass and talahib reeds at the water's edge, the moon catching the tips from the right. */
function grass() {
  const r = rng(13);
  let back = '', front = '', rims = '', stems = '', plumes = '';
  for (let i = 0; i < 150; i++) {
    const x = r() * 1600, h = 150 * (0.35 + r() * 0.65);
    back += blade(x, 300, h, (r() - 0.5) * h * 0.7, 2 + r() * 3.5);
  }
  let hairs = '';
  for (let i = 0; i < 16; i++) { // reeds: a thin stem, a feathered head drooping downwind
    const x = 40 + r() * 1520, h = 190 + r() * 90, lean = 20 + r() * 40, tx = x + lean, ty = 300 - h;
    stems += `M${n(x)},300Q${n(x + lean * 0.2)},${n(300 - h * 0.6)} ${n(tx)},${n(ty)}`;
    const L = 56 + r() * 30, w = 7 + r() * 4, ex = tx + L * 0.45, ey = ty + L * 0.9, cx = tx + L * 0.55, cy = ty + L * 0.25;
    plumes += `M${n(tx)},${n(ty)}Q${n(cx + w)},${n(cy - w * 0.6)} ${n(ex)},${n(ey)}Q${n(cx - w)},${n(cy + w * 0.8)} ${n(tx)},${n(ty)}Z`;
    for (let k = 1; k < 7; k++) { // a few loose hairs off the head
      const t = k / 7, px = tx + (ex - tx) * t * 0.9, py = ty + (ey - ty) * t * 0.9;
      hairs += `M${n(px)},${n(py)}l${n(6 + r() * 8)},${n(-3 - r() * 4)}`;
    }
  }
  for (let i = 0; i < 190; i++) {
    const x = r() * 1600, h = 250 * (0.3 + r() * 0.7), lean = (r() - 0.5) * h * 0.8, w = 2.5 + r() * 4.5;
    front += blade(x, 300, h, lean, w);
    if (h > 150 && r() < 0.6) { // the moonlit edge, from halfway up to the tip
      const cx = x + lean * 0.3, cy = 300 - h * 0.6;
      rims += `M${n(cx + w * 0.4)},${n(cy)}Q${n(x + lean + w * 0.3)},${n(300 - h * 0.85)} ${n(x + lean)},${n(300 - h)}`;
    }
  }
  return svg('0 0 1600 300', `<defs>
    ${lin('gr-b', [[0, '#1b252e'], [1, '#070a0e']])}
    ${lin('gr-f', [[0, '#101a17'], [1, '#010204']])}
    ${lin('gr-pl', [[0, '#c3ccd8', 0.7], [1, '#7d8897', 0.15]], [1, 1])}
  </defs>
  <path d="${back}" fill="url(#gr-b)" opacity="0.9"/>
  <path d="${stems}" fill="none" stroke="#0b1015" stroke-width="2.5"/>
  <path d="${plumes}" fill="url(#gr-pl)"/>
  <path d="${hairs}" fill="none" stroke="#b4bfcc" stroke-opacity="0.3" stroke-width="1" stroke-linecap="round"/>
  <path d="${front}" fill="url(#gr-f)"/>
  <path d="${rims}" fill="none" stroke="#7a8896" stroke-opacity="0.4" stroke-width="1"/>`);
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
  return `<path d="${d}" fill="url(#ba-leaf)" stroke="#05080a" stroke-width="0.8"/>
    <path d="${rib}" fill="none" stroke="#24322b" stroke-width="5"/>
    <path d="${rib}" fill="none" stroke="#6a7a82" stroke-opacity="0.45" stroke-width="1.2" transform="translate(0,-2.5)"/>`;
}

function banana() {
  const r = rng(29);
  let body = '';
  for (const [bx, by, a, len, droop] of [[-40, 760, -0.9, 520, 1.3], [-60, 820, -0.35, 600, 0.9], [-20, 900, -1.3, 420, 1.7]]) body += leaf(r, bx, by, a, len, 70, droop);
  for (const [bx, by, a, len, droop] of [[1640, 780, Math.PI + 0.85, 540, -1.2], [1660, 880, Math.PI + 0.3, 560, -0.8]]) body += leaf(r, bx, by, a, len, 66, droop);
  // the heart of the plant, puso ng saging, hanging on its stalk under the left leaves
  const heart = 'M196,700C232,720 238,786 214,826C204,842 188,842 178,826C154,786 160,720 196,700Z';
  body += `<path d="M40,560Q150,590 196,702" fill="none" stroke="#0c120e" stroke-width="7"/>
    <path d="${heart}" fill="url(#ba-heart)"/>
    <path d="M206,712C226,738 228,782 212,814" fill="none" stroke="#c07a8a" stroke-opacity="0.35" stroke-width="2"/>`;
  return svg('0 0 1600 900', `<defs>
    <linearGradient id="ba-leaf" gradientUnits="userSpaceOnUse" x1="0" y1="250" x2="0" y2="900"><stop offset="0" stop-color="#1a2a22"/><stop offset="1" stop-color="#04070a"/></linearGradient>
    ${lin('ba-heart', [[0, '#3e1624'], [1, '#10050a']], [1, 1])}
  </defs>${body}`);
}

/* Bamboo by the stair, and on a ledge at its foot a few candles someone left burning. */
function bamboo() {
  const r = rng(31);
  let culms = '', nodes = '', leaves = '';
  for (let i = 0; i < 5; i++) {
    const x = 1120 + i * 70 + r() * 30, w = 16 + r() * 10, lean = (r() - 0.4) * 60;
    culms += `<path d="M${n(x)},1000L${n(x + w)},1000L${n(x + w + lean)},-20L${n(x + lean)},-20Z" fill="url(#bb-culm)"/>`;
    for (let y = 960; y > 0; y -= 100 + r() * 30) {
      const k = (1000 - y) / 1020;
      nodes += `<rect x="${n(x + lean * k - 2.5)}" y="${n(y)}" width="${n(w + 5)}" height="4" rx="2"/>`;
      if (y < 560 && r() < 0.7) {
        for (let j = 0; j < 4; j++) {
          const lx = x + lean * k + w / 2, a = -2.6 + r() * 1.6, L = 60 + r() * 50;
          const tx = lx + Math.cos(a) * L, ty = y + Math.sin(a) * L + 30, mx = lx + Math.cos(a) * L * 0.5, my = y + Math.sin(a) * L * 0.5 + 6;
          leaves += `M${n(lx)},${n(y)}Q${n(mx - 6)},${n(my - 6)} ${n(tx)},${n(ty)}Q${n(mx + 6)},${n(my + 6)} ${n(lx)},${n(y)}Z`;
        }
      }
    }
  }
  let candles = '', flames = '';
  for (const [x, h, w] of [[190, 70, 20], [236, 46, 18], [300, 88, 22], [352, 58, 18], [410, 38, 16]]) {
    const top = 912 - h;
    candles += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="3" fill="url(#bb-wax)"/><path d="M${x},${top + 4}q${w / 2},-6 ${w},0v6h-${w}z" fill="#fff1d2" opacity="0.7"/>`;
    const fx = x + w / 2, fy = top - 4;
    flames += glow('bb-halo', fx, fy - 10, 70);
    flames += `<path d="M${fx},${fy - 30}C${fx + 7},${fy - 16} ${fx + 6},${fy - 4} ${fx},${fy}C${fx - 6},${fy - 4} ${fx - 7},${fy - 16} ${fx},${fy - 30}Z" fill="url(#bb-flame)"/>`;
  }
  return svg('0 0 1600 1000', `<defs>
    ${lin('bb-culm', [[0, '#030405'], [0.35, '#17221c'], [0.55, '#33423a'], [0.72, '#111a15'], [1, '#030405']], [1, 0])}
    ${lin('bb-leaf', [[0, '#1c2a21'], [1, '#060a08']])}
    ${lin('bb-wax', [[0, '#8f8370'], [0.4, '#efe3c9'], [1, '#6f6453']], [1, 0])}
    ${lin('bb-ledge', [[0, '#3a2c1f'], [0.25, '#16110c'], [1, '#070605']])}
    ${rad('bb-glow', [[0, '#ffb35c', 0.4], [1, '#ffb35c', 0]])}
    ${rad('bb-halo', [[0, '#ffd08a', 0.55], [0.4, '#ff9c4f', 0.18], [1, '#ff9c4f', 0]])}
    ${rad('bb-flame', [[0, '#fff6dc'], [0.55, '#ffc46a'], [1, '#ff8a3a', 0.2]])}
  </defs>
  ${culms}<g fill="#3c4a40" opacity="0.75">${nodes}</g><path d="${leaves}" fill="url(#bb-leaf)"/>
  ${glow('bb-glow', 300, 880, 300)}
  <path d="M0,1000V912Q30,904 80,906L560,912Q620,916 640,1000Z" fill="url(#bb-ledge)"/>
  ${candles}${flames}`);
}

/* A tiled eave seen from under it, rafter ends showing, rain gathering on the tile lips. */
function eave() {
  let tiles = '', drops = '';
  for (let x = 0; x < 1600; x += 38) tiles += `M${x},70h38v10a19,19 0 0 1 -38,0Z`;
  for (let x = 19; x < 1600; x += 76) drops += `<ellipse cx="${x}" cy="${102 + (x % 3) * 4}" rx="2.2" ry="3.4"/>`;
  let rafters = '';
  for (let x = 20; x < 1600; x += 152) rafters += `<rect x="${x}" y="70" width="14" height="40" rx="2"/>`;
  return svg('0 0 1600 140', `<defs>
    ${lin('ev-tile', [[0, '#0a0504'], [0.7, '#24120c'], [1, '#3b2116']])}
  </defs>
  <rect x="0" y="0" width="1600" height="74" fill="#050304"/>
  <path d="${tiles}" fill="url(#ev-tile)"/>
  <g fill="#1d140e">${rafters}</g>
  <g fill="#9fb0c8" opacity="0.5">${drops}</g>`, 'xMidYMin slice');
}

/* Coral-stone garden wall under a street lamp, a gumamela bush leaning over it. */
function wall() {
  const r = rng(37);
  let blocks = '';
  const tones = ['#2b2621', '#231f1b', '#1b1814', '#302a23'];
  for (let row = 0; row < 5; row++) {
    const y = 140 + row * 36;
    for (let x = row % 2 ? -40 : 0; x < 1600;) {
      const w = 70 + r() * 70;
      blocks += `<rect x="${n(x + 2)}" y="${y + 2}" width="${n(w - 4)}" height="32" rx="3" fill="${tones[Math.floor(r() * 4)]}"/>`;
      x += w;
    }
  }
  let bush = '', flowers = '';
  for (let i = 0; i < 70; i++) {
    const x = 1120 + r() * 460, y = 40 + r() * 150, a = r() * 180;
    bush += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(18 + r() * 14)}" ry="${n(8 + r() * 5)}" transform="rotate(${n(a)} ${n(x)} ${n(y)})"/>`;
  }
  for (let i = 0; i < 7; i++) {
    const x = 1150 + r() * 400, y = 50 + r() * 120;
    let petals = '';
    for (let k = 0; k < 5; k++) petals += `<ellipse cx="${n(x)}" cy="${n(y - 13)}" rx="8" ry="14" transform="rotate(${k * 72} ${n(x)} ${n(y)})"/>`;
    flowers += `<g fill="url(#wl-petal)">${petals}</g><circle cx="${n(x)}" cy="${n(y)}" r="3" fill="#d9a24c"/>`;
  }
  return svg('0 0 1600 320', `<defs>
    ${rad('wl-petal', [[0, '#6e1c1f'], [1, '#2a0809']])}
    ${rad('wl-lamp', [[0, '#ffb066', 0.32], [1, '#ffb066', 0]])}
    ${lin('wl-shade', [[0, '#000', 0], [1, '#04050a', 0.85]])}
  </defs>
  <rect x="0" y="126" width="1600" height="16" rx="4" fill="#3a332b"/>
  <rect x="0" y="140" width="1600" height="180" fill="#0d0b09"/>${blocks}
  <rect x="0" y="126" width="1600" height="194" fill="url(#wl-shade)"/>
  ${glow('wl-lamp', 260, 196, 196)}
  <g fill="#0a120d">${bush}</g>${flowers}`);
}

/* The churchyard wall: bougainvillea spilling over it, red-glass votives burning along the top. */
function churchyard() {
  const r = rng(43);
  // the vine: clumps along a stem that comes over the wall and hangs down its face, each clump a
  // few dozen papery bracts in threes, deeper toward the shadowed underside
  let bracts = '', leaves = '';
  const hues = ['#7a2856', '#5e1e45', '#43142f', '#8f3567'];
  for (let c = 0; c < 22; c++) {
    const t = c / 21, cx = 30 + t * 620 + (r() - 0.5) * 50, cy = 70 + Math.sin(t * Math.PI) * 30 + t * t * 150 + (r() - 0.5) * 30, size = 26 + r() * 22;
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = r() * size, x = cx + Math.cos(a) * d * 1.3, y = cy + Math.sin(a) * d * 0.8;
      leaves += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(10 + r() * 6)}" ry="${n(5 + r() * 3)}" transform="rotate(${n(r() * 180)} ${n(x)} ${n(y)})"/>`;
    }
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size, x = cx + Math.cos(a) * d * 1.2, y = cy + Math.sin(a) * d * 0.75;
      const shade = Math.min(3, Math.floor(r() * 2 + (y - cy + size) / size * 1.2));
      for (let k = 0; k < 3; k++) {
        const rot = k * 120 + r() * 40;
        bracts += `<ellipse cx="${n(x)}" cy="${n(y - 5)}" rx="4.5" ry="6.5" fill="${hues[3 - shade]}" transform="rotate(${n(rot)} ${n(x)} ${n(y)})"/>`;
      }
    }
  }
  let votives = '';
  for (let i = 0; i < 6; i++) {
    const x = 980 + i * 92 + r() * 20;
    votives += glow('cy-halo', x + 14, 150, 90);
    votives += `<path d="M${n(x)},152h28l-4,38h-20z" fill="url(#cy-glass)"/><ellipse cx="${n(x + 14)}" cy="152" rx="14" ry="3" fill="#ff8a5a" opacity="0.7"/>`;
    votives += `<path d="M${n(x + 14)},134c4,7 4,13 0,17c-4,-4 -4,-10 0,-17z" fill="#ffd9a0"/>`;
  }
  return svg('0 0 1600 320', `<defs>
    ${lin('cy-wall', [[0, '#2e2924'], [0.12, '#171411'], [1, '#060505']])}
    ${lin('cy-glass', [[0, '#ff7a45'], [0.5, '#a3201a'], [1, '#4a0a08']])}
    ${rad('cy-halo', [[0, '#ff7a45', 0.45], [0.5, '#ff5a2e', 0.12], [1, '#ff5a2e', 0]])}
  </defs>
  <path d="M0,320V186Q0,180 8,180H1600V320Z" fill="url(#cy-wall)"/>
  <rect x="0" y="176" width="1600" height="14" rx="4" fill="#3b342d"/>
  ${votives}
  <g fill="#0b120d">${leaves}</g><g opacity="0.92">${bracts}</g>`);
}

/* A parol up close, swinging on its string: a bamboo star, paper panels lit from inside, two tails. */
function parol() {
  const cx = 1000, cy = 300, R = 120, ri = 50;
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? ri : R;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const star = `M${pts.map(([x, y]) => `${n(x)},${n(y)}`).join('L')}Z`;
  const spokes = pts.filter((_, i) => i % 2 === 0).map(([x, y]) => `M${cx},${cy}L${n(x)},${n(y)}`).join('');
  const tail = (x, y, dx) => `M${n(x)},${n(y)}C${n(x + dx)},${n(y + 90)} ${n(x - dx)},${n(y + 170)} ${n(x + dx * 0.6)},${n(y + 260)}`;
  const [l, rt] = [pts[4], pts[6]];
  const far = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="0.55">${glow('pr-halo', 0, 0, 260)}<path d="${star}" transform="translate(${-cx} ${-cy})" fill="url(#pr-panel)"/></g>`;
  return svg('0 0 1600 700', `<defs>
    ${rad('pr-panel', [[0, '#fff3cf'], [0.45, '#ffb84d'], [1, '#e4573d']])}
    ${rad('pr-halo', [[0, '#ffb35c', 0.5], [0.35, '#ff9c4f', 0.16], [1, '#ff9c4f', 0]])}
    ${lin('pr-tail', [[0, '#ffcf7a', 0.9], [1, '#e4573d', 0]])}
  </defs>
  ${far(330, 150, 0.4)}
  <path d="M${cx},0V${cy - R}" stroke="#0c0c0c" stroke-width="3"/>
  ${glow('pr-halo', cx, cy, 340)}
  <path d="${tail(l[0], l[1], 26)}" fill="none" stroke="url(#pr-tail)" stroke-width="10" stroke-linecap="round"/>
  <path d="${tail(rt[0], rt[1], -26)}" fill="none" stroke="url(#pr-tail)" stroke-width="10" stroke-linecap="round"/>
  <path d="${star}" fill="url(#pr-panel)"/>
  <path d="${star}${spokes}" fill="none" stroke="#3a2412" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="#3a2412" stroke-width="4"/>`, 'xMidYMin slice');
}

/* Barrel tiles on the roof below, their ridges catching the moon, the town's glow behind. */
function roof() {
  let tiles = '', rims = '';
  for (let row = 0; row < 4; row++) {
    const y0 = 90 + row * 46;
    for (let x = -30 + (row % 2) * 24; x < 1640; x += 48) {
      const y = y0 + x * 0.02;
      tiles += `M${x},${n(y + 50)}V${n(y + 12)}a24,12 0 0 1 48,0V${n(y + 50)}Z`;
      rims += `M${x + 4},${n(y + 10)}a20,9 0 0 1 40,0`;
    }
  }
  return svg('0 0 1600 300', `<defs>
    ${lin('rf-tile', [[0, '#2a140e'], [1, '#060302']])}
    ${lin('rf-sky', [[0, '#ffb066', 0], [1, '#ffb066', 0.1]])}
  </defs>
  <rect x="0" y="0" width="1600" height="110" fill="url(#rf-sky)"/>
  <path d="${tiles}" fill="url(#rf-tile)" stroke="#070302" stroke-width="1.5"/>
  <path d="${rims}" fill="none" stroke="#8a6a58" stroke-opacity="0.25" stroke-width="1.5"/>`);
}

const DRAW = { grass, banana, bamboo, eave, wall, churchyard, parol, roof };

export function drawForeground(root = document) {
  for (const el of root.querySelectorAll('[data-fg]')) el.innerHTML = DRAW[el.dataset.fg]();
}

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { rng } from './rng.js';

/* Every surface is painted on a canvas at load, so the site ships no image files. */

export { rng } from './rng.js';

function paint(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/* Coursed volcanic stone: blocks of uneven tone in staggered rows, dark mortar. */
export function stone({ base = [104, 98, 90], seed = 3, rows = 8 } = {}) {
  const r = rng(seed);
  return paint(256, 256, (g, w, h) => {
    g.fillStyle = '#26221e'; g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let y = 0; y < rows; y++) {
      let x = y % 2 ? -rh * 0.9 : 0;
      while (x < w) {
        const bw = rh * (1.3 + r() * 1.2);
        const k = 0.72 + r() * 0.42;
        g.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
        g.fillRect(x + 1.5, y * rh + 1.5, bw - 3, rh - 3);
        // pitting, so the stone is not plastic
        for (let i = 0; i < 14; i++) {
          g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`;
          g.fillRect(x + r() * bw, y * rh + r() * rh, 1 + r() * 3, 1 + r() * 2);
        }
        x += bw;
      }
    }
  }, { repeat: true });
}

/* Vertical boards of dark narra-like wood. */
export function wood({ seed = 5 } = {}) {
  const r = rng(seed);
  return paint(128, 128, (g, w, h) => {
    const bw = w / 6;
    for (let i = 0; i < 6; i++) {
      const k = 0.8 + r() * 0.35;
      g.fillStyle = `rgb(${Math.round(70 * k)},${Math.round(46 * k)},${Math.round(32 * k)})`;
      g.fillRect(i * bw, 0, bw, h);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(i * bw, 0, 1.5, h);
      for (let j = 0; j < 6; j++) {
        g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
        g.fillRect(i * bw + r() * bw, 0, 1, h);
      }
    }
  }, { repeat: true });
}

/* Clay roof tiles in rows. */
export function tiles({ seed = 7 } = {}) {
  const r = rng(seed);
  return paint(128, 128, (g, w, h) => {
    g.fillStyle = '#2a120d'; g.fillRect(0, 0, w, h);
    const rows = 10, cols = 8;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = 0.75 + r() * 0.4;
      g.fillStyle = `rgb(${Math.round(112 * k)},${Math.round(48 * k)},${Math.round(34 * k)})`;
      g.fillRect(x * (w / cols) + (y % 2) * 4, y * (h / rows), w / cols - 2, h / rows - 3);
    }
  }, { repeat: true });
}

/*
 * A capiz window: a timber lattice of small square panes of flattened shell. Each pane is slightly
 * different in tone, which is what makes the light behind them look soft and uneven.
 */
export function capiz({ cols = 6, rows = 7, seed = 11 } = {}) {
  const r = rng(seed);
  return paint(192, 224, (g, w, h) => {
    g.fillStyle = '#2b1c12'; g.fillRect(0, 0, w, h);
    const pw = w / cols, ph = h / rows, bar = 3;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = 0.82 + r() * 0.18;
      const grad = g.createRadialGradient(
        x * pw + pw * (0.3 + r() * 0.4), y * ph + ph * (0.3 + r() * 0.4), 1,
        x * pw + pw / 2, y * ph + ph / 2, pw * 0.8);
      grad.addColorStop(0, `rgb(${Math.round(250 * k)},${Math.round(238 * k)},${Math.round(214 * k)})`);
      grad.addColorStop(1, `rgb(${Math.round(214 * k)},${Math.round(196 * k)},${Math.round(168 * k)})`);
      g.fillStyle = grad;
      g.fillRect(x * pw + bar / 2, y * ph + bar / 2, pw - bar, ph - bar);
    }
    g.strokeStyle = '#2b1c12'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
    g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke(); // the slide meets here
  });
}

/* Moon: pale disc with soft grey maria. */
export function moon() {
  const r = rng(19);
  return paint(256, 256, (g, w, h) => {
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, rad = 8 + r() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(120,116,108,${0.18 + r() * 0.2})`);
      grad.addColorStop(1, 'rgba(120,116,108,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }
  });
}

/*
 * The name in the display face, its letters spread edge to edge as the old wordmark was.
 * Painted again once the face has loaded, since the scene can start before it.
 */
export function mark(text = 'GABI', w = 2048, h = 512) {
  const face = "'Newsreader', 'Iowan Old Style', Georgia, serif", pad = 8;
  const draw = (g) => {
    g.clearRect(0, 0, w, h);
    g.font = `400 100px ${face}`;
    const probe = g.measureText(text);
    g.font = `400 ${(100 * (h - pad * 2)) / (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent)}px ${face}`;
    const top = g.measureText(text).actualBoundingBoxAscent;
    const chars = [...text], m = chars.map((c) => g.measureText(c));
    const ink = m.map((k) => k.actualBoundingBoxLeft + k.actualBoundingBoxRight);
    const gap = (w - pad * 2 - ink.reduce((a, b) => a + b, 0)) / (chars.length - 1);
    g.fillStyle = '#e7e2d4';
    let x = pad;
    chars.forEach((c, i) => { g.fillText(c, x + m[i].actualBoundingBoxLeft, pad + top); x += ink[i] + gap; });
  };
  const t = paint(w, h, draw);
  document.fonts?.load(`400 64px Newsreader`).then(() => { draw(t.image.getContext('2d')); t.needsUpdate = true; });
  return t;
}

/* Soft round glow for lamps, flames and fireflies (alpha only). */
export function glow() {
  return paint(64, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

/* A bank of mist: overlapping soft blobs, wider than tall. */
export function mist() {
  const r = rng(23);
  return paint(256, 64, (g, w, h) => {
    for (let i = 0; i < 40; i++) {
      const x = 20 + r() * (w - 40), y = h * (0.35 + r() * 0.3), rad = 12 + r() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }
  }, { srgb: false });
}

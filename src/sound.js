/*
 * The night, heard: lake water, crickets, rain on the tiles and one church bell, all synthesized
 * on first use, so the site ships no audio files. Off until the visitor turns it on.
 */

/* How loud each layer is at each chapter, 0 to 1: [water, crickets, rain]. */
export const MIX = [
  [0.55, 0.12, 0],   // the lake from the hill
  [0.7, 0.18, 0],    // down by the bangka
  [0.3, 0.55, 0],    // the stair, with the fireflies
  [0.08, 0.12, 0.6], // the street in the rain
  [0.05, 0.3, 0],    // the church, where the bell rings
  [0.3, 0.35, 0],    // the parols, the lake heard from above
];
const BELL_AT = 4;
const LEVEL = 0.5;

function buffer(ctx, seconds, fill) {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  fill(b.getChannelData(0), ctx.sampleRate);
  return b;
}

/* A cricket: bursts of three short pulses at one pitch. Silent at both ends, so it loops clean. */
const chirps = (hz, every) => (d, rate) => {
  for (let at = 0.2; at < d.length / rate - 0.3; at += every * (0.8 + Math.random() * 0.4)) {
    for (let k = 0; k < 3; k++) {
      const s0 = Math.round((at + k * 0.045) * rate), len = Math.round(0.022 * rate);
      for (let i = 0; i < len; i++) d[s0 + i] += Math.sin((2 * Math.PI * hz * i) / rate) * Math.sin((Math.PI * i) / len) * 0.6;
    }
  }
};

export function createSound() {
  let ctx = null, master, layers, lastBell = -99;
  let chapter = 0, on = false;

  function build() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const chain = (...nodes) => { nodes.reduce((a, b) => (a.connect(b), b)); return nodes.at(-1); };
    const layer = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(master); return g; };
    const source = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const filter = (type, hz, Q = 0.7) => new BiquadFilterNode(ctx, { type, frequency: hz, Q });

    const noise = buffer(ctx, 3, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    const water = layer(), crickets = layer(), rain = layer();

    // water: low noise that swells and falls like small waves on the sea wall
    const lap = new GainNode(ctx, { gain: 0.6 });
    const lfo = new OscillatorNode(ctx, { frequency: 0.16 });
    chain(lfo, new GainNode(ctx, { gain: 0.4 }), lap.gain);
    lfo.start();
    chain(source(noise), filter('lowpass', 520), new GainNode(ctx, { gain: 3 }), lap, water); // the low-pass eats most of the noise, so give it back

    // two crickets, one to each side
    for (const [hz, every, pan] of [[4400, 0.7, -0.5], [4900, 0.95, 0.6]]) {
      chain(source(buffer(ctx, 2 + every, chirps(hz, every))), new StereoPannerNode(ctx, { pan }), new GainNode(ctx, { gain: 0.25 }), crickets);
    }

    // rain on clay tiles: a band of hiss
    chain(source(noise), filter('bandpass', 1800, 0.4), new GainNode(ctx, { gain: 0.5 }), rain);

    layers = [water, crickets, rain];
  }

  /* A far bell: a few inharmonic partials, the low ones ringing longest, softened by distance. */
  function bell() {
    lastBell = ctx.currentTime;
    const out = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2200 });
    out.connect(master);
    const now = ctx.currentTime;
    for (const [ratio, amp, decay] of [[0.5, 0.35, 7], [1, 0.3, 5], [1.19, 0.18, 4], [1.5, 0.12, 3], [2, 0.14, 2.5], [2.74, 0.06, 1.6]]) {
      const o = new OscillatorNode(ctx, { frequency: 262 * ratio });
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay);
    }
  }

  function setChapter(i) {
    const arrived = i !== chapter;
    chapter = i;
    if (!on) return;
    MIX[i].forEach((v, k) => layers[k].gain.setTargetAtTime(v, ctx.currentTime, 1.2));
    if (arrived && i === BELL_AT && ctx.currentTime - lastBell > 8) bell();
  }

  function toggle() {
    on = !on;
    if (!ctx) build();
    if (on) {
      ctx.resume();
      master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.4);
      MIX[chapter].forEach((v, k) => layers[k].gain.setTargetAtTime(v, ctx.currentTime, 0.6));
    } else {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => { if (!on) ctx.suspend(); }, 1200);
    }
    return on;
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  return { toggle, setChapter };
}

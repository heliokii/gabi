import 'lenis/dist/lenis.css';
import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { drawForeground } from './foreground.js';
import { createSound } from './sound.js';

gsap.registerPlugin(ScrollTrigger);
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = navigator.connection?.saveData === true;
const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
const live = !saveData && webgl; // with reduced motion the scene still runs, as held shots
if (!live || reduced) root.classList.add('is-static');

const sections = $$('[data-shot]');
drawForeground();

/* ---------- smooth scroll (wheel steps become a glide, as on a trackpad) ---------- */
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ autoRaf: false, anchors: true, lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------- top bar material, mobile menu ---------- */
const bar = $('[data-bar]');
const onScroll = () => bar.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const menu = $('[data-menu]'), menuBtn = $('[data-menu-btn]');
const setMenu = (open) => {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) ($('[aria-current="true"]', menu) || $('a', menu)).focus();
};
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });

/* ---------- sound, off until asked for ---------- */
const sound = createSound();
const soundBtn = $('[data-sound]');
soundBtn.addEventListener('click', () => soundBtn.setAttribute('aria-pressed', String(sound.toggle())));

/* ---------- where you are: rail panes, nav, menu, sound ---------- */
const panes = $$('a', $('[data-rail]'));
const navLinks = $$('.links a, .menu a');
function setChapter(i) {
  sound.setChapter(i);
  panes.forEach((a, j) => {
    a.classList.toggle('is-past', j < i);
    a.classList.toggle('is-now', j === i);
    if (j === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
  });
  navLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${sections[i].id}`)));
}
// Work out the chapter from all of them at once: a jump (a link, a reload mid-page) can skip right
// past a chapter without it ever turning on. Re-placed on every toggle and every re-measure.
let chapterTriggers = [];
const syncChapter = () => {
  if (chapterTriggers.length < sections.length) return; // still being made
  const i = chapterTriggers.findIndex((t) => t.isActive);
  setChapter(i >= 0 ? i : window.scrollY > chapterTriggers.at(-1).end ? sections.length - 1 : 0);
};
chapterTriggers = sections.map((s) => ScrollTrigger.create({ trigger: s, start: 'top 55%', end: 'bottom 55%', onToggle: syncChapter }));
ScrollTrigger.addEventListener('refresh', syncChapter);
syncChapter();

/* ---------- words rise as their chapter arrives; silhouettes drift in and out ---------- */
if (!reduced) {
  for (const h of $$('[data-words]')) {
    h.innerHTML = h.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
  }
  sections.forEach((s, i) => {
    const words = $$('.w', s), rest = $$('.copy > :not(h1):not(h2)', s);
    const from = { opacity: 0, y: 12 };
    const extra = $$('[data-reveal]', s);
    if (i === 0) { // the first screen is already in view: one short entrance, the big letters rising last
      gsap.from(words, { ...from, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.2 });
      gsap.from(rest, { ...from, duration: 0.8, ease: 'expo.out', stagger: 0.06, delay: 0.45 });
      gsap.from('[data-mark] span', { opacity: 0, yPercent: 18, duration: 1.4, ease: 'expo.out', stagger: 0.08, delay: 0.35 });
      gsap.from(['.bay-v', '.index a'], { opacity: 0, y: 8, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.8 });
    } else {
      const tl = gsap.timeline({ scrollTrigger: { trigger: s, start: 'top 62%', toggleActions: 'play none none reverse' } });
      tl.from(rest[0], { ...from, duration: 0.5, ease: 'expo.out' })
        .from(words, { ...from, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, '<0.05')
        .from(rest.slice(1), { ...from, duration: 0.6, ease: 'expo.out', stagger: 0.06 }, '<0.2');
      if (extra.length) tl.from(extra, { ...from, duration: 0.8, ease: 'expo.out', stagger: 0.08 }, '<0.15');
    }
    for (const fg of $$('.fg', s)) {
      const up = fg.classList.contains('fg--top') ? -1 : 1;
      gsap.timeline({ scrollTrigger: { trigger: s, start: 'top bottom', end: 'bottom top', scrub: 0.6 } })
        .fromTo(fg, { opacity: 0, y: 64 * up }, { opacity: 1, y: 0, duration: 0.3, ease: 'none' })
        .to(fg, { opacity: 1, duration: 0.4 })
        .to(fg, { opacity: 0, y: -48 * up, duration: 0.3, ease: 'none' });
    }
  });

  // the field notes and the craft grid come in as their section arrives
  for (const s of $$('.notes, .craft')) {
    gsap.timeline({ scrollTrigger: { trigger: s, start: 'top 70%', toggleActions: 'play none none reverse' } })
      .from($$('.sec-head > :not(div), .sec-head > div > *', s), { opacity: 0, y: 12, duration: 0.6, ease: 'expo.out', stagger: 0.06 })
      .from($$('.note, .craft-grid > li', s), { opacity: 0, y: 16, duration: 0.7, ease: 'expo.out', stagger: 0.07 }, '<0.15');
  }

  /*
   * Near plants lean against the scroll and spring back: a damped spring on their skew, driven by how
   * fast the page moves. The parol up top swings on its string instead. The eave stays put.
   */
  const springs = $$('.fg').filter((el) => el.dataset.fg !== 'eave')
    .map((el) => ({ el, hang: el.classList.contains('fg--hang'), x: 0, v: 0, on: false }));
  gsap.ticker.add((time, ms) => {
    const dt = Math.min(ms / 1000, 0.05), push = gsap.utils.clamp(-7, 7, -(lenis?.velocity || 0) * 0.35);
    for (const b of springs) {
      b.v += ((push * (b.hang ? 0.6 : 1) - b.x) * 60 - b.v * 7) * dt;
      b.x += b.v * dt;
      const svgEl = b.el.firstElementChild;
      if (!svgEl) continue;
      if (Math.abs(b.x) < 0.01 && Math.abs(b.v) < 0.01) {
        if (b.on) { svgEl.style.transform = ''; b.on = false; }
        continue;
      }
      b.on = true;
      svgEl.style.transform = b.hang ? `rotate(${b.x.toFixed(2)}deg)` : `skewX(${b.x.toFixed(2)}deg)`;
    }
  });
}

/* ---------- the live scene, loaded only when it will run ---------- */
if (live) {
  import('./scene.js')
    .then(({ start }) => {
      const scene = start($('#gl'), sections, {
        still: reduced,
        onFirstFrame: () => root.classList.add('is-live'),
        onLost: () => { root.classList.remove('is-live'); root.classList.add('is-static'); },
      });
      document.fonts?.ready.then(() => { scene.measure(); ScrollTrigger.refresh(); scene.drawNotes($$('[data-note]')); });
    })
    .catch((err) => {
      console.error(err);
      root.classList.add('is-static');
    });
}

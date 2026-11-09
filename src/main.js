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
sections.forEach((s, i) => ScrollTrigger.create({
  trigger: s, start: 'top 55%', end: 'bottom 55%',
  onToggle: (self) => self.isActive && setChapter(i),
}));
setChapter(0);

/* ---------- words rise as their chapter arrives; silhouettes drift in and out ---------- */
if (!reduced) {
  for (const h of $$('[data-words]')) {
    h.innerHTML = h.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
  }
  sections.forEach((s, i) => {
    const words = $$('.w', s), rest = $$('.copy > :not(h1):not(h2)', s);
    const from = { opacity: 0, y: 12 };
    if (i === 0) { // the first screen is already in view: one short entrance
      gsap.from(words, { ...from, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.2 });
      gsap.from(rest, { ...from, duration: 0.8, ease: 'expo.out', stagger: 0.06, delay: 0.45 });
    } else {
      const tl = gsap.timeline({ scrollTrigger: { trigger: s, start: 'top 62%', toggleActions: 'play none none reverse' } });
      tl.from(rest[0], { ...from, duration: 0.5, ease: 'expo.out' })
        .from(words, { ...from, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, '<0.05')
        .from(rest.slice(1), { ...from, duration: 0.6, ease: 'expo.out', stagger: 0.06 }, '<0.2');
    }
    const fg = $('.fg', s);
    if (fg) {
      const up = fg.classList.contains('fg--top') ? -1 : 1;
      gsap.timeline({ scrollTrigger: { trigger: s, start: 'top bottom', end: 'bottom top', scrub: 0.6 } })
        .fromTo(fg, { opacity: 0, y: 64 * up }, { opacity: 1, y: 0, duration: 0.3, ease: 'none' })
        .to(fg, { opacity: 1, duration: 0.4 })
        .to(fg, { opacity: 0, y: -48 * up, duration: 0.3, ease: 'none' });
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
      document.fonts?.ready.then(() => { scene.measure(); ScrollTrigger.refresh(); });
    })
    .catch((err) => {
      console.error(err);
      root.classList.add('is-static');
    });
}

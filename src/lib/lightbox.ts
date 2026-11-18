// Visionneuse plein écran « comme une appli » (styles : styles/lightbox.css).
// - s'ouvre en grandissant depuis la vignette, se referme en y retournant ;
// - balayage horizontal : un ruban de 3 photos suit le doigt (jamais de vide) ;
// - glisser vers le bas : la photo suit le doigt, le fond s'efface, relâchée elle retourne sur sa vignette ;
// - zoom : pincement (×5 max, centré entre les doigts), double-tap / double-clic, molette, pavé tactile ;
// - appui long : les boutons disparaissent tant que le doigt reste posé ;
// - bouton retour du téléphone / du navigateur, Échap, croix ou tap sur le fond : même fermeture animée.
import {
  AXIS_DECISION_THRESHOLD, FLING_VELOCITY, MIN_FLING_DISTANCE, CLOSE_DISTANCE_RATIO, EASING,
  clamp, createVelocityTracker, snapDuration, swallowNextClick, reducedMotion,
} from './gestures';

type Item = { full: string; thumb: string; alt: string; ratio: number; tile: HTMLElement };
type Slide = { el: HTMLElement; img: HTMLImageElement; idx: number };

const GAP = 16;           // écart entre deux photos du ruban
const MAX_ZOOM = 5;
const MORPH_MS = 320;

let dlg: HTMLDialogElement;
let bg: HTMLElement;
let track: HTMLElement;
let countEl: HTMLElement;
let slides: Slide[] = [];
let items: Item[] = [];
let i = 0;
let isOpen = false;
let busy = false;          // animation en cours (ouverture, fermeture, changement de photo)
const decoded = new Set<string>();

// zoom de la photo affichée
let scale = 1, ox = 0, oy = 0;

const W = () => innerWidth;
const H = () => innerHeight;
const mod = (n: number) => ((n % items.length) + items.length) % items.length;
const cur = () => slides[1];

/** Taille affichée d'une photo : entière, le plus grande possible dans l'écran (marges réduites sur téléphone). */
function fit(ratio: number) {
  const phone = W() < 720;
  const px = phone ? 0 : clamp(W() * 0.06, 12, 96);
  const py = phone ? 56 : 64;
  const aw = W() - 2 * px, ah = H() - 2 * py;
  const w = Math.min(aw, ah * ratio);
  return { w, h: w / ratio };
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'lb';
  dlg.setAttribute('aria-label', 'Visionneuse photo');
  dlg.innerHTML = `
    <div class="lb-bg"></div>
    <div class="lb-track">${'<div class="lb-slide"><img alt="" draggable="false" /></div>'.repeat(3)}</div>
    <button class="lb-btn lb-close" aria-label="Fermer">✕</button>
    <button class="lb-btn lb-prev" aria-label="Photo précédente">←</button>
    <button class="lb-btn lb-next" aria-label="Photo suivante">→</button>
    <span class="lb-count"></span>`;
  document.body.append(dlg);
  bg = dlg.querySelector('.lb-bg')!;
  track = dlg.querySelector('.lb-track')!;
  countEl = dlg.querySelector('.lb-count')!;
  slides = [...track.querySelectorAll<HTMLElement>('.lb-slide')].map((el) => ({ el, img: el.querySelector('img')!, idx: -1 }));

  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.lb-prev')) go(-1);
    else if (t.closest('.lb-next')) go(1);
    else if (t.closest('.lb-close')) requestClose();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); }); // Échap
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  dlg.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('popstate', () => { if (isOpen && !history.state?.lb) close(); });
  addEventListener('resize', () => { if (isOpen) { resetZoom(false); placeSlides(); } });
  attachPointers();
  attachWheel();
}

// ---------- ruban de photos ----------

function setSlide(s: Slide, idx: number) {
  const it = items[mod(idx)];
  s.idx = mod(idx);
  const { w, h } = fit(it.ratio);
  Object.assign(s.img.style, { width: `${w}px`, height: `${h}px`, transform: '', transition: '' });
  s.img.alt = it.alt;
  if (decoded.has(it.full)) { s.img.src = it.full; return; }
  s.img.src = it.thumb; // déjà en cache : affichée tout de suite, la pleine définition la remplace une fois prête
  const hd = new Image();
  hd.src = it.full;
  hd.decode().then(() => {
    decoded.add(it.full);
    if (s.idx === mod(idx)) s.img.src = it.full;
  }, () => {});
}

function placeSlides() {
  slides.forEach((s, k) => {
    s.el.style.transform = `translate3d(${(k - 1) * (W() + GAP)}px,0,0)`;
    const { w, h } = fit(items[s.idx]?.ratio ?? 1.5);
    Object.assign(s.img.style, { width: `${w}px`, height: `${h}px` });
  });
  track.style.transition = 'none';
  track.style.transform = '';
}

function fillSlides() {
  setSlide(slides[1], i);
  setSlide(slides[0], i - 1);
  setSlide(slides[2], i + 1);
  placeSlides();
  countEl.textContent = `${i + 1} / ${items.length}`;
  dlg.classList.toggle('lb-single', items.length < 2);
}

/** Passe à la photo voisine (dir = 1 : suivante) ; le ruban repart à la vitesse du doigt. */
function go(dir: number, velocity = 0) {
  if (busy || !isOpen || items.length < 2) return;
  busy = true;
  resetZoom(false);
  const target = -dir * (W() + GAP);
  const current = new DOMMatrix(getComputedStyle(track).transform).m41;
  const ms = reducedMotion() ? 1 : snapDuration(Math.abs(target - current), velocity);
  track.style.transition = `transform ${ms}ms ${EASING}`;
  track.style.transform = `translate3d(${target}px,0,0)`;
  setTimeout(() => {
    i = mod(i + dir);
    if (dir > 0) { const s = slides.shift()!; slides.push(s); setSlide(s, i + 1); }
    else { const s = slides.pop()!; slides.unshift(s); setSlide(s, i - 1); }
    placeSlides();
    countEl.textContent = `${i + 1} / ${items.length}`;
    busy = false;
  }, ms);
}

function snapBack() {
  track.style.transition = `transform 260ms ${EASING}`;
  track.style.transform = '';
}

// ---------- zoom ----------

function paintZoom(animated: boolean) {
  const img = cur().img;
  img.style.transition = animated ? `transform 260ms ${EASING}` : 'none';
  img.style.transform = scale === 1 && !ox && !oy ? '' : `translate3d(${ox}px,${oy}px,0) scale(${scale})`;
  dlg.classList.toggle('lb-zoomed', scale > 1);
}

/** Pas de bord vide : on ne peut déplacer l'image zoomée que de ce qui dépasse de l'écran. */
function bound() {
  const { w, h } = fit(items[i].ratio);
  const mx = Math.max(0, (w * scale - W()) / 2), my = Math.max(0, (h * scale - H()) / 2);
  ox = clamp(ox, -mx, mx); oy = clamp(oy, -my, my);
}

/** Zoom ancré : le point (cx, cy) de l'écran reste sous le doigt / le curseur. */
function zoomAt(next: number, cx: number, cy: number, animated = false) {
  next = clamp(next, 1, MAX_ZOOM);
  if (next === 1) { scale = 1; ox = oy = 0; paintZoom(animated); return; }
  const k = next / scale, c0x = W() / 2, c0y = H() / 2;
  ox = cx - c0x - (cx - c0x - ox) * k;
  oy = cy - c0y - (cy - c0y - oy) * k;
  scale = next;
  bound(); paintZoom(animated);
}

function resetZoom(animated: boolean) {
  if (scale === 1 && !ox && !oy) return;
  scale = 1; ox = oy = 0; paintZoom(animated);
}

function attachWheel() {
  dlg.addEventListener('wheel', (e) => {
    e.preventDefault(); // sinon la page derrière défile, ou tout le site zoome
    if (busy) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = e.ctrlKey ? Math.exp(-dy * 0.01) : Math.exp(-dy * 0.002); // ctrl = pincement au pavé tactile
    zoomAt(scale * factor, e.clientX, e.clientY);
    if (scale < 1.02) resetZoom(false);
  }, { passive: false });
  // Safari sur Mac : pincement au pavé tactile
  let gs = 1;
  dlg.addEventListener('gesturestart', (e: any) => { e.preventDefault(); gs = scale; });
  dlg.addEventListener('gesturechange', (e: any) => { e.preventDefault(); zoomAt(gs * e.scale, e.clientX, e.clientY); });
  dlg.addEventListener('gestureend', (e: any) => { e.preventDefault(); if (scale < 1.15) resetZoom(true); });
}

// ---------- gestes au doigt / à la souris ----------

function attachPointers() {
  const pts = new Map<number, { x: number; y: number }>();
  const tracker = createVelocityTracker();
  let g: null | { id: number; sx: number; sy: number; t0: number; axis: null | 'h' | 'v' | 'pan' | 'none'; lx: number; ly: number; ly2: number; lt: number } = null;
  let pinch: null | { dist: number; scale: number } = null;
  let longTimer = 0;
  let lastTap: null | { t: number; x: number; y: number } = null;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const restoreDrag = () => {
    const img = cur().img;
    img.style.transition = `transform 230ms ${EASING}`;
    img.style.transform = '';
    bg.style.transition = 'opacity 230ms';
    bg.style.opacity = '';
    dlg.classList.remove('lb-dragging');
  };

  dlg.addEventListener('pointerdown', (e) => {
    if (busy || !isOpen || (e.target as HTMLElement).closest('.lb-btn')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { dlg.setPointerCapture(e.pointerId); } catch {}
    if (pts.size === 2) {
      // deuxième doigt : on abandonne le balayage en cours et on passe au pincement
      clearTimeout(longTimer);
      if (g?.axis === 'h') snapBack();
      if (g?.axis === 'v') restoreDrag();
      g = null;
      const [a, b] = [...pts.values()];
      pinch = { dist: dist(a, b), scale };
      return;
    }
    if (pts.size > 2) return;
    g = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, axis: null, lx: e.clientX, ly: e.clientY, ly2: e.clientY, lt: e.timeStamp };
    tracker.reset(e.clientX, e.timeStamp);
    if (e.pointerType !== 'mouse') longTimer = window.setTimeout(() => dlg.classList.add('lb-immersive'), 450);
  });

  dlg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.scale * (dist(a, b) / Math.max(pinch.dist, 1)), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.axis) {
      if (Math.abs(dx) < AXIS_DECISION_THRESHOLD && Math.abs(dy) < AXIS_DECISION_THRESHOLD) return;
      clearTimeout(longTimer);
      if (scale > 1) g.axis = 'pan';
      else if (Math.abs(dy) <= Math.abs(dx)) g.axis = 'h'; // le premier axe qui dépasse le seuil gagne
      else g.axis = dy > 0 ? 'v' : 'none';
      if (g.axis === 'v') dlg.classList.add('lb-dragging');
    }
    if (g.axis === 'h') {
      tracker.add(e.clientX, e.timeStamp);
      const x = items.length < 2 ? dx * 0.25 : dx; // une seule photo : simple résistance
      track.style.transition = 'none';
      track.style.transform = `translate3d(${x}px,0,0)`;
    } else if (g.axis === 'v') {
      const off = Math.max(0, dy);
      const img = cur().img;
      img.style.transition = 'none';
      img.style.transform = `translate3d(${dx * 0.6}px,${off}px,0) scale(${1 - Math.min(off / H(), 1) * 0.2})`;
      bg.style.transition = 'none';
      bg.style.opacity = String(1 - Math.min(off / (H() * 0.5), 1));
      g.ly2 = g.ly; g.lt = e.timeStamp;
    } else if (g.axis === 'pan') {
      ox += e.clientX - g.lx; oy += e.clientY - g.ly;
      bound(); paintZoom(false);
    }
    g.lx = e.clientX; g.ly = e.clientY;
  });

  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    if (pinch) {
      if (pts.size < 2) {
        pinch = null;
        if (scale < 1.15) resetZoom(true); // zoom à peine visible : retour en douceur
        const [id] = [...pts.keys()];
        if (id !== undefined) { // le doigt restant continue à déplacer l'image
          const p = pts.get(id)!;
          g = { id, sx: p.x, sy: p.y, t0: e.timeStamp, axis: scale > 1 ? 'pan' : 'none', lx: p.x, ly: p.y, ly2: p.y, lt: e.timeStamp };
        }
      }
      return;
    }
    if (!g || g.id !== e.pointerId) return;
    clearTimeout(longTimer);
    dlg.classList.remove('lb-immersive');
    const gg = g; g = null;
    const dx = e.clientX - gg.sx, dy = e.clientY - gg.sy;

    if (!gg.axis) {
      // simple appui : double-tap = zoom, tap sur le fond = fermer
      if (cancelled || e.timeStamp - gg.t0 > 450) return;
      const onImg = (e.target as HTMLElement) === cur().img;
      if (lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        if (scale > 1) resetZoom(true); else zoomAt(2.5, e.clientX, e.clientY, true);
        return;
      }
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (!onImg && scale === 1) {
        // attend un éventuel 2e tap avant de fermer
        const t = lastTap;
        setTimeout(() => { if (lastTap === t) requestClose(); }, 260);
      }
      return;
    }
    swallowNextClick();
    if (gg.axis === 'h') {
      const v = tracker.release(e.clientX, e.timeStamp);
      const W0 = W();
      const towards = Math.sign(dx);
      const thrown = Math.abs(dx) > MIN_FLING_DISTANCE && Math.sign(v) === towards && Math.abs(v) > FLING_VELOCITY;
      const thrownBack = Math.sign(v) === -towards && Math.abs(v) > FLING_VELOCITY;
      if (!cancelled && items.length > 1 && (thrown || (Math.abs(dx) > W0 * CLOSE_DISTANCE_RATIO && !thrownBack))) go(-towards, v);
      else snapBack();
    } else if (gg.axis === 'v') {
      const speed = (e.clientY - gg.ly2) / Math.max(1, e.timeStamp - gg.lt);
      const average = dy / Math.max(1, e.timeStamp - gg.t0);
      if (!cancelled && speed > -FLING_VELOCITY && (dy > H() * 0.22 || (dy > 40 && (speed > 0.5 || average > 0.6)))) requestClose();
      else restoreDrag();
    }
  };
  dlg.addEventListener('pointerup', end);
  dlg.addEventListener('pointercancel', end);
  addEventListener('blur', () => { pts.clear(); pinch = null; if (g?.axis === 'h') snapBack(); if (g?.axis === 'v') restoreDrag(); g = null; });
}

// ---------- ouverture / fermeture animées ----------

/** Transformation qui pose la photo plein écran sur le rectangle de sa vignette. */
function towardsThumb(tile: HTMLElement) {
  const from = tile.getBoundingClientRect();
  const { w, h } = fit(items[i].ratio);
  const dx = from.left + from.width / 2 - W() / 2;
  const dy = from.top + from.height / 2 - H() / 2;
  return { small: `translate3d(${dx}px,${dy}px,0) scale(${from.width / w}, ${from.height / h})`, rect: from };
}

const visible = (r: DOMRect) => r.bottom > 0 && r.top < H() && r.width > 0;

function open(list: Item[], n: number) {
  if (isOpen) return;
  if (!dlg) build();
  items = list; i = n;
  scale = 1; ox = oy = 0;
  dlg.classList.remove('lb-closing', 'lb-zoomed', 'lb-dragging', 'lb-immersive');
  bg.style.opacity = ''; bg.style.transition = '';
  fillSlides();
  dlg.showModal();
  isOpen = true;
  history.pushState({ ...(history.state ?? {}), lb: true }, ''); // le retour du téléphone fermera la visionneuse

  const tile = items[i].tile;
  if (reducedMotion() || !visible(tile.getBoundingClientRect())) return;
  busy = true;
  const { small } = towardsThumb(tile);
  tile.style.visibility = 'hidden';
  bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MORPH_MS, easing: 'ease-out' });
  const a = cur().img.animate([{ transform: small }, { transform: 'none' }], { duration: MORPH_MS, easing: EASING });
  a.onfinish = a.oncancel = () => { tile.style.visibility = ''; busy = false; };
}

/** Fermeture demandée par l'interface : passe par l'historique pour rester cohérent avec le bouton retour. */
function requestClose() {
  if (!isOpen) return;
  if (history.state?.lb) history.back(); // → popstate → close()
  else close();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  busy = true;
  const img = cur().img;
  const tile = items[i].tile;
  // la galerie suit la dernière photo regardée
  if (!visible(tile.getBoundingClientRect())) tile.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  const startT = img.style.transform || 'none';
  const startBg = getComputedStyle(bg).opacity;
  dlg.classList.add('lb-closing');
  const finish = () => {
    tile.style.visibility = '';
    dlg.close();
    img.getAnimations().forEach((x) => x.cancel());
    resetZoom(false);
    img.style.transform = '';
    bg.style.opacity = '';
    dlg.classList.remove('lb-closing', 'lb-dragging');
    busy = false;
  };
  if (reducedMotion()) { finish(); return; }
  const r = tile.getBoundingClientRect();
  bg.style.transition = 'none';
  bg.animate([{ opacity: startBg }, { opacity: 0 }], { duration: MORPH_MS, easing: 'ease-out', fill: 'forwards' });
  let a: Animation;
  if (visible(r)) {
    const { small } = towardsThumb(tile);
    tile.style.visibility = 'hidden';
    a = img.animate([{ transform: startT }, { transform: small }], { duration: MORPH_MS, easing: EASING, fill: 'forwards' });
  } else {
    a = img.animate([{ transform: startT, opacity: 1 }, { transform: 'translate3d(0,30%,0)', opacity: 0 }], { duration: 250, easing: 'ease-in', fill: 'forwards' });
  }
  a.onfinish = a.oncancel = () => { bg.getAnimations().forEach((x) => x.cancel()); finish(); };
}

/** Branche la visionneuse sur une grille : chaque lien a.tile ouvre sa photo. */
export function initLightbox(grid: HTMLElement) {
  const links = [...grid.querySelectorAll<HTMLAnchorElement>('a.tile')];
  if (!links.length) return;
  const list = (): Item[] => links.map((a) => {
    const im = a.querySelector('img');
    const w = Number(im?.getAttribute('width')) || im?.naturalWidth || 3;
    const h = Number(im?.getAttribute('height')) || im?.naturalHeight || 2;
    return { full: a.href, thumb: im?.currentSrc || im?.src || a.href, alt: im?.alt ?? '', ratio: w / h, tile: a };
  });
  links.forEach((a, n) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // nouvel onglet : comportement normal
    e.preventDefault();
    open(list(), n);
  }));
}

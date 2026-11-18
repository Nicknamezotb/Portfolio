// Grille de photos du site : rangées justifiées calculées en JS + zoom de la grille au pincement
// (façon Google Photos). Sans JS, la grille reste en CSS pur (styles/photo-grid.css), comme dans l'admin.
//
// Tout se compte en « formats » (largeur ÷ hauteur). Chaque niveau de zoom vise une largeur de rangée
// en formats cumulés : plus elle est grande, plus il y a de photos par rangée.
import { EASING, clamp, reducedMotion, swallowNextClick } from './gestures';

export interface Row { items: number[]; rest: number }
type Rect = { x: number; y: number; w: number; h: number };
type Level = number | 'pair';

const isLandscape = (a: number) => a >= 1.05; // un carré se range avec les portraits
const sum = (idx: number[], aspects: number[]) => idx.reduce((s, k) => s + aspects[k], 0);

/** Rangées au plus près de `target` formats cumulés ; la dernière n'est pas étirée. */
export function rowsNearWidth(aspects: number[], target: number): Row[] {
  const rows: Row[] = [];
  let current: number[] = [];
  aspects.forEach((a, k) => {
    const before = sum(current, aspects), after = before + a;
    // ferme la rangée si cette photo éloigne plus de la cible qu'elle n'en rapproche
    if (current.length && after > target && target - before <= after - target) {
      rows.push({ items: current, rest: 0 });
      current = [];
    }
    current.push(k);
  });
  if (current.length) {
    const w = sum(current, aspects);
    rows.push({ items: current, rest: w < target - 0.05 ? target - w : 0 });
  }
  return rows;
}

/** Niveau « grandes photos » : un paysage seul s'il est suivi d'un paysage, sinon une paire. */
export function pairedRows(aspects: number[]): Row[] {
  const rows: Row[] = [];
  for (let k = 0; k < aspects.length;) {
    const a = aspects[k], b = aspects[k + 1];
    if (b !== undefined && (!isLandscape(a) || !isLandscape(b))) { rows.push({ items: [k, k + 1], rest: 0 }); k += 2; }
    else { rows.push({ items: [k], rest: isLandscape(a) ? 0 : a }); k += 1; }
  }
  return rows;
}

/** Rectangles de chaque photo pour une largeur donnée. */
function computeLayout(aspects: number[], width: number, gap: number, level: Level) {
  const rows = level === 'pair' ? pairedRows(aspects) : rowsNearWidth(aspects, level);
  const rects: Rect[] = new Array(aspects.length);
  let y = 0;
  for (const row of rows) {
    const slots = row.items.length + (row.rest > 0 ? 1 : 0);
    const h = (width - gap * (slots - 1)) / (sum(row.items, aspects) + row.rest);
    let x = 0;
    for (const k of row.items) {
      const w = aspects[k] * h;
      rects[k] = { x, y, w, h };
      x += w + gap;
    }
    y += h + gap;
  }
  return { rects, height: Math.max(0, y - gap) };
}

/** Niveaux de zoom selon la largeur de la grille (du plus zoomé au plus dézoomé) et niveau par défaut. */
function levelsFor(width: number, rowH: number): { levels: Level[]; def: number } {
  if (width < 600) {
    const levels: Level[] = ['pair', 3.2, 4.5, 5.6];
    return { levels, def: rowH >= 420 ? 0 : rowH >= 300 ? 1 : 2 };
  }
  const heights = width < 1000 ? [420, 300, 220, 160, 120] : [560, 420, 300, 220, 160, 120];
  const scaled = width < 1000 ? rowH * 0.75 : rowH; // tablette : rangées un peu plus basses
  let def = 0;
  heights.forEach((h, k) => { if (Math.abs(h - scaled) < Math.abs(heights[def] - scaled)) def = k; });
  return { levels: heights.map((h) => width / h), def };
}

const widthOf = (l: Level) => (l === 'pair' ? 1.4 : l);

export function initJustified(grid: HTMLElement) {
  const tiles = [...grid.querySelectorAll<HTMLElement>(':scope > .ptile')];
  if (!tiles.length) return;
  const aspects = tiles.map((t) => parseFloat(t.style.getPropertyValue('--r')) || 1.5);
  const rowH = parseFloat(grid.style.getPropertyValue('--rh-n')) || 300;
  grid.classList.add('is-js');

  let width = 0, gap = 0, levels: Level[] = [], level = 0, current: Rect[] = [];

  const apply = (rects: Rect[], height: number) => {
    current = rects;
    grid.style.height = `${height}px`;
    tiles.forEach((t, k) => {
      const r = rects[k];
      t.style.left = `${r.x}px`; t.style.top = `${r.y}px`;
      t.style.width = `${r.w}px`; t.style.height = `${r.h}px`;
    });
  };
  const layout = (lv = level) => computeLayout(aspects, width, gap, levels[lv]);

  const relayout = () => {
    const w = grid.clientWidth;
    if (!w || w === width) return;
    const sameScale = levels.length && (w < 600) === (width < 600) && (w < 1000) === (width < 1000);
    width = w;
    gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const l = levelsFor(width, rowH);
    if (!sameScale) level = l.def;
    levels = l.levels;
    const { rects, height } = layout();
    apply(rects, height);
  };
  relayout();
  new ResizeObserver(relayout).observe(grid);

  // ---------- zoom de la grille ----------
  // Pendant le geste, la vraie grille ne bouge pas : chaque case visible reçoit une transformation
  // qui l'amène de sa place au niveau actuel vers sa place au niveau voisin (même rangée, même rang).

  type Morph = { target: number; rects: Rect[]; height: number; shift: number; moving: number[]; from: Rect[]; to: Rect[]; fade: (0 | 1 | -1)[] };
  let morph: Morph | null = null;
  let t = 0, acc = 0;

  const startMorph = (target: number): Morph => {
    const { rects, height } = layout(target);
    const top = grid.getBoundingClientRect().top;
    const vh = innerHeight, vw = innerWidth, margin = 80;
    // point fixe : la photo en haut de l'écran reste en haut, à la même fraction
    let k = current.findIndex((r) => top + r.y + r.h > 0);
    if (k < 0) k = 0;
    const frac = clamp(-(top + current[k].y) / current[k].h, 0, 1);
    const shift = rects[k].y + frac * rects[k].h - (current[k].y + frac * current[k].h);
    const moving: number[] = [], from: Rect[] = [], to: Rect[] = [], fade: (0 | 1 | -1)[] = [];
    tiles.forEach((tile, j) => {
      const a = current[j], b = { ...rects[j], y: rects[j].y - shift };
      const inA = top + a.y + a.h > -margin && top + a.y < vh + margin;
      const inB = top + b.y + b.h > -margin && top + b.y < vh + margin;
      if (!inA && !inB) return;
      moving.push(j);
      if (inA && inB) { from.push(a); to.push(b); fade.push(0); }
      else if (inA) { from.push(a); to.push({ ...a, x: a.x + vw }); fade.push(-1); }       // repart par la droite
      else { from.push({ ...b, x: b.x + vw }); to.push(b); fade.push(1); }                 // arrive par la droite
      const img = tile.querySelector('img');
      if (img) img.loading = 'eager';
      tile.style.willChange = 'transform';
    });
    return { target, rects, height, shift, moving, from, to, fade };
  };

  const render = (m: Morph, p: number, animated = false) => {
    m.moving.forEach((j, n) => {
      const a = current[j], f = m.from[n], g = m.to[n];
      const x = f.x + (g.x - f.x) * p, y = f.y + (g.y - f.y) * p;
      const w = f.w + (g.w - f.w) * p, h = f.h + (g.h - f.h) * p;
      const s = tiles[j].style;
      s.transition = animated ? `transform 280ms ${EASING}, opacity 280ms` : 'none';
      s.transformOrigin = '0 0';
      s.transform = `translate3d(${x - a.x}px,${y - a.y}px,0) scale(${w / a.w},${h / a.h})`;
      s.opacity = m.fade[n] === 0 ? '' : String(m.fade[n] > 0 ? p : 1 - p);
    });
  };

  const clearMorph = (m: Morph) => m.moving.forEach((j) => {
    const s = tiles[j].style;
    s.transition = 'none'; s.transform = ''; s.opacity = ''; s.willChange = ''; s.transformOrigin = '';
  });

  /** Pose la vraie grille au niveau atteint et redéfile pour que rien ne bouge à l'écran. */
  const commit = (m: Morph) => {
    level = m.target;
    apply(m.rects, m.height);
    clearMorph(m);
    if (m.shift) scrollTo({ top: scrollY + m.shift, behavior: 'instant' as ScrollBehavior });
  };

  /** Fait avancer le zoom de `step` (log de l'écart des doigts ; positif = écarter = photos plus grandes). */
  const feed = (step: number) => {
    acc += step;
    if (Math.abs(acc) < 0.015) { if (morph) render(morph, 0); return; } // zone morte
    const target = level + (acc > 0 ? -1 : 1);
    if (target < 0 || target >= levels.length) { acc = Math.sign(acc) * 0.015; return; } // bout de l'échelle
    if (morph && morph.target !== target) { clearMorph(morph); morph = null; }
    if (!morph) morph = startMorph(target);
    const span = Math.abs(Math.log(widthOf(levels[target]) / widthOf(levels[level])));
    t = Math.min(Math.abs(acc) / span, 1);
    render(morph, t);
    if (t >= 1) { commit(morph); morph = null; acc = 0; t = 0; } // enchaîne sur le niveau suivant
  };

  /** Lâché : rejoint en glissant le niveau le plus proche. */
  const settle = (force?: boolean) => {
    acc = 0;
    const m = morph;
    if (!m) return;
    morph = null;
    const toTarget = force ?? t >= 0.5;
    t = 0;
    if (reducedMotion()) { if (toTarget) commit(m); else clearMorph(m); return; }
    render(m, toTarget ? 1 : 0, true);
    setTimeout(() => { if (toTarget) commit(m); else clearMorph(m); }, 290);
  };

  /** Un cran de molette (Ctrl) : un niveau, animé. */
  const step = (dir: 1 | -1) => {
    if (morph) return;
    const target = level + dir;
    if (target < 0 || target >= levels.length) return;
    morph = startMorph(target);
    render(morph, 0);
    grid.getBoundingClientRect();
    settle(true);
  };

  // pincement au doigt (événements tactiles : plus fiables que les pointeurs quand deux doigts arrivent)
  let lastLog = 0, lastTime = 0, pinching = false;
  const spread = (e: TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.log(Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)));
  };
  grid.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { pinching = true; acc = 0; lastLog = spread(e); lastTime = e.timeStamp; }
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    if (!pinching || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault(); // pas de zoom de toute la page
    const now = spread(e), d = now - lastLog, ms = e.timeStamp - lastTime;
    const allowed = 0.004 * Math.max(ms, 8); // amortit les gestes très vifs
    lastLog = now; lastTime = e.timeStamp;
    feed(Math.abs(d) <= allowed ? d : Math.sign(d) * (allowed + (Math.abs(d) - allowed) * 0.25));
  }, { passive: false });
  const touchEnd = (e: TouchEvent) => {
    if (!pinching || e.touches.length >= 2) return;
    pinching = false;
    swallowNextClick(); // le relâcher ne doit pas ouvrir une photo
    settle();
  };
  grid.addEventListener('touchend', touchEnd, { passive: true });
  grid.addEventListener('touchcancel', touchEnd, { passive: true });
  grid.addEventListener('gesturestart', (e) => e.preventDefault()); // iPhone : pas de zoom de la page

  // ordinateur : Ctrl + molette (un cran = un niveau) ou pincement au pavé tactile (arrive en Ctrl + molette)
  let wheelTimer = 0;
  grid.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(dy) >= 50) { step(dy > 0 ? 1 : -1); return; }
    feed(-dy * 0.01);
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => settle(), 160);
  }, { passive: false });

  // Safari sur Mac : pincement au pavé tactile
  let gLast = 0;
  // (sur iPhone ces événements arrivent aussi pendant un pincement au doigt : déjà traité plus haut)
  grid.addEventListener('gesturestart', () => { if (!pinching) { gLast = 0; acc = 0; } });
  grid.addEventListener('gesturechange', (e: any) => {
    e.preventDefault();
    if (pinching) return;
    const l = Math.log(e.scale); feed(l - gLast); gLast = l;
  });
  grid.addEventListener('gestureend', (e: any) => { e.preventDefault(); if (!pinching) settle(); });
}

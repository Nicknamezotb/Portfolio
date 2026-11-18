// Réglages communs à tous les gestes tactiles du site (visionneuse, grille, retour, bords élastiques).
// Calés sur Android / iOS pour que chaque geste se comporte de la même façon partout.

export const AXIS_DECISION_THRESHOLD = 8;   // px avant de choisir l'axe (horizontal / vertical)
export const FLING_VELOCITY = 0.2;          // px/ms : un petit coup franc suffit
export const MIN_FLING_DISTANCE = 20;       // px : en dessous, c'est un tremblement
export const CLOSE_DISTANCE_RATIO = 0.25;   // geste lent : 25 % de la largeur
export const EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
export const DURATION_MS = 280;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Vitesse moyenne du doigt sur les 100 dernières ms (comme le VelocityTracker d'Android). */
export function createVelocityTracker(windowMs = 100) {
  let samples: { x: number; t: number }[] = [];
  const prune = (now: number) => {
    while (samples.length > 1 && samples[0].t < now - windowMs) samples.shift();
  };
  return {
    reset(x: number, t: number) { samples = [{ x, t }]; },
    add(x: number, t: number) { samples.push({ x, t }); prune(t); },
    release(x: number, t: number) {
      samples.push({ x, t }); prune(t);
      if (samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length - 1];
      return b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    },
  };
}

/** Durée du glissement final : l'élément repart à la vitesse du doigt, bornée. */
export function snapDuration(remainingPx: number, velocity = 0) {
  const speed = Math.abs(velocity);
  if (speed < FLING_VELOCITY || remainingPx <= 0) return 300;
  return Math.round(Math.min(380, Math.max(180, (remainingPx * 2) / speed)));
}

/** Ignore le prochain clic (celui que le navigateur émet au relâcher d'un geste). */
export function swallowNextClick(ms = 400) {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), ms);
}

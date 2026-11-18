// Gestes de page, sur tout le site (branchés dans layouts/Base.astro) :
// - bords élastiques : en haut ou en bas de page, continuer à tirer étire légèrement le contenu, comme un ressort ;
// - retour par balayage : sur une page de détail (galerie, création, projet), balayer vers la droite
//   ramène à la page d'avant, avec la page qui suit le doigt.
// Une zone qui garde son geste porte data-no-swipe (pas de retour) ou data-no-pull-refresh (pas d'élastique).
import {
  AXIS_DECISION_THRESHOLD, FLING_VELOCITY, MIN_FLING_DISTANCE, CLOSE_DISTANCE_RATIO, EASING, DURATION_MS,
  createVelocityTracker, reducedMotion,
} from './gestures';

const DAMPING = 0.45;            // le contenu suit à 45 % du doigt
const SOFT_PX = 110;             // au-delà, encore deux fois plus freiné
const STRETCH_PER_PX = 0.0004;   // 110 px → +4 % de hauteur
const RELEASE = `transform ${DURATION_MS}ms ${EASING}`;
const EDGE = 24;                 // bord gauche réservé au geste retour de l'iPhone

const blocked = (t: EventTarget | null) =>
  !!document.querySelector('dialog[open]') || document.body.classList.contains('menu-open') ||
  !!(t as Element | null)?.closest?.('dialog');

export function attachPageGestures(page: HTMLElement) {
  const backHref = document.body.dataset.back;
  const tracker = createVelocityTracker();
  let phase: 'idle' | 'deciding' | 'pulling' | 'pushing' | 'back' = 'idle';
  let atTop = false, atBottom = false, sx = 0, sy = 0, canBack = false, canStretch = false;

  const style = page.style;
  const paintStretch = (offset: number, animated: boolean) => {
    style.transition = animated ? RELEASE : 'none';
    style.willChange = offset ? 'transform' : '';
    if (offset !== 0) style.transformOrigin = offset < 0 ? 'bottom' : 'top'; // jamais changé pendant le retour à zéro
    const stretch = Math.min(Math.abs(offset), SOFT_PX) * STRETCH_PER_PX;
    const scale = offset ? `scaleY(${(1 + stretch).toFixed(4)})` : '';
    style.transform = offset > 0 ? `translate3d(0,${offset}px,0) ${scale}` : scale;
  };
  const pull = (d: number) => {
    const x = Math.max(0, d) * DAMPING;
    return x <= SOFT_PX ? x : SOFT_PX + (x - SOFT_PX) * 0.5;
  };

  addEventListener('touchstart', (e) => {
    phase = 'idle';
    if (e.touches.length !== 1 || blocked(e.target)) return;
    const el = document.scrollingElement!;
    atTop = el.scrollTop <= 0;
    atBottom = el.scrollTop + innerHeight >= el.scrollHeight - 1;
    const target = e.target as Element;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    canStretch = !reducedMotion() && (atTop || atBottom) && !target.closest?.('[data-no-pull-refresh]');
    canBack = !!backHref && sx > EDGE && !target.closest?.('[data-no-swipe]');
    if (!canStretch && !canBack) return;
    tracker.reset(sx, e.timeStamp);
    phase = 'deciding';
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    if (phase === 'idle') return;
    if (e.touches.length !== 1) { end(); return; } // deuxième doigt : c'est un pincement
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (phase === 'deciding') {
      if (Math.abs(dx) < AXIS_DECISION_THRESHOLD && Math.abs(dy) < AXIS_DECISION_THRESHOLD) return;
      if (Math.abs(dy) <= Math.abs(dx)) {
        // horizontal : retour arrière seulement vers la droite
        if (!canBack || dx <= 0) { phase = 'idle'; return; }
        phase = 'back';
      } else {
        if (!canStretch || (dy > 0 && !atTop) || (dy < 0 && !atBottom)) { phase = 'idle'; return; }
        phase = dy > 0 ? 'pulling' : 'pushing';
      }
    }
    if (e.cancelable) e.preventDefault();
    if (phase === 'back') {
      tracker.add(e.touches[0].clientX, e.timeStamp);
      style.transition = 'none';
      style.willChange = 'transform';
      style.transform = `translate3d(${Math.max(0, dx)}px,0,0)`;
    } else if (phase === 'pushing') paintStretch(-Math.min(SOFT_PX, -dy * DAMPING), false); // étirement en bas
    else paintStretch(pull(dy), false);
  }, { passive: false });

  const end = (e?: TouchEvent) => {
    const p = phase;
    phase = 'idle';
    if (p === 'pulling' || p === 'pushing') { paintStretch(0, true); return; }
    if (p !== 'back') return;
    const x = e?.changedTouches[0]?.clientX ?? sx, dx = x - sx;
    const v = e ? tracker.release(x, e.timeStamp) : 0;
    const thrown = dx > MIN_FLING_DISTANCE && v > FLING_VELOCITY;
    const thrownBack = v < -FLING_VELOCITY;
    if (!e || e.type === 'touchcancel' || !(thrown || (dx > innerWidth * CLOSE_DISTANCE_RATIO && !thrownBack))) {
      style.transition = RELEASE; style.transform = ''; // abandonné : retour en place
      return;
    }
    style.transition = `transform ${DURATION_MS}ms ${EASING}`;
    style.transform = 'translate3d(100%,0,0)';
    setTimeout(goBack, DURATION_MS);
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', end, { passive: true });

  const goBack = () => {
    sessionStorage.setItem('qg-swiped', '1'); // la page d'arrivée ne rejoue pas d'animation par-dessus
    let ref: URL | null = null;
    try { ref = document.referrer ? new URL(document.referrer) : null; } catch {}
    const target = new URL(backHref!, location.href);
    // on vient de la page parente : vrai retour (elle revient à sa position de défilement)
    if (ref && ref.origin === location.origin && ref.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') && history.length > 1) history.back();
    else location.href = target.href;
  };

  // revenu sur cette page par le cache du navigateur : elle doit être en place
  addEventListener('pageshow', (e) => {
    if (e.persisted) { style.transition = 'none'; style.transform = ''; style.willChange = ''; }
  });
}

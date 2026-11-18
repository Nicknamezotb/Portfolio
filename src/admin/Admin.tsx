import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Content } from '../lib/types';
import {
  verify, loadContent, publish, deployStatus, tokenStore, TOKEN_URL, SITE_URL, OWNER, REPO, LOCAL,
  type DeployState, type PublishProgress,
} from './github';
import { StoreCtx, addFiles, imgUrl, pending, photoPaths, validate, onCompressing, whenIdle, type Store } from './store';
import { PANELS } from './panels';
import { Icon } from './icons';
import { LOGO_PATH } from '../lib/logo';

function Logo({ big }: { big?: boolean }) {
  return <svg class={big ? 'logo big' : 'logo'} viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d={LOGO_PATH} /></svg>;
}
import { OAUTH_ENABLED, startLogin, finishLogin, freshToken, clearOAuth } from './auth';
import './admin.css';
import '../styles/photo-grid.css';

type User = { login: string; avatar: string };

/* ---------- Connexion ---------- */

function Login({ onLogin, initialError = '' }: { onLogin: (token: string, user: User) => void; initialError?: string }) {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const github = async () => {
    setBusy(true); setErr('');
    try { await startLogin(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const t = token.trim();
      const user = await verify(t);
      tokenStore.set(t, remember);
      onLogin(t, user);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tokenFields = (
    <>
      <label class="field">
        <span class="label">Jeton GitHub</span>
        <input type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} placeholder="github_pat_…" autoComplete="current-password" required />
      </label>
      <label class="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
        Rester connecté sur cet appareil
      </label>
    </>
  );

  if (OAUTH_ENABLED) {
    return (
      <div class="login">
        <div class="login-box">
          <Logo big />
          <div>
            <h1>Back-office</h1>
            <p class="muted">Accès réservé au propriétaire du compte GitHub <b>{OWNER}</b>.</p>
          </div>
          {err && <p class="error">{err}</p>}
          <button type="button" class="btn primary block" disabled={busy} onClick={github}>
            {busy ? 'Connexion…' : 'Se connecter avec GitHub'}
          </button>
          <details class="help">
            <summary>Secours : se connecter avec un jeton</summary>
            <form onSubmit={submit} style="display:grid;gap:12px;margin-top:12px">
              {tokenFields}
              <button class="btn block" disabled={busy}>{busy ? 'Vérification…' : 'Se connecter avec le jeton'}</button>
            </form>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div class="login">
      <form class="login-box" onSubmit={submit}>
        <Logo big />
        <div>
          <h1>Back-office</h1>
          <p class="muted">Accès réservé au propriétaire du compte GitHub <b>{OWNER}</b>.</p>
        </div>
        {tokenFields}
        {err && <p class="error">{err}</p>}
        <button class="btn primary block" disabled={busy}>{busy ? 'Vérification…' : 'Se connecter'}</button>

        <details class="help">
          <summary>Première connexion : créer mon jeton</summary>
          <ol>
            <li>Ouvre <a href={TOKEN_URL} target="_blank" rel="noopener">la page de création de jeton GitHub</a> (connecté avec <b>{OWNER}</b>).</li>
            <li><b>Repository access</b> : « Only select repositories » → <b>{REPO}</b>.</li>
            <li><b>Permissions</b> : <i>Contents</i> → Read and write, et <i>Actions</i> → Read-only.</li>
            <li>Clique sur <b>Generate token</b>, copie-le et colle-le ci-dessus.</li>
          </ol>
          <p class="muted">Garde ce jeton pour toi : il fonctionne comme un mot de passe. Tu peux le révoquer à tout moment sur GitHub.</p>
        </details>
      </form>
    </div>
  );
}

/* ---------- Publication ---------- */

type Phase = 'wait' | 'check' | 'upload' | 'commit' | 'deploy' | 'live' | 'error';
type Job = {
  phase: Phase;
  started: number;
  photos: number;         // nombre de photos envoyées dans cette publication
  removed: number;
  done?: number; total?: number; bytesDone?: number; bytesTotal?: number; uploadStart?: number;
  deploy?: DeployState;
  deployStart?: number;
  error?: string;
  errors?: string[];      // problèmes à corriger avant de publier
};

const STEPS: { id: Phase; label: string }[] = [
  { id: 'upload', label: 'Envoi des photos' },
  { id: 'commit', label: 'Enregistrement' },
  { id: 'deploy', label: 'Mise à jour du site' },
  { id: 'live', label: 'En ligne' },
];
const ORDER: Phase[] = ['wait', 'check', 'upload', 'commit', 'deploy', 'live'];
const busyPhase = (p?: Phase) => !!p && ['wait', 'check', 'upload', 'commit'].includes(p);

const mo = (b: number) => (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: b < 10485760 ? 1 : 0 });
const dur = (s: number) => (s < 50 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`);

/** Avancement global estimé (0 à 100). */
function percent(j: Job, now: number) {
  switch (j.phase) {
    case 'wait': case 'check': return 2;
    case 'upload': return 3 + 72 * (j.bytesTotal ? j.bytesDone! / j.bytesTotal : 1);
    case 'commit': return 78;
    case 'deploy': {
      // le site met environ 1 min à se reconstruire
      const t = (now - (j.deployStart ?? now)) / 1000;
      return Math.min(98, 82 + 16 * (1 - Math.exp(-t / 35)));
    }
    case 'live': return 100;
    default: return 0;
  }
}

function timeLeft(j: Job, now: number) {
  if (j.phase === 'upload' && j.bytesDone && j.uploadStart && now - j.uploadStart > 2500) {
    const rate = j.bytesDone / (now - j.uploadStart);
    return (j.bytesTotal! - j.bytesDone) / rate / 1000 + 70;
  }
  if (j.phase === 'commit') return 70;
  if (j.phase === 'deploy') return Math.max(10, 70 - (now - (j.deployStart ?? now)) / 1000);
  return null;
}

/** Heure courante rafraîchie toutes les 0,5 s, pour faire avancer les barres sans redessiner toute la page. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return now;
}
const Pct = ({ job }: { job: Job }) => <>{Math.round(percent(job, useNow()))} %</>;
const TopProgress = ({ job }: { job: Job }) => <div class="top-progress"><span style={{ width: `${percent(job, useNow())}%` }} /></div>;

function PublishDock({ job, dirty, queued, onClose, onRetry }: { job: Job; dirty: boolean; queued: boolean; onClose: () => void; onRetry: () => void }) {
  const now = useNow();
  const [small, setSmall] = useState(false);
  // une fois en ligne, le panneau se range tout seul
  useEffect(() => {
    if (job.phase !== 'live' || queued) return;
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [job.phase, queued]);

  if (job.errors) {
    return (
      <div class="dock error">
        <div class="dock-head">
          <span class="dock-ico err"><Icon name="alert" /></span>
          <b>À corriger avant de publier</b>
          <button type="button" class="icon" onClick={onClose} title="Fermer"><Icon name="close" size={16} /></button>
        </div>
        <ul class="dock-list">{job.errors.map((e) => <li>{e}</li>)}</ul>
      </div>
    );
  }

  const pct = percent(job, now);
  const left = timeLeft(job, now);
  const idx = ORDER.indexOf(job.phase === 'error' ? 'upload' : job.phase);
  const title =
    job.phase === 'error' ? 'La publication a échoué'
    : job.phase === 'live' ? 'En ligne'
    : job.phase === 'deploy' ? (job.deploy === 'failure' ? 'La mise à jour du site a échoué' : 'Mise à jour du site…')
    : job.phase === 'wait' ? 'Préparation des photos…'
    : 'Publication en cours…';

  return (
    <div class={`dock ${job.phase}${small ? ' small' : ''}`} role="status" aria-live="polite">
      <div class="dock-head">
        <span class={`dock-ico ${job.phase === 'live' ? 'ok' : job.phase === 'error' || job.deploy === 'failure' ? 'err' : 'busy'}`}>
          {job.phase === 'live' ? <Icon name="check" /> : job.phase === 'error' || job.deploy === 'failure' ? <Icon name="alert" /> : <span class="spin" />}
        </span>
        <span class="dock-title">
          <b>{title}</b>
          {job.phase !== 'error' && job.phase !== 'live' && <small>{Math.round(pct)} %{left != null && ` · encore ≈ ${dur(left)}`}</small>}
          {job.phase === 'live' && <small>Tes modifications sont visibles sur le site.</small>}
        </span>
        {job.phase !== 'live' && job.phase !== 'error' && (
          <button type="button" class="icon" onClick={() => setSmall(!small)} title={small ? 'Agrandir' : 'Réduire'}>
            <Icon name={small ? 'up' : 'down'} size={16} />
          </button>
        )}
        {!busyPhase(job.phase) && <button type="button" class="icon" onClick={onClose} title="Fermer"><Icon name="close" size={16} /></button>}
      </div>

      <div class="bar"><span style={{ width: `${pct}%` }} /></div>

      {!small && (
        <>
          {job.phase === 'error' ? (
            <div class="dock-body">
              <p class="dock-err">{job.error}</p>
              <p class="hint">Rien n'est perdu : tes modifications sont toujours là. Les photos déjà envoyées ne repartiront pas.</p>
              <button type="button" class="btn primary small" onClick={onRetry}>Réessayer</button>
            </div>
          ) : (
            <div class="dock-body">
              {job.phase === 'upload' && job.total! > 0 && (
                <p class="dock-meta">
                  <b>{Math.floor(job.done! / 2)}</b> / {job.total! / 2} photo{job.total! > 2 ? 's' : ''}
                  <span>{mo(job.bytesDone!)} / {mo(job.bytesTotal!)} Mo</span>
                </p>
              )}
              <ol class="steps">
                {STEPS.map((s) => {
                  const i = ORDER.indexOf(s.id);
                  const state = job.phase === 'live' || i < idx ? 'done' : i === idx ? 'now' : 'todo';
                  const skip = s.id === 'upload' && job.photos === 0;
                  return (
                    <li class={`${state}${skip ? ' skip' : ''}`}>
                      <span class="st-dot">{state === 'done' ? <Icon name="check" size={12} /> : null}</span>
                      {skip ? 'Aucune photo à envoyer' : s.label}
                    </li>
                  );
                })}
              </ol>
              {job.phase === 'deploy' && job.deploy === 'unknown' && <p class="hint">Suivi impossible (permission « Actions » absente du jeton) : le site sera à jour d'ici 1 à 2 minutes.</p>}
              {job.phase === 'deploy' && job.deploy === 'failure' && <p class="hint">GitHub n'a pas réussi à reconstruire le site. Tes données sont bien enregistrées : republie plus tard ou relance le déploiement depuis GitHub.</p>}
              {busyPhase(job.phase) && (
                <p class="hint">
                  {queued ? 'Tes nouvelles modifications partiront juste après celle-ci.'
                    : dirty ? 'Tes nouvelles modifications ne font pas partie de cet envoi : clique sur « Publier ensuite » pour les ajouter à la suite.'
                    : 'Tu peux continuer à travailler pendant l’envoi.'}
                </p>
              )}
              {job.phase === 'live' && <a class="btn small" href={SITE_URL} target="_blank" rel="noopener">Voir le site <Icon name="external" size={14} /></a>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Application ---------- */

function Editor({ token, user, onLogout }: { token: string; user: User; onLogout: () => void }) {
  const tok = useRef(token); // jeton toujours à jour (renouvelé toutes les 8 h avec la connexion GitHub)
  tok.current = token;
  const [content, setContent] = useState<Content | null>(null);
  const [originalJson, setOriginalJson] = useState('');
  const [sendingJson, setSendingJson] = useState(''); // version en cours d'envoi
  const [error, setError] = useState('');
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'general');
  const [job, setJob] = useState<Job | null>(null);
  const [queued, setQueued] = useState(false);
  const [menu, setMenu] = useState(false);
  const [compressing, setCompressing] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  // Références toujours à jour (la publication dure longtemps : elle ne doit pas travailler sur des valeurs périmées)
  const contentRef = useRef<Content | null>(null);
  contentRef.current = content;
  const originalRef = useRef<Content | null>(null);
  const shaRef = useRef('');
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;
  const queuedRef = useRef(false);
  queuedRef.current = queued;
  const poll = useRef<number>();

  const busy = busyPhase(job?.phase);
  // pendant un envoi, « modifié » = différent de ce qui est en train de partir
  const dirty = useMemo(() => !!content && JSON.stringify(content) !== (busy && sendingJson ? sendingJson : originalJson), [content, originalJson, sendingJson, busy]);

  /** Nombre de photos ajoutées (encore sur cet appareil). */
  const newPhotos = useMemo(() => {
    if (!content) return 0;
    let n = 0;
    for (const p of photoPaths(content)) if (pending.has(`public${p}`)) n++;
    return n / 2;
  }, [content, job?.phase]);

  const reload = () => {
    setError('');
    loadContent(tok.current)
      .then(({ data, sha }) => {
        // Valeurs par défaut pour les champs ajoutés après coup
        data.home = { heroCaption: '', heroSide: 'left', heroOpacity: 55, worksBg: null, ...data.home };
        data.pageBgs = { photo: null, video: null, creations: null, contact: null, ...data.pageBgs };
        data.galleries = data.galleries.map((g: any) => ({ description: '', ...g }));
        data.home.cards = { photo: null, video: null, creations: null, ...data.home.cards };
        setContent(data);
        originalRef.current = structuredClone(data);
        setOriginalJson(JSON.stringify(data));
        shaRef.current = sha;
      })
      .catch((e) => setError(`Impossible de charger le contenu : ${e.message}`));
  };
  useEffect(reload, []); // pas de rechargement quand le jeton est renouvelé : on garderait sinon les modifs en cours
  useEffect(() => { location.hash = tab; }, [tab]);
  useEffect(() => onCompressing(setCompressing), []);
  useEffect(() => () => clearInterval(poll.current), []);

  // Avertit avant de quitter si quelque chose n'est pas fini
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty || busy || compressing) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [dirty, busy, compressing]);

  const toast = (msg: string, kind = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };

  const store = useMemo<Store | null>(() => content && {
    content,
    set: (fn) => setContent((prev) => { const next = structuredClone(prev!); fn(next); return next; }),
    addFiles: (files, onPhoto) => addFiles(files, onPhoto, (name) => toast(`Impossible de lire « ${name} » (format non pris en charge ?)`, 'err')),
    imgUrl,
    toast,
  }, [content]);

  const watchDeploy = (commit: string) => {
    clearInterval(poll.current);
    const started = Date.now();
    poll.current = window.setInterval(async () => {
      const s = await deployStatus(tok.current, commit);
      setJob((j) => (j && j.phase === 'deploy' ? { ...j, deploy: s, phase: s === 'success' ? 'live' : 'deploy' } : j));
      if (s === 'success' || s === 'failure' || s === 'unknown' || Date.now() - started > 6 * 60_000) clearInterval(poll.current);
    }, 4000);
  };

  const run = async (): Promise<void> => {
    clearInterval(poll.current);
    setQueued(false);
    const t0 = Date.now();
    setSendingJson('');
    setJob({ phase: 'wait', started: t0, photos: 0, removed: 0 });
    await whenIdle(); // attend les photos encore en préparation

    const snap = contentRef.current!;
    const errs = validate(snap);
    if (errs.length) { setJob({ phase: 'error', started: t0, photos: 0, removed: 0, errors: errs }); return; }

    const now = photoPaths(snap);
    const before = photoPaths(originalRef.current!);
    const uploads = new Map<string, Blob>();
    for (const [path, blob] of pending) if (now.has(path.replace(/^public/, ''))) uploads.set(path, blob);
    const deletes = [...before].filter((p) => !now.has(p)).map((p) => `public${p}`);
    const added = uploads.size / 2, removed = deletes.length / 2;

    const parts = [];
    if (added) parts.push(`${added} photo(s) ajoutée(s)`);
    if (removed) parts.push(`${removed} photo(s) supprimée(s)`);
    const message = `Back-office : mise à jour du contenu${parts.length ? ` (${parts.join(', ')})` : ''}`;

    setSendingJson(JSON.stringify(snap));
    setJob({ phase: 'check', started: t0, photos: added, removed });
    try {
      const res = await publish(tok.current, {
        json: JSON.stringify(snap, null, 2) + '\n',
        loadedSha: shaRef.current,
        uploads,
        deletes,
        message,
        onProgress: (p: PublishProgress) => setJob((j) => j && (p.step === 'upload'
          ? { ...j, phase: 'upload', ...p, uploadStart: j.uploadStart ?? Date.now() }
          : { ...j, phase: p.step === 'check' ? 'check' : 'commit' })),
      });
      for (const p of uploads.keys()) pending.delete(p);
      shaRef.current = res.contentSha;
      originalRef.current = structuredClone(snap);
      setOriginalJson(JSON.stringify(snap));
      setJob((j) => j && { ...j, phase: 'deploy', deploy: 'pending', deployStart: Date.now() });

      // Des modifications en attente ? On enchaîne.
      if (queuedRef.current && JSON.stringify(contentRef.current) !== JSON.stringify(snap)) return run();
      setQueued(false);
      watchDeploy(res.commit);
    } catch (e: any) {
      setQueued(false);
      setJob((j) => ({ ...(j ?? { started: t0, photos: added, removed }), phase: 'error', error: e.message || String(e) }));
    }
  };

  const onPublish = () => {
    if (busy) { setQueued(true); return; }
    run();
  };

  if (error) return <div class="center"><p class="error">{error}</p><div><button class="btn" onClick={reload}>Réessayer</button> <button class="btn ghost" onClick={onLogout}>Se déconnecter</button></div></div>;
  if (!content || !store) return <div class="center muted"><span class="spin dark" />Chargement du contenu…</div>;

  const current = PANELS.find((p) => p.id === tab) ?? PANELS[0];
  const Current = current.C;

  let status: { dot: string; text: string };
  if (busy) status = { dot: 'busy', text: job!.phase === 'upload' ? 'Envoi en cours…' : 'Publication en cours…' };
  else if (compressing) status = { dot: 'busy', text: `Préparation de ${compressing} photo${compressing > 1 ? 's' : ''}…` };
  else if (dirty) status = { dot: 'warn', text: newPhotos ? `Non publié · ${newPhotos} photo${newPhotos > 1 ? 's' : ''} à envoyer` : 'Modifications non publiées' };
  else if (job?.phase === 'deploy') status = { dot: job.deploy === 'failure' ? 'err' : 'busy', text: job.deploy === 'failure' ? 'Échec de la mise à jour du site' : 'Mise à jour du site…' };
  else if (job?.phase === 'error') status = { dot: 'err', text: 'La publication a échoué' };
  else status = { dot: 'ok', text: 'Tout est publié' };


  return (
    <StoreCtx.Provider value={store}>
      <div class={`app${menu ? ' menu-open' : ''}`}>
        <aside class="side">
          <div class="side-head">
            <Logo />
            <span><b>Back-office</b><small>{content.settings.name}</small></span>
          </div>
          <nav>
            {PANELS.map((p) => (
              <button type="button" class={tab === p.id ? 'active' : ''} onClick={() => { setTab(p.id); setMenu(false); scrollTo(0, 0); }}>
                <Icon name={p.id} />{p.label}
              </button>
            ))}
          </nav>
          <div class="side-foot">
            <a href={SITE_URL} target="_blank" rel="noopener" class="side-link"><Icon name="globe" />Voir le site<Icon name="external" size={14} /></a>
            <div class="user">
              {user.avatar ? <img src={user.avatar} alt="" /> : <span class="avatar" />}
              <span>{user.login}</span>
              <button type="button" class="icon" title="Se déconnecter" onClick={() => { if (!(dirty || busy) || confirm('Des modifications ne sont pas publiées. Se déconnecter quand même ?')) onLogout(); }}>
                <Icon name="logout" size={16} />
              </button>
            </div>
          </div>
        </aside>
        <div class="scrim" onClick={() => setMenu(false)} />

        <div class="main">
          <header class="topbar">
            <button type="button" class="icon burger" onClick={() => setMenu(!menu)} aria-label="Menu"><Icon name="menu" /></button>
            <span class="crumb">{current.label}</span>
            <div class="status"><span class={`dot ${status.dot}`} /><span class="status-text">{status.text}</span></div>
            <div class="top-actions">
              {dirty && !busy && (
                <button type="button" class="btn ghost" title="Annuler toutes les modifications non publiées" onClick={() => { if (confirm('Annuler toutes les modifications non publiées ?')) reload(); }}>
                  <Icon name="undo" size={16} /><span class="hide-sm">Annuler</span>
                </button>
              )}
              <button type="button" class={`btn primary${busy ? ' working' : ''}`} disabled={busy ? !dirty || queued : !dirty} onClick={onPublish}>
                {busy ? (queued ? <>Prévu ensuite <Icon name="check" size={15} /></> : dirty ? 'Publier ensuite' : <><span class="spin" /><Pct job={job!} /></>) : <><Icon name="upload" size={16} />Publier</>}
              </button>
            </div>
            {job && job.phase !== 'live' && job.phase !== 'error' && <TopProgress job={job} />}
          </header>
          <div class="content">
            <Current />
          </div>
        </div>

        {job && <PublishDock job={job} dirty={dirty} queued={queued} onClose={() => { clearInterval(poll.current); setJob(null); }} onRetry={run} />}
        <div class="toasts">{toasts.map((t) => <div class={`toast ${t.kind}`}>{t.msg}</div>)}</div>
      </div>
    </StoreCtx.Provider>
  );
}

export default function Admin() {
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  const [checking, setChecking] = useState(true);
  const [loginErr, setLoginErr] = useState('');

  useEffect(() => {
    if (LOCAL) { setSession({ token: 'local', user: { login: 'test-local', avatar: '' } }); setChecking(false); return; }
    (async () => {
      // 1. Retour de GitHub après « Se connecter avec GitHub »
      try {
        const t = await finishLogin();
        if (t) { setSession({ token: t, user: await verify(t) }); return; }
      } catch (e: any) {
        clearOAuth();
        setLoginErr(e.message);
        return;
      }
      // 2. Connexion GitHub déjà enregistrée (renouvelée si besoin), sinon ancien jeton collé à la main
      const oauth = OAUTH_ENABLED ? await freshToken() : null;
      const t = oauth ?? tokenStore.get();
      if (!t) return;
      try {
        setSession({ token: t, user: await verify(t) });
      } catch {
        if (oauth) clearOAuth(); else tokenStore.clear();
      }
    })().finally(() => setChecking(false));
  }, []);

  // Connexion GitHub : le jeton dure 8 h, on le renouvelle en arrière-plan (et au retour sur l'onglet après une veille).
  useEffect(() => {
    if (!session || LOCAL || !OAUTH_ENABLED) return;
    const tick = () => freshToken().then((t) => {
      if (t && t !== session.token) setSession((s) => s && { ...s, token: t });
    });
    const id = setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [session?.token]);

  if (checking) return <div class="center muted"><span class="spin dark" />Chargement…</div>;
  if (!session) return <Login initialError={loginErr} onLogin={(token, user) => setSession({ token, user })} />;
  return <Editor token={session.token} user={session.user} onLogout={() => { tokenStore.clear(); clearOAuth(); setSession(null); }} />;
}

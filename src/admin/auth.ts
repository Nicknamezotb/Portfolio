// Connexion « Se connecter avec GitHub » (app GitHub + relais Cloudflare, voir worker/github-auth.js).
// GitHub donne un jeton valable 8 h, renouvelé automatiquement grâce à un jeton de renouvellement (6 mois).

/** À remplir après la création de l'app GitHub et du Worker. Vide = bouton masqué (connexion par jeton seulement). */
export const AUTH = {
  clientId: 'Iv23livHbJDZrMoovjc7',
  worker: 'https://portfolio-auth.qg-girard.workers.dev/',
};

export const OAUTH_ENABLED = !!(AUTH.clientId && AUTH.worker);

const KEY = 'qg-admin-oauth';
const FLOW_KEY = 'qg-admin-oauth-flow';
const MARGIN = 10 * 60_000; // renouvelle 10 min avant l'expiration

type Saved = { access: string; accessExp: number; refresh: string; refreshExp: number };

const read = (): Saved | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
export const clearOAuth = () => localStorage.removeItem(KEY);

const redirectUri = () => `${location.origin}/admin/`;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Envoie vers GitHub pour se connecter (retour sur /admin/ avec un code). */
export async function startLogin() {
  const state = random(16);
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(FLOW_KEY, JSON.stringify({ state, verifier }));
  location.href = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
    client_id: AUTH.clientId,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
}

async function callWorker(body: object): Promise<Saved> {
  let res: Response;
  try {
    res = await fetch(AUTH.worker, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Le service de connexion ne répond pas. Réessaie dans un instant.');
  }
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw new Error(t.error || 'Connexion refusée.');
  const now = Date.now();
  const saved: Saved = {
    access: t.access_token,
    accessExp: now + (t.expires_in ?? 8 * 3600) * 1000,
    refresh: t.refresh_token ?? '',
    refreshExp: now + (t.refresh_token_expires_in ?? 0) * 1000,
  };
  localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}

/** Au retour de GitHub (?code=…&state=…) : échange le code contre un jeton. Renvoie null si l'URL n'est pas un retour. */
export async function finishLogin(): Promise<string | null> {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const error = q.get('error');
  if (!code && !error) return null;
  history.replaceState(null, '', location.pathname); // retire le code de l'adresse
  const flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) || 'null');
  sessionStorage.removeItem(FLOW_KEY);
  if (error) throw new Error(error === 'access_denied' ? 'Connexion annulée.' : `GitHub : ${q.get('error_description') || error}`);
  if (!flow || flow.state !== q.get('state')) throw new Error('Connexion expirée ou invalide, recommence.');
  const s = await callWorker({ code, redirect_uri: redirectUri(), code_verifier: flow.verifier });
  return s.access;
}

/**
 * Jeton GitHub valide, renouvelé si besoin. null si pas (ou plus) connecté par GitHub.
 * Un verrou évite que deux onglets renouvellent en même temps (un jeton de renouvellement ne sert qu'une fois).
 */
export async function freshToken(): Promise<string | null> {
  const run = async () => {
    const s = read();
    if (!s) return null;
    const now = Date.now();
    if (s.accessExp - now > MARGIN) return s.access;
    if (!s.refresh || s.refreshExp <= now) { clearOAuth(); return null; }
    try {
      return (await callWorker({ refresh_token: s.refresh })).access;
    } catch (e: any) {
      if (/répond pas/.test(e.message)) return s.accessExp > now ? s.access : null; // réseau : on garde l'ancien s'il marche encore
      clearOAuth();
      return null;
    }
  };
  return navigator.locks ? navigator.locks.request('qg-admin-oauth', run) : run();
}

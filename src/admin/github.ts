// Accès au repo GitHub depuis le navigateur.
// Le back-office n'a pas de serveur : il lit et écrit directement les fichiers du repo,
// avec un jeton personnel GitHub. Sans ce jeton (que seul le propriétaire possède), rien n'est modifiable.

export const OWNER = 'Nicknamezotb';
export const REPO = 'portfolio';
export const BRANCH = 'main';
export const CONTENT_PATH = 'src/data/content.json';
export const SITE_URL = 'https://quentingirard.fr';

const API = 'https://api.github.com';
const TOKEN_KEY = 'qg-admin-token';

export class GitHubError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY),
  set: (t: string, remember: boolean) => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t),
  clear: () => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); },
};

async function gh<T = any>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message ?? msg; } catch {}
    throw new GitHubError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const repo = `/repos/${OWNER}/${REPO}`;

/** Vérifie que le jeton appartient au propriétaire du site et peut écrire dans le repo. */
export async function verify(token: string) {
  let user;
  try {
    user = await gh(token, '/user');
  } catch (e) {
    throw new GitHubError('Jeton invalide ou expiré.');
  }
  if (user.login.toLowerCase() !== OWNER.toLowerCase()) {
    throw new GitHubError(`Accès refusé : ce jeton appartient à « ${user.login} ».`);
  }
  let r;
  try {
    r = await gh(token, repo);
  } catch {
    throw new GitHubError(`Ce jeton n'a pas accès au repo ${OWNER}/${REPO}.`);
  }
  if (!r.permissions?.push) throw new GitHubError("Ce jeton n'a pas le droit d'écriture (Contents : Read and write).");
  return { login: user.login as string, avatar: user.avatar_url as string };
}

const decodeB64 = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

/** Lit content.json tel qu'il est sur GitHub (version la plus récente, pas celle du site déployé). */
export async function loadContent(token: string) {
  if (LOCAL) return { data: structuredClone((await import('../data/content.json')).default), sha: 'local' };
  const f = await gh(token, `${repo}/contents/${CONTENT_PATH}?ref=${BRANCH}&t=${Date.now()}`);
  return { data: JSON.parse(decodeB64(f.content)), sha: f.sha as string };
}

const blobToB64 = (b: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok((r.result as string).split(',')[1]);
    r.onerror = ko;
    r.readAsDataURL(b);
  });

export type PublishProgress =
  | { step: 'check' }
  | { step: 'upload'; done: number; total: number; bytesDone: number; bytesTotal: number }
  | { step: 'commit' };

export type PublishInput = {
  json: string;
  loadedSha: string;
  uploads: Map<string, Blob>; // chemin dans le repo -> fichier
  deletes: string[];          // chemins dans le repo
  message: string;
  onProgress?: (p: PublishProgress) => void;
};

/** Fichiers déjà envoyés à GitHub (chemin -> identifiant) : un nouvel essai après un échec ne les renvoie pas. */
const sent = new Map<string, string>();
const sentBlob = new WeakMap<Blob, string>();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Réessaie une requête quand GitHub ou le réseau flanche (erreurs 5xx, coupure, limite temporaire). */
async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const transient = !(e instanceof GitHubError) || e.status >= 500 || e.status === 429 || e.status === 403 && /rate|abuse|secondary/i.test(e.message);
      if (!transient || i >= tries) throw e;
      await wait(1000 * 2 ** i);
    }
  }
}

/** Exécute les tâches avec au plus `n` en parallèle. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Publie tout en un seul commit (contenu + nouvelles photos + suppressions). */
export async function publish(token: string, { json, loadedSha, uploads, deletes, message, onProgress }: PublishInput) {
  if (LOCAL) return simulatePublish(uploads, onProgress);
  onProgress?.({ step: 'check' });
  // Protection : si content.json a été modifié ailleurs entre-temps, on ne l'écrase pas.
  const ref0 = await retry(() => gh(token, `${repo}/git/ref/heads/${BRANCH}`));
  const current = await retry(() => gh(token, `${repo}/contents/${CONTENT_PATH}?ref=${ref0.object.sha}`));
  if (current.sha !== loadedSha) {
    throw new GitHubError('Le contenu a été modifié ailleurs (autre onglet ou autre appareil ?). Recharge la page avant de publier.', 409);
  }

  // 1. Envoi des photos, 4 à la fois
  const list = [...uploads];
  const total = list.length;
  const bytesTotal = list.reduce((n, [, b]) => n + b.size, 0);
  let done = 0, bytesDone = 0;
  const report = () => onProgress?.({ step: 'upload', done, total, bytesDone, bytesTotal });
  report();
  const tree: any[] = [{ path: CONTENT_PATH, mode: '100644', type: 'blob', content: json }];
  await pool(list, 4, async ([path, blob]) => {
    let sha = sentBlob.get(blob) ?? sent.get(path);
    if (!sha) {
      const content = await blobToB64(blob);
      const b = await retry(() => gh(token, `${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) }));
      sha = b.sha as string;
      sent.set(path, sha);
      sentBlob.set(blob, sha);
    }
    tree.push({ path, mode: '100644', type: 'blob', sha });
    done++; bytesDone += blob.size;
    report();
  });
  for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });

  // 2. Enregistrement : un seul commit. Si la branche a bougé entre-temps (autre publication), on recommence sur la nouvelle base.
  onProgress?.({ step: 'commit' });
  for (let attempt = 1; ; attempt++) {
    const ref = await retry(() => gh(token, `${repo}/git/ref/heads/${BRANCH}`));
    const head = ref.object.sha as string;
    if (head !== ref0.object.sha) {
      const cur = await retry(() => gh(token, `${repo}/contents/${CONTENT_PATH}?ref=${head}`));
      if (cur.sha !== loadedSha) throw new GitHubError('Le contenu a été modifié ailleurs pendant l’envoi. Recharge la page puis republie.', 409);
    }
    const commit = await retry(() => gh(token, `${repo}/git/commits/${head}`));
    const newTree = await retry(() => gh(token, `${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) }));
    const newCommit = await retry(() => gh(token, `${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) }));
    try {
      await gh(token, `${repo}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
    } catch (e: any) {
      if (attempt < 3 && (e.status === 422 || e.status >= 500 || !(e instanceof GitHubError))) { await wait(1500); continue; }
      throw e;
    }
    const after = await retry(() => gh(token, `${repo}/contents/${CONTENT_PATH}?ref=${newCommit.sha}`));
    return { commit: newCommit.sha as string, contentSha: after.sha as string };
  }
}

export type DeployState = 'pending' | 'running' | 'success' | 'failure' | 'unknown';

/** État du déploiement GitHub Pages déclenché par un commit. */
export async function deployStatus(token: string, sha: string): Promise<DeployState> {
  if (LOCAL) { const t = Date.now() - Number(sha.split('-')[1]); return t < 4000 ? 'pending' : t < 12000 ? 'running' : 'success'; }
  try {
    const r = await gh(token, `${repo}/actions/runs?head_sha=${sha}&per_page=1`);
    const run = r.workflow_runs?.[0];
    if (!run) return 'pending';
    if (run.status !== 'completed') return 'running';
    return run.conclusion === 'success' ? 'success' : 'failure';
  } catch {
    return 'unknown'; // jeton sans permission « Actions : read »
  }
}

/** Lien de création de jeton prérempli (fine-grained, limité à ce repo). */
export const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?' +
  new URLSearchParams({
    name: 'Back-office portfolio',
    description: 'Accès du back-office au repo portfolio',
    target_name: OWNER,
    expires_in: '366',
    contents: 'write',
    actions: 'read',
  });

/** Mode test local : simule un envoi (rien n'est envoyé) pour tester l'interface. */
async function simulatePublish(uploads: Map<string, Blob>, onProgress?: (p: PublishProgress) => void) {
  onProgress?.({ step: 'check' });
  await wait(600);
  const list = [...uploads.values()];
  const bytesTotal = list.reduce((n, b) => n + b.size, 0);
  let bytesDone = 0;
  for (let i = 0; i < list.length; i++) {
    onProgress?.({ step: 'upload', done: i, total: list.length, bytesDone, bytesTotal });
    await wait(400);
    bytesDone += list[i].size;
  }
  onProgress?.({ step: 'upload', done: list.length, total: list.length, bytesDone, bytesTotal });
  onProgress?.({ step: 'commit' });
  await wait(800);
  return { commit: `local-${Date.now()}`, contentSha: 'local' };
}

/** Mode test local (uniquement avec `npm run dev` et ?local dans l'URL) : aucun accès GitHub. */
export const LOCAL = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('local');

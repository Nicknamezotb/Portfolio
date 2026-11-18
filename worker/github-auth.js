// Relais de connexion « Se connecter avec GitHub » du back-office (Cloudflare Worker).
//
// Pourquoi ce relais : pour transformer le code de connexion renvoyé par GitHub en jeton,
// GitHub exige le « client secret » de l'app. Ce secret ne peut pas être mis dans le site
// (tout le monde peut lire son code) : il reste ici, dans les secrets du Worker.
//
// Secrets à définir dans Cloudflare (Settings → Variables and Secrets) :
//   GITHUB_CLIENT_ID      identifiant de l'app GitHub (Client ID)
//   GITHUB_CLIENT_SECRET  secret de l'app GitHub
//
// Sécurité : n'accepte que les demandes venant du site (ou du serveur local de test),
// et ne rend un jeton que s'il appartient au compte OWNER (sinon il est révoqué aussitôt).

const OWNER = 'Nicknamezotb';
const ALLOWED = ['https://quentingirard.fr', 'https://www.quentingirard.fr', 'http://localhost:4321'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST' || !ALLOWED.includes(origin)) return json({ error: 'Accès refusé.' }, 403);

    const body = await req.json().catch(() => ({}));
    const params = { client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET };
    if (typeof body.code === 'string') {
      Object.assign(params, { code: body.code, redirect_uri: body.redirect_uri, code_verifier: body.code_verifier });
    } else if (typeof body.refresh_token === 'string') {
      Object.assign(params, { grant_type: 'refresh_token', refresh_token: body.refresh_token });
    } else {
      return json({ error: 'Requête invalide.' }, 400);
    }

    const t = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then((r) => r.json()).catch(() => ({}));
    if (!t.access_token) return json({ error: t.error_description || t.error || 'GitHub a refusé la connexion.' }, 401);

    // Seul le propriétaire du site obtient un jeton.
    const user = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-auth' },
    }).then((r) => r.json()).catch(() => ({}));
    if (String(user.login || '').toLowerCase() !== OWNER.toLowerCase()) {
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`),
          Accept: 'application/vnd.github+json',
          'User-Agent': 'portfolio-auth',
        },
        body: JSON.stringify({ access_token: t.access_token }),
      }).catch(() => {});
      return json({ error: `Accès refusé : ce compte (« ${user.login || 'inconnu'} ») n'est pas celui du propriétaire.` }, 403);
    }

    return json({
      access_token: t.access_token,
      expires_in: t.expires_in,
      refresh_token: t.refresh_token,
      refresh_token_expires_in: t.refresh_token_expires_in,
    });
  },
};

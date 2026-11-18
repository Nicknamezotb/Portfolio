# Portfolio Quentin Girard — notes de travail

Portfolio photo/vidéo de Quentin Girard (remplace quentingirard.myportfolio.com, Adobe Portfolio).
Quentin parle français, familier ; pas développeur : expliquer simplement, sans jargon.

## Où est quoi

| Élément | Emplacement |
|---|---|
| Code source | `C:\Users\qgir2\Desktop\Portfolio` (Windows 11) |
| Repo GitHub | https://github.com/Nicknamezotb/portfolio (public, branche `main`) |
| Site en ligne | https://quentingirard.fr/ (GitHub Pages) |
| Back-office | https://quentingirard.fr/admin |
| Contenu (textes, listes, réglages) | `src/data/content.json` (fichier unique) |
| Photos publiées | `public/media/<id>.webp` + `<id>-sm.webp` (vignette), dans repo |
| Vidéos | YouTube (chaîne @qg.production), seulement ID dans content.json |
| Photos de démo | picsum.photos, générées à la volée tant que liste photos vide |
| Formulaire de contact | Formspree (`settings.formspreeId` = xaeqgewr, compte Quentin), repli mailto si vide. Adresse jamais en clair dans HTML : boutons « Copier mon e-mail » (`data-copy-email`, encodage dans `src/lib/email.ts`) |
| Logo | diaphragme 6 lames, tracé dans `src/lib/logo.ts` (LOGO_PATH) ; fichiers `public/logo.svg` (noir), `logo-blanc.svg`, `favicon.svg` (s'éclaircit en mode sombre). Généré par calcul, pas décalqué |
| Polices | auto-hébergées via @fontsource (Bebas Neue titres, Inter texte, DM Sans petits textes via `--font-mono` — Quentin trouvait JetBrains Mono « trop IA ») |

Domaine perso **quentingirard.fr** (OVH, payé jusqu'en oct. 2029) : DNS OVH = 4 A vers 185.199.108-111.153 + CNAME www → nicknamezotb.github.io. ; `public/CNAME` ; `site`/`base: '/'` dans astro.config.mjs. Ancienne adresse github.io redirige.

## Stack

- **Astro 7** (100 % statique), `base: '/'` → **tous liens internes passent par `url()`** de `src/lib/media.ts`.
- **Preact** (`@astrojs/preact`) uniquement pour back-office (`client:only`).
- Node 26 / npm 11 en local. npm 11 bloque scripts d'installation : après `npm i`, si esbuild ou sharp posent problème → `npm install-scripts approve esbuild sharp`.
- CI : `.github/workflows/deploy.yml` (withastro/action, **`node-version: 24` obligatoire**, Astro 7 refuse Node 20).

## Commandes

```bash
npm run dev      # http://localhost:4321  (config preview : .claude/launch.json, nom "portfolio")
npm run build    # vérifier avant de pousser
```

- Admin en local **sans GitHub** : http://localhost:4321/admin?local (mode `LOCAL` dans `src/admin/github.ts`, dev seulement ; charge content.json local, ne peut pas publier).
- Déployer : `git push` sur `main` → GitHub Actions publie en ~1 min.
- Suivre déploiement : `"/c/Program Files/GitHub CLI/gh.exe" run list -R Nicknamezotb/portfolio -L 3` puis `gh run watch <id> --exit-status`.
- Committer avec `git -c user.name="Quentin Girard" -c user.email="qg.girard@gmail.com" commit ...` (pas d'identité git globale), avec ligne Co-Authored-By.

## Architecture du site

```
src/
  data/content.json      tout le contenu (voir types)
  lib/types.ts           type Content (partagé site + admin) — À METTRE À JOUR à chaque nouveau champ
  lib/media.ts           content, url(), photos()/cover()/single() (+ repli démo), ytThumb()
  lib/layout.ts          réglages d'affichage PARTAGÉS site + admin : GRID (colonnes par page), rowHeight(), ASPECT (formats des cadres : cartes, hero, couvertures…), SITE_WIDTH
  styles/photo-grid.css  grille justifiée (.pgrid/.ptile) partagée site + admin ; .pgrid-scale = aperçu admin à l'échelle
  lib/lightbox.ts        visionneuse plein écran (vanilla)
  layouts/Base.astro     <head>, thème injecté en variables CSS, prop bodyClass
  components/            Nav, Footer, PhotoGrid (rangées justifiées en flex : --r = ratio, --rh = hauteur de rangée ; prop columns = taille), Footer (encart « Travaillons ensemble » arrondi, sans traits), VideoEmbed (façade YouTube),
                         Tile (carte au style de l'accueil : arrondi, ombre, texte sur photo, survol), Backdrop (photo floutée en haut de page)
  pages/
    index.astro          accueil : hero plein écran + voile, cartes rubriques, projet à la une
    photo/index, photo/[slug]          galeries
    video.astro                         vidéos par catégorie
    creations/index, creations/[slug]   créations visuelles
    projets/[slug]                      projets longs (ex. machu-picchu)
    contact, 404, admin
  admin/                 back-office (voir ci-dessous)
  styles/global.css
```

- **Thème** : seules `--bg`, `--text`, `--accent` viennent de `settings.theme` (injectées en `html:root` dans Base.astro, spécificité > global.css). Autres teintes (`--muted`, `--line`, `--raised`…) dérivées par `color-mix()`. Thème clair par défaut (#f5f3ee / #17181c / #3f6a91).
- **Accueil** : `home.heroPhoto`, `heroSide` (left/right), `heroOpacity` (0–100, opacité voile), `heroCaption`, `worksBg` (photo floutée derrière « Travaux », masque sur `.works-bgwrap`), `cards.{photo,video,creations}` (null = image par défaut tirée du contenu), `featured` (slug projet). Sur accueil, menu desktop = pastille en verre (`body.home:not(.scrolled)`).
- **Fonds de page** : `pageBgs.{photo,video,creations,contact}` (réglables en haut onglets Vidéos / Galeries / Créations, et dans Général pour Contact) ; pages de détail (galerie, création, projet) utilisent leur couverture.
- 2e `astro dev` refusé si autre session en fait tourner un : utiliser config `portfolio-build` (astro preview du build, port 4330).
- **Redirections** anciennes URL Adobe (`/projet-mp`, `/work`, `/copie-de-nevera`…) dans `astro.config.mjs` → `redirects`.
- **Miniatures YouTube** : `maxresdefault` (16/9) ; `hqdefault` a bandes noires. VideoEmbed retombe sur hqdefault si maxres absent.

- **Texte enrichi** : `rich()` (media.ts) transforme `**mot**` en gras (HTML échappé). Utilisé pour intro projets (page projet + « À la une »).
- **Page projet** : bannière couverture arrondie avec titre incrusté, puis texte | vidéo côte à côte, puis sections photo compactes (PhotoGrid columns=5).
- **Accueil** : cartes Photo/Vidéo/Créations alignées (pas de décalage ni parallaxe sur cartes), survol = seule carte visée se soulève ; pas d'indicateur de défilement ni liens sous accroche ; barre menu progressive via variable CSS `--nav` (0→1) pilotée par défilement.

### Gestes « appli native » (2026-11, d'après `IsepLife V2/PORTFOLIO_GESTES.md`)
- `lib/gestures.ts` : seuils communs (8 px avant de choisir l'axe, vitesse sur 100 ms, 25 % de largeur).
- `lib/lightbox.ts` + `styles/lightbox.css` : visionneuse (ruban de 3 photos, ouverture/fermeture depuis la vignette, glisser vers le bas, zoom pincement/double-tap/molette ×5, appui long = immersion). Ouverte = entrée d'historique `{lb:true}` : le retour du téléphone la ferme.
- `lib/justified.ts` : sur le site, grille placée en JS (`.pgrid.is-js`, positions absolues), rangées au plus près d'une largeur cible en « formats » ; niveau « paires » sur téléphone ; zoom de grille au pincement / Ctrl+molette (cases animées par transform, la vraie grille n'est reposée qu'à la fin). L'admin garde la grille CSS.
- `lib/pageGestures.ts` : bords élastiques (tout le site) + balayage vers la droite = retour sur pages de détail (`<Base back="/photo">` → `data-back`). Contenu enveloppé dans `#page` (le menu fixe reste dehors).
- Transitions entre pages : `@view-transition` dans global.css + script `pagereveal` dans Base.astro (types `push`/`pop`).

## Back-office (`src/admin/`)

Pas de serveur : admin lit/écrit repo via API GitHub, depuis navigateur.

- **Auth** : jeton GitHub *fine-grained* de Quentin (repo `portfolio`, Contents RW + Actions R). `verify()` exige `login === Nicknamezotb` et `permissions.push`. Jeton en localStorage/sessionStorage (`qg-admin-token`). Ne jamais saisir de jeton réel à sa place : lui le crée et le colle.
- **Publication** (`publish()` dans github.ts) : **un seul commit** via API Git Data (blobs → tree → commit → PATCH ref) avec content.json + photos ajoutées + suppressions. Refus si sha de content.json changé depuis chargement (conflit).
- **Photos** : `images.ts` compresse dans navigateur (OffscreenCanvas → WebP, 2000 px q0.82 + vignette 720 px q0.75, métadonnées/GPS supprimées). Fichiers en attente dans `store.pending` jusqu'à publication. Suppressions/ajouts **calculés à la publication** en comparant `photoPaths(original)` et `photoPaths(contenu)` : rien à gérer à chaque action.
- **Bibliothèque** : chaque champ photo a « Choisir parmi les photos du site » (`PhotoPicker`, `photoLibrary()` dans store.ts).
- **Recadrage** non destructif (`Cropper` dans ui.tsx) : `photo.crop = { x, y, zoom }` sur photo unique ou 1re d'une liste (couverture). Rendu site via `cropStyle()` (media.ts) : object-position + propriété CSS `scale` (compatible transform de parallaxe). Prop `aspect` de PhotoManager = format réel sur site.
- Aperçu photos déjà publiées dans admin : raw.githubusercontent.com (pas site déployé, qui peut être en retard).
- **Taille des vignettes admin = site** : changer une taille/un format dans `lib/layout.ts` ou `styles/photo-grid.css` met à jour les deux. Ne jamais recoder une taille en dur dans une page ou dans l'admin.
- **Envoi** : photos 4 à la fois, nouvel essai auto (5xx, réseau), photos déjà envoyées gardées en mémoire (`sent` dans github.ts) pour un nouvel essai. On peut modifier pendant l'envoi : « modifié » est comparé à la version en cours d'envoi ; « Publier ensuite » enchaîne un 2e envoi. La publication attend les compressions en cours (`whenIdle` dans store.ts). Panneau de suivi : `PublishDock` dans Admin.tsx. En mode `?local`, l'envoi est simulé (rien n'est envoyé).
- Photos ajoutées arrivent une à une (3 compressions en parallèle), avec emplacements animés ; pastille « Non publiée » tant qu'elles ne sont pas sur GitHub.
- Après publication : interroger `actions/runs?head_sha=` toutes les 5 s pour afficher « En ligne ✓ ».
- Fichiers : `Admin.tsx` (connexion, éditeur, barre Publier), `panels.tsx` (Général, Accueil, Vidéos, Galeries, Créations, Projets), `ui.tsx` (Field, Area, Toggle, ColorField, SlugField, YouTubeField, ItemList repliable/réordonnable, PhotoManager glisser-déposer, SectionsEditor), `store.ts` (contexte, slugify, youtubeId, validate), `admin.css`.

### Ajouter un champ configurable (procédure)
1. Ajouter champ dans `src/lib/types.ts`.
2. L'ajouter dans `src/data/content.json` avec valeur par défaut.
3. Ajouter **défaut de secours** au chargement dans `Admin.tsx` (`reload()`, normalisation de `data.home`…) et avec `??` côté pages, si content.json en ligne plus ancien.
4. L'éditer dans bon panneau de `panels.tsx`.
5. L'utiliser dans pages. Puis `npm run build`, tester `/admin?local`, pousser.

⚠️ Quentin peut publier depuis admin à tout moment : **faire `git pull` avant de modifier content.json en local**, sinon conflit.

## Pièges de l'environnement

- **Plusieurs sessions Claude (forks) peuvent travailler en même temps sur ce dossier** : toujours `git pull --rebase --autostash` avant de modifier, committer seulement ses fichiers (`git add <fichiers>`), prévenir Quentin si modifications inconnues.
- Déploiements GitHub Pages parfois en échec côté GitHub (502, timeout, « cancelled » si deux pushs se suivent) : relancer avec `gh workflow run deploy.yml`.
- Panneau navigateur caché met requestAnimationFrame en pause : pour tester animations, remplacer `window.requestAnimationFrame` par setTimeout dans page.

- Bash = Git Bash sous Windows. **Python pas installé** (utiliser `node -e` pour scripts).
- Heredocs bash avec beaucoup de backticks/apostrophes ont cassé une fois → préférer outil Write pour fichiers.
- `gh` pas dans PATH : `"/c/Program Files/GitHub CLI/gh.exe"`. Connecté au compte Nicknamezotb (keyring).
- Outil `run_in_terminal` échoue (intégration terminal desktop cassée) → demander à Quentin de lancer lui-même commandes interactives.
- Avertissements « LF will be replaced by CRLF » au commit : sans conséquence.
- Relancer serveur de dev après modification de `astro.config.mjs`.

## Contenu et décisions

- 6 galeries, 10 vidéos (4 catégories), 3 créations (BAIANA, NEVERA, EXALTE), 1 projet (Machu Picchu).
- Photos importées de l'ancien site Adobe le 2026-10-20 (≈520, IDs `a-<uuid>` dans public/media, ~189 Mo). Photo d'accueil = photo du Pérou par défaut.
- BAIANA : année « 2025-2026 » (confirmé par Quentin).
- Quentin ne veut **pas** de collaborateur (Martin) : projet perso, repo réservé à lui.
- Préférences Quentin : pas de grands vides, pas de traits/séparateurs « archaïques », pas d'éléments décoratifs inutiles ; **pas de zoom sur images** (ni survol ni défilement : seulement fondus et parallaxe légère) ; pas de jaune ; rendu moderne, épuré, typo pas trop grosse ; thème clair ; tout modifiable depuis admin ; seul administrateur.
- Bouton Publier de l'admin testé et fonctionnel par Quentin (2026-10).
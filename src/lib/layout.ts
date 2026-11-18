// Réglages d'affichage des photos, partagés par le site ET le back-office.
// Modifier une valeur ici change le site et l'aperçu de l'admin en même temps.

/** Largeur utile du contenu sur grand écran (--max 1320px moins les marges de 48px). Sert à mettre l'aperçu admin à l'échelle. */
export const SITE_WIDTH = 1224;

/** « Colonnes » des grilles de photos (plus le nombre est grand, plus les photos sont petites). */
export const GRID = {
  gallery: 3,  // page d'une galerie
  creation: 2, // sections d'une création
  project: 5,  // sections d'un projet
} as const;

/** Hauteur d'une rangée (px, grand écran) selon le nombre de « colonnes ». */
export const rowHeight = (columns: number) => (columns >= 5 ? 200 : columns >= 4 ? 240 : columns >= 3 ? 300 : 420);

/** Espace entre les photos (px, grand écran). */
export const GRID_GAP = 12;

/** Forme d'une photo (largeur / hauteur), 1.5 si inconnue. */
export const ratio = (p: { w?: number; h?: number }) => (p.w && p.h ? p.w / p.h : 1.5);

/** Formats (largeur / hauteur) des images affichées en cadre fixe. */
export const ASPECT = {
  hero: 16 / 9,         // photo plein écran de l'accueil
  card: 4 / 5,          // cartes Photo / Vidéo / Créations de l'accueil, et couvertures des galeries et créations
  worksBg: 2.4,         // fond flouté de « Travaux »
  pageBg: 16 / 9,       // fond flouté en haut des pages
  projectCover: 2.3,    // bannière en haut d'une page projet (et « À la une » de l'accueil)
} as const;

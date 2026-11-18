import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Content, Photo } from '../lib/types';
import { processImage } from './images';
import { OWNER, REPO, BRANCH } from './github';

export type Store = {
  content: Content;
  /** Modifie le contenu : la fonction reçoit une copie modifiable. */
  set: (fn: (draft: Content) => void) => void;
  /** Compresse des fichiers ; chaque photo prête est transmise à `onPhoto` dans l'ordre (en attente de publication). */
  addFiles: (files: File[], onPhoto: (p: Photo) => void) => Promise<void>;
  /** URL affichable dans l'admin (aperçu local si la photo n'est pas encore publiée). */
  imgUrl: (p: Photo, thumb?: boolean) => string;
  /** Message court (en bas de l'écran). */
  toast: (msg: string, kind?: 'ok' | 'err') => void;
};

export const StoreCtx = createContext<Store>(null as any);
export const useStore = () => useContext(StoreCtx);

/** Fichiers en attente : chemin dans le repo -> blob, et chemin public -> URL d'aperçu. */
export const pending = new Map<string, Blob>();
const previews = new Map<string, string>();

/** La photo n'est pas encore sur GitHub (ajoutée depuis la dernière publication). */
export const isPending = (p: Photo) => pending.has(`public${p.src}`);

/* Compressions en cours, toutes rubriques confondues : la publication attend qu'elles soient finies. */
let compressing = 0;
const listeners = new Set<(n: number) => void>();
const emit = () => listeners.forEach((f) => f(compressing));
export const onCompressing = (f: (n: number) => void) => { listeners.add(f); f(compressing); return () => { listeners.delete(f); }; };
export const whenIdle = () => new Promise<void>((ok) => {
  if (!compressing) return ok();
  const off = onCompressing((n) => { if (!n) { off(); setTimeout(ok, 60); } });
});

export async function addFiles(files: File[], onPhoto: (p: Photo) => void, onError?: (name: string) => void) {
  const list = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif|avif|webp|jpe?g|png|gif|tiff?)$/i.test(f.name));
  compressing += list.length; emit();
  // 3 compressions en parallèle, mais les photos sont livrées dans l'ordre choisi
  const results: (Photo | null | undefined)[] = new Array(list.length);
  let next = 0, out = 0;
  const flush = () => {
    while (out < list.length && results[out] !== undefined) {
      const p = results[out++];
      if (p) onPhoto(p);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      try {
        const { photo, files: blobs } = await processImage(list[i]);
        for (const [path, blob] of blobs) {
          pending.set(path, blob);
          previews.set(path.replace(/^public/, ''), URL.createObjectURL(blob));
        }
        results[i] = photo;
      } catch (e) {
        console.error(e);
        results[i] = null;
        onError?.(list[i].name);
      }
      compressing--; emit();
      flush();
    }
  }));
}

const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/public`;

export function imgUrl(p: Photo, thumb = true) {
  const path = thumb ? p.thumb : p.src;
  if (/^https?:/.test(path)) return path;
  return previews.get(path) ?? `${RAW}${path}`;
}

/** Tous les chemins de photos référencés dans un contenu. */
export function photoPaths(c: Content): Set<string> {
  const set = new Set<string>();
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.src === 'string' && typeof v.thumb === 'string' && 'w' in v) {
      set.add(v.src); set.add(v.thumb);
      return;
    }
    Object.values(v).forEach(walk);
  };
  walk(c);
  return set;
}

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Extrait l'identifiant d'une URL YouTube (ou renvoie la saisie si c'est déjà un ID). */
export function youtubeId(input: string) {
  const s = input.trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : s;
}

/** Vérifications avant publication. Renvoie la liste des problèmes. */
export function validate(c: Content): string[] {
  const errs: string[] = [];
  const check = (list: { slug: string; title: string }[], label: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (!x.slug) errs.push(`${label} « ${x.title || 'sans titre'} » : l'adresse (slug) est vide.`);
      else if (seen.has(x.slug)) errs.push(`${label} : l'adresse « ${x.slug} » est utilisée deux fois.`);
      seen.add(x.slug);
    }
  };
  check(c.galleries, 'Galerie');
  check(c.creations, 'Création');
  check(c.projects, 'Projet');
  if (!c.settings.name.trim()) errs.push('Général : le nom est vide.');
  return errs;
}

export type PhotoGroup = { label: string; photos: Photo[] };

/** Toutes les photos déjà présentes sur le site, rangées par provenance (sans doublons). */
export function photoLibrary(c: Content): PhotoGroup[] {
  const seen = new Set<string>();
  const groups: PhotoGroup[] = [];
  const push = (label: string, list: (Photo | null | undefined)[]) => {
    const photos = list.filter((p): p is Photo => !!p && !seen.has(p.src));
    photos.forEach((p) => seen.add(p.src));
    if (photos.length) groups.push({ label, photos });
  };
  for (const g of c.galleries) push(`Galerie · ${g.title}`, g.photos);
  for (const p of c.projects) {
    push(`Projet · ${p.title} · couverture`, [p.cover]);
    p.sections.forEach((s) => push(`Projet · ${p.title} · ${s.title}`, s.photos));
  }
  for (const cr of c.creations) cr.sections.forEach((s) => push(`Création · ${cr.title} · ${s.title}`, s.photos));
  push('Accueil', [c.home.heroPhoto, c.home.worksBg, c.home.cards?.photo, c.home.cards?.video, c.home.cards?.creations]);
  return groups;
}

import type { ComponentChildren } from 'preact';
import { useState, useRef } from 'preact/hooks';
import type { Photo } from '../lib/types';
import { useStore, youtubeId, photoLibrary, isPending } from './store';
import { GRID, GRID_GAP, ASPECT, SITE_WIDTH, rowHeight, ratio } from '../lib/layout';
import { Icon } from './icons';

/* ---------- Champs ---------- */

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ComponentChildren;
  placeholder?: string;
  type?: string;
  wide?: boolean;
};

export function Field({ label, value, onChange, hint, placeholder, type = 'text', wide }: FieldProps) {
  return (
    <label class={`field${wide ? ' wide' : ''}`}>
      <span class="label">{label}</span>
      <input type={type} value={value ?? ''} placeholder={placeholder} onInput={(e) => onChange(e.currentTarget.value)} />
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

export function Area({ label, value, onChange, hint, placeholder, rows = 4 }: FieldProps & { rows?: number }) {
  return (
    <label class="field wide">
      <span class="label">{label}</span>
      <textarea rows={rows} value={value ?? ''} placeholder={placeholder} onInput={(e) => onChange(e.currentTarget.value)} />
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="toggle wide">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="switch" />
      <span>
        <span class="label">{label}</span>
        {hint && <span class="hint">{hint}</span>}
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="field color">
      <span class="label">{label}</span>
      <span class="color-row">
        <input type="color" value={value} onInput={(e) => onChange(e.currentTarget.value)} />
        <input type="text" value={value} onInput={(e) => /^#[0-9a-f]{6}$/i.test(e.currentTarget.value) && onChange(e.currentTarget.value)} />
      </span>
    </label>
  );
}

export function SlugField({ value, onChange, prefix }: { value: string; onChange: (v: string) => void; prefix: string }) {
  return (
    <Field
      label="Adresse de la page"
      value={value}
      onChange={(v) => onChange(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
      hint={<>{prefix}<b>{value || '…'}</b> · lettres minuscules, chiffres et tirets</>}
    />
  );
}

export function YouTubeField({ label = 'Vidéo YouTube', value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div class="field wide yt-field">
      <label class="field">
        <span class="label">{label}</span>
        <input
          value={value}
          placeholder="Colle le lien YouTube (ou l'identifiant)"
          onInput={(e) => onChange(youtubeId(e.currentTarget.value))}
        />
        <span class="hint">Identifiant : <b>{value || '—'}</b></span>
      </label>
      {value && <img src={`https://i.ytimg.com/vi/${value}/mqdefault.jpg`} alt="" />}
    </div>
  );
}

/* ---------- Mise en page ---------- */

export function Panel({ title, intro, actions, children }: { title: string; intro?: ComponentChildren; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h1>{title}</h1>
          {intro && <p class="intro">{intro}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Card({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <div class="card">
      {title && <h2>{title}</h2>}
      <div class="grid">{children}</div>
    </div>
  );
}

/* ---------- Listes ---------- */

type ListProps<T> = {
  items: T[];
  onChange: (items: T[]) => void;
  title: (item: T, i: number) => ComponentChildren;
  meta?: (item: T) => ComponentChildren;
  thumb?: (item: T) => string | undefined;
  render: (item: T, update: (fn: (x: T) => void) => void, i: number) => ComponentChildren;
  create: () => T;
  addLabel: string;
  confirmDelete?: (item: T) => string;
  startOpen?: number | null;
};

/** Liste d'éléments repliables, réordonnables (flèches) et supprimables. */
export function ItemList<T>({ items, onChange, title, meta, thumb, render, create, addLabel, confirmDelete, startOpen = null }: ListProps<T>) {
  const [open, setOpen] = useState<number | null>(startOpen);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (open === i) setOpen(j); else if (open === j) setOpen(i);
  };
  const remove = (i: number) => {
    const msg = confirmDelete?.(items[i]) ?? 'Supprimer cet élément ?';
    if (!confirm(msg)) return;
    onChange(items.filter((_, k) => k !== i));
    setOpen(null);
  };
  const update = (i: number) => (fn: (x: T) => void) => {
    const next = structuredClone(items);
    fn(next[i]);
    onChange(next);
  };

  return (
    <div class="list">
      {items.map((item, i) => {
        const t = thumb?.(item);
        return (
          <div class={`list-item${open === i ? ' open' : ''}`} key={i}>
            <div class="list-row">
              <button type="button" class="list-toggle" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span class="chev"><Icon name="chevron" size={16} /></span>
                {thumb && <span class="list-thumb">{t && <img src={t} alt="" />}</span>}
                <span class="list-title">{title(item, i)}</span>
                {meta && <span class="list-meta">{meta(item)}</span>}
              </button>
              <div class="list-actions">
                <button type="button" class="icon" title="Monter" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={15} /></button>
                <button type="button" class="icon" title="Descendre" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={15} /></button>
                <button type="button" class="icon danger" title="Supprimer" onClick={() => remove(i)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
            {open === i && <div class="list-body">{render(item, update(i), i)}</div>}
          </div>
        );
      })}
      <button type="button" class="btn ghost add" onClick={() => { onChange([...items, create()]); setOpen(items.length); }}>
        <Icon name="plus" size={16} />{addLabel}
      </button>
    </div>
  );
}

/* ---------- Photos ---------- */

/**
 * aspect : format du cadre sur le site (photo unique, ou couverture = 1re photo d'une liste), utilisé par l'aperçu et le recadrage.
 * columns : pour une liste, réglage de la grille de la page (GRID dans lib/layout.ts) : l'aperçu reproduit exactement le site.
 */
type PhotosProps = { label?: string; photos: Photo[]; onChange: (p: Photo[]) => void; single?: boolean; hint?: string; aspect?: number; columns?: number };

/** Glisser-déposer de photos, réordonnables par glisser, avec compression automatique. */
export function PhotoManager({ label = 'Photos', photos, onChange, single, hint, aspect, columns = GRID.gallery }: PhotosProps) {
  const { addFiles, imgUrl } = useStore();
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);
  // Recadrage : la photo unique (couverture/fond), ou la 1re d'une liste (couverture de la galerie)
  const cropTarget = photos[0];
  const cropAspect = aspect ?? (single ? ASPECT.pageBg : ASPECT.card);
  const [waiting, setWaiting] = useState(0); // photos en cours de compression
  const [over, setOver] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Toujours la dernière version : les photos arrivent une à une pendant que tu continues à travailler
  const latest = useRef({ photos, onChange });
  latest.current = { photos, onChange };
  const buffer = useRef<Photo[]>([]);
  const flushTimer = useRef<number>();

  const add = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, single ? 1 : undefined);
    setWaiting((n) => n + list.length);
    let delivered = 0;
    await addFiles(list, (p) => {
      delivered++;
      setWaiting((n) => Math.max(0, n - 1));
      if (single) { latest.current.onChange([p]); return; }
      // regroupe les photos prêtes au même moment, puis les ajoute à la liste la plus récente
      buffer.current.push(p);
      clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => {
        const add = buffer.current.splice(0);
        const known = new Set(latest.current.photos.map((x) => x.src));
        latest.current.onChange([...latest.current.photos, ...add.filter((x) => !known.has(x.src))]);
      }, 30);
    });
    // fichiers illisibles (déjà signalés) : on retire leurs emplacements
    setWaiting((n) => Math.max(0, n - (list.length - delivered)));
  };

  const reorder = (to: number) => {
    if (drag === null || drag === to) return;
    const next = photos.slice();
    const [m] = next.splice(drag, 1);
    next.splice(to, 0, m);
    onChange(next);
    setDrag(to);
  };

  const remove = (i: number) => onChange(photos.filter((_, k) => k !== i));

  const tools = (p: Photo, i: number) => (
    <>
      {isPending(p) && <span class="pend" title="Ajoutée sur cet appareil, pas encore publiée">Non publiée</span>}
      {i === 0 && !single && <span class="badge">Couverture</span>}
      <span class="tile-tools">
        {i === 0 && <button type="button" class="tool" title="Recadrer la couverture" onClick={() => setCropping(true)}><Icon name="crop" size={14} /></button>}
        <button type="button" class="tool danger" title="Retirer" onClick={() => remove(i)}><Icon name="trash" size={14} /></button>
      </span>
    </>
  );

  return (
    <div class="field wide photos">
      <div class="photos-head">
        <span class="label">{label} {!single && <em>{photos.length}</em>}</span>
        <button type="button" class="btn ghost small" onClick={() => setPicking(true)}><Icon name="library" size={14} />Photos du site</button>
      </div>

      {single ? (
        (photos[0] || waiting > 0) && (
          // aperçu au format réel du cadre sur le site (couverture, fond, carte…)
          <div class="single-wrap">
            <figure class={`single-photo${waiting ? ' loading' : ''}`} style={{ aspectRatio: String(cropAspect), width: `min(100%, calc(260px * ${cropAspect}))` }}>
              {photos[0] && <img src={imgUrl(photos[0])} alt="" style={cropCss(photos[0].crop)} />}
              {photos[0] && !waiting && tools(photos[0], 0)}
            </figure>
          </div>
        )
      ) : (
        (photos.length > 0 || waiting > 0) && (
          // même grille que le site (styles/photo-grid.css), mise à l'échelle de la largeur disponible
          <div class="pgrid-scale" style={{ '--site-w': SITE_WIDTH, '--gap-n': GRID_GAP } as any}>
            <div class="pgrid" style={{ '--rh-n': rowHeight(columns) } as any}>
              {photos.map((p, i) => (
                <figure
                  key={p.src}
                  draggable
                  class={`ptile${drag === i ? ' dragging' : ''}`}
                  style={{ '--r': ratio(p).toFixed(4) } as any}
                  onDragStart={(e) => { setDrag(i); e.dataTransfer!.effectAllowed = 'move'; }}
                  onDragEnter={() => reorder(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnd={() => setDrag(null)}
                >
                  <img src={imgUrl(p)} alt="" loading="lazy" draggable={false} />
                  {tools(p, i)}
                </figure>
              ))}
              {Array.from({ length: waiting }, (_, i) => <figure key={`w${i}`} class="ptile loading" style={{ '--r': 1.5 } as any} />)}
            </div>
          </div>
        )
      )}

      <div
        class={`drop${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { if (drag === null) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (drag === null) add(e.dataTransfer?.files ?? null); }}
      >
        <Icon name="upload" size={18} />
        {waiting > 0
          ? <span>Préparation de {waiting} photo{waiting > 1 ? 's' : ''}… tu peux en ajouter d'autres</span>
          : <span>{single ? (photos.length ? 'Remplacer la photo' : 'Ajouter une photo') : 'Glisse tes photos ici'} <u>ou parcourir</u></span>}
        <input ref={input} type="file" accept="image/*" multiple={!single} hidden onChange={(e) => { add(e.currentTarget.files); e.currentTarget.value = ''; }} />
      </div>
      {cropping && cropTarget && (
        <Cropper
          photo={cropTarget}
          aspect={cropAspect}
          onClose={() => setCropping(false)}
          onSave={(crop) => {
            const next = photos.slice();
            next[0] = { ...cropTarget, crop };
            if (!crop) delete next[0].crop;
            onChange(next);
            setCropping(false);
          }}
        />
      )}
      {picking && (
        <PhotoPicker
          single={single}
          exclude={photos}
          onClose={() => setPicking(false)}
          onPick={(picked) => { onChange(single ? picked.slice(0, 1) : [...photos, ...picked]); setPicking(false); }}
        />
      )}
      <span class="hint">
        {hint ?? (single ? '' : 'Aperçu identique à la page du site. Glisse les vignettes pour changer l’ordre ; la première sert de couverture. ')}
        Les photos sont compressées automatiquement (WebP, 2000 px max, sans données GPS).
      </span>
    </div>
  );
}

/** Sections (titre + légende + photos) : utilisées par les créations et les projets. */
export function SectionsEditor({ sections, onChange, columns, coverAspect }: { sections: { title: string; caption: string; photos: Photo[] }[]; onChange: (s: any[]) => void; columns: number; coverAspect?: number }) {
  const { imgUrl } = useStore();
  return (
    <div class="field wide">
      <span class="label">Sections de photos</span>
      <ItemList
        items={sections}
        onChange={onChange}
        title={(s) => s.title || 'Section sans titre'}
        meta={(s) => `${s.photos.length} photo${s.photos.length > 1 ? 's' : ''}`}
        thumb={(s) => (s.photos[0] ? imgUrl(s.photos[0]) : undefined)}
        create={() => ({ title: 'Nouvelle section', caption: '', photos: [] })}
        addLabel="Ajouter une section"
        confirmDelete={(s) => `Supprimer la section « ${s.title} » et ses ${s.photos.length} photos ?`}
        render={(s, up) => (
          <div class="grid">
            <Field label="Titre" value={s.title} onChange={(v) => up((x) => (x.title = v))} />
            <Field label="Légende (optionnelle)" value={s.caption} onChange={(v) => up((x) => (x.caption = v))} />
            <PhotoManager photos={s.photos} columns={columns} aspect={coverAspect} onChange={(p) => up((x) => (x.photos = p))} />
          </div>
        )}
      />
    </div>
  );
}

/** Fenêtre de choix parmi les photos déjà présentes sur le site (galeries, projets, créations…). */
function PhotoPicker({ single, exclude, onPick, onClose }: { single?: boolean; exclude: Photo[]; onPick: (p: Photo[]) => void; onClose: () => void }) {
  const { content, imgUrl } = useStore();
  const groups = photoLibrary(content);
  const [group, setGroup] = useState<string>('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Photo[]>([]);
  const taken = new Set(exclude.map((p) => p.src));

  const shown = groups.filter((g) => (!group || g.label === group) && g.label.toLowerCase().includes(q.trim().toLowerCase()));
  const total = shown.reduce((n, g) => n + g.photos.length, 0);
  const isSel = (p: Photo) => sel.some((x) => x.src === p.src);
  const click = (p: Photo) => {
    if (single) return onPick([p]);
    setSel(isSel(p) ? sel.filter((x) => x.src !== p.src) : [...sel, p]);
  };

  return (
    <div class="picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div class="picker" role="dialog" aria-label="Choisir une photo">
        <header class="picker-head">
          <div>
            <h2>{single ? 'Choisir une photo' : 'Ajouter des photos du site'}</h2>
            <p class="hint">{total} photo{total > 1 ? 's' : ''}{single ? ' · clique sur une photo pour la choisir' : ' · clique pour sélectionner'}</p>
          </div>
          <button type="button" class="icon" title="Fermer" onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div class="picker-filters">
          <input type="search" placeholder="Rechercher une galerie, un projet…" value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus />
          <select value={group} onChange={(e) => setGroup(e.currentTarget.value)}>
            <option value="">Toutes les provenances</option>
            {groups.map((g) => <option value={g.label}>{g.label} ({g.photos.length})</option>)}
          </select>
        </div>
        <div class="picker-body">
          {shown.map((g) => (
            <section>
              <h3>{g.label} <em>{g.photos.length}</em></h3>
              <div class="picker-grid">
                {g.photos.map((p) => (
                  <button type="button" class={`pick${isSel(p) ? ' on' : ''}${taken.has(p.src) ? ' taken' : ''}`} onClick={() => click(p)} title={taken.has(p.src) ? 'Déjà utilisée ici' : ''}>
                    <img src={imgUrl(p)} alt="" loading="lazy" />
                    {isSel(p) && <span class="check">✓</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!shown.length && <p class="hint">Aucune photo ne correspond.</p>}
        </div>
        {!single && (
          <footer class="picker-foot">
            <button type="button" class="btn ghost" onClick={onClose}>Annuler</button>
            <button type="button" class="btn primary" disabled={!sel.length} onClick={() => onPick(sel)}>Ajouter {sel.length || ''} photo{sel.length > 1 ? 's' : ''}</button>
          </footer>
        )}
      </div>
    </div>
  );
}

/* ---------- Recadrage ---------- */

type CropValue = { x: number; y: number; zoom: number };

/** Même rendu que sur le site (cropStyle dans lib/media.ts). */
export const cropCss = (c?: CropValue) =>
  c ? { objectPosition: `${c.x}% ${c.y}%`, transformOrigin: `${c.x}% ${c.y}%`, scale: String(c.zoom) } : undefined;

/** Recadrage non destructif : on choisit la zone visible (glisser) et le zoom ; l'original n'est pas modifié. */
function Cropper({ photo, aspect, onSave, onClose }: { photo: Photo; aspect: number; onSave: (c: CropValue | undefined) => void; onClose: () => void }) {
  const { imgUrl } = useStore();
  const [c, setC] = useState<CropValue>(photo.crop ?? { x: 50, y: 50, zoom: 1 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const clamp = (v: number) => Math.min(100, Math.max(0, v));

  const down = (e: PointerEvent) => {
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    drag.current = { px: e.clientX, py: e.clientY, x: c.x, y: c.y };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current, f = frame.current;
    if (!d || !f) return;
    const r = f.getBoundingClientRect();
    // glisser l'image vers la droite montre davantage sa partie gauche
    const k = 1.6 / c.zoom;
    setC({ ...c, x: clamp(d.x - ((e.clientX - d.px) / r.width) * 100 * k), y: clamp(d.y - ((e.clientY - d.py) / r.height) * 100 * k) });
  };
  const up = () => (drag.current = null);

  return (
    <div class="picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="picker cropper" role="dialog" aria-label="Recadrer la photo">
        <header class="picker-head">
          <div>
            <h2>Recadrer</h2>
            <p class="hint">Fais glisser l'image pour choisir ce qui est visible, puis règle le zoom. La photo d'origine n'est pas modifiée.</p>
          </div>
          <button type="button" class="icon" title="Fermer" onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div class="crop-stage">
          <div
            ref={frame}
            class="crop-frame"
            // largeur calculée à partir de la hauteur max : le cadre garde exactement le format du site
            style={{ aspectRatio: String(aspect), width: `min(100%, calc(62vh * ${aspect}))` }}
            onPointerDown={down as any}
            onPointerMove={move as any}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <img src={imgUrl(photo, false)} alt="" draggable={false} style={cropCss(c)} />
            <span class="crop-grid" aria-hidden="true" />
          </div>
        </div>
        <footer class="picker-foot crop-foot">
          <label class="crop-zoom">
            <span>Zoom</span>
            <input type="range" min="1" max="3" step="0.01" value={c.zoom} onInput={(e) => setC({ ...c, zoom: Number(e.currentTarget.value) })} />
            <b>{Math.round(c.zoom * 100)} %</b>
          </label>
          <button type="button" class="btn ghost" onClick={() => setC({ x: 50, y: 50, zoom: 1 })}>Réinitialiser</button>
          <button type="button" class="btn ghost" onClick={onClose}>Annuler</button>
          <button
            type="button"
            class="btn primary"
            onClick={() => onSave(c.x === 50 && c.y === 50 && c.zoom === 1 ? undefined : { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, zoom: Math.round(c.zoom * 100) / 100 })}
          >
            Valider le cadrage
          </button>
        </footer>
      </div>
    </div>
  );
}

import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  ArrowUpRight,
  GitFork,
  History,
  ImagePlus,
  Images,
  Link2,
  LoaderCircle,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { MiniPhotos, pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import type {
  Episode,
  EpisodeLinkKind,
  EpisodeUpdate,
  EpisodeUpdateKind,
  StoredImage,
} from '../data';
import {
  episodeKinds,
  episodeLinkKindList,
  episodeLinkKinds,
  episodeUpdateKindList,
  episodeUpdateKinds,
  originLabel,
  relatedEpisodes,
} from '../lib/episodes';
import { friendlyDate, shortDate, todayInputValue } from '../lib/format';
import { MAX_INPUT_BYTES, hasImgbbKey, prepareImage, uploadToImgbb } from '../lib/imgbb';

const MIGRATION = 'supabase/migrations/202611070006_episode_extras.sql';

function MissingExtras({ what }: { what: string }) {
  return (
    <p className="pp-empty">
      Para {what} ejecuta <code>{MIGRATION}</code> en el SQL Editor de Supabase.
    </p>
  );
}

/** Mantiene a mano la versión más reciente del episodio (para escrituras tras una espera). */
function useLatest(episode: Episode) {
  const ref = useRef(episode);
  ref.current = episode;
  return ref;
}

// ───────────────────────── Bitácora ─────────────────────────

const LOG_PREVIEW = 5;

/** Actualizaciones del episodio: avances, decisiones, cambios, problemas y logros, con fotos. */
export function EpisodeLog({ episode }: { episode: Episode }) {
  const { updateEpisode, notify, episodeExtrasMissing } = useApp();
  const latest = useLatest(episode);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<EpisodeUpdateKind>('avance');
  const [date, setDate] = useState(todayInputValue);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const photos = useImageUploads([], 6);
  const km = episodeUpdateKinds[kind];

  const list = [...episode.updates].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
  const shown = all ? list : list.slice(0, LOG_PREVIEW);
  const ready = (text.trim() || photos.images.length > 0) && !photos.busy && !busy;

  const add = async () => {
    if (!ready) return;
    setBusy(true);
    const update: EpisodeUpdate = {
      id: crypto.randomUUID(),
      date: date || todayInputValue(),
      kind,
      text: text.trim().slice(0, 2000),
      ...(photos.images.length > 0 && { images: photos.images }),
      created_at: new Date().toISOString(),
    };
    const ok = await updateEpisode(
      latest.current,
      { updates: [update, ...latest.current.updates].slice(0, 500) },
      true,
    );
    setBusy(false);
    if (!ok) return;
    setText('');
    setDate(todayInputValue());
    photos.reset();
    notify('Actualización añadida al episodio.');
  };

  const remove = async (u: EpisodeUpdate) => {
    const ok = await updateEpisode(
      latest.current,
      { updates: latest.current.updates.filter((x) => x.id !== u.id) },
      true,
    );
    if (ok)
      notify('Actualización eliminada.', {
        label: 'Deshacer',
        icon: 'undo',
        run: () =>
          void updateEpisode(
            latest.current,
            { updates: [u, ...latest.current.updates.filter((x) => x.id !== u.id)] },
            true,
          ),
      });
  };

  return (
    <section className="ep-panel ep-log">
      <div className="ep-panel-head">
        <h3>
          <History size={15} /> Bitácora{' '}
          {list.length > 0 && <i className="ep-count">{list.length}</i>}
        </h3>
      </div>

      {episodeExtrasMissing ? (
        <MissingExtras what="escribir la bitácora" />
      ) : (
        <div className="ep-log-new" style={{ '--u': km.color, '--us': km.soft } as CSSProperties}>
          <div className="ep-log-kinds" role="radiogroup" aria-label="Tipo de actualización">
            {episodeUpdateKindList.map((k) => {
              const m = episodeUpdateKinds[k];
              return (
                <button
                  type="button"
                  role="radio"
                  key={k}
                  aria-checked={kind === k}
                  className={kind === k ? 'on' : ''}
                  style={{ '--u': m.color, '--us': m.soft } as CSSProperties}
                  onClick={() => setKind(k)}
                >
                  <m.icon size={13} /> {m.label}
                </button>
              );
            })}
          </div>
          <textarea
            rows={2}
            maxLength={2000}
            value={text}
            placeholder={km.hint}
            aria-label="Texto de la actualización"
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = pastedImages(e);
              if (files.length) {
                e.preventDefault();
                photos.add(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <div className="ep-log-bar">
            <MiniPhotos uploads={photos} />
            <input
              type="date"
              className="ep-log-date"
              value={date}
              max="2100-12-31"
              aria-label="Cuándo pasó"
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              className="ep-log-send"
              disabled={!ready}
              onClick={() => void add()}
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={14} />} Añadir
            </button>
          </div>
        </div>
      )}

      {shown.length > 0 ? (
        <ol className="ep-log-list">
          {shown.map((u) => {
            const m = episodeUpdateKinds[u.kind] ?? episodeUpdateKinds.nota;
            return (
              <li key={u.id} style={{ '--u': m.color, '--us': m.soft } as CSSProperties}>
                <span className="ep-log-dot">
                  <m.icon size={13} />
                </span>
                <div className="ep-log-body">
                  <small>
                    <b>{m.label}</b> · {friendlyDate(u.date)}
                  </small>
                  {u.text && <p>{u.text}</p>}
                  {u.images && u.images.length > 0 && <PhotoThumbs images={u.images} />}
                </div>
                {!episodeExtrasMissing && (
                  <button
                    type="button"
                    className="ep-row-x"
                    aria-label="Eliminar actualización"
                    title="Eliminar"
                    onClick={() => void remove(u)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !episodeExtrasMissing && (
          <p className="ep-muted">
            Anota cómo va: lo que avanzó, lo que se decidió, lo que cambió o lo que salió bien.
          </p>
        )
      )}
      {list.length > LOG_PREVIEW && (
        <button type="button" className="pp-text-btn" onClick={() => setAll((v) => !v)}>
          {all ? 'Ver menos' : `Ver las ${list.length} actualizaciones`}
        </button>
      )}
    </section>
  );
}

// ───────────────────────── Episodios relacionados ─────────────────────────

/** Opciones desde este episodio: las propias y las inversas (que se guardan en el otro). */
const linkOptions = episodeLinkKindList.flatMap((k) => {
  const m = episodeLinkKinds[k];
  const own = { value: `${k}:own`, label: m.label, kind: k, own: true };
  return m.back === m.label
    ? [own]
    : [own, { value: `${k}:back`, label: m.back, kind: k, own: false }];
});

export function RelatedEpisodes({ episode }: { episode: Episode }) {
  const { workspace, go, updateEpisode, openEpisode, notify, episodeExtrasMissing } = useApp();
  const related = relatedEpisodes(episode, workspace.episodes);
  const [adding, setAdding] = useState(false);
  const [option, setOption] = useState(linkOptions[0].value);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const taken = new Set(related.map((r) => r.episode.id));
  const candidates = workspace.episodes
    .filter((e) => e.id !== episode.id && !taken.has(e.id))
    .sort((a, b) => (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at));

  const link = async () => {
    const opt = linkOptions.find((o) => o.value === option);
    const other = workspace.episodes.find((e) => e.id === target);
    if (!opt || !other || busy) return;
    setBusy(true);
    // «Surgió de», «Continúa en», «Incluye»: el vínculo se guarda en el otro episodio.
    const [holder, to] = opt.own ? [episode, other] : [other, episode];
    const ok = await updateEpisode(
      holder,
      { links: [...holder.links.filter((l) => l.id !== to.id), { id: to.id, kind: opt.kind }] },
      true,
    );
    setBusy(false);
    if (!ok) return;
    notify(`Enlazado: ${opt.label.toLowerCase()} «${other.title}».`);
    setTarget('');
    setAdding(false);
  };

  const unlink = (r: (typeof related)[number]) => {
    const holder = r.own ? episode : r.episode;
    const other = r.own ? r.episode.id : episode.id;
    void updateEpisode(holder, { links: holder.links.filter((l) => l.id !== other) }, true);
  };

  // «Se convirtió en»: lo guarda este episodio. «Su continuación»: el nuevo es continuación de este.
  const derive = (kind: EpisodeLinkKind) => {
    const from = { episode, kind, holder: kind === 'continua' ? 'new' : 'source' } as const;
    openEpisode(
      undefined,
      {
        kind: kind === 'derivo' ? 'proyecto' : episode.kind,
        person_ids: episode.person_ids,
        place_ids: episode.place_ids,
        starts_on: todayInputValue(),
        summary: `${originLabel(from)} «${episode.title}».`,
      },
      from,
    );
  };

  return (
    <section className="ep-panel ep-related">
      <div className="ep-panel-head">
        <h3>
          <Link2 size={15} /> Relacionados{' '}
          {related.length > 0 && <i className="ep-count">{related.length}</i>}
        </h3>
        {!episodeExtrasMissing && candidates.length > 0 && (
          <button type="button" className="pp-text-btn" onClick={() => setAdding((v) => !v)}>
            {adding ? (
              <>
                <X size={13} /> Cancelar
              </>
            ) : (
              <>
                <Plus size={13} /> Enlazar
              </>
            )}
          </button>
        )}
      </div>

      {episodeExtrasMissing ? (
        <MissingExtras what="relacionar episodios" />
      ) : (
        <>
          {adding && (
            <div className="ep-link-form">
              <span>Este episodio</span>
              <select
                value={option}
                onChange={(e) => setOption(e.target.value)}
                aria-label="Relación"
              >
                {linkOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label.toLowerCase()}
                  </option>
                ))}
              </select>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Episodio"
              >
                <option value="">Elige un episodio…</option>
                {candidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                    {e.starts_on ? ` · ${shortDate(e.starts_on + 'T12:00:00')}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pp-btn dark"
                disabled={!target || busy}
                onClick={() => void link()}
              >
                {busy ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />} Enlazar
              </button>
            </div>
          )}

          {related.length > 0 ? (
            <ul className="ep-rel-list">
              {related.map((r) => {
                const m = episodeKinds[r.episode.kind] ?? episodeKinds.otro;
                return (
                  <li
                    key={r.episode.id}
                    style={{ '--rc': m.color, '--rs': m.soft } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="ep-rel"
                      onClick={() => go('Episodios', r.episode)}
                    >
                      <span className="ep-rel-icon">
                        <m.icon size={15} />
                      </span>
                      <span className="ep-rel-text">
                        <small>{r.label}</small>
                        <strong>{r.episode.title}</strong>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="ep-row-x"
                      aria-label="Quitar el vínculo"
                      title="Quitar el vínculo"
                      onClick={() => unlink(r)}
                    >
                      <X size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !adding && (
              <p className="ep-muted">
                Un encuentro puede convertirse en un proyecto; un viaje, continuar en otro.
              </p>
            )
          )}

          <div className="ep-derive">
            <button type="button" onClick={() => derive('derivo')}>
              <GitFork size={13} /> Se convirtió en algo nuevo
            </button>
            <button type="button" onClick={() => derive('continua')}>
              <Plus size={13} /> Crear su continuación
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ───────────────────────── Galería ─────────────────────────

const GALLERY_MAX = 11;
const fileName = (file: File, blob: Blob) => {
  const base = file.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'foto.jpg';
  return blob.type === 'image/jpeg' && !/\.jpe?g$/i.test(base)
    ? base.replace(/\.\w+$/, '') + '.jpg'
    : base;
};

/**
 * Todas las fotos del episodio (las suyas, las de su bitácora, sus recuerdos y novedades), en
 * ImgBB. Se pueden subir más directo al episodio: con el botón o soltándolas encima.
 */
export function EpisodeGallery({ episode, photos }: { episode: Episode; photos: StoredImage[] }) {
  const { openImages, updateEpisode, notify, episodeExtrasMissing } = useApp();
  const latest = useLatest(episode);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const own = new Set(episode.images.map((i) => i.url));
  const canUpload = !episodeExtrasMissing && hasImgbbKey();

  const upload = async (files: File[]) => {
    const list = files
      .filter((f) => f.type.startsWith('image/') && f.size <= MAX_INPUT_BYTES)
      .slice(0, 20);
    if (!list.length) {
      if (files.length) notify('Solo se pueden subir imágenes de hasta 32 MB.');
      return;
    }
    setUploading((n) => n + list.length);
    const done: StoredImage[] = [];
    let failed = 0;
    await Promise.all(
      list.map(async (file) => {
        try {
          const blob = await prepareImage(file);
          done.push(await uploadToImgbb(blob, fileName(file, blob)));
        } catch {
          failed++;
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    if (done.length) {
      const current = latest.current;
      const ok = await updateEpisode(
        current,
        { images: [...current.images, ...done].slice(0, 200) },
        true,
      );
      if (ok)
        notify(
          done.length === 1
            ? 'Foto añadida a la galería.'
            : `${done.length} fotos añadidas a la galería.`,
        );
    }
    if (failed)
      notify(
        `${failed} ${failed === 1 ? 'foto no se pudo' : 'fotos no se pudieron'} subir a ImgBB.`,
      );
  };

  const remove = (img: StoredImage) =>
    void updateEpisode(
      latest.current,
      { images: latest.current.images.filter((i) => i.url !== img.url) },
      true,
    );

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const shown = photos.slice(0, GALLERY_MAX);
  const extra = photos.length - shown.length;

  return (
    <section
      className={'ep-panel ep-gallery' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (!canUpload || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canUpload || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="ep-panel-head">
        <h3>
          <Images size={15} /> Galería{' '}
          {photos.length > 0 && <i className="ep-count">{photos.length}</i>}
        </h3>
        {canUpload && (
          <label className="pp-text-btn ep-upload">
            <input
              type="file"
              accept="image/*"
              multiple
              className="cp-sr"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void upload(files);
              }}
            />
            <ImagePlus size={13} /> Añadir fotos
          </label>
        )}
      </div>
      {uploading > 0 && (
        <p className="ep-muted" role="status">
          <LoaderCircle className="spin" size={13} /> Subiendo {uploading}{' '}
          {uploading === 1 ? 'foto' : 'fotos'} a ImgBB…
        </p>
      )}
      {shown.length > 0 ? (
        <div className={'ep-gal-grid n' + Math.min(shown.length, 3)}>
          {shown.map((img, i) => (
            <div className="ep-gal-item" key={img.url}>
              <button
                type="button"
                aria-label={`Ver foto ${i + 1} de ${photos.length}`}
                onClick={() => openImages(photos, i)}
              >
                <img
                  src={i === 0 ? (img.medium ?? img.url) : (img.thumb ?? img.medium ?? img.url)}
                  alt=""
                  loading="lazy"
                />
                {extra > 0 && i === shown.length - 1 && <span>+{extra}</span>}
              </button>
              {own.has(img.url) && !episodeExtrasMissing && (
                <button
                  type="button"
                  className="ep-gal-x"
                  aria-label="Quitar de la galería"
                  title="Quitar de la galería"
                  onClick={() => remove(img)}
                >
                  <X size={12} strokeWidth={3} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="ep-muted">
          {canUpload
            ? 'Aquí se reúnen las fotos de sus recuerdos. También puedes soltarlas aquí.'
            : 'Aquí se reúnen las fotos de sus recuerdos y su bitácora.'}
        </p>
      )}
      {dragging && (
        <div className="ep-gal-drop" aria-hidden="true">
          <ImagePlus size={26} /> Suelta las fotos para subirlas
        </div>
      )}
    </section>
  );
}

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type ReactNode,
} from 'react';
import {
  BookMarked,
  CalendarDays,
  Copy,
  ExternalLink,
  EyeOff,
  Globe,
  ImageOff,
  ImagePlus,
  Link2,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { PickDialog, personCounts, type PickItem } from '../capture/Pickers';
import { kindMeta } from '../composer/kinds';
import { MoodIcon, moodOf } from '../composer/controls';
import { pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import { notebookColors, type Notebook } from '../cuadernos/model';
import { useCuadernos } from '../cuadernos/useCuadernos';
import type { Entry, Episode, Person, Place, StoredImage } from '../data';
import { episodeKindOf } from '../lib/episodes';
import { friendlyDate, todayInputValue } from '../lib/format';
import { placeKinds, placeSearchText } from '../lib/places';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { Avatar } from '../people/Avatar';
import { MyFace } from '../people/MyFace';
import { enqueuePieces } from './analysis';
import { peopleIn, placesIn, scanOn, shownName } from './helpers';
import {
  INSTANT_MAX,
  INSTANT_PHOTOS,
  agoLabel,
  compactCount,
  dayOfInstant,
  linkCount,
  type Instant,
  type LinkKey,
  type Thread,
} from './model';
import { Popover } from './Popover';
import {
  openRemote,
  resyncInstant,
  shareInstants,
  sharesState,
  unshareInstants,
  useCanShare,
  useShare,
} from './share';
import {
  createInstants,
  linkInstant,
  removeInstants,
  restoreInstants,
  updateInstant,
  useInstants,
} from './store';
import './instants.css';

/** Mapas por id, uno por lista (se rehacen solo cuando cambia la lista). */
const maps = new WeakMap<object, Map<string, unknown>>();
function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  let m = maps.get(list);
  if (!m) {
    m = new Map(list.map((x) => [x.id, x]));
    maps.set(list, m);
  }
  return m as Map<string, T>;
}

/** Cómo se comporta una tarjeta según dónde está (el panel o la ventana de un instante). */
export type FeedNav = {
  /** Antes de ir a otra sección (un episodio, un lugar). */
  onLeave?: () => void;
  /** Antes de abrir algo encima (la ficha de un recuerdo). */
  onOpen?: () => void;
};

const MAX_CHIPS = 8;
/** Mientras los cuadernos cargan (siempre la misma lista vacía, para no rehacer el mapa por id). */
const NO_NOTEBOOKS: Notebook[] = [];
/** El día (AAAA-MM-DD) en que pasó un recuerdo. */
const entryDay = (e: Entry) => todayInputValue(new Date(e.created_at));

type ThreadCardProps = {
  thread: Thread;
  highlight?: boolean;
  nav?: FeedNav;
  /** En la ventana de un instante: sin borde de tarjeta. */
  compact?: boolean;
};

/** El mismo hilo con los mismos instantes (los que no cambiaron son el mismo objeto). */
const sameThread = (a: ThreadCardProps, b: ThreadCardProps) =>
  a.highlight === b.highlight &&
  a.compact === b.compact &&
  a.nav === b.nav &&
  a.thread.id === b.thread.id &&
  a.thread.items.length === b.thread.items.length &&
  a.thread.items.every((it, k) => it === b.thread.items[k]);

/**
 * Un hilo completo: cada publicación, sus vínculos y la caja para seguirlo. No se vuelve a pintar
 * si su hilo no cambió: con cientos en el feed, traer la siguiente tanda o cambiar otro instante
 * no repinta los demás.
 */
export const ThreadCard = memo(function ThreadCard({
  thread,
  highlight = false,
  nav = {},
  compact = false,
}: ThreadCardProps) {
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  const n = thread.items.length;
  return (
    <article
      ref={ref}
      className={'ic' + (highlight ? ' flash' : '') + (compact ? ' compact' : '')}
      data-thread={thread.id}
    >
      {thread.items.map((i, k) => (
        <InstantPost
          key={i.id}
          instant={i}
          thread={thread}
          joined={k < n - 1 || replying}
          // El botón del hilo, con su contador, solo al final de un hilo (y si lo es).
          threadCount={n > 1 && k === n - 1 && !replying ? n : 0}
          nav={nav}
          onReply={() => setReplying(true)}
        />
      ))}
      {replying && <ReplyBox thread={thread} onDone={() => setReplying(false)} />}
    </article>
  );
}, sameThread);

/**
 * Una foto del instante. Mientras llega se ve un esqueleto del tamaño que tendrá (así el feed no
 * salta al cargar), aparece con un fundido y, si la versión media falla, prueba la original; si
 * tampoco, deja un marcador en vez de una imagen rota.
 */
function PostPhoto({
  image,
  index,
  onOpen,
}: {
  image: StoredImage;
  index: number;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState(image.medium ?? image.url);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const img = useRef<HTMLImageElement>(null);
  // Una foto que ya estaba en la caché del navegador puede haber cargado antes de escuchar el aviso.
  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setState('ready');
  }, []);
  return (
    <button
      type="button"
      className={'ip-photo ' + state}
      onClick={onOpen}
      aria-label={`Ver foto ${index + 1}`}
    >
      {state === 'error' ? (
        <ImageOff size={20} aria-hidden="true" />
      ) : (
        <img
          ref={img}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => (src !== image.url ? setSrc(image.url) : setState('error'))}
        />
      )}
    </button>
  );
}

/** Una publicación: quién, cuándo, el texto tal cual, sus fotos, sus vínculos y su menú. */
function InstantPost({
  instant: i,
  thread,
  joined,
  threadCount,
  nav,
  onReply,
}: {
  instant: Instant;
  thread: Thread;
  joined: boolean;
  /** Cuántos tiene el hilo (0: no se muestra el botón). */
  threadCount: number;
  nav: FeedNav;
  onReply: () => void;
}) {
  const app = useApp();
  const { me, user, notify, confirm } = app;
  const [editing, setEditing] = useState(false);
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const [linking, setLinking] = useState(false);
  const [allChips, setAllChips] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = useCanShare();
  const share = useShare(i.id);
  const myName = shownName(me.profile, user.email);
  const mood = moodOf(i.mood);
  const day = dayOfInstant(i);
  const writtenDay = dayOfInstant({ ...i, happened_on: null });
  const isRoot = thread.root.id === i.id;
  const links = linkCount(i);

  const chips = useLinkChips(i, nav);
  const shownChips = allChips ? chips : chips.slice(0, MAX_CHIPS);

  const searchAgain = () => {
    const ws = app.workspace;
    const job = enqueuePieces({
      items: [
        {
          id: i.id,
          text: i.body,
          mood: i.mood,
          date: i.happened_on,
          places: i.place_ids.flatMap((id) => {
            const p = ws.places.find((x) => x.id === id);
            return p ? [{ id: p.id, name: p.name }] : [];
          }),
        },
      ],
      people: i.person_ids,
      episodeId: i.episode_ids[0] ?? null,
      keepText: false,
    });
    notify(job ? 'Buscando piezas en este instante…' : 'Este instante no tiene texto que leer.');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(i.body);
      notify('Texto copiado.');
    } catch {
      notify('No se pudo copiar.');
    }
  };
  /** Publicarlo en tu cuenta del Fediverso (o, si falló antes, ponerlo al día). */
  const doShare = async () => {
    setSharing(true);
    if (share?.remote_ids.length) {
      const why = await resyncInstant(i.id);
      setSharing(false);
      return notify(why ? `No se pudo actualizar la publicación: ${why}` : 'Publicación al día.');
    }
    const r = await shareInstants([i.id]);
    setSharing(false);
    if (r.error) return notify(`No se pudo compartir: ${r.error}`);
    notify(
      'Compartido' + (r.note ? `. ${r.note}` : '.'),
      r.url ? { label: 'Ver', icon: 'open', run: () => openRemote(r.url) } : undefined,
    );
  };
  const stopSharing = async () => {
    const ok = await confirm({
      title: '¿Dejar de compartir?',
      message:
        'Se borra la publicación de tu cuenta del Fediverso, con sus respuestas.' +
        (share?.origin === 'mastodon' ? ' Nació allí: el instante se queda en Nexo.' : '') +
        ' Las copias que otros servidores ya guardaron pueden tardar en desaparecer.',
      confirmLabel: 'Dejar de compartir',
      danger: true,
      icon: 'warning',
    });
    if (!ok) return;
    setSharing(true);
    const why = await unshareInstants([i.id]);
    setSharing(false);
    notify(why ? `No se pudo quitar la publicación: ${why}` : 'Ya no está compartido.');
  };
  const remove = async () => {
    const whole = isRoot && thread.items.length > 1;
    const ids = whole ? thread.items.map((x) => x.id) : [i.id];
    // Lo que Nexo publicó se borra también del Fediverso; lo que nació allí se queda allí.
    const shared = ids.filter((id) => sharesState().shares.get(id)?.origin === 'nexo');
    const ok = await confirm({
      title: whole ? `¿Borrar el hilo (${thread.items.length})?` : '¿Borrar este instante?',
      message:
        (whole ? 'Es el primero del hilo: se borra con todo lo que lo sigue. ' : '') +
        'Las piezas que nacieron de él (encuentros, gastos, pendientes…) se conservan.' +
        (shared.length ? ' También se borra lo compartido en tu cuenta del Fediverso.' : ''),
      confirmLabel: 'Borrar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    if (shared.length) {
      // Primero lo público: si no se puede quitar de allí, se avisa antes de perder el rastro.
      const why = await unshareInstants(shared);
      if (why) {
        const anyway = await confirm({
          title: 'No se pudo quitar de tu cuenta',
          message: `${why} Si lo borras de Nexo, la publicación seguirá pública allí. ¿Borrar de todos modos?`,
          confirmLabel: 'Borrar de todos modos',
          danger: true,
          icon: 'warning',
        });
        if (!anyway) return;
      }
    }
    const gone = await removeInstants(ids);
    if (typeof gone === 'string') return notify(gone);
    notify(whole ? 'Hilo borrado.' : 'Instante borrado.', {
      label: 'Deshacer',
      icon: 'undo',
      run: () =>
        void restoreInstants(gone).then((r) => {
          if (r !== true) notify(r);
        }),
    });
  };
  /** Cierra el menú y hace lo elegido. */
  const run = (fn: () => void) => () => {
    setMenuAt(null);
    fn();
  };

  return (
    <div className={'ip-post' + (joined ? ' joined' : '')}>
      <span className="ic-face" aria-hidden="true">
        <MyFace size={36} />
      </span>
      <div className="ip-main">
        <header className="ip-who">
          <strong>{myName}</strong>
          <time dateTime={i.created_at} title={new Date(i.created_at).toLocaleString('es-CO')}>
            {agoLabel(i.created_at)}
          </time>
          {i.edited_at && <small className="ip-edited">editado</small>}
          <button
            type="button"
            className="ip-dots"
            aria-label="Más opciones"
            aria-haspopup="menu"
            aria-expanded={Boolean(menuAt)}
            onClick={(e) => {
              const el = e.currentTarget;
              setMenuAt((cur) => (cur ? null : el));
            }}
          >
            <MoreHorizontal size={17} />
          </button>
        </header>

        {share && (
          <button
            type="button"
            className={'ip-share' + (share.status === 'error' ? ' error' : '')}
            disabled={sharing}
            title={
              share.status === 'error'
                ? `${share.note || 'No se pudo compartir.'} Toca para reintentar.`
                : share.origin === 'mastodon'
                  ? 'Nació en tu cuenta del Fediverso. Toca para abrirlo.'
                  : share.note
                    ? `Público en tu cuenta del Fediverso. ${share.note}`
                    : 'Público en tu cuenta del Fediverso. Toca para abrirlo.'
            }
            onClick={() => (share.status === 'error' ? void doShare() : openRemote(share.remote_url))}
          >
            {sharing ? <LoaderCircle className="spin" size={10} /> : <Globe size={10} />}
            {share.status === 'error' ? 'No se compartió · reintentar' : 'Público'}
          </button>
        )}

        {editing ? (
          <EditBox instant={i} onDone={() => setEditing(false)} />
        ) : (
          <>
            {i.body && <p className="ip-body">{i.body}</p>}
            {i.images.length > 0 && (
              <div className={'ip-photos n' + Math.min(i.images.length, 3)}>
                {i.images.map((img, k) => (
                  <PostPhoto key={img.url + k} image={img} index={k} onOpen={() => app.openImages(i.images, k)} />
                ))}
              </div>
            )}
          </>
        )}

        {(mood || day !== writtenDay) && !editing && (
          <div className="ip-meta">
            {mood && (
              <span className="ip-mood" style={{ '--mood': mood.color } as CSSProperties}>
                <MoodIcon mood={mood} size={18} solid /> {mood.label}
              </span>
            )}
            {day !== writtenDay && (
              <span>
                <CalendarDays size={13} /> Pasó {friendlyDate(day, todayInputValue()).toLowerCase()}
              </span>
            )}
          </div>
        )}

        {chips.length > 0 && (
          <div className="ip-links" aria-label="Vinculado">
            {shownChips}
            {chips.length > MAX_CHIPS && (
              <button type="button" className="ip-chip more" onClick={() => setAllChips((v) => !v)}>
                {allChips ? 'Ver menos' : `+${chips.length - MAX_CHIPS}`}
              </button>
            )}
          </div>
        )}

        {threadCount > 0 && !editing && (
          <button
            type="button"
            className="ip-thread"
            onClick={onReply}
            title={`Hilo de ${threadCount} · añadir al hilo`}
            aria-label={`Hilo de ${threadCount}. Añadir al hilo`}
          >
            <MessageCircle size={16} />
            <span>{compactCount(threadCount)}</span>
          </button>
        )}
      </div>

      {menuAt && (
        <Popover
          anchor={menuAt}
          align="end"
          role="menu"
          label="Opciones del instante"
          className="ip-pop"
          onClose={() => setMenuAt(null)}
        >
          <button role="menuitem" onClick={run(onReply)}>
            <MessageCircle size={15} /> Añadir al hilo
          </button>
          <button role="menuitem" onClick={run(() => setEditing(true))}>
            <Pencil size={15} /> Editar
          </button>
          <button role="menuitem" onClick={run(() => setLinking(true))}>
            <Link2 size={15} /> Vincular…
            {links > 0 && <span className="ip-pop-n">{compactCount(links)}</span>}
          </button>
          <button role="menuitem" onClick={run(searchAgain)}>
            <Sparkles size={15} /> Buscar piezas otra vez
          </button>
          <button role="menuitem" onClick={run(() => void copy())}>
            <Copy size={15} /> Copiar texto
          </button>
          {canShare &&
            (share?.status === 'posted' ? (
              <>
                <button role="menuitem" onClick={run(() => openRemote(share.remote_url))}>
                  <ExternalLink size={15} /> Ver publicación
                </button>
                <button role="menuitem" onClick={run(() => void stopSharing())}>
                  <EyeOff size={15} /> Dejar de compartir
                </button>
              </>
            ) : (
              <button role="menuitem" disabled={sharing} onClick={run(() => void doShare())}>
                <Globe size={15} /> {share ? 'Reintentar compartir' : 'Compartir en público'}
              </button>
            ))}
          <i className="ip-pop-sep" aria-hidden="true" />
          <button role="menuitem" className="danger" onClick={run(() => void remove())}>
            <Trash2 size={15} /> {isRoot && thread.items.length > 1 ? 'Borrar el hilo' : 'Borrar'}
          </button>
        </Popover>
      )}
      {linking && <LinkDialog instant={i} onClose={() => setLinking(false)} />}
    </div>
  );
}

/** Los vínculos de un instante como fichas que se pueden abrir (y quitar). */
function useLinkChips(i: Instant, nav: FeedNav): ReactNode[] {
  const app = useApp();
  const { workspace } = app;
  const { list: notebookList } = useCuadernos();
  const entries = byId(workspace.entries);
  const episodes = byId(workspace.episodes);
  const notebooks = byId(notebookList ?? NO_NOTEBOOKS);
  const people = byId(workspace.people);
  const places = byId(workspace.places);
  const unlink = (key: LinkKey, id: string) => void linkInstant(i.id, {}, { [key]: [id] });

  const out: ReactNode[] = [];
  for (const id of i.episode_ids) {
    const e = episodes.get(id);
    if (!e) continue;
    const m = episodeKindOf(e.kind);
    out.push(
      <Chip
        key={'e' + id}
        tone={m.color}
        icon={<m.icon size={13} />}
        label={e.title}
        title={`Episodio · ${m.label}`}
        onOpen={() => {
          nav.onLeave?.();
          app.go('Episodios', e);
        }}
        onRemove={() => unlink('episode_ids', id)}
      />,
    );
  }
  for (const id of i.notebook_ids) {
    const nb = notebooks.get(id);
    if (!nb) continue;
    out.push(
      <Chip
        key={'n' + id}
        tone={notebookColors[nb.color].accent}
        icon={<BookMarked size={13} />}
        label={nb.name}
        title="Cuaderno"
        onOpen={() => {
          nav.onLeave?.();
          app.go('Agenda', nb);
        }}
        onRemove={() => unlink('notebook_ids', id)}
      />,
    );
  }
  for (const id of i.entry_ids) {
    const e = entries.get(id);
    if (!e) continue;
    const m = kindMeta[e.kind];
    out.push(
      <Chip
        key={'r' + id}
        tone={m.accent}
        icon={<m.icon size={13} />}
        label={e.title || m.label}
        title={`${m.label} · ${friendlyDate(entryDay(e))}`}
        onOpen={() => {
          nav.onOpen?.();
          app.viewEntry(e);
        }}
        onRemove={() => unlink('entry_ids', id)}
      />,
    );
  }
  for (const id of i.person_ids) {
    const p = people.get(id);
    if (!p) continue;
    out.push(
      <Chip
        key={'p' + id}
        icon={<Avatar person={p} size={18} />}
        label={p.name.split(' ')[0]}
        title={p.name}
        person
        onOpen={() => app.peekPerson(p)}
        onRemove={() => unlink('person_ids', id)}
      />,
    );
  }
  for (const id of i.place_ids) {
    const p = places.get(id);
    if (!p) continue;
    const m = placeKinds[p.kind] ?? placeKinds.otro;
    out.push(
      <Chip
        key={'l' + id}
        tone={m.color}
        icon={<MapPin size={13} />}
        label={p.name}
        title={`Lugar · ${m.label}`}
        onOpen={() => {
          nav.onLeave?.();
          app.go('Lugares', p);
        }}
        onRemove={() => unlink('place_ids', id)}
      />,
    );
  }
  return out;
}

function Chip({
  icon,
  label,
  title,
  tone,
  person = false,
  onOpen,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  tone?: string;
  person?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      className={'ip-chip' + (person ? ' person' : '')}
      style={tone ? ({ '--c': tone } as CSSProperties) : undefined}
    >
      <button type="button" className="ip-chip-main" title={title} onClick={onOpen}>
        {icon}
        <span>{label}</span>
      </button>
      <button type="button" className="ip-chip-x" aria-label={`Desvincular ${label}`} onClick={onRemove}>
        <X size={11} />
      </button>
    </span>
  );
}

/** Editar lo que escribiste (y sus fotos) en el mismo lugar. */
function EditBox({ instant: i, onDone }: { instant: Instant; onDone: () => void }) {
  const { notify } = useApp();
  const [text, setText] = useState(i.body);
  const [busy, setBusy] = useState(false);
  const uploads = useImageUploads(i.images, INSTANT_PHOTOS);
  const area = useAutoGrow(text);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Solo al empezar a editar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed =
    text.trim() !== i.body ||
    uploads.images.length !== i.images.length ||
    uploads.images.some((x, k) => x.url !== i.images[k]?.url);
  const save = async () => {
    if (busy || uploads.busy) return;
    if (!changed) return onDone();
    if (!text.trim() && !uploads.images.length) return notify('Un instante necesita texto o una foto.');
    setBusy(true);
    const ok = await updateInstant(i.id, { body: text.trim(), images: uploads.images }, true);
    setBusy(false);
    if (ok !== true) return notify(ok);
    // Si está compartido, la publicación se pone al día con lo que acabas de cambiar.
    if (sharesState().shares.get(i.id)?.remote_ids.length)
      void resyncInstant(i.id).then((why) =>
        notify(
          why
            ? `Se guardó en Nexo, pero no se pudo actualizar la publicación: ${why}`
            : 'Publicación actualizada.',
        ),
      );
    onDone();
  };
  return (
    <div
      className="ip-edit"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void save();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <textarea
        ref={area}
        value={text}
        maxLength={INSTANT_MAX}
        aria-label="Texto del instante"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = pastedImages(e);
          if (files.length) {
            e.preventDefault();
            uploads.add(files);
          }
        }}
      />
      <PhotoStrip uploads={uploads} />
      <div className="ip-edit-foot">
        <label className="ic-tool" data-tip="Imagen">
          <input
            type="file"
            accept="image/*"
            multiple
            className="cp-sr"
            onChange={(e) => {
              uploads.add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <ImagePlus size={18} />
        </label>
        <span className="ic-grow" />
        <button type="button" className="ic-btn ghost" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="button"
          className="ic-btn"
          disabled={busy || uploads.busy}
          onClick={() => void save()}
        >
          {busy && <LoaderCircle className="spin" size={14} />} Guardar
        </button>
      </div>
    </div>
  );
}

/** Seguir el hilo desde el panel: se publica al final y Nexo busca sus piezas. */
function ReplyBox({ thread, onDone }: { thread: Thread; onDone: () => void }) {
  const { workspace, notify } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const uploads = useImageUploads([], INSTANT_PHOTOS);
  const area = useAutoGrow(text);
  useEffect(() => {
    area.current?.focus();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const publish = async () => {
    if (busy || uploads.busy || (!text.trim() && !uploads.images.length)) return;
    setBusy(true);
    const made = await createInstants(
      [
        {
          body: text.trim(),
          images: uploads.images,
          mood: null,
          happened_on: null,
          person_ids: peopleIn(text, [], workspace),
          place_ids: placesIn(text, [], workspace),
          episode_ids: thread.root.episode_ids,
        },
      ],
      thread.id,
    );
    setBusy(false);
    if (typeof made === 'string') return notify(made);
    if (scanOn())
      enqueuePieces({
        items: made.map((x) => ({
          id: x.id,
          text: x.body,
          mood: null,
          date: null,
          places: x.place_ids.flatMap((id) => {
            const p = workspace.places.find((pl) => pl.id === id);
            return p ? [{ id: p.id, name: p.name }] : [];
          }),
        })),
        people: [],
        episodeId: thread.root.episode_ids[0] ?? null,
        keepText: false,
      });
    setText('');
    uploads.reset();
    onDone();
  };
  return (
    <div
      className="ip-post reply"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void publish();
        }
        // Esc no cierra el panel con algo escrito: solo deja de responder si está vacío.
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (!text.trim() && !uploads.items.length) onDone();
        }
      }}
    >
      <span className="ic-face sm" aria-hidden="true">
        <MyFace size={28} />
      </span>
      <div className="ip-main">
        <textarea
          ref={area}
          className="ip-reply-area"
          value={text}
          rows={1}
          maxLength={INSTANT_MAX}
          placeholder="Añadir al hilo…"
          aria-label="Añadir al hilo"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
            const files = pastedImages(e);
            if (files.length) {
              e.preventDefault();
              uploads.add(files);
            }
          }}
        />
        <PhotoStrip uploads={uploads} />
        <div className="ip-edit-foot">
          <label className="ic-tool" data-tip="Imagen">
            <input
              type="file"
              accept="image/*"
              multiple
              className="cp-sr"
              onChange={(e) => {
                uploads.add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <ImagePlus size={18} />
          </label>
          <span className="ic-grow" />
          <button type="button" className="ic-btn ghost" onClick={onDone}>
            Cancelar
          </button>
          <button
            type="button"
            className="ic-btn"
            disabled={busy || uploads.busy || (!text.trim() && !uploads.images.length)}
            onClick={() => void publish()}
          >
            {busy && <LoaderCircle className="spin" size={14} />} Publicar
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoStrip({ uploads }: { uploads: ReturnType<typeof useImageUploads> }) {
  if (!uploads.items.length && !uploads.notice) return null;
  return (
    <>
      {uploads.items.length > 0 && (
        <div className="inc-photos">
          {uploads.items.map((item) => (
            <figure key={item.id} className={'inc-photo ' + item.status}>
              <img src={item.preview} alt="" />
              {item.status === 'uploading' && (
                <span className="inc-photo-busy" role="status" aria-label="Subiendo foto">
                  <LoaderCircle className="spin" size={16} />
                </span>
              )}
              {item.status === 'error' && (
                <button
                  type="button"
                  className="inc-photo-retry"
                  title={item.error}
                  aria-label="Reintentar subida"
                  onClick={() => uploads.retry(item.id)}
                >
                  <RotateCw size={16} />
                </button>
              )}
              <button
                type="button"
                className="inc-photo-x"
                aria-label="Quitar foto"
                onClick={() => uploads.remove(item.id)}
              >
                <X size={12} strokeWidth={3} />
              </button>
            </figure>
          ))}
        </div>
      )}
      {uploads.notice && <p className="inc-notice">{uploads.notice}</p>}
    </>
  );
}

function useAutoGrow(text: string, max = 320) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [text, max]);
  return ref;
}

/**
 * Vincular a mano: personas, lugares, episodios y cualquier recuerdo. Marcar o desmarcar se guarda
 * al momento.
 */
function LinkDialog({ instant, onClose }: { instant: Instant; onClose: () => void }) {
  const { workspace } = useApp();
  const { list: notebookList } = useCuadernos();
  const { noNotebooks } = useInstants();
  const counts = useMemo(() => personCounts(workspace.entries), [workspace.entries]);
  const items = useMemo<PickItem[]>(() => {
    const people = [...workspace.people]
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .map((p: Person) => ({
        id: 'person_ids:' + p.id,
        name: p.name,
        sub: ['Persona', relationMeta[relationOf(p)].label].join(' · '),
        lead: <Avatar person={p} size={36} />,
        search: searchText(p),
      }));
    const episodes = [...workspace.episodes]
      .sort(
        (a, b) =>
          Number(b.status === 'activo') - Number(a.status === 'activo') ||
          (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at),
      )
      .map((e: Episode) => {
        const m = episodeKindOf(e.kind);
        return {
          id: 'episode_ids:' + e.id,
          name: e.title,
          sub: `Episodio · ${m.label}`,
          lead: (
            <span className="pk-tile" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
              <m.icon size={16} />
            </span>
          ),
        };
      });
    // Sin la columna de cuadernos (migración nueva sin ejecutar) no se ofrecen.
    const notebooks = noNotebooks
      ? []
      : [...(notebookList ?? [])]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .map((nb: Notebook) => {
            const c = notebookColors[nb.color];
            return {
              id: 'notebook_ids:' + nb.id,
              name: nb.name,
              sub: `Cuaderno · ${nb.items.length} ${nb.items.length === 1 ? 'elemento' : 'elementos'}`,
              lead: (
                <span className="pk-tile" style={{ '--c': c.accent, '--s': c.soft } as CSSProperties}>
                  <BookMarked size={16} />
                </span>
              ),
            };
          });
    const places = workspace.places.map((p: Place) => {
      const m = placeKinds[p.kind] ?? placeKinds.otro;
      return {
        id: 'place_ids:' + p.id,
        name: p.name,
        sub: ['Lugar', m.label, p.city].filter(Boolean).join(' · '),
        lead: (
          <span className="pk-tile" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
            <m.icon size={16} />
          </span>
        ),
        search: placeSearchText(p),
      };
    });
    const entries = [...workspace.entries]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e: Entry) => {
        const m = kindMeta[e.kind];
        return {
          id: 'entry_ids:' + e.id,
          name: e.title || m.label,
          sub: `${m.label} · ${friendlyDate(entryDay(e))}`,
          lead: (
            <span className="pk-tile" style={{ '--c': m.accent, '--s': m.soft } as CSSProperties}>
              <m.icon size={16} />
            </span>
          ),
        };
      });
    return [...episodes, ...notebooks, ...people, ...places, ...entries];
  }, [workspace, counts, notebookList, noNotebooks]);
  const selected = [
    ...instant.entry_ids.map((id) => 'entry_ids:' + id),
    ...instant.episode_ids.map((id) => 'episode_ids:' + id),
    ...instant.notebook_ids.map((id) => 'notebook_ids:' + id),
    ...instant.person_ids.map((id) => 'person_ids:' + id),
    ...instant.place_ids.map((id) => 'place_ids:' + id),
  ];
  return (
    <PickDialog
      title="Vincular a este instante"
      placeholder="Busca una persona, un lugar, un episodio, un cuaderno o un recuerdo…"
      items={items}
      selected={selected}
      multi
      pinned={selected}
      pinnedLabel="Ya vinculado"
      onToggle={(value) => {
        const at = value.indexOf(':');
        const key = value.slice(0, at) as LinkKey;
        const id = value.slice(at + 1);
        const on = instant[key].includes(id);
        void linkInstant(instant.id, on ? {} : { [key]: [id] }, on ? { [key]: [id] } : {});
      }}
      footer={
        <span className="xp-pk-count">
          {selected.length
            ? `${selected.length} ${selected.length === 1 ? 'vínculo' : 'vínculos'}`
            : 'Nada vinculado aún'}
        </span>
      }
      onClose={onClose}
    />
  );
}

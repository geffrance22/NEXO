import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  CalendarDays,
  ChevronRight,
  Globe,
  ImagePlus,
  LoaderCircle,
  MapPin,
  MapPinPlus,
  Plus,
  RotateCw,
  Smile,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { personCounts } from '../capture/Pickers';
import { MoodIcon, moodOf, moods } from '../composer/controls';
import { pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import { useCuadernos } from '../cuadernos/useCuadernos';
import type { Place, StoredImage } from '../data';
import { guessPlaceKind } from '../lib/capture';
import { addDays, friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { placeKinds, placeSearchText } from '../lib/places';
import { Avatar } from '../people/Avatar';
import { MyFace } from '../people/MyFace';
import { enqueuePieces } from './analysis';
import { names, peopleIn, placesIn, scanOn, setScan as saveScan, shownName } from './helpers';
import { INSTANT_MAX, INSTANT_PHOTOS } from './model';
import { QuickPick, type QuickItem } from './QuickPick';
import { openRemote, shareInstants, useFediverse } from './share';
import {
  createInstants,
  instantsHint,
  instantsState,
  linkInstant,
  useInstants,
  type InstantDraft,
} from './store';
import { TopicPick, topicChip, topicKey, topicOf, type Topic, type TopicChip } from './topics';
import './instants.css';

/** Sin buscar: cuántas personas y cuántos lugares se ofrecen. */
const TOP_PEOPLE = 10;
const TOP_PLACES = 3;

type Draft = {
  key: string;
  text: string;
  mood: number | null;
  /** AAAA-MM-DD si elegiste cuándo pasó. */
  date: string | null;
  /** Personas que nombraste con el botón (y, en el primero, desde donde abriste). */
  people: string[];
  places: string[];
  /** Lugares nuevos que escribiste: se crean al publicar, no antes. */
  newPlaces: string[];
};
type Shot = { images: StoredImage[]; busy: boolean; error: boolean; count: number };
type Pick = { kind: 'person' | 'place' | 'topic'; index: number; anchor?: HTMLElement };

const newDraft = (text = '', people: string[] = []): Draft => ({
  key: crypto.randomUUID(),
  text,
  mood: null,
  date: null,
  people,
  places: [],
  newPlaces: [],
});
const keyOf = (name: string) => normalizeText(name.trim()).replace(/\s+/g, ' ');

/**
 * Escribir un instante: lo que pasó, tal cual, como una publicación breve (o un hilo de varias).
 * Con fotos, ánimo, personas, lugar, fecha y el episodio o tema al que pertenece. Al publicar se
 * guarda al momento y Nexo busca sus piezas en segundo plano (la barra de abajo a la derecha).
 */
export function InstantComposer({
  text: initialText = '',
  people: preset = [],
  onClose,
}: {
  text?: string;
  people?: string[];
  onClose: () => void;
}) {
  const app = useApp();
  const { workspace, me, user, confirm, notify } = app;
  const { list: instants, noNotebooks } = useInstants();
  const { list: notebooks } = useCuadernos();
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft(initialText, preset)]);
  const [active, setActive] = useState(0);
  /** «Episodio o tema»: un episodio, cuadernos y recuerdos (encuentros, diario, películas…). */
  const [topics, setTopics] = useState<Topic[]>([]);
  const [scan, setScan] = useState(scanOn);
  const fediverse = useFediverse();
  /** Publicarlo también en tu cuenta del Fediverso. Siempre empieza apagado: lo privado es lo normal. */
  const [share, setShare] = useState(false);
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());

  const myName = shownName(me.profile, user.email);
  // Lo elegido que ya no existe (se borró) ni se muestra ni se guarda.
  const chosen = useMemo(
    () =>
      topics.flatMap((t) => {
        const chip = topicChip(t, workspace, notebooks ?? []);
        return chip ? [{ topic: t, chip }] : [];
      }),
    [topics, workspace, notebooks],
  );
  const topicIds = (kind: Topic['kind']) =>
    chosen.filter((c) => c.topic.kind === kind).map((c) => c.topic.id);
  /** Las piezas que Nexo encuentre se suman a este episodio (si elegiste uno). */
  const episodeId = topicIds('episode')[0] ?? null;
  const uploading = Object.values(shots).some((s) => s.busy);
  const filled = drafts.filter((d) => d.text.trim() || shots[d.key]?.images.length);
  const tooLong = drafts.some((d) => d.text.length > INSTANT_MAX);
  const canPublish = filled.length > 0 && !uploading && !busy && !tooLong;

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const focusDraft = (key: string, at?: number) =>
    requestAnimationFrame(() => {
      const el = areas.current.get(key);
      if (!el) return;
      el.focus({ preventScroll: false });
      const pos = at ?? el.value.length;
      el.setSelectionRange(pos, pos);
    });

  useEffect(() => {
    focusDraft(drafts[0].key);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Escribe algo donde está el cursor (con los espacios que hagan falta). */
  const insertAt = (i: number, snippet: string) => {
    const d = drafts[i];
    const el = areas.current.get(d.key);
    // El cursor se conserva aunque el foco esté en el buscador.
    const start = Math.min(el?.selectionStart ?? d.text.length, d.text.length);
    const end = Math.min(el?.selectionEnd ?? start, d.text.length);
    const before = d.text.slice(0, start);
    const after = d.text.slice(end);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
    const head = before + pad + snippet + tail;
    setDrafts((ds) =>
      ds.map((x, j) => (j === i ? { ...x, text: (head + after).slice(0, INSTANT_MAX) } : x)),
    );
    focusDraft(d.key, head.length);
  };

  const addThread = () => {
    const last = drafts[drafts.length - 1];
    if (!last.text.trim() && !shots[last.key]?.images.length) return focusDraft(last.key);
    const d = newDraft();
    setDrafts((ds) => [...ds, d]);
    setActive(drafts.length);
    focusDraft(d.key);
  };
  const removeDraft = (i: number) => {
    const d = drafts[i];
    setDrafts((ds) => ds.filter((_, j) => j !== i));
    setShots((s) => {
      const rest = { ...s };
      delete rest[d.key];
      return rest;
    });
    setPick(null);
    const next = Math.max(0, i - 1);
    setActive(next);
    focusDraft(drafts[next].key);
  };

  // ── Lo más frecuente primero: recuerdos e instantes en que aparece cada persona y cada lugar.
  const usage = useMemo(() => {
    const people = personCounts(workspace.entries);
    const places = new Map<string, number>();
    for (const e of workspace.entries) {
      const id = e.details.placeId;
      if (id) places.set(id, (places.get(id) ?? 0) + 1);
    }
    for (const i of instants ?? []) {
      for (const id of i.person_ids) people.set(id, (people.get(id) ?? 0) + 1);
      for (const id of i.place_ids) places.set(id, (places.get(id) ?? 0) + 1);
    }
    return { people, places };
  }, [workspace.entries, instants]);

  const personQuick = useMemo<QuickItem[]>(
    () =>
      workspace.people
        .map((p) => ({
          id: p.id,
          name: p.name,
          n: usage.people.get(p.id) ?? 0,
          sub: [relationMeta[relationOf(p)].label, p.role].filter(Boolean).join(' · '),
          lead: <Avatar person={p} size={30} />,
          search: searchText(p),
        }))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'es')),
    [workspace.people, usage],
  );
  const placeQuick = useMemo<QuickItem[]>(
    () =>
      workspace.places
        .map((p) => {
          const m = placeKinds[p.kind] ?? placeKinds.otro;
          return {
            id: p.id,
            name: p.name,
            n: (usage.places.get(p.id) ?? 0) + (p.favorite ? 2 : 0),
            at: p.created_at,
            sub: [m.label, p.city].filter(Boolean).join(' · '),
            lead: (
              <span className="qp-tile" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
                <m.icon size={15} />
              </span>
            ),
            search: placeSearchText(p),
          };
        })
        .sort((a, b) => b.n - a.n || b.at.localeCompare(a.at)),
    [workspace.places, usage],
  );
  /** Abre (o cierra, si ya estaba abierto) el buscador de ese botón. */
  const togglePick = (next: Pick) =>
    setPick((cur) => (cur && cur.kind === next.kind && cur.index === next.index ? null : next));

  /** Elegir (o quitar) un episodio, un cuaderno o un recuerdo como tema. */
  const toggleTopic = (key: string) => {
    const t = topicOf(key);
    setPick(null);
    if (!t) return;
    setTopics((cur) =>
      cur.some((x) => topicKey(x) === key)
        ? cur.filter((x) => topicKey(x) !== key)
        : // Un solo episodio a la vez: es al que Nexo suma las piezas que encuentre.
          [...(t.kind === 'episode' ? cur.filter((x) => x.kind !== 'episode') : cur), t],
    );
    focusDraft(drafts[Math.min(active, drafts.length - 1)].key);
  };

  /** Nombrar a alguien: se escribe su nombre donde estás. Si ya estaba, se quita. */
  const pickPerson = (i: number, id: string) => {
    const p = workspace.people.find((x) => x.id === id);
    const d = drafts[i];
    setPick(null);
    if (!p) return;
    if (d.people.includes(id)) {
      update(i, { people: d.people.filter((x) => x !== id) });
      return focusDraft(d.key);
    }
    const first = p.name.trim().split(/\s+/)[0];
    // Si hay otra persona con el mismo nombre, se escribe completo.
    const twin = workspace.people.some(
      (x) => x.id !== p.id && normalizeText(x.name.split(/\s+/)[0]) === normalizeText(first),
    );
    const shown = twin ? p.name.trim() : first;
    setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, people: [...x.people, id] } : x)));
    if (!names(d.text, shown) && !names(d.text, p.name)) insertAt(i, shown);
    else focusDraft(d.key);
  };
  const pickPlace = (i: number, id: string) => {
    const p = workspace.places.find((x) => x.id === id);
    const d = drafts[i];
    setPick(null);
    if (!p) return;
    if (d.places.includes(id)) {
      update(i, { places: d.places.filter((x) => x !== id) });
      return focusDraft(d.key);
    }
    setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, places: [...x.places, id] } : x)));
    if (!names(d.text, p.name)) insertAt(i, `en ${p.name.trim()}`);
    else focusDraft(d.key);
  };
  /** Un lugar que aún no tienes: queda en el instante y se crea al publicar. */
  const addPlace = (i: number, raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) return;
    const same = workspace.places.find((p) => keyOf(p.name) === keyOf(name));
    if (same) return pickPlace(i, same.id);
    const d = drafts[i];
    setPick(null);
    if (!d.newPlaces.some((n) => keyOf(n) === keyOf(name)))
      setDrafts((ds) =>
        ds.map((x, j) => (j === i ? { ...x, newPlaces: [...x.newPlaces, name] } : x)),
      );
    if (!names(d.text, name)) insertAt(i, `en ${name}`);
    else focusDraft(d.key);
  };

  const toggleScan = () => {
    saveScan(!scan);
    setScan(!scan);
  };

  const publish = async () => {
    if (!canPublish) return;
    setBusy(true);
    setPick(null);
    const rows: InstantDraft[] = filled.map((d) => ({
      body: d.text.trim(),
      images: shots[d.key]?.images ?? [],
      mood: d.mood,
      happened_on: d.date,
      person_ids: peopleIn(d.text, d.people, workspace),
      place_ids: placesIn(d.text, d.places, workspace),
      episode_ids: topicIds('episode'),
      entry_ids: topicIds('entry'),
      notebook_ids: topicIds('notebook'),
    }));
    const picked = [...new Set(filled.flatMap((d) => d.people))];
    const made = await createInstants(rows);
    if (typeof made === 'string') {
      setBusy(false);
      // Sin la tabla de instantes: como antes, las piezas guardan el texto completo.
      if (instantsState().missing && scan) {
        enqueuePieces({
          items: rows.map((r) => ({ id: '', text: r.body, mood: r.mood, date: r.happened_on })),
          people: picked,
          episodeId,
          keepText: true,
        });
        notify(`${instantsHint} Mientras tanto, Nexo busca sus piezas con el texto completo.`);
        onClose();
        return;
      }
      notify(made);
      return;
    }

    // Los lugares nuevos se crean ahora que el instante quedó guardado (una sola vez cada uno).
    const fresh = new Map<string, Place>();
    for (const name of filled.flatMap((d) => d.newPlaces)) {
      if (fresh.has(keyOf(name))) continue;
      const place = await app.savePlace({
        name,
        kind: guessPlaceKind(name),
        city: '',
        address: '',
        story: '',
        images: [],
        favorite: false,
      });
      if (place) fresh.set(keyOf(name), place);
    }
    const placesOf = made.map((_, k) => [
      ...rows[k].place_ids.flatMap((id) => workspace.places.find((p) => p.id === id) ?? []),
      ...filled[k].newPlaces.flatMap((n) => fresh.get(keyOf(n)) ?? []),
    ]);
    for (let k = 0; k < made.length; k++) {
      const add = filled[k].newPlaces.flatMap((n) => fresh.get(keyOf(n))?.id ?? []);
      if (add.length) await linkInstant(made[k].id, { place_ids: add });
    }
    setBusy(false);

    if (scan)
      enqueuePieces({
        items: made.map((i, k) => ({
          id: i.id,
          text: i.body,
          mood: i.mood,
          date: i.happened_on,
          places: placesOf[k].map((p) => ({ id: p.id, name: p.name })),
        })),
        people: picked,
        episodeId,
        keepText: false,
      });
    const sharing = share && fediverse.ready;
    notify(
      (made.length > 1 ? `Hilo publicado (${made.length}).` : 'Instante publicado.') +
        (sharing ? ' Compartiéndolo…' : ''),
      {
        label: 'Ver',
        icon: 'open',
        run: () => app.openInstant(made[0].id),
      },
    );
    // Se comparte detrás: la ventana se cierra sin esperar, y el resultado se avisa al terminar.
    if (sharing)
      void shareInstants(made.map((m) => m.id)).then((r) => {
        if (r.error)
          notify(
            `No se pudo compartir${r.ok ? ` (salieron ${r.ok} de ${made.length})` : ''}: ${r.error} Reinténtalo desde el menú del instante.`,
          );
        else
          notify(
            'Compartido' + (r.note ? `. ${r.note}` : '.'),
            r.url ? { label: 'Ver', icon: 'open', run: () => openRemote(r.url) } : undefined,
          );
      });
    onClose();
  };

  const requestClose = async () => {
    const dirty =
      drafts.some((d, i) => (i === 0 ? d.text.trim() !== initialText.trim() : d.text.trim())) ||
      Object.values(shots).some((s) => s.count > 0);
    if (dirty) {
      const ok = await confirm({
        title: drafts.length > 1 ? '¿Descartar este hilo?' : '¿Descartar este instante?',
        message: 'Aún no lo publicas: lo que escribiste se pierde.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir escribiendo',
        danger: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };

  const last = drafts[drafts.length - 1];
  const canThread = Boolean(last.text.trim() || shots[last.key]?.images.length);
  const target = pick ? drafts[pick.index] : null;

  return (
    <Sheet
      label={drafts.length > 1 ? 'Nuevo hilo' : 'Nuevo instante'}
      className="inc-sheet"
      yieldTo=".xp-pk-backdrop, .nx-pop"
      onRequestClose={() => void requestClose()}
    >
      <div
        className="inc"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void publish();
          }
        }}
      >
        <header className="inc-head">
          <button type="button" className="inc-cancel" onClick={() => void requestClose()}>
            Cancelar
          </button>
          <h2>{drafts.length > 1 ? 'Nuevo hilo' : 'Nuevo instante'}</h2>
          <span className="inc-count" aria-live="polite">
            {drafts.length > 1 ? `${drafts.length} partes` : ''}
          </span>
        </header>

        <div className="inc-body">
          {drafts.map((d, i) => (
            <ThreadDraft
              key={d.key}
              draft={d}
              first={i === 0}
              active={i === active}
              myName={myName}
              open={pick && pick.index === i ? pick.kind : null}
              topic={
                i === 0
                  ? {
                      chips: chosen.map((c) => c.chip),
                      onPick: (anchor) => togglePick({ kind: 'topic', index: 0, anchor }),
                      onRemove: (key) => setTopics((cur) => cur.filter((x) => topicKey(x) !== key)),
                    }
                  : undefined
              }
              register={(el) => {
                if (el) areas.current.set(d.key, el);
                else areas.current.delete(d.key);
              }}
              onFocus={() => setActive(i)}
              onChange={(patch) => update(i, patch)}
              onRemove={i > 0 ? () => removeDraft(i) : undefined}
              onPerson={(anchor) => togglePick({ kind: 'person', index: i, anchor })}
              onPlace={(anchor) => togglePick({ kind: 'place', index: i, anchor })}
              onShots={(s) =>
                setShots((all) => {
                  const prev = all[d.key];
                  if (
                    prev &&
                    prev.busy === s.busy &&
                    prev.error === s.error &&
                    prev.count === s.count &&
                    prev.images.length === s.images.length &&
                    prev.images.every((x, k) => x.url === s.images[k]?.url)
                  )
                    return all;
                  return { ...all, [d.key]: s };
                })
              }
            />
          ))}

          <button
            type="button"
            className={'inc-more' + (canThread ? '' : ' muted')}
            onClick={addThread}
            title="Sigue la idea en otra publicación"
          >
            <span className="inc-face sm">
              <MyFace size={22} />
            </span>
            Añadir al hilo
          </button>
        </div>

        <footer className="inc-foot">
          <button
            type="button"
            className={'inc-scan' + (scan ? ' on' : '')}
            role="switch"
            aria-checked={scan}
            onClick={toggleScan}
            title="Nexo lee lo que publicas y, en segundo plano, te propone sus piezas: encuentro, gasto, pendiente, novedad…"
          >
            <i aria-hidden="true" />
            <Sparkles size={14} />
            {scan ? 'Buscar piezas' : 'Sin buscar piezas'}
          </button>
          {fediverse.ready && (
            <button
              type="button"
              className={'inc-scan inc-share' + (share ? ' on' : '')}
              role="switch"
              aria-checked={share}
              onClick={() => setShare((v) => !v)}
              title={
                share
                  ? `Se publica en ${fediverse.account?.handle || 'tu cuenta'}, en público: el texto y hasta 4 fotos. No salen el ánimo, las personas ni los lugares.`
                  : `No se comparte. Actívalo para publicarlo también en ${fediverse.account?.handle || 'tu cuenta del Fediverso'}.`
              }
            >
              <i aria-hidden="true" />
              <Globe size={14} />
              {share ? 'Público' : 'No compartir'}
            </button>
          )}
          <span className="inc-keys" aria-hidden="true">
            <kbd>Ctrl</kbd>
            <kbd>Enter</kbd>
          </span>
          <button
            type="button"
            className="inc-publish"
            disabled={!canPublish}
            onClick={() => void publish()}
            title={uploading ? 'Esperando a que suban las fotos…' : undefined}
          >
            {busy || uploading ? <LoaderCircle className="spin" size={15} /> : null}
            Publicar
          </button>
        </footer>
      </div>

      {pick?.kind === 'person' && pick.anchor && target && (
        <QuickPick
          anchor={pick.anchor}
          label="Nombrar a una persona"
          placeholder="Buscar persona…"
          items={personQuick}
          top={TOP_PEOPLE}
          selected={target.people}
          noun="personas"
          onPick={(id) => pickPerson(pick.index, id)}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'place' && pick.anchor && target && (
        <QuickPick
          anchor={pick.anchor}
          label="Lugar"
          placeholder="Buscar lugar…"
          items={placeQuick}
          top={TOP_PLACES}
          selected={target.places}
          noun="lugares"
          onPick={(id) => pickPlace(pick.index, id)}
          onCreate={(name) => addPlace(pick.index, name)}
          createPlaceholder="Nuevo lugar"
          createIcon={<MapPinPlus size={15} />}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'topic' && pick.anchor && (
        <TopicPick
          anchor={pick.anchor}
          selected={chosen.map((c) => c.chip.key)}
          withNotebooks={!noNotebooks}
          onToggle={toggleTopic}
          onClose={() => setPick(null)}
        />
      )}
    </Sheet>
  );
}

/** Una publicación del hilo: tu foto, el texto, sus fotos y su barra de herramientas. */
function ThreadDraft({
  draft: d,
  first,
  active,
  myName,
  open,
  topic,
  register,
  onFocus,
  onChange,
  onRemove,
  onPerson,
  onPlace,
  onShots,
}: {
  draft: Draft;
  first: boolean;
  active: boolean;
  myName: string;
  /** El buscador abierto desde esta publicación (para marcar su botón). */
  open: Pick['kind'] | null;
  /** «Episodio o tema» (solo en la primera publicación del hilo). */
  topic?: {
    chips: TopicChip[];
    onPick: (anchor: HTMLElement) => void;
    onRemove: (key: string) => void;
  };
  register: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (patch: Partial<Draft>) => void;
  onRemove?: () => void;
  onPerson: (anchor: HTMLElement) => void;
  onPlace: (anchor: HTMLElement) => void;
  onShots: (s: Shot) => void;
}) {
  const { workspace } = useApp();
  const uploads = useImageUploads([], INSTANT_PHOTOS);
  const [tray, setTray] = useState<'mood' | 'date' | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const today = todayInputValue();
  const mood = moodOf(d.mood);
  const shownMood = moodOf(hover) ?? mood;

  // El padre sabe qué fotos hay (y si alguna sigue subiendo) para publicar.
  const sig =
    uploads.images.map((i) => i.url).join('|') +
    `#${uploads.busy}#${uploads.hasError}#${uploads.items.length}`;
  const report = useRef(onShots);
  report.current = onShots;
  useEffect(() => {
    report.current({
      images: uploads.images,
      busy: uploads.busy,
      error: uploads.hasError,
      count: uploads.items.length,
    });
    // `sig` resume todo lo anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // El campo crece con el texto (con un tope; luego hace scroll).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 360;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [d.text]);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedImages(e);
    if (!files.length) return;
    e.preventDefault();
    uploads.add(files);
  };
  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    setDrag(false);
    if (!files.length) return;
    e.preventDefault();
    uploads.add(files);
  };

  const people = d.people
    .map((id) => workspace.people.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const places = d.places
    .map((id) => workspace.places.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const left = INSTANT_MAX - d.text.length;
  const full = uploads.items.length >= INSTANT_PHOTOS;
  const hasChips =
    Boolean(mood || d.date) || people.length > 0 || places.length > 0 || d.newPlaces.length > 0;

  return (
    <article
      className={'inc-item' + (active ? ' active' : '') + (drag ? ' drag' : '')}
      onFocusCapture={onFocus}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((x) => x.kind === 'file')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
      }}
      onDrop={onDrop}
    >
      <span className="inc-face" aria-hidden="true">
        <MyFace size={36} />
      </span>
      <div className="inc-main">
        <div className="inc-who">
          <strong>{myName}</strong>
          {topic &&
            (topic.chips.length === 0 ? (
              <span className="inc-topic">
                <button type="button" onClick={(e) => topic.onPick(e.currentTarget)}>
                  <ChevronRight size={14} />
                  Episodio o tema
                </button>
              </span>
            ) : (
              <>
                {topic.chips.map((c) => (
                  <span key={c.key} className="inc-topic set">
                    <button
                      type="button"
                      title={c.title}
                      onClick={(e) => topic.onPick(e.currentTarget)}
                      style={{ '--c': c.color } as CSSProperties}
                    >
                      <ChevronRight size={14} />
                      {c.label}
                    </button>
                    <button
                      type="button"
                      className="inc-topic-x"
                      aria-label={`Quitar ${c.label}`}
                      onClick={() => topic.onRemove(c.key)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <span className="inc-topic">
                  <button
                    type="button"
                    aria-label="Añadir otro tema"
                    title="Añadir otro tema"
                    onClick={(e) => topic.onPick(e.currentTarget)}
                  >
                    <Plus size={14} />
                  </button>
                </span>
              </>
            ))}
          {onRemove && (
            <button
              type="button"
              className="inc-remove"
              aria-label="Quitar del hilo"
              title="Quitar del hilo"
              onClick={onRemove}
            >
              <X size={15} />
            </button>
          )}
        </div>

        <textarea
          ref={(el) => {
            area.current = el;
            register(el);
          }}
          className="inc-area"
          rows={first ? 2 : 1}
          value={d.text}
          maxLength={INSTANT_MAX + 200}
          placeholder={first ? '¿Qué está pasando?' : 'Di algo más…'}
          aria-label={first ? 'Qué está pasando' : 'Siguiente parte del hilo'}
          onChange={(e) => onChange({ text: e.target.value })}
          onPaste={onPaste}
        />

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

        {hasChips && (
          <div className="inc-chips">
            {mood && (
              <button type="button" className="inc-chip" onClick={() => setTray('mood')}>
                <MoodIcon mood={mood} size={18} solid /> {mood.label}
                <X
                  size={12}
                  className="inc-chip-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({ mood: null });
                  }}
                />
              </button>
            )}
            {d.date && (
              <button type="button" className="inc-chip" onClick={() => setTray('date')}>
                <CalendarDays size={13} /> {friendlyDate(d.date, today)}
                <X
                  size={12}
                  className="inc-chip-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({ date: null });
                  }}
                />
              </button>
            )}
            {people.map((p) => (
              <span key={p.id} className="inc-chip person">
                <UserRound size={13} /> {p.name.split(' ')[0]}
                <X
                  size={12}
                  className="inc-chip-x"
                  role="button"
                  aria-label={`Quitar a ${p.name}`}
                  onClick={() => onChange({ people: d.people.filter((x) => x !== p.id) })}
                />
              </span>
            ))}
            {places.map((p) => (
              <span key={p.id} className="inc-chip place">
                <MapPin size={13} /> {p.name}
                <X
                  size={12}
                  className="inc-chip-x"
                  role="button"
                  aria-label={`Quitar ${p.name}`}
                  onClick={() => onChange({ places: d.places.filter((x) => x !== p.id) })}
                />
              </span>
            ))}
            {d.newPlaces.map((n) => (
              <span key={'new:' + n} className="inc-chip place" title="Se crea al publicar">
                <MapPinPlus size={13} /> {n} <em>nuevo</em>
                <X
                  size={12}
                  className="inc-chip-x"
                  role="button"
                  aria-label={`Quitar ${n}`}
                  onClick={() => onChange({ newPlaces: d.newPlaces.filter((x) => x !== n) })}
                />
              </span>
            ))}
          </div>
        )}

        {active && (
          <div className="inc-tools" role="toolbar" aria-label="Añadir al instante">
            <label className={'inc-tool' + (full ? ' disabled' : '')} data-tip="Imagen">
              <input
                type="file"
                accept="image/*"
                multiple
                className="cp-sr"
                disabled={full}
                onChange={(e) => {
                  uploads.add(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <ImagePlus size={19} />
            </label>
            <button
              type="button"
              className={'inc-tool' + (tray === 'mood' ? ' on' : '')}
              data-tip="Ánimo"
              aria-label="Ánimo"
              aria-expanded={tray === 'mood'}
              onClick={() => setTray((t) => (t === 'mood' ? null : 'mood'))}
            >
              <Smile size={19} />
            </button>
            <button
              type="button"
              className={'inc-tool' + (open === 'person' ? ' on' : '')}
              data-tip={open === 'person' ? undefined : 'Persona'}
              aria-label="Nombrar a una persona"
              aria-expanded={open === 'person'}
              onClick={(e) => onPerson(e.currentTarget)}
            >
              <UserRound size={19} />
            </button>
            <button
              type="button"
              className={'inc-tool' + (open === 'place' ? ' on' : '')}
              data-tip={open === 'place' ? undefined : 'Lugar'}
              aria-label="Lugar"
              aria-expanded={open === 'place'}
              onClick={(e) => onPlace(e.currentTarget)}
            >
              <MapPin size={19} />
            </button>
            <button
              type="button"
              className={'inc-tool' + (tray === 'date' ? ' on' : '')}
              data-tip="Cuándo pasó"
              aria-label="Cuándo pasó"
              aria-expanded={tray === 'date'}
              onClick={() => setTray((t) => (t === 'date' ? null : 'date'))}
            >
              <CalendarDays size={19} />
            </button>
            {left < 400 && (
              <span className={'inc-left' + (left < 0 ? ' over' : '')} aria-live="polite">
                {left}
              </span>
            )}
          </div>
        )}

        {active && tray === 'mood' && (
          <div
            className="inc-moods"
            role="radiogroup"
            aria-label="Cómo te sentiste"
            onMouseLeave={() => setHover(null)}
          >
            {moods.map((m) => {
              const on = d.mood === m.value;
              return (
                <button
                  type="button"
                  key={m.value}
                  role="radio"
                  aria-checked={on}
                  aria-label={m.label}
                  className={on ? 'on' : ''}
                  style={{ '--mood': m.color } as CSSProperties}
                  onMouseEnter={() => setHover(m.value)}
                  onFocus={() => setHover(m.value)}
                  onBlur={() => setHover(null)}
                  onClick={() => {
                    onChange({ mood: on ? null : m.value });
                    setHover(null);
                    setTray(null);
                  }}
                >
                  <MoodIcon mood={m} size={26} solid={on} />
                </button>
              );
            })}
            <span
              className="inc-mood-name"
              style={shownMood ? ({ '--mood': shownMood.color } as CSSProperties) : undefined}
              aria-hidden="true"
            >
              {shownMood?.label ?? '¿Cómo te sientes?'}
            </span>
          </div>
        )}
        {active && tray === 'date' && (
          <div className="inc-dates">
            {[
              ['Hoy', today],
              ['Ayer', addDays(today, -1)],
              ['Anteayer', addDays(today, -2)],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                className={d.date === value ? 'on' : ''}
                onClick={() => {
                  onChange({ date: d.date === value ? null : value });
                  setTray(null);
                }}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={d.date ?? ''}
              max="2100-12-31"
              aria-label="Otra fecha"
              onChange={(e) => onChange({ date: e.target.value || null })}
            />
            {d.date && (
              <button type="button" className="ghost" onClick={() => onChange({ date: null })}>
                Quitar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

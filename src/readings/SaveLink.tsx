import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, CircleAlert, CircleCheck, Link2, LoaderCircle } from 'lucide-react';
import { Minus, RotateCw, Square, X } from 'lucide-react';
import { supabase } from '../backend';
import { ReaderDialog } from './ReaderDialog';
import { capture, failure, publicLink } from './capture';
import { savePictures } from './media';
import './readings.css';

type Saved = { id: string; archived: boolean; folder: string; title: string };
type Step = 'reading' | 'saving';
type Status = 'queued' | Step | 'done' | 'exists' | 'error' | 'stopped';
type Item = { url: string; status: Status; title?: string; error?: string };

/** Enlaces que se capturan a la vez: Jina Reader limita las peticiones por minuto. */
const PARALLEL = 3;
/** Tope por lote, para no saturar el lector ni la base de datos. */
const MAX = 50;
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const LABEL: Record<Status, string> = {
  queued: 'En cola',
  reading: 'Leyendo…',
  saving: 'Guardando…',
  done: 'Guardado',
  exists: 'Ya estaba',
  error: 'Error',
  stopped: 'Sin guardar',
};

const occurrences = (text: string, char: string) => text.split(char).length - 1;

/** Quita lo que se pega al final al copiar un enlace de un texto: puntuación y cierres sueltos. */
function tidy(raw: string) {
  let link = raw;
  for (;;) {
    const before = link;
    link = link.replace(/[.,;:!?…»”’*]+$/u, '');
    for (const [open, shut] of [
      ['(', ')'],
      ['[', ']'],
    ]) {
      if (link.endsWith(shut) && occurrences(link, open) < occurrences(link, shut))
        link = link.slice(0, -1);
    }
    if (link === before) return link;
  }
}

/**
 * Los enlaces de un texto pegado: uno por línea, separados por comas o mezclados con otro texto
 * (también en Markdown). Sin repetir y en el orden en que aparecen.
 */
function findLinks(text: string) {
  const raw = [
    ...(text
      .replace(/[,;|](?=\s*(?:https?:\/\/|www\.))/gi, ' ')
      .match(/(?<![\w@.\/-])(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? []),
  ];
  // Un solo dominio escrito sin https:// («elpais.com/…»).
  const alone = text.trim();
  if (!raw.length && alone && !/\s/.test(alone)) raw.push(alone);
  const links: string[] = [];
  let invalid = 0;
  for (const candidate of raw) {
    const clean = tidy(candidate);
    try {
      const link = publicLink(/^https?:\/\//i.test(clean) ? clean : 'https://' + clean);
      if (!links.includes(link)) links.push(link);
    } catch {
      invalid++;
    }
  }
  return { links, invalid, repeated: raw.length - invalid - links.length };
}

/** Guarda un enlace en Lecturas. Si ya estaba, devuelve el que había. */
async function store(
  link: string,
  manual: { title: string; content: string } | null,
  step: (s: Step) => void,
): Promise<{ row: Saved; existed: boolean }> {
  const lookup = await supabase
    .from('readings')
    .select('id,archived,folder,title')
    .eq('url', link)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  if (lookup.data) return { row: lookup.data, existed: true };
  const snap = manual ?? (await capture(link));
  step('saving');
  const { data, error } = await supabase
    .from('readings')
    .insert({
      url: link,
      title: snap.title,
      content: snap.content,
      media: await savePictures(snap.content),
    })
    .select('id,archived,folder,title')
    .single();
  if (error) throw error;
  return { row: data, existed: false };
}

/** «elpais.com/cultura/…» para mostrar un enlace mientras aún no tiene título. */
function shortLink(url: string) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  let rest = u.pathname.replace(/\/$/, '') + u.search;
  try {
    rest = decodeURI(rest);
  } catch {
    /* Se muestra tal cual. */
  }
  return { host, full: host + rest };
}

function Row({ item, index }: { item: Item; index: number }) {
  const { host, full } = shortLink(item.url);
  const icon =
    item.status === 'queued' ? (
      <i className="rd-sl-dot" />
    ) : item.status === 'reading' || item.status === 'saving' ? (
      <LoaderCircle className="spin" size={15} />
    ) : item.status === 'done' || item.status === 'exists' ? (
      <Check size={13} strokeWidth={2.75} />
    ) : item.status === 'error' ? (
      <X size={13} strokeWidth={2.75} />
    ) : (
      <Minus size={13} strokeWidth={2.5} />
    );
  const detail = item.error || (item.title ? host : '');
  return (
    <li
      className={'rd-sl-item ' + item.status}
      style={{ '--i': Math.min(index, 14) } as CSSProperties}
    >
      <span className="rd-sl-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="rd-sl-text">
        <strong title={item.url}>{item.title || full}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <span className="rd-sl-state">{LABEL[item.status]}</span>
    </li>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SaveLink({
  close,
  saved,
  savedMany,
}: {
  close: () => void;
  /** Un solo enlace: se abre al guardarlo. */
  saved: (article: Saved) => void;
  /** Varios enlaces: al cerrar, si se añadió alguno nuevo. */
  savedMany: (added: number) => void;
}) {
  const [text, setText] = useState(''),
    [manual, setManual] = useState(''),
    [title, setTitle] = useState(''),
    [manualOpen, setManualOpen] = useState(false);
  const [step, setStep] = useState<Step | null>(null),
    [error, fail] = useState('');
  const [items, setItems] = useState<Item[] | null>(null),
    [running, setRunning] = useState(false),
    [stopping, setStopping] = useState(false);
  const stop = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const found = useMemo(() => findLinks(text), [text]);
  const links = found.links.slice(0, MAX);
  const busy = step !== null || running;

  // Mantiene a la vista el enlace que se está guardando.
  useEffect(() => {
    if (!running) return;
    list.current
      ?.querySelector('.rd-sl-item.reading, .rd-sl-item.saving')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [items, running]);

  async function submit() {
    if (busy || !links.length) return;
    fail('');
    if (links.length > 1) {
      setItems(links.map((url) => ({ url, status: 'queued' })));
      void run(links);
      return;
    }
    const body = manual.trim();
    setStep('reading');
    try {
      const snap = body
        ? { title: title.trim() || new URL(links[0]).hostname, content: body }
        : null;
      const { row } = await store(links[0], snap, setStep);
      saved(row);
    } catch (e) {
      fail(failure(e));
      // Si la página no se pudo leer, se despliega la opción de pegar el texto.
      if (!body) setManualOpen(true);
    } finally {
      setStep(null);
    }
  }

  const patch = (url: string, change: Partial<Item>) =>
    setItems((all) => all && all.map((it) => (it.url === url ? { ...it, ...change } : it)));

  /** Guarda los enlaces de `urls` de `PARALLEL` en `PARALLEL`. «Detener» deja de tomar nuevos. */
  async function run(urls: string[]) {
    stop.current = false;
    setStopping(false);
    setRunning(true);
    const queue = [...urls];
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift()!;
        if (stop.current) {
          patch(url, { status: 'stopped' });
          continue;
        }
        patch(url, { status: 'reading', error: undefined });
        try {
          const { row, existed } = await store(url, null, (s) => patch(url, { status: s }));
          patch(url, { status: existed ? 'exists' : 'done', title: row.title });
        } catch (e) {
          patch(url, { status: 'error', error: failure(e, true) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker));
    setRunning(false);
    setStopping(false);
  }

  function retry() {
    if (!items || running) return;
    const again = items
      .filter((i) => i.status === 'error' || i.status === 'stopped')
      .map((i) => i.url);
    setItems(
      items.map((i) => (again.includes(i.url) ? { ...i, status: 'queued', error: undefined } : i)),
    );
    void run(again);
  }

  const count = (status: Status) => items?.filter((i) => i.status === status).length ?? 0;
  const added = count('done'),
    existed = count('exists'),
    failed = count('error'),
    skipped = count('stopped');
  const total = items?.length ?? 0;
  const finished = added + existed + failed + skipped;

  /** Al cerrar: si se añadió algo, Lecturas se refresca. */
  function finish() {
    if (added) savedMany(added);
    else close();
  }

  const summary =
    !failed && !skipped && !existed
      ? plural(added, 'enlace guardado', 'enlaces guardados')
      : !added && !failed && !skipped
        ? existed === 1
          ? 'Ya lo tenías guardado'
          : 'Ya los tenías guardados'
        : [
            added && plural(added, 'guardado', 'guardados'),
            existed && plural(existed, 'ya estaba', 'ya estaban'),
            failed && `${failed} con error`,
            skipped && `${skipped} sin guardar`,
          ]
            .filter(Boolean)
            .join(' · ');

  const extras = [
    found.repeated > 0 && plural(found.repeated, 'repetido', 'repetidos'),
    found.invalid > 0 && plural(found.invalid, 'no válido', 'no válidos'),
    found.links.length > MAX && `se guardan ${MAX} por vez`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReaderDialog title="Guardar enlaces" className="rd-sl" close={finish} busy={busy}>
      {items ? (
        <div className="rd-sl-run">
          <div className="rd-sl-status" role="status" aria-live="polite">
            <div className="rd-sl-head">
              <strong>
                {running ? (
                  <LoaderCircle className="spin" size={15} />
                ) : failed || skipped ? (
                  <CircleAlert className="warn" size={15} />
                ) : (
                  <CircleCheck className="ok" size={15} />
                )}
                {running ? (stopping ? 'Deteniendo…' : 'Guardando enlaces…') : summary}
              </strong>
              <span className="rd-sl-num">
                {finished} de {total}
              </span>
            </div>
            <div
              className={'rd-sl-bar' + (running ? ' live' : failed || skipped ? ' partial' : '')}
              aria-hidden="true"
            >
              <i style={{ '--p': (100 * finished) / total } as CSSProperties} />
            </div>
          </div>
          <ul className="rd-sl-list" ref={list}>
            {items.map((item, i) => (
              <Row key={item.url} item={item} index={i} />
            ))}
          </ul>
          <footer className="rd-sl-foot">
            {running ? (
              <>
                <small>Si lo detienes, lo ya guardado se queda en Lecturas.</small>
                <button
                  type="button"
                  className="rd-sl-btn ghost"
                  autoFocus
                  disabled={stopping}
                  onClick={() => {
                    stop.current = true;
                    setStopping(true);
                  }}
                >
                  <Square size={11} fill="currentColor" /> Detener
                </button>
              </>
            ) : (
              <>
                {failed + skipped > 0 && (
                  <button type="button" className="rd-sl-btn ghost" onClick={retry}>
                    <RotateCw size={14} /> Reintentar {failed + skipped}
                  </button>
                )}
                <button type="button" className="rd-sl-btn primary" autoFocus onClick={finish}>
                  Listo
                </button>
              </>
            )}
          </footer>
        </div>
      ) : (
        <form
          className="rd-sl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="rd-sl-field">
            <textarea
              data-initial-focus
              aria-label="Enlaces"
              placeholder="Pega uno o varios enlaces…"
              spellCheck={false}
              rows={3}
              value={text}
              readOnly={busy}
              onChange={(e) => {
                setText(e.target.value);
                fail('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="rd-sl-meta" aria-live="polite">
              {links.length ? (
                <>
                  <span className="rd-sl-chip" key={links.length}>
                    <Link2 size={12} /> {plural(links.length, 'enlace', 'enlaces')}
                  </span>
                  {extras && <span>{extras}</span>}
                  <kbd className="rd-sl-kbd">{MAC ? '⌘' : 'Ctrl'} ↵</kbd>
                </>
              ) : text.trim() ? (
                <span className="warn">No hay enlaces válidos.</span>
              ) : (
                <span>Uno por línea o una lista entera: se detectan solos.</span>
              )}
            </div>
          </div>
          {links.length <= 1 && (
            <details
              className="rd-sl-manual"
              open={manualOpen}
              onToggle={(e) => setManualOpen(e.currentTarget.open)}
            >
              <summary>
                <ChevronRight size={14} /> Pegar el texto a mano
              </summary>
              <div>
                <input
                  aria-label="Título"
                  placeholder="Título (opcional)"
                  value={title}
                  readOnly={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  aria-label="Texto del artículo"
                  placeholder="Texto del artículo"
                  value={manual}
                  readOnly={busy}
                  onChange={(e) => setManual(e.target.value)}
                />
              </div>
            </details>
          )}
          {error && (
            <p role="alert" className="rd-sl-error">
              <CircleAlert size={15} /> <span>{error}</span>
            </p>
          )}
          <footer className="rd-sl-foot">
            <small>La captura envía los enlaces a Jina Reader.</small>
            <button
              className={'rd-sl-btn primary' + (step ? ' busy' : '')}
              disabled={busy || !links.length}
            >
              {step ? (
                <>
                  <LoaderCircle className="spin" size={15} />
                  {step === 'reading' ? 'Leyendo la página…' : 'Guardando…'}
                </>
              ) : links.length > 1 ? (
                `Guardar ${links.length} enlaces`
              ) : (
                'Guardar artículo'
              )}
            </button>
          </footer>
        </form>
      )}
    </ReaderDialog>
  );
}

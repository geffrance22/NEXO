import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  FileText,
  Highlighter,
  LoaderCircle,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { errorMessage, shortDate } from '../lib/format';
import { AiText, MarkNote } from './AiText';
import { inkOf } from './ArticleMarks';
import './notebooks.css';

type Book = { id: string; name: string; sources: number; notes: number };
type RawBook = {
  id: string;
  name: string;
  reading_book_articles?: unknown[] | null;
  reading_book_notes?: unknown[] | null;
};
type Source = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  minutes: number | null;
};
type RawSource = { reading_id: string; readings: Omit<Source, 'id'> | null };
type Kind = 'nota' | 'pregunta';
type Note = { id: string; kind: Kind; body: string; created_at: string };
type Mark = { id: string; reading_id: string; quote: string | null; note: string; color: string };
type Pick = { id: string; title: string; url: string; minutes: number | null };
type Answer = { id: number; q: string; text: string; saved: boolean };
type Tab = 'sources' | 'notes' | 'ai';

/** Último cuaderno abierto: se reabre al volver. */
const LAST = 'nexo-notebook';
/** Resaltados visibles por fuente antes de «Ver todos». */
const PREVIEW = 3;
const PROMPTS = [
  {
    label: 'Resumir',
    q: 'Resume el cuaderno: de qué tratan las fuentes, sus ideas principales y lo que dicen mis notas.',
  },
  {
    label: 'Ideas clave',
    q: 'Enumera las ideas clave del cuaderno, cada una con la fuente de la que sale.',
  },
  {
    label: 'Contradicciones',
    q: '¿En qué se contradicen o se tensionan las fuentes entre sí? Di qué sostiene cada una.',
  },
  {
    label: 'Preguntas abiertas',
    q: '¿Qué preguntas quedan abiertas después de estas fuentes y mis notas?',
  },
  {
    label: 'Qué falta investigar',
    q: '¿Qué falta investigar o leer para completar este tema? Sugiere ángulos y búsquedas concretas.',
  },
];
const IDEAS = ['Diseño de producto', 'Salud y hábitos', 'Finanzas personales'];

const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const byName = (a: Book, b: Book) => a.name.localeCompare(b.name, 'es');

/**
 * Cuadernos: reúnen artículos sobre un tema con sus resaltados, tus notas y preguntas, y le
 * preguntan a la IA por el conjunto (resumen, ideas clave, contradicciones…).
 */
export function Notebooks({ open, back }: { open: (id: string) => void; back: () => void }) {
  const { confirm, notify } = useApp();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [book, setBook] = useState(() => localStorage.getItem(LAST) ?? '');
  const [tab, setTab] = useState<Tab>('sources');
  const [error, fail] = useState('');
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<Source[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [rev, reload] = useState(0);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [needle, setNeedle] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [kind, setKind] = useState<Kind>('nota');
  const [draft, setDraft] = useState('');
  const [noteFilter, setNoteFilter] = useState<'todas' | Kind>('todas');
  const [edit, setEdit] = useState<{ id: string; body: string } | null>(null);

  const [ask, setAsk] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [thinking, setThinking] = useState('');
  const [aiError, setAiError] = useState('');

  const current = books?.find((b) => b.id === book) ?? null;
  // Cuaderno abierto ahora (para descartar respuestas que llegan después de cambiar).
  const openBook = useRef(book);
  openBook.current = book;

  useEffect(() => {
    if (book) localStorage.setItem(LAST, book);
  }, [book]);

  // La lista de cuadernos, con cuántas fuentes y notas tiene cada uno.
  useEffect(() => {
    let alive = true;
    supabase
      .from('reading_books')
      .select('id,name,reading_book_articles(reading_id),reading_book_notes(id)')
      .order('name')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) return fail(error.message);
        const list = ((data ?? []) as RawBook[]).map((b) => ({
          id: b.id,
          name: b.name,
          sources: b.reading_book_articles?.length ?? 0,
          notes: b.reading_book_notes?.length ?? 0,
        }));
        setBooks(list);
        setBook((v) => (list.some((b) => b.id === v) ? v : (list[0]?.id ?? '')));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Fuentes, resaltados y notas del cuaderno abierto. Al cambiar de cuaderno se limpia todo.
  const shown = useRef('');
  // Recién creado: se abre con el buscador de fuentes a la vista.
  const pickNext = useRef(false);
  useEffect(() => {
    let alive = true;
    if (shown.current !== book) {
      shown.current = book;
      setSources([]);
      setMarks([]);
      setNotes([]);
      setExpanded({});
      setAnswers([]);
      setAsk('');
      setAiError('');
      setDraft('');
      setEdit(null);
      setNeedle('');
      setPicking(pickNext.current);
      pickNext.current = false;
      setRenaming(null);
      setNoteFilter('todas');
    }
    if (!book) return;
    setLoading(true);
    (async () => {
      const [s, n] = await Promise.all([
        supabase
          .from('reading_book_articles')
          .select('reading_id,readings(title,url,cover,minutes)')
          .eq('book_id', book),
        supabase
          .from('reading_book_notes')
          .select('id,kind,body,created_at')
          .eq('book_id', book)
          .order('created_at', { ascending: false }),
      ]);
      if (s.error || n.error) throw s.error || n.error;
      const rows = ((s.data ?? []) as unknown as RawSource[])
        .filter((r) => r.readings)
        .map((r) => ({ ...r.readings!, id: r.reading_id }))
        .sort((a, b) => a.title.localeCompare(b.title, 'es'));
      let found: Mark[] = [];
      if (rows.length) {
        const m = await supabase
          .from('reading_marks')
          .select('id,reading_id,quote,note,color')
          .in(
            'reading_id',
            rows.map((r) => r.id),
          )
          .order('start_offset');
        if (m.error) throw m.error;
        found = (m.data ?? []) as Mark[];
      }
      if (!alive) return;
      setSources(rows);
      setNotes((n.data ?? []) as Note[]);
      setMarks(found);
    })()
      .catch((e) => alive && fail(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [book, rev]);

  // Buscador de artículos para añadir (sin texto: los más recientes).
  useEffect(() => {
    if (!picking) return;
    let alive = true;
    const text = needle.trim();
    setPickLoading(true);
    const t = setTimeout(
      async () => {
        const base = supabase.from('reading_cards').select('id,title,url,minutes');
        const { data, error } = await (text ? base.ilike('title', `%${text}%`) : base)
          .order('created_at', { ascending: false })
          .limit(24);
        if (!alive) return;
        setPickLoading(false);
        if (error) fail(error.message);
        else setPicks((data ?? []) as Pick[]);
      },
      text ? 200 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [picking, needle]);

  const marksBy = useMemo(() => {
    const map = new Map<string, Mark[]>();
    for (const m of marks) {
      if (!m.quote?.trim()) continue;
      const list = map.get(m.reading_id);
      if (list) list.push(m);
      else map.set(m.reading_id, [m]);
    }
    return map;
  }, [marks]);
  const markCount = useMemo(
    () => [...marksBy.values()].reduce((n, l) => n + l.length, 0),
    [marksBy],
  );
  const questions = notes.filter((n) => n.kind === 'pregunta').length;
  const shownNotes = noteFilter === 'todas' ? notes : notes.filter((n) => n.kind === noteFilter);
  const shownPicks = picks.filter((p) => !sources.some((s) => s.id === p.id)).slice(0, 8);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    fail('');
    try {
      return await fn();
    } catch (e) {
      fail(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  /** Ajusta los contadores del cuaderno abierto en la fila de cuadernos. */
  const count = (key: 'sources' | 'notes', delta: number) =>
    setBooks(
      (list) =>
        list?.map((b) => (b.id === book ? { ...b, [key]: Math.max(0, b[key] + delta) } : b)) ??
        list,
    );
  const copy = (text: string, done: string) =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => notify(done))
      .catch(() => fail('No se pudo copiar.'));

  const createBook = (name: string) =>
    run(async () => {
      const { data, error } = await supabase
        .from('reading_books')
        .insert({ name })
        .select('id,name')
        .single();
      if (error) throw error;
      setBooks((list) =>
        [...(list ?? []), { id: data.id, name: data.name, sources: 0, notes: 0 }].sort(byName),
      );
      pickNext.current = true;
      setBook(data.id);
      setTab('sources');
      setCreating(false);
      setNewName('');
    });

  const renameBook = (name: string) =>
    run(async () => {
      const { error } = await supabase.from('reading_books').update({ name }).eq('id', book);
      if (error) throw error;
      setBooks(
        (list) => list?.map((b) => (b.id === book ? { ...b, name } : b)).sort(byName) ?? list,
      );
      setRenaming(null);
    });

  async function deleteBook() {
    if (!current) return;
    const ok = await confirm({
      title: `¿Eliminar el cuaderno «${current.name.slice(0, 60)}»?`,
      message:
        'Se borran sus notas y preguntas. Los artículos y sus resaltados siguen en Lecturas.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    await run(async () => {
      const { error } = await supabase.from('reading_books').delete().eq('id', current.id);
      if (error) throw error;
      const rest = (books ?? []).filter((b) => b.id !== current.id);
      setBooks(rest);
      setBook(rest[0]?.id ?? '');
      if (!rest.length) localStorage.removeItem(LAST);
      notify(`Cuaderno «${current.name.slice(0, 60)}» eliminado.`);
    });
  }

  const addSource = (p: Pick) =>
    run(async () => {
      const { error } = await supabase
        .from('reading_book_articles')
        .insert({ book_id: book, reading_id: p.id });
      if (error) throw error;
      // Aparece al instante; la recarga trae la portada y los resaltados.
      setSources((list) =>
        [...list, { id: p.id, title: p.title, url: p.url, cover: null, minutes: p.minutes }].sort(
          (a, b) => a.title.localeCompare(b.title, 'es'),
        ),
      );
      count('sources', 1);
      reload((v) => v + 1);
    });

  const removeSource = (s: Source) =>
    run(async () => {
      const { error } = await supabase
        .from('reading_book_articles')
        .delete()
        .eq('book_id', book)
        .eq('reading_id', s.id);
      if (error) throw error;
      setSources((list) => list.filter((x) => x.id !== s.id));
      setMarks((list) => list.filter((m) => m.reading_id !== s.id));
      count('sources', -1);
      notify(`«${s.title.slice(0, 50)}» salió del cuaderno.`);
    });

  const addNote = (k: Kind, body: string) =>
    run(async () => {
      const { data, error } = await supabase
        .from('reading_book_notes')
        .insert({ book_id: book, kind: k, body })
        .select('id,kind,body,created_at')
        .single();
      if (error) throw error;
      setNotes((list) => [data as Note, ...list]);
      count('notes', 1);
      return true;
    });

  async function submitNote() {
    const body = draft.trim();
    if (!body || busy) return;
    if (await addNote(kind, body)) setDraft('');
  }

  async function saveEdit() {
    if (!edit || busy) return;
    const body = edit.body.trim();
    if (!body) return;
    await run(async () => {
      const { error } = await supabase
        .from('reading_book_notes')
        .update({ body })
        .eq('id', edit.id);
      if (error) throw error;
      setNotes((list) => list.map((n) => (n.id === edit.id ? { ...n, body } : n)));
      setEdit(null);
    });
  }

  async function deleteNote(n: Note) {
    const ok = await confirm({
      title: n.kind === 'pregunta' ? '¿Eliminar esta pregunta?' : '¿Eliminar esta nota?',
      message: n.body.slice(0, 140) + (n.body.length > 140 ? '…' : ''),
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    await run(async () => {
      const { error } = await supabase.from('reading_book_notes').delete().eq('id', n.id);
      if (error) throw error;
      setNotes((list) => list.filter((x) => x.id !== n.id));
      count('notes', -1);
    });
  }

  async function ai(question: string, label = question) {
    const q = question.trim();
    if (!q || thinking || !book) return;
    const at = book;
    setTab('ai');
    setThinking(label);
    setAiError('');
    try {
      const { data, error } = await supabase.functions.invoke('assistant', {
        body: { mode: 'notebook', bookId: at, question: q.slice(0, 1500) },
      });
      if (error) {
        let detail = '';
        try {
          detail = (await (error as { context?: Response }).context?.json())?.error ?? '';
        } catch {
          /* sin detalle */
        }
        throw Error(
          detail ||
            'No se pudo consultar el cuaderno. Comprueba el despliegue de assistant y tu cuota.',
        );
      }
      if (!data?.answer) throw Error('La IA no respondió. Inténtalo de nuevo.');
      if (openBook.current !== at) return;
      setAnswers((list) => [
        { id: Date.now(), q: label, text: data.answer, saved: false },
        ...list,
      ]);
      setAsk((v) => (v.trim() === q ? '' : v));
    } catch (e) {
      if (openBook.current === at) setAiError(errorMessage(e));
    } finally {
      setThinking('');
    }
  }

  async function keepAnswer(a: Answer) {
    // Mismo formato que las preguntas guardadas en los resaltados: «✦ pregunta» y la respuesta.
    const body = `✦ ${a.q.replace(/\s+/g, ' ').slice(0, 240)}\n${a.text}`.slice(0, 8000);
    if (await addNote('nota', body)) {
      setAnswers((list) => list.map((x) => (x.id === a.id ? { ...x, saved: true } : x)));
      notify('Respuesta guardada en Notas y preguntas.');
    }
  }

  const markdown = () => {
    const out = [`# ${current?.name ?? 'Cuaderno'}`];
    for (const s of sources) {
      out.push('', `## ${s.title}`, s.url);
      for (const m of marksBy.get(s.id) ?? []) {
        out.push('', `> ${m.quote!.trim().replace(/\n+/g, '\n> ')}`);
        if (m.note.trim()) out.push('', m.note.trim());
      }
    }
    if (notes.length) {
      out.push('', '## Notas y preguntas');
      for (const n of [...notes].reverse())
        out.push('', (n.kind === 'pregunta' ? '**Pregunta:** ' : '') + n.body.trim());
    }
    return out.join('\n');
  };

  const welcome = books !== null && !books.length;

  return (
    <section className="bk" aria-label="Cuadernos">
      <header className="bk-head">
        <span className="bk-mark" aria-hidden="true">
          <NotebookPen size={18} />
        </span>
        <div className="bk-title">
          {renaming !== null && current ? (
            <form
              className="bk-rename"
              onSubmit={(e) => {
                e.preventDefault();
                const v = renaming.trim();
                if (v && v !== current.name) void renameBook(v);
                else setRenaming(null);
              }}
            >
              <input
                autoFocus
                value={renaming}
                maxLength={100}
                aria-label="Nuevo nombre del cuaderno"
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  setRenaming(null);
                }}
              />
              <button
                type="submit"
                className="bk-icon"
                title="Guardar el nombre"
                aria-label="Guardar el nombre"
                disabled={busy || !renaming.trim()}
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                className="bk-icon"
                title="Cancelar"
                aria-label="Cancelar"
                onClick={() => setRenaming(null)}
              >
                <X size={16} />
              </button>
            </form>
          ) : (
            <h2>{current?.name ?? 'Cuadernos'}</h2>
          )}
          {current && renaming === null && (
            <small>
              {plural(sources.length, 'fuente', 'fuentes')} ·{' '}
              {plural(markCount, 'resaltado', 'resaltados')} ·{' '}
              {plural(notes.length, 'nota', 'notas')}
            </small>
          )}
        </div>
        {current && renaming === null && (
          <div className="bk-tools">
            <button
              type="button"
              className="bk-icon"
              title="Copiar el cuaderno en Markdown"
              aria-label="Copiar el cuaderno en Markdown"
              onClick={() => copy(markdown(), 'Cuaderno copiado en Markdown.')}
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              className="bk-icon"
              title="Cambiar el nombre"
              aria-label="Cambiar el nombre"
              onClick={() => setRenaming(current.name)}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="bk-icon danger"
              title="Eliminar el cuaderno"
              aria-label="Eliminar el cuaderno"
              disabled={busy}
              onClick={() => void deleteBook()}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
        <button
          type="button"
          className="bk-icon bk-close"
          title="Volver a Lecturas"
          aria-label="Cerrar cuadernos"
          onClick={back}
        >
          <X size={18} />
        </button>
      </header>

      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      {books === null ? (
        !error && (
          <div className="bk-loading">
            <LoaderCircle className="spin" size={18} /> Cargando cuadernos…
          </div>
        )
      ) : welcome ? (
        <div className="bk-welcome">
          <span className="bk-welcome-mark" aria-hidden="true">
            <NotebookPen size={26} />
          </span>
          <h3>Reúne tus lecturas por tema</h3>
          <p>
            Un cuaderno junta varios artículos, sus resaltados y tus notas. Luego le preguntas a la
            IA por todo el conjunto: ideas clave, contradicciones, qué falta.
          </p>
          <form
            className="bk-create"
            onSubmit={(e) => {
              e.preventDefault();
              const v = newName.trim();
              if (v) void createBook(v);
            }}
          >
            <input
              autoFocus
              value={newName}
              maxLength={100}
              placeholder="Nombre del cuaderno"
              aria-label="Nombre del cuaderno"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="bk-btn primary" disabled={busy || !newName.trim()}>
              <Plus size={15} /> Crear cuaderno
            </button>
          </form>
          <div className="bk-ideas">
            {IDEAS.map((x) => (
              <button type="button" key={x} onClick={() => setNewName(x)}>
                {x}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="bk-shelf" role="tablist" aria-label="Tus cuadernos">
            {books.map((b) => (
              <button
                type="button"
                role="tab"
                key={b.id}
                aria-selected={b.id === book}
                className={'bk-pill' + (b.id === book ? ' on' : '')}
                title={`${plural(b.sources, 'fuente', 'fuentes')} · ${plural(b.notes, 'nota', 'notas')}`}
                onClick={() => setBook(b.id)}
              >
                <span>{b.name}</span>
                <b>{b.sources}</b>
              </button>
            ))}
            {creating ? (
              <form
                className="bk-pill bk-pill-new"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = newName.trim();
                  if (v) void createBook(v);
                }}
              >
                <input
                  autoFocus
                  value={newName}
                  maxLength={100}
                  placeholder="Nombre del cuaderno"
                  aria-label="Nombre del nuevo cuaderno"
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => !newName.trim() && setCreating(false)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.preventDefault();
                    setCreating(false);
                    setNewName('');
                  }}
                />
                <button
                  type="submit"
                  aria-label="Crear el cuaderno"
                  disabled={busy || !newName.trim()}
                >
                  {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={14} />}
                </button>
              </form>
            ) : (
              <button type="button" className="bk-pill add" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nuevo
              </button>
            )}
          </div>

          <div className="bk-tabs" role="tablist" aria-label="Secciones del cuaderno">
            {(
              [
                ['sources', 'Fuentes', FileText, sources.length],
                ['notes', 'Notas y preguntas', StickyNote, notes.length],
                ['ai', 'Preguntar a la IA', Sparkles, 0],
              ] as const
            ).map(([key, label, Icon, n]) => (
              <button
                type="button"
                role="tab"
                key={key}
                aria-selected={tab === key}
                className={tab === key ? 'on' : ''}
                onClick={() => setTab(key)}
              >
                <Icon size={15} />
                <span>{label}</span>
                {n > 0 && <b>{n}</b>}
                {key === 'ai' && thinking && <LoaderCircle className="spin" size={13} />}
              </button>
            ))}
          </div>

          {tab === 'sources' && (
            <div className="bk-page">
              <div className="bk-bar">
                <p>
                  {sources.length
                    ? 'Los resaltados de cada artículo, juntos. Pulsa el título para seguir leyendo.'
                    : ''}
                </p>
                <button
                  type="button"
                  className={'bk-btn' + (picking ? ' on' : '')}
                  aria-expanded={picking}
                  onClick={() => {
                    setPicking(!picking);
                    setNeedle('');
                  }}
                >
                  {picking ? <Check size={15} /> : <Plus size={15} />}
                  {picking ? 'Listo' : 'Añadir fuente'}
                </button>
              </div>

              {picking && (
                <div className="bk-picker">
                  <label className="bk-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      autoFocus
                      value={needle}
                      placeholder="Buscar en tus lecturas por título…"
                      aria-label="Buscar un artículo para añadir"
                      onChange={(e) => setNeedle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return;
                        e.preventDefault();
                        if (needle) setNeedle('');
                        else setPicking(false);
                      }}
                    />
                    {pickLoading && <LoaderCircle className="spin" size={14} />}
                  </label>
                  <small className="bk-label">{needle.trim() ? 'Resultados' : 'Recientes'}</small>
                  {shownPicks.length ? (
                    <ul className="bk-picks">
                      {shownPicks.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={busy}
                            title="Añadir al cuaderno"
                            onClick={() => void addSource(p)}
                          >
                            <span>
                              <b>{p.title}</b>
                              <small>
                                {host(p.url)}
                                {p.minutes ? ` · ${p.minutes} min` : ''}
                              </small>
                            </span>
                            <Plus size={16} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !pickLoading && (
                      <p className="bk-muted">
                        {needle.trim()
                          ? `Nada coincide con «${needle.trim()}».`
                          : 'Ya añadiste lo más reciente. Busca por título.'}
                      </p>
                    )
                  )}
                </div>
              )}

              {loading && !sources.length ? (
                <div className="bk-skel" aria-hidden="true">
                  <i />
                  <i />
                </div>
              ) : !sources.length ? (
                !picking && (
                  <div className="bk-empty">
                    <FileText size={24} />
                    <strong>Aún no hay fuentes</strong>
                    <p>
                      Añade artículos de tu lista: sus resaltados aparecerán aquí y la IA podrá
                      cruzarlos.
                    </p>
                    <button
                      type="button"
                      className="bk-btn primary"
                      onClick={() => setPicking(true)}
                    >
                      <Plus size={15} /> Añadir la primera fuente
                    </button>
                  </div>
                )
              ) : (
                <ol className="bk-sources">
                  {sources.map((s) => {
                    const list = marksBy.get(s.id) ?? [];
                    const long = list.length > PREVIEW + 1;
                    const all = !long || expanded[s.id];
                    return (
                      <li className="bk-src" key={s.id}>
                        <div className="bk-src-head">
                          {s.cover ? (
                            <img
                              className="bk-src-cover"
                              src={s.cover}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => (e.currentTarget.hidden = true)}
                            />
                          ) : (
                            <span className="bk-src-cover blank" aria-hidden="true">
                              {(host(s.url)[0] ?? '·').toUpperCase()}
                            </span>
                          )}
                          <button
                            type="button"
                            className="bk-src-title"
                            title="Abrir el artículo"
                            onClick={() => open(s.id)}
                          >
                            <b>{s.title}</b>
                            <small>
                              {host(s.url)}
                              {s.minutes ? ` · ${s.minutes} min` : ''} ·{' '}
                              {plural(list.length, 'resaltado', 'resaltados')}
                            </small>
                          </button>
                          <button
                            type="button"
                            className="bk-icon sm"
                            title="Quitar del cuaderno"
                            aria-label={`Quitar «${s.title}» del cuaderno`}
                            disabled={busy}
                            onClick={() => void removeSource(s)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                        {list.length ? (
                          <ul className="bk-marks">
                            {(all ? list : list.slice(0, PREVIEW)).map((m) => (
                              <li key={m.id} style={{ '--mc': inkOf(m.color) } as CSSProperties}>
                                <blockquote>{m.quote!.trim()}</blockquote>
                                {m.note.trim() && <MarkNote text={m.note.trim()} />}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="bk-muted bk-src-none">
                            <Highlighter size={13} /> Sin resaltados todavía. Ábrelo y subraya lo
                            que te sirva.
                          </p>
                        )}
                        {long && (
                          <button
                            type="button"
                            className="bk-more"
                            aria-expanded={Boolean(expanded[s.id])}
                            onClick={() => setExpanded((x) => ({ ...x, [s.id]: !x[s.id] }))}
                          >
                            <ChevronDown size={14} />
                            {expanded[s.id] ? 'Ver menos' : `Ver los ${list.length} resaltados`}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="bk-page">
              <form
                className="bk-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitNote();
                }}
              >
                <div className="bk-seg" role="radiogroup" aria-label="Tipo">
                  {(['nota', 'pregunta'] as const).map((k) => (
                    <button
                      type="button"
                      role="radio"
                      key={k}
                      aria-checked={kind === k}
                      className={kind === k ? 'on' : ''}
                      onClick={() => setKind(k)}
                    >
                      {k === 'nota' ? <StickyNote size={14} /> : <CircleHelp size={14} />}
                      {k === 'nota' ? 'Nota' : 'Pregunta'}
                    </button>
                  ))}
                </div>
                <textarea
                  value={draft}
                  maxLength={8000}
                  rows={3}
                  aria-label={kind === 'nota' ? 'Texto de la nota' : 'Texto de la pregunta'}
                  placeholder={
                    kind === 'nota'
                      ? 'Una idea, una conexión entre fuentes, algo que quieras recordar…'
                      : '¿Qué quieres averiguar con estas lecturas?'
                  }
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void submitNote();
                    }
                  }}
                />
                <div className="bk-foot">
                  <small>Ctrl + Enter</small>
                  <button type="submit" className="bk-btn primary" disabled={busy || !draft.trim()}>
                    <Plus size={15} /> {kind === 'nota' ? 'Añadir nota' : 'Añadir pregunta'}
                  </button>
                </div>
              </form>

              {questions > 0 && questions < notes.length && (
                <div className="bk-chips" role="tablist" aria-label="Filtrar notas">
                  {(
                    [
                      ['todas', 'Todas', notes.length],
                      ['nota', 'Notas', notes.length - questions],
                      ['pregunta', 'Preguntas', questions],
                    ] as const
                  ).map(([key, label, n]) => (
                    <button
                      type="button"
                      role="tab"
                      key={key}
                      aria-selected={noteFilter === key}
                      className={noteFilter === key ? 'on' : ''}
                      onClick={() => setNoteFilter(key)}
                    >
                      {label}
                      <b>{n}</b>
                    </button>
                  ))}
                </div>
              )}

              {loading && !notes.length ? (
                <div className="bk-skel" aria-hidden="true">
                  <i />
                </div>
              ) : !notes.length ? (
                <div className="bk-empty small">
                  <StickyNote size={22} />
                  <strong>Sin notas todavía</strong>
                  <p>
                    Escribe lo que vas pensando o deja preguntas: luego la IA puede responderlas con
                    tus fuentes.
                  </p>
                </div>
              ) : (
                <ul className="bk-notes">
                  {shownNotes.map((n) => (
                    <li key={n.id} className={'bk-note ' + n.kind}>
                      <div className="bk-note-meta">
                        <span className="bk-kind">
                          {n.kind === 'pregunta' ? (
                            <CircleHelp size={12} />
                          ) : (
                            <StickyNote size={12} />
                          )}
                          {n.kind === 'pregunta' ? 'Pregunta' : 'Nota'}
                        </span>
                        <time dateTime={n.created_at}>{shortDate(n.created_at)}</time>
                        {n.kind === 'pregunta' && edit?.id !== n.id && (
                          <button
                            type="button"
                            className="bk-ask"
                            disabled={Boolean(thinking)}
                            onClick={() => void ai(n.body)}
                          >
                            <Sparkles size={13} /> Preguntar a la IA
                          </button>
                        )}
                        <div className="bk-note-acts">
                          <button
                            type="button"
                            className="bk-icon sm"
                            title="Editar"
                            aria-label="Editar"
                            onClick={() => setEdit({ id: n.id, body: n.body })}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="bk-icon sm"
                            title="Copiar"
                            aria-label="Copiar"
                            onClick={() => copy(n.body, 'Copiado.')}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className="bk-icon sm danger"
                            title="Eliminar"
                            aria-label="Eliminar"
                            disabled={busy}
                            onClick={() => void deleteNote(n)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {edit?.id === n.id ? (
                        <form
                          className="bk-edit"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveEdit();
                          }}
                        >
                          <textarea
                            autoFocus
                            value={edit.body}
                            maxLength={8000}
                            aria-label="Editar el texto"
                            onChange={(e) => setEdit({ id: n.id, body: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEdit(null);
                              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                void saveEdit();
                              }
                            }}
                          />
                          <div className="bk-foot">
                            <button type="button" className="bk-btn" onClick={() => setEdit(null)}>
                              Cancelar
                            </button>
                            <button
                              type="submit"
                              className="bk-btn primary"
                              disabled={busy || !edit.body.trim()}
                            >
                              <Check size={15} /> Guardar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <MarkNote text={n.body} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'ai' && (
            <div className="bk-page bk-ai">
              {!loading && !sources.length && !notes.length && (
                <p className="bk-tip">
                  Este cuaderno está vacío: añade fuentes o notas para que la IA tenga de qué
                  hablar.
                </p>
              )}
              <div className="bk-prompts">
                {PROMPTS.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    disabled={Boolean(thinking)}
                    onClick={() => void ai(p.q, p.label)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <form
                className="bk-askbox"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ai(ask);
                }}
              >
                <textarea
                  rows={1}
                  value={ask}
                  maxLength={1500}
                  placeholder="Pregunta lo que quieras sobre tus fuentes y notas…"
                  aria-label="Pregunta para la IA"
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ai(ask);
                    }
                  }}
                />
                <button
                  type="submit"
                  title="Preguntar (Enter)"
                  aria-label="Preguntar"
                  disabled={Boolean(thinking) || !ask.trim()}
                >
                  {thinking ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={16} />}
                </button>
              </form>

              {thinking && (
                <div className="bk-thinking" aria-live="polite">
                  <i />
                  <i />
                  <i />
                  <span>Leyendo el cuaderno · {thinking.slice(0, 90)}</span>
                </div>
              )}
              {aiError && (
                <p className="bk-error" role="alert">
                  {aiError}
                </p>
              )}

              {answers.length
                ? answers.map((a) => (
                    <article key={a.id} className="bk-answer">
                      <header>
                        <Sparkles size={14} />
                        <strong>{a.q}</strong>
                      </header>
                      <AiText text={a.text} />
                      <footer>
                        {a.saved ? (
                          <span className="bk-saved">
                            <Check size={14} /> Guardada en tus notas
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="bk-btn primary sm"
                            disabled={busy}
                            onClick={() => void keepAnswer(a)}
                          >
                            <BookmarkPlus size={14} /> Guardar como nota
                          </button>
                        )}
                        <button
                          type="button"
                          className="bk-btn sm"
                          onClick={() => copy(a.text, 'Respuesta copiada.')}
                        >
                          <Copy size={14} /> Copiar
                        </button>
                        <button
                          type="button"
                          className="bk-icon sm"
                          title="Quitar la respuesta"
                          aria-label="Quitar la respuesta"
                          onClick={() => setAnswers((list) => list.filter((x) => x.id !== a.id))}
                        >
                          <X size={14} />
                        </button>
                      </footer>
                    </article>
                  ))
                : !thinking && (
                    <div className="bk-empty small">
                      <Sparkles size={22} />
                      <strong>Pregúntale al cuaderno</strong>
                      <p>
                        La IA lee extractos de tus fuentes, tus resaltados y tus notas, y responde
                        citando de dónde sale cada idea.
                      </p>
                    </div>
                  )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

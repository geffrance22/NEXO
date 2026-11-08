import { formats, readableSlice } from './formatting';
import { useEffect, useMemo, useState, useRef, type CSSProperties } from 'react';
import { MarkToolbar, boxOfRange, type Box } from './MarkToolbar';
import { AI_MARK, aiNote, askReading, locateQuote, type ReadingAnswer } from './ask';
import { DEBATE_LABEL, QUESTION_LABEL, QuestionFab, type SavedAi } from './ReadingQuestion';
import { Listen } from './Listen';
import { SharePanel } from './SharePanel';
import { whoMightCare } from '../lib/interest';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { SaveLink } from './SaveLink';
import { pictures, preview } from './media';
import { ReaderDialog } from './ReaderDialog';
import { Trash2, Plus, BookOpen, Highlighter, Folder, Archive, ExternalLink } from 'lucide-react';
import { Tag, Zap, Sparkles, ChevronDown, Search, X, LoaderCircle } from 'lucide-react';
import { useLibrary, type Card } from './library';
import { Notebooks } from './Notebooks';
import { MarkGroups, useResume } from './ReadingExtras';
import { ArticleMarks, toneOf } from './ArticleMarks';
import { BookA, Check, Heart, NotebookPen, Pin } from 'lucide-react';
import { Dictionary } from './Dictionary';
import { cleanTerm, isTerm, sentenceAround, useWords } from './words';
import { ReadEnd } from './ReadEnd';
import { SpeedReader, readingAI } from './SpeedReader';
import { toHash } from '../lib/route';
import './readings.css';

type Article = {
  id: string;
  url: string;
  title: string;
  content: string;
  folder: string;
  archived: boolean;
  favorite: boolean;
  resume_at: number;
  last_read: string | null;
  question: string;
  tags?: string[];
  media?: Record<string, string>;
  pinned_at?: string | null;
  read_at?: string | null;
};
/** Fijar y «Completado» necesitan la migración 012. */
const PINS_SQL = 'supabase/migrations/202611070012_reading_pins.sql';
const missingColumn = (e: { code?: string; message: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /pinned_at|read_at/.test(e.message);
/** Mensaje claro para un fallo al guardar un resaltado. */
const markError = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23514' || /color_check/.test(err?.message ?? ''))
    return 'Para los colores nuevos ejecuta supabase/migrations/202611070011_reading_colors.sql en el SQL Editor de Supabase.';
  return err?.message || 'No se pudo guardar el resaltado.';
};
type Mark = {
  id: string;
  reading_id: string;
  start_offset: number;
  end_offset: number;
  note: string;
  color?: string;
  edited_at: string;
};
type Span = { start: number; end: number };
function endpoint(node: Node | null, offset: number) {
  if (!node) return null;
  const el = (node.nodeType === 3 ? node.parentElement : (node as Element))?.closest(
    '[data-offset]',
  );
  if (!el) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return Number(el.getAttribute('data-offset')) + r.toString().length;
}
/**
 * Posición en el texto original de una selección dentro del artículo. Si empieza o termina
 * fuera de un fragmento (arrastrar hasta el margen, triple clic), usa el primero y el último
 * fragmento que toca.
 */
function selectionSpan(root: HTMLElement, r: Range): Span | null {
  let start = root.contains(r.startContainer) ? endpoint(r.startContainer, r.startOffset) : null;
  let end = root.contains(r.endContainer) ? endpoint(r.endContainer, r.endOffset) : null;
  if (start === null || end === null) {
    const parts = Array.from(root.querySelectorAll<HTMLElement>('[data-offset]')).filter((el) =>
      r.intersectsNode(el),
    );
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    start ??= Number(parts[0].dataset.offset);
    end ??= Number(last.dataset.offset) + (last.textContent?.length ?? 0);
  }
  return end > start ? { start, end } : null;
}

export function Readings({ openId, addLink = false }: { openId?: string; addLink?: boolean } = {}) {
  const [article, setArticle] = useState<Article | null>(null),
    [marks, setMarks] = useState<Mark[]>([]),
    [id, select] = useState(openId ?? '');
  // Artículo pedido por enlace (p. ej. la recomendación del inicio): al cargarlo se muestra su
  // colección; si ya no existe, se abre Lecturas sin error.
  const linked = useRef(openId ?? '');
  const [view, setView] = useState('inbox'),
    [query, search] = useState(''),
    [adding, add] = useState(addLink);
  const [busy, working] = useState(false),
    [error, fail] = useState(''),
    [folder, setFolder] = useState('');
  const [span, setSpan] = useState<Span | null>(null),
    [note, setNote] = useState('');
  const [editing, setEditing] = useState<Mark | null>(null),
    [color, setColor] = useState('yellow'),
    [moving, setMoving] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false),
    [tagOpen, setTagOpen] = useState(false),
    [tag, setTag] = useState(''),
    [speed, setSpeed] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, string>>({}),
    [showSummary, setShowSummary] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  function anchor(rect: DOMRect | Box) {
    setBox({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
  }
  const palette = { yellow: 'Amarillo', blue: 'Azul oscuro', orange: 'Naranja' };
  // Qué abrió la barra: una selección nueva o un resaltado existente (se lee sin esperar render).
  const mode = useRef<'selection' | 'mark' | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  function inspect(m: Mark, rect?: DOMRect) {
    if (rect) anchor(rect);
    mode.current = 'mark';
    setNoteOpen(false);
    setAskOpen(false);
    setShareOpen(false);
    setSpan({ start: m.start_offset, end: m.end_offset });
    setEditing(m);
    setColor(toneOf(m.color));
    setNote(m.note);
  }
  function closeEditor(clear = false) {
    if (clear && mode.current === 'selection') window.getSelection()?.removeAllRanges();
    mode.current = null;
    setSpan(null);
    setEditing(null);
    setNoteOpen(false);
    setAskOpen(false);
    setShareOpen(false);
  }
  const [revision, bump] = useState(0),
    [books, showBooks] = useState(false),
    [askOpen, setAskOpen] = useState(false),
    [shareOpen, setShareOpen] = useState(false),
    [dict, showDict] = useState(false);
  const { notify, workspace } = useApp();
  // Diccionario de palabras y conceptos por aprender (se carga una vez).
  const dictionary = useWords(notify);
  const pendingWords = dictionary.words.filter((w) => !w.learned_at).length;
  useEffect(() => {
    const refresh = () => bump((v) => v + 1);
    window.addEventListener('nexo:link-saved', refresh);
    return () => window.removeEventListener('nexo:link-saved', refresh);
  }, []);
  // Cambios en resaltados: refrescan Anotaciones y los contadores sin recargar la lista.
  const [markRev, bumpMarks] = useState(0);
  const {
    cards: visible,
    pinned,
    more,
    load,
    loading,
    error: listError,
    filters,
    patch: patchCard,
    pin: pinCard,
  } = useLibrary(view, query, revision, markRev);
  /** Fija o suelta un artículo al instante; se guarda de fondo. */
  function togglePin(card: Card) {
    const on = !card.pinned_at;
    pinCard(card, on);
    void supabase
      .from('readings')
      .update({ pinned_at: on ? new Date().toISOString() : null })
      .eq('id', card.id)
      .then(({ error }) => {
        if (!error) return;
        pinCard(card, !on);
        notify(
          missingColumn(error)
            ? `Para fijar artículos ejecuta ${PINS_SQL} en el SQL Editor de Supabase.`
            : 'No se pudo fijar: ' + error.message,
        );
      });
  }
  /** Marca el artículo abierto como completado (o no) al instante; se guarda de fondo. */
  function markRead(done: boolean) {
    if (!article) return;
    const rid = article.id;
    const before = article.read_at ?? null;
    const at = done ? new Date().toISOString() : null;
    setArticle((a) => (a && a.id === rid ? { ...a, read_at: at } : a));
    patchCard(rid, { read_at: at });
    void supabase
      .from('readings')
      .update({ read_at: at })
      .eq('id', rid)
      .then(({ error }) => {
        if (!error) return;
        setArticle((a) => (a && a.id === rid ? { ...a, read_at: before } : a));
        patchCard(rid, { read_at: before });
        notify(
          missingColumn(error)
            ? `Para marcar lecturas como completadas ejecuta ${PINS_SQL} en el SQL Editor de Supabase.`
            : 'No se pudo guardar: ' + error.message,
        );
      });
  }

  useEffect(() => {
    let live = true;
    setArticle(null);
    setMarks([]);
    if (id) {
      (async () => {
        const [a, m] = await Promise.all([
          supabase.from('readings').select('*').eq('id', id).single(),
          loadArticleMarks(id),
        ]);
        if (a.error) {
          if (linked.current === id) {
            linked.current = '';
            if (live) select('');
            return;
          }
          throw a.error;
        }
        if (live) {
          setArticle(a.data);
          setFolder(a.data.folder);
          setMarks(m);
          if (linked.current === id) {
            linked.current = '';
            setView(a.data.archived ? 'archive' : a.data.folder ? 'f:' + a.data.folder : 'inbox');
          }
        }
      })().catch((e) => live && fail(e.message));
    }
    return () => {
      live = false;
    };
  }, [id]);
  // La URL sigue al artículo abierto: recargar la página lo vuelve a abrir.
  useEffect(() => {
    if (!window.location.hash.startsWith(toHash('Lecturas'))) return;
    const target = toHash('Lecturas', id || null);
    if (window.location.hash !== target) history.replaceState(null, '', target);
  }, [id]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more || loading || !sentinel.current) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0]?.isIntersecting) void load();
      },
      { root: sentinel.current.closest('aside'), rootMargin: '200px' },
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [more, loading, load]);
  const [deleting, setDeleting] = useState(false),
    [annotations, setAnnotations] = useState(false),
    [feedback, setFeedback] = useState('');
  // Progreso de lo que lees ahora (la lista se actualiza sin recargarla).
  const [readNow, setReadNow] = useState<Record<string, number>>({});
  useResume(
    article?.id,
    article?.resume_at || 0,
    !annotations && !books && !speed,
    fail,
    (offset) => {
      if (!article) return;
      const pct = Math.min(100, Math.round((100 * offset) / Math.max(1, article.content.length)));
      setReadNow((p) => ({ ...p, [article.id]: pct }));
    },
  );
  const total = (key: string) => (filters.counts ? ' (' + (filters.counts[key] ?? 0) + ')' : '');
  useEffect(() => {
    if (!id) return;
    /*
     * Esc va por capas: primero lo que esté abierto encima (lo maneja cada cosa), luego la barra
     * de resaltado, las etiquetas, el resumen y las anotaciones; solo al final cierra el artículo.
     */
    function escape(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      if (speed || adding || moving || deleting) return;
      if (
        document.querySelector(
          'dialog[open], .sheet-backdrop, .confirm-backdrop, .picker-backdrop, .lightbox, .nx-peek, .chat-panel, .rd-listen-pop, .rd-qf.open',
        )
      )
        return;
      // En un campo de texto (buscador, etiquetas…), Esc solo sale del campo.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
        target.blur();
        return;
      }
      e.preventDefault();
      // Con la IA abierta, Esc lo maneja la barra (pregunta si guardar la respuesta).
      if (span) {
        if (!askOpen) closeEditor(true);
      } else if (tagOpen) setTagOpen(false);
      else if (showSummary) setShowSummary(false);
      else if (annotations) setAnnotations(false);
      else open();
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [id, speed, adding, moving, deleting, span, tagOpen, askOpen, showSummary, annotations]);
  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('Copiado al portapapeles.');
    } catch {
      setFeedback('El navegador no permitió copiar el texto.');
    }
  }
  async function deleteArticle() {
    const { error } = await supabase.from('readings').delete().eq('id', id).select('id').single();
    if (error) throw error;
    bump((v) => v + 1);
    setMarks((v) => v.filter((m) => m.reading_id !== id));
    open(visible.find((a) => a.id !== id));
  }
  function open(a?: { id: string }) {
    // Al cambiar de artículo (o cerrarlo) se vacía ya: nunca se pinta el anterior en el panel nuevo.
    if ((a?.id ?? '') !== id) {
      setArticle(null);
      setMarks([]);
    }
    window.getSelection()?.removeAllRanges();
    showBooks(false);
    showDict(false);
    setSpeed(false);
    setTagOpen(false);
    setTag('');
    setShowSummary(false);
    setDeleting(false);
    setAnnotations(false);
    setFeedback('');
    select(a?.id ?? '');
    setEditing(null);
    setMoving(false);
    setFolder('');
    mode.current = null;
    setSpan(null);
    setNote('');
  }
  async function run(fn: () => Promise<void>) {
    working(true);
    fail('');
    try {
      await fn();
    } catch (e) {
      fail(e instanceof Error ? e.message : String((e as { message?: string })?.message || e));
    } finally {
      working(false);
    }
  }
  async function update(
    changes: Partial<Pick<Article, 'folder' | 'archived' | 'tags' | 'favorite' | 'question'>>,
  ) {
    if (!article) return;
    const { data, error } = await supabase
      .from('readings')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setArticle(data);
    bump((v) => v + 1);
    if (changes.favorite !== undefined || changes.question !== undefined) return;
    if (changes.tags) {
      setTag('');
      return;
    }
    open(data);
    if (changes.archived !== undefined)
      setView(data.archived ? 'archive' : data.folder ? 'f:' + data.folder : 'inbox');
    else if (view.startsWith('f:'))
      setView(data.folder ? 'f:' + data.folder : data.archived ? 'archive' : 'inbox');
  }
  const mine = useMemo(() => marks.filter((m) => m.reading_id === id), [marks, id]);
  function readSelection() {
    const root = articleRef.current;
    const s = window.getSelection();
    if (!root || !s?.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    if (!r.intersectsNode(root)) return;
    const next = selectionSpan(root, r);
    const rect = next && boxOfRange(r);
    if (!next || !rect) return;
    // La misma selección: solo se recoloca la barra.
    if (mode.current === 'selection' && span?.start === next.start && span.end === next.end) {
      setBox(rect);
      return;
    }
    mode.current = 'selection';
    setBox(rect);
    setNoteOpen(false);
    setAskOpen(false);
    setShareOpen(false);
    setEditing(null);
    setColor('yellow');
    setSpan(next);
    setNote('');
  }
  // Las funciones y el estado cambian en cada render; los escuchas globales leen lo último.
  const live = useRef({ readSelection, closeEditor, span, noteOpen, askOpen, shareOpen });
  live.current = { readSelection, closeEditor, span, noteOpen, askOpen, shareOpen };

  /*
   * Selección fluida: la barra aparece al soltar (aunque sueltes fuera del artículo), con el
   * teclado o al terminar de seleccionar en pantallas táctiles; se va sola al deseleccionar y
   * sigue al texto al desplazarte.
   */
  useEffect(() => {
    if (!article) return;
    let pressed = false;
    let timer = 0;
    let frame = 0;
    const down = (e: PointerEvent) => {
      pressed = Boolean(articleRef.current?.contains(e.target as Node));
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => live.current.readSelection());
    };
    const change = () => {
      window.clearTimeout(timer);
      const s = window.getSelection();
      if (!s?.rangeCount || s.isCollapsed) {
        const inside = document.activeElement?.closest('.rd-marktools');
        const writing = live.current.noteOpen || live.current.askOpen || live.current.shareOpen;
        if (mode.current === 'selection' && !inside && !writing) live.current.closeEditor();
        return;
      }
      if (!pressed) timer = window.setTimeout(() => live.current.readSelection(), 160);
    };
    let moving = 0;
    const follow = () => {
      cancelAnimationFrame(moving);
      moving = requestAnimationFrame(() => {
        const current = live.current.span;
        if (!current) return;
        const s = window.getSelection();
        const rect =
          mode.current === 'selection' && s?.rangeCount && !s.isCollapsed
            ? boxOfRange(s.getRangeAt(0))
            : (articleRef.current
                ?.querySelector(`[data-offset="${current.start}"]`)
                ?.getBoundingClientRect() ?? null);
        if (rect) anchor(rect);
      });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('selectionchange', change);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moving);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('selectionchange', change);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [article?.id]);
  /** Guarda la pregunta a la IA y su respuesta como nota del resaltado (nuevo o el que editas). */
  async function keepAnswer(prompt: string, answer: string) {
    const qa = aiNote(prompt, answer);
    const own = editing?.note.trim() ?? note.trim();
    working(true);
    fail('');
    try {
      await highlight(editing ? toneOf(editing.color) : 'blue', own ? `${own}\n\n${qa}` : qa);
      notify('Respuesta guardada como resaltado en el artículo.');
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar la respuesta.');
      return false;
    } finally {
      working(false);
    }
  }
  /**
   * Respuesta a la pregunta guía: se guarda como resaltado sobre la cita que la respalda (o,
   * si la IA no dio una cita que exista en el texto, sobre el primer párrafo).
   */
  async function keepQuestionAnswer(question: string, { answer, quote }: ReadingAnswer) {
    if (!article) return false;
    let at = locateQuote(article.content, quote);
    if (!at) {
      const first = Array.from(
        articleRef.current?.querySelectorAll<HTMLElement>('[data-offset]') ?? [],
      ).find((el) => (el.textContent?.trim().length ?? 0) > 20);
      if (first) {
        const start = Number(first.dataset.offset);
        at = { start, end: start + Math.min(first.textContent!.length, 220) };
      }
    }
    if (!at) {
      notify('No encontré dónde guardarla en el texto. Cópiala o selecciona un fragmento.');
      return false;
    }
    try {
      const { data, error } = await supabase
        .from('reading_marks')
        .insert({
          note: aiNote(question, answer),
          color: 'blue',
          edited_at: new Date().toISOString(),
          quote: readableSlice(article.content, at.start, at.end),
          reading_id: article.id,
          start_offset: at.start,
          end_offset: at.end,
        })
        .select()
        .single();
      if (error) throw error;
      setMarks((v) => [...v, data]);
      patchCard(article.id, (c) => ({ mark_count: c.mark_count + 1 }));
      bumpMarks((v) => v + 1);
      notify('Respuesta guardada como resaltado en el artículo.');
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar la respuesta.');
      return false;
    }
  }
  /**
   * Guarda el resaltado (nuevo o el que editas). Con `keepOpen` la barra sigue abierta sobre el
   * resaltado recién guardado (p. ej. para compartirlo con varias personas).
   */
  /*
   * Resaltados al instante: se pintan (o se quitan) ya y se guardan de fondo. Uno nuevo lleva un
   * id provisional («tmp:…») hasta que la base le da el suyo; si lo editas o lo borras antes,
   * se espera a ese id. Si el guardado falla, se deshace y se avisa.
   */
  const savedId = useRef(new Map<string, Promise<string | null>>());
  const removed = useRef(new Set<string>());
  const realId = async (markId: string) =>
    markId.startsWith('tmp:') ? ((await savedId.current.get(markId)) ?? null) : markId;
  /**
   * Guarda el resaltado (nuevo o el que editas). Con `keepOpen` la barra sigue abierta sobre el
   * resaltado (p. ej. para compartirlo con varias personas). La promesa termina al guardarse.
   */
  function highlight(chosen = color, text = note, keepOpen = false): Promise<void> {
    if (!span || !article) return Promise.resolve();
    const rid = article.id;
    const fields = {
      note: text.trim(),
      color: chosen,
      edited_at: new Date().toISOString(),
      quote: readableSlice(article.content, span.start, span.end),
    };
    const before = editing;
    const local: Mark = before
      ? { ...before, ...fields }
      : {
          ...fields,
          id: 'tmp:' + crypto.randomUUID(),
          reading_id: rid,
          start_offset: span.start,
          end_offset: span.end,
        };
    if (before) setMarks((v) => v.map((m) => (m.id === before.id ? local : m)));
    else {
      setMarks((v) => [...v, local]);
      patchCard(rid, (c) => ({ mark_count: c.mark_count + 1 }));
    }
    if (keepOpen) {
      // Desde ahora la barra edita ese resaltado (la selección ya no hace falta).
      mode.current = 'mark';
      setEditing(local);
      setColor(chosen);
      setNote(local.note);
    } else {
      closeEditor(true);
      setNote('');
    }

    let target = local.id;
    const save = (async () => {
      if (before) {
        const real = await realId(before.id);
        if (!real) throw Error('El resaltado no se llegó a guardar.');
        target = real;
        const { error } = await supabase.from('reading_marks').update(fields).eq('id', real);
        if (error) throw error;
        return real;
      }
      const { data, error } = await supabase
        .from('reading_marks')
        .insert({
          ...fields,
          reading_id: rid,
          start_offset: local.start_offset,
          end_offset: local.end_offset,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    })();
    if (!before)
      savedId.current.set(
        local.id,
        save.catch(() => null),
      );

    return save.then(
      (real) => {
        bumpMarks((v) => v + 1);
        if (before) return;
        // Solo cambia el id: lo que ves ya es lo último que pediste.
        setMarks((v) => v.map((m) => (m.id === local.id ? { ...m, id: real } : m)));
        setEditing((e) => (e?.id === local.id ? { ...e, id: real } : e));
        // Lo borraste mientras se guardaba: se borra también en la base.
        if (removed.current.has(local.id))
          void supabase.from('reading_marks').delete().eq('id', real);
      },
      (e) => {
        if (before) {
          setMarks((v) => v.map((m) => (m.id === target || m.id === before.id ? before : m)));
          setEditing((x) => (x && (x.id === target || x.id === before.id) ? before : x));
        } else {
          // Ya lo habías quitado: no hay nada que deshacer ni avisar.
          if (removed.current.has(local.id)) return;
          setMarks((v) => v.filter((m) => m.id !== local.id));
          setEditing((x) => (x?.id === local.id ? null : x));
          patchCard(rid, (c) => ({ mark_count: Math.max(0, c.mark_count - 1) }));
        }
        throw Error(markError(e));
      },
    );
  }
  /** Quita el resaltado al instante y lo borra de fondo (si falla, vuelve). */
  function removeMark(m: Mark) {
    const rid = m.reading_id;
    setMarks((v) => v.filter((x) => x.id !== m.id));
    patchCard(rid, (c) => ({ mark_count: Math.max(0, c.mark_count - 1) }));
    closeEditor();
    if (m.id.startsWith('tmp:')) {
      // Aún no tiene id real: se borra en cuanto se guarde (o nada, si no se llega a guardar).
      removed.current.add(m.id);
      return;
    }
    void supabase
      .from('reading_marks')
      .delete()
      .eq('id', m.id)
      .then(({ error }) => {
        if (!error) {
          bumpMarks((v) => v + 1);
          return;
        }
        setMarks((v) => (v.some((x) => x.id === m.id) ? v : [...v, m]));
        patchCard(rid, (c) => ({ mark_count: c.mark_count + 1 }));
        notify('No se pudo quitar el resaltado: ' + error.message);
      });
  }
  /** Para la barra: pinta ya y avisa solo si el guardado de fondo falla. */
  const highlightNow = (chosen?: string, text?: string) =>
    void highlight(chosen, text).catch((e: Error) => notify(e.message));
  /** Deja el fragmento resaltado con una línea de para quién era («→ Para Laura»). */
  async function keepShareMark(line: string) {
    const prev = (editing ? editing.note : note).trim();
    if (prev.split('\n').includes(line)) return;
    try {
      await highlight(
        editing ? toneOf(editing.color) : 'yellow',
        prev ? `${prev}\n${line}` : line,
        true,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar el resaltado.');
    }
  }
  function body(a: Article) {
    const images = pictures(a.content);
    const rules = formats(a.content);
    const cuts = new Set([
      0,
      a.content.length,
      ...Array.from(a.content.matchAll(/\n+/g), (m) => m.index! + m[0].length),
      ...rules.flatMap((r) => [r.start, r.end]),
      ...mine.flatMap((m) => [m.start_offset, m.end_offset]),
      ...images.flatMap((i) => [i.index!, i.index! + i[0].length]),
    ]);
    const points = [...cuts].sort((x, y) => x - y);
    return points.slice(0, -1).map((p, i) => {
      const img = images.find((x) => x.index === p);
      if (img)
        return (
          <img
            key={p}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={a.media?.[img[2]] || img[2]}
            alt={img[1]}
          />
        );
      if (images.some((x) => p > x.index! && p < x.index! + x[0].length)) return null;
      const styles = rules.filter((r) => r.start <= p && r.end > p);
      if (styles.some((r) => r.kind === 'hidden')) return null;
      const marked = mine.find((m) => m.start_offset <= p && m.end_offset > p);
      return (
        <span
          key={p}
          data-offset={p}
          className={[
            ...styles.map((r) => 'rd-f-' + r.kind),
            marked ? 'lit ' + (marked.color || 'yellow') : '',
          ].join(' ')}
          role={marked ? 'button' : undefined}
          tabIndex={marked ? 0 : undefined}
          onClick={(e) => {
            if (marked && window.getSelection()?.isCollapsed)
              inspect(marked, e.currentTarget.getBoundingClientRect());
          }}
          onKeyDown={(e) => {
            if (marked && e.key === 'Enter')
              inspect(marked, e.currentTarget.getBoundingClientRect());
          }}
        >
          {a.content.slice(p, points[i + 1])}
        </span>
      );
    });
  }
  // El artículo solo se vuelve a pintar si cambian él o sus resaltados: abrir la barra es instantáneo.
  const rendered = useMemo(() => (article ? body(article) : null), [article, mine]);
  // A quién le puede interesar el fragmento seleccionado (el título da contexto).
  const spanText = article && span ? readableSlice(article.content, span.start, span.end) : '';
  // Diccionario: el término seleccionado (solo palabras o conceptos, no párrafos).
  const term = cleanTerm(spanText);
  const wordSaved = isTerm(term) ? dictionary.find(term) : undefined;
  function toggleWord() {
    if (!article || !span || !isTerm(term)) return;
    if (wordSaved) {
      dictionary.remove(wordSaved, false);
      notify(`«${wordSaved.term.slice(0, 40)}» salió de tu diccionario.`);
      return;
    }
    // Se guarda con la frase donde apareció, para recordar en qué sentido se usaba.
    const around = sentenceAround(article.content, span.start, span.end);
    const added = dictionary.add({
      term,
      context: readableSlice(article.content, around.start, around.end),
      reading_id: article.id,
      source: article.title,
    });
    if (added)
      notify(`«${added.term.slice(0, 40)}» va a tu diccionario.`, {
        label: 'Ver',
        icon: 'open',
        run: () => {
          closeEditor(true);
          select('');
          showBooks(false);
          showDict(true);
        },
      });
  }
  const interested = useMemo(
    () => (spanText ? whoMightCare(spanText, workspace.people, article?.title ?? '') : []),
    [spanText, workspace.people, article?.title],
  );
  // «Ver en el texto» desde Anotaciones: al volver al artículo, lleva al resaltado y lo destaca.
  const jumpTo = useRef<number | null>(null);
  const flashAt = (at: number) => {
    const el = articleRef.current?.querySelector<HTMLElement>(`[data-offset="${at}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('rd-flash');
    window.setTimeout(() => el.classList.remove('rd-flash'), 1800);
  };
  useEffect(() => {
    if (annotations || jumpTo.current === null) return;
    const at = jumpTo.current;
    jumpTo.current = null;
    flashAt(at);
  }, [annotations, rendered]);
  function jump(at: number) {
    if (annotations) {
      jumpTo.current = at;
      setAnnotations(false);
    } else flashAt(at);
  }
  // Lo guardado desde el botón flotante: respuestas a la pregunta guía y contraargumentos.
  const fabSaved = useMemo<SavedAi[]>(
    () =>
      mine.flatMap((m) => {
        const note = m.note.trim();
        if (!note.startsWith(AI_MARK)) return [];
        const [first, ...rest] = note.slice(AI_MARK.length).split('\n');
        const debate = first.startsWith(DEBATE_LABEL);
        const guide =
          first.startsWith(QUESTION_LABEL) ||
          Boolean(article?.question && first.trim() === article.question.trim());
        if (!debate && !guide) return [];
        return [
          {
            id: m.id,
            kind: debate ? ('debate' as const) : ('pregunta' as const),
            title: debate ? 'Contraargumentos' : first.replace(QUESTION_LABEL, '').trim(),
            body: rest
              .join('\n')
              .split(/\n{2,}(?=✦ )/)[0]
              .trim(),
            start: m.start_offset,
            date: m.edited_at,
          },
        ];
      }),
    [mine, article?.question],
  );
  // Fijados arriba (sin repetirse abajo) y luego el resto, del más reciente al más antiguo.
  const listed =
    view === 'marks'
      ? []
      : [...pinned, ...visible.filter((c) => !pinned.some((p) => p.id === c.id))];
  return (
    <section className="readings" data-open={!!article || books || dict}>
      <aside>
        {/* Encabezado fijo: colección, cuadernos, guardar enlace y buscador. */}
        <div className="rd-side-head">
          <div className="read-tools">
            <label className="rd-view" title="Colección">
              <select
                aria-label="Colección"
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  open();
                }}
              >
                <option value="inbox">Por leer{total('inbox')}</option>
                <option value="favorites">Favoritos{total('favorites')}</option>
                <option value="archive">Archivados{total('archive')}</option>
                <option value="marks">Anotaciones{total('marks')}</option>
                {filters.tags.map((t) => (
                  <option key={'t:' + t} value={'t:' + t}>
                    Etiqueta · {t}
                    {total('t:' + t)}
                  </option>
                ))}
                {filters.folders.map((f) => (
                  <option key={f} value={'f:' + f}>
                    {f}
                    {total('f:' + f)}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            <button
              title="Cuadernos"
              aria-label="Cuadernos"
              aria-pressed={books}
              onClick={() => {
                select('');
                showDict(false);
                showBooks(true);
              }}
            >
              <NotebookPen size={18} />
            </button>
            <button
              className="rd-dict-btn"
              title={
                pendingWords
                  ? `Diccionario · ${pendingWords} por aprender`
                  : 'Diccionario: palabras y conceptos por aprender'
              }
              aria-label="Diccionario"
              aria-pressed={dict}
              onClick={() => {
                select('');
                showBooks(false);
                showDict(true);
              }}
            >
              <BookA size={18} />
              {pendingWords > 0 && (
                <i className="rd-dict-count">{pendingWords > 99 ? '99+' : pendingWords}</i>
              )}
            </button>
            <button
              className="rd-add"
              title="Guardar enlace"
              aria-label="Guardar enlace"
              onClick={() => {
                fail('');
                add(true);
              }}
            >
              <Plus size={18} />
            </button>
          </div>
          <label className="rd-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Buscar artículos"
              placeholder={view === 'marks' ? 'Buscar en tus anotaciones…' : 'Buscar artículos…'}
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  search('');
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="rd-search-x"
                aria-label="Borrar la búsqueda"
                onClick={() => search('')}
              >
                <X size={14} />
              </button>
            ) : (
              loading && <LoaderCircle className="spin rd-search-spin" size={14} />
            )}
          </label>
        </div>
        {adding && (
          <SaveLink
            close={() => add(false)}
            saved={(a) => {
              bump((v) => v + 1);
              setView(a.archived ? 'archive' : a.folder ? 'f:' + a.folder : 'inbox');
              search('');
              open(a);
              add(false);
            }}
          />
        )}
        {view === 'marks' && (
          <MarkGroups
            query={query}
            current={annotations ? id : ''}
            revision={revision + markRev}
            open={(reading) => {
              open({ id: reading });
              setAnnotations(true);
            }}
          />
        )}
        {pinned.length > 0 && view !== 'marks' && (
          <small className="rd-pinned-label">
            <Pin size={12} aria-hidden="true" /> Fijados
          </small>
        )}
        {listed.map((a, i, all) => {
          const done = Boolean(a.read_at);
          const pct = done ? 100 : (readNow[a.id] ?? a.progress ?? 0);
          const full = done || pct >= 95;
          // Separa los fijados del resto.
          const lastPinned = Boolean(a.pinned_at) && !all[i + 1]?.pinned_at;
          return (
            <div
              key={a.id}
              className={
                'rd-row' + (a.pinned_at ? ' pinned' : '') + (lastPinned ? ' last-pinned' : '')
              }
            >
              <button
                className={'read-row' + (id === a.id ? ' current' : '') + (done ? ' read' : '')}
                onClick={() => open(a)}
              >
                {pct > 0 && (
                  <i
                    className={'rd-progress' + (full ? ' done' : '')}
                    style={{ '--p': Math.max(4, pct) } as CSSProperties}
                    title={done ? 'Completado' : full ? 'Leído' : `Llevas el ${pct}%`}
                    aria-label={done ? 'Completado' : full ? 'Leído' : `Leído al ${pct}%`}
                  />
                )}
                {a.cover && (
                  <img
                    className="rd-thumb"
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => (e.currentTarget.hidden = true)}
                    src={a.cover}
                  />
                )}
                <strong>{a.title}</strong>
                <small className="rd-cardmeta">
                  <span className="rd-domain">{new URL(a.url).hostname}</span>
                  <span className="rd-minutes" title="Tiempo estimado de lectura">
                    {a.minutes} min
                  </span>
                  {a.mark_count > 0 && (
                    <span className="rd-count" title="Resaltados">
                      <Highlighter size={12} /> {a.mark_count}
                    </span>
                  )}
                  {done && (
                    <span className="rd-readmark" title="Completado">
                      <Check size={12} strokeWidth={2.6} />
                    </span>
                  )}
                </small>
                <span className="rd-preview">{preview(a.excerpt || '').slice(0, 160)}</span>
              </button>
              <button
                type="button"
                className="rd-pin"
                aria-pressed={Boolean(a.pinned_at)}
                title={a.pinned_at ? 'Desfijar' : 'Fijar arriba'}
                aria-label={a.pinned_at ? `Desfijar «${a.title}»` : `Fijar «${a.title}» arriba`}
                onClick={() => togglePin(a)}
              >
                <Pin size={14} fill={a.pinned_at ? 'currentColor' : 'none'} />
              </button>
            </div>
          );
        })}
        <div ref={sentinel} />
        {more && (
          <button disabled={loading} onClick={() => void load()}>
            Más artículos
          </button>
        )}
        {listError && <p role="alert">{listError}</p>}
        {view !== 'marks' && !loading && !visible.length && !pinned.length && (
          <p>Sin artículos en esta vista.</p>
        )}
      </aside>
      {/* Claves distintas para cada hermano: si se repiten, React no sabe cuál quitar. */}
      <main key={'reader:' + id}>
        {error && <p role="alert">{error}</p>}
        {books ? (
          <Notebooks open={(id) => open({ id })} back={() => showBooks(false)} />
        ) : dict ? (
          <Dictionary api={dictionary} open={(id) => open({ id })} back={() => showDict(false)} />
        ) : article ? (
          <>
            <button className="read-back" onClick={() => open()}>
              ← Lista
            </button>
            <div
              className="read-tools rd-articlebar"
              role="group"
              aria-label="Acciones del artículo"
            >
              <a
                title="Ver original"
                aria-label="Ver original"
                href={article.url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
              </a>
              <button
                disabled={busy}
                aria-label="Favorito"
                title="Favorito"
                aria-pressed={article.favorite}
                onClick={() => void run(() => update({ favorite: !article.favorite }))}
              >
                <Heart size={17} fill={article.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                disabled={busy}
                title={article.archived ? 'Desarchivar' : 'Archivar'}
                aria-label={article.archived ? 'Desarchivar' : 'Archivar'}
                onClick={() => void run(() => update({ archived: !article.archived }))}
              >
                <Archive size={16} />
              </button>
              <button
                title={article.folder || 'Carpeta'}
                aria-label="Mover a carpeta"
                onClick={() => setMoving(true)}
              >
                <Folder size={16} />
              </button>
              <button
                title="Etiquetas"
                aria-label="Etiquetas"
                aria-expanded={tagOpen}
                onClick={() => setTagOpen(!tagOpen)}
              >
                <Tag size={16} />
              </button>
              <button
                aria-pressed={annotations}
                onClick={() => {
                  setAnnotations(!annotations);
                  setFeedback('');
                }}
              >
                <Highlighter size={16} />
                {annotations ? 'Volver al texto' : 'Anotaciones (' + mine.length + ')'}
              </button>
              <button
                disabled={busy}
                title="Resumir con IA"
                onClick={() => {
                  if (summaries[id]) setShowSummary(!showSummary);
                  else
                    void run(async () => {
                      const { summary } = await readingAI(id, 'summary');
                      setSummaries((v) => ({ ...v, [id]: summary }));
                      setShowSummary(true);
                    });
                }}
              >
                <Sparkles size={16} /> Resumen
              </button>
              <button onClick={() => setSpeed(true)}>
                <Zap size={16} /> Lectura rápida
              </button>
              {!annotations && (
                <Listen
                  article={articleRef}
                  pane={() => document.querySelector<HTMLElement>('.readings > main')}
                />
              )}
              <button
                aria-label="Eliminar artículo"
                title="Eliminar artículo"
                onClick={() => {
                  fail('');
                  setDeleting(true);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {deleting && (
              <ReaderDialog title="Eliminar artículo" close={() => setDeleting(false)} busy={busy}>
                <p>Se eliminarán «{article.title}» y sus resaltados y notas.</p>
                <button disabled={busy} onClick={() => setDeleting(false)}>
                  Cancelar
                </button>
                <button disabled={busy} onClick={() => void run(deleteArticle)}>
                  Eliminar artículo
                </button>
                {error && <p role="alert">{error}</p>}
              </ReaderDialog>
            )}
            {tagOpen && (
              <div className="rd-tagbox">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = tag.trim();
                    if (value && !article.tags?.includes(value))
                      void run(() => update({ tags: [...(article.tags || []), value] }));
                  }}
                >
                  <input
                    autoFocus
                    maxLength={48}
                    placeholder="Nueva etiqueta"
                    aria-label="Nueva etiqueta"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  <button disabled={busy || !tag.trim()}>Añadir</button>
                </form>
                {article.tags?.map((t) => (
                  <button
                    key={t}
                    disabled={busy}
                    aria-label={'Quitar etiqueta ' + t}
                    onClick={() =>
                      void run(() => update({ tags: article.tags?.filter((x) => x !== t) }))
                    }
                  >
                    {t} ×
                  </button>
                ))}
              </div>
            )}
            {showSummary && summaries[id] && (
              <section className="rd-summary">
                <h3>Resumen</h3>
                <p>{summaries[id]}</p>
              </section>
            )}
            {speed && (
              <SpeedReader key={id} id={id} text={article.content} close={() => setSpeed(false)} />
            )}
            {moving && (
              <ReaderDialog title="Mover a carpeta" close={() => setMoving(false)}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => update({ folder: folder.trim() }));
                  }}
                >
                  <label>
                    Carpeta
                    <input
                      list="read-folders"
                      value={folder}
                      placeholder="Sin carpeta"
                      onChange={(e) => setFolder(e.target.value)}
                    />
                  </label>
                  <datalist id="read-folders">
                    {filters.folders.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </datalist>
                  <button disabled={busy || folder.trim() === article.folder}>Mover</button>
                </form>
              </ReaderDialog>
            )}
            {article.last_read && Date.now() - Date.parse(article.last_read) > 2 * 86400000 && (
              <details className="rd-summary">
                <summary>Retomar la lectura</summary>
                <p>{readableSlice(article.content, article.resume_at, article.resume_at + 240)}</p>
                {[...mine]
                  .filter((m) => m.note)
                  .sort((a, b) => b.edited_at.localeCompare(a.edited_at))
                  .slice(0, 1)
                  .map((m) => (
                    <p key={m.id}>Última nota · {m.note}</p>
                  ))}
                {article.question && <p>Pregunta pendiente · {article.question}</p>}
              </details>
            )}
            <small className="rd-source">{new URL(article.url).hostname}</small>
            <h2>{article.title}</h2>
            {!annotations && (
              <small>Selecciona texto para resaltarlo, anotarlo o preguntarle a la IA.</small>
            )}
            {span && box && (
              <MarkToolbar
                box={box}
                palette={palette}
                color={color}
                editing={Boolean(editing)}
                busy={busy}
                quote={readableSlice(article.content, span.start, span.end)}
                noteOpen={noteOpen}
                note={note}
                askOpen={askOpen}
                onToggleAsk={() => {
                  setAskOpen((v) => !v);
                  setNoteOpen(false);
                  setShareOpen(false);
                }}
                onAsk={(prompt) =>
                  askReading(
                    article.id,
                    readableSlice(article.content, span.start, span.end),
                    prompt,
                  ).then((r) => r.answer)
                }
                shareOpen={shareOpen}
                shareHint={interested.length}
                onToggleShare={() => {
                  setShareOpen((v) => !v);
                  setAskOpen(false);
                  setNoteOpen(false);
                }}
                sharePanel={
                  <SharePanel
                    quote={readableSlice(article.content, span.start, span.end)}
                    title={article.title}
                    url={article.url}
                    matches={interested}
                    onKeepMark={keepShareMark}
                  />
                }
                onKeep={keepAnswer}
                onWord={isTerm(term) ? toggleWord : undefined}
                wordSaved={Boolean(wordSaved)}
                onPick={(key) => highlightNow(key)}
                onToggleNote={() => {
                  setNoteOpen((v) => !v);
                  setAskOpen(false);
                  setShareOpen(false);
                }}
                onNote={setNote}
                onSaveNote={() => highlightNow()}
                onDelete={editing ? () => removeMark(editing) : undefined}
                onClose={() => closeEditor(true)}
              />
            )}
            {annotations ? (
              <ArticleMarks
                marks={mine}
                content={article.content}
                title={article.title}
                feedback={feedback}
                copy={(text) => void copyText(text)}
                onEdit={(m, rect) => inspect(m as Mark, rect)}
                onJump={(start) => {
                  jumpTo.current = start;
                  setAnnotations(false);
                }}
              />
            ) : (
              <>
                <article ref={articleRef}>{rendered}</article>
                <ReadEnd key={article.id} readAt={article.read_at} onToggle={markRead} />
              </>
            )}
          </>
        ) : (
          <div className="rd-empty">
            <BookOpen size={34} />
            <h2>Tu lista de lectura</h2>
            <p>
              {visible.length
                ? 'Selecciona un artículo para leerlo.'
                : 'Guarda tu primer artículo para leerlo aquí.'}
            </p>
            <button onClick={() => add(true)}>Guardar enlace</button>
          </div>
        )}
      </main>
      {/* Fuera del área que se desplaza: queda siempre en la esquina del lector. */}
      {article && !books && (
        <QuestionFab
          key={'fab:' + article.id}
          question={article.question ?? ''}
          busy={busy}
          saved={fabSaved}
          onSave={async (value) => {
            let ok = false;
            await run(async () => {
              await update({ question: value });
              ok = true;
            });
            if (ok) notify(value ? 'Pregunta guardada.' : 'Pregunta resuelta.');
            return ok;
          }}
          onAsk={(prompt) => askReading(article.id, '', prompt)}
          onKeep={keepQuestionAnswer}
          onJump={jump}
        />
      )}
    </section>
  );
}
async function loadArticleMarks(id: string) {
  const rows: Mark[] = [];
  for (let n = 0; ; n += 500) {
    const { data, error } = await supabase
      .from('reading_marks')
      .select('*')
      .eq('reading_id', id)
      .order('id')
      .range(n, n + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

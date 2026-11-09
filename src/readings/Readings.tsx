import { formats, readableSlice } from "./formatting";
import { useEffect, useMemo, useState, useRef } from "react";
import { MarkToolbar, boxOfRange, type Box } from "./MarkToolbar";
import {
  AI_MARK,
  aiNote,
  askReading,
  locateQuote,
  type ReadingAnswer,
} from "./ask";
import {
  DEBATE_LABEL,
  QUESTION_LABEL,
  QuestionFab,
  type SavedAi,
} from "./ReadingQuestion";
import { Listen } from "./Listen";
import { SharePanel } from "./SharePanel";
import { whoMightCare } from "../lib/interest";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import { SaveLink } from "./SaveLink";
import { failure } from "./capture";
import { refetchReading } from "./refetch";
import { pictures, minutesOf, wordCount } from "./media";
import { ReaderDialog } from "./ReaderDialog";
import {
  Trash2,
  Plus,
  BookOpen,
  Highlighter,
  Folder,
  Archive,
  ExternalLink,
} from "lucide-react";
import {
  Tag,
  Zap,
  Sparkles,
  ChevronDown,
  Search,
  X,
  LoaderCircle,
} from "lucide-react";
import { useLibrary, type Card } from "./library";
import { Notebooks } from "./Notebooks";
import { MarkGroups, useResume } from "./ReadingExtras";
import { ArticleMarks, toneOf } from "./ArticleMarks";
import { BookA, Heart, NotebookPen, Pin } from "lucide-react";
import { ReadingRow, type RowActions } from "./ReadingRow";
import { Dictionary } from "./Dictionary";
import { cleanTerm, isTerm, sentenceAround, useWords } from "./words";
import { FinishPrompt, ReadEnd } from "./ReadEnd";
import { ReaderSettings, useReaderPrefs } from "./ReaderSettings";
import { BatchBar } from "./BatchBar";
import { JUMP_KEY } from "./search";
import { SpeedReader, readingAI } from "./SpeedReader";
import { toHash } from "../lib/route";
import "./readings.css";

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
/** Un artículo recién vuelto a descargar, con los campos de su tarjeta. */
type Fresh = Article & Partial<Pick<Card, "excerpt" | "cover" | "minutes">>;
/** Fijar y «Completado» necesitan la migración 012. */
const PINS_SQL = "supabase/migrations/202611070012_reading_pins.sql";
const missingColumn = (e: { code?: string; message: string }) =>
  e.code === "PGRST204" ||
  e.code === "42703" ||
  /pinned_at|read_at/.test(e.message);
/** Mensaje claro para un fallo al guardar un resaltado. */
const markError = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  if (err?.code === "23514" || /color_check/.test(err?.message ?? ""))
    return "Para los colores nuevos ejecuta supabase/migrations/202611070011_reading_colors.sql en el SQL Editor de Supabase.";
  return err?.message || "No se pudo guardar el resaltado.";
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
/** La colección donde vive un artículo. */
const viewOf = (a: {
  archived: boolean;
  folder: string;
  read_at?: string | null;
}) =>
  a.archived
    ? "archive"
    : a.folder
      ? "f:" + a.folder
      : a.read_at
        ? "read"
        : "inbox";
function endpoint(node: Node | null, offset: number) {
  if (!node) return null;
  const el = (
    node.nodeType === 3 ? node.parentElement : (node as Element)
  )?.closest("[data-offset]");
  if (!el) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return Number(el.getAttribute("data-offset")) + r.toString().length;
}
/**
 * Posición en el texto original de una selección dentro del artículo. Si empieza o termina
 * fuera de un fragmento (arrastrar hasta el margen, triple clic), usa el primero y el último
 * fragmento que toca.
 */
function selectionSpan(root: HTMLElement, r: Range): Span | null {
  let start = root.contains(r.startContainer)
    ? endpoint(r.startContainer, r.startOffset)
    : null;
  let end = root.contains(r.endContainer)
    ? endpoint(r.endContainer, r.endOffset)
    : null;
  if (start === null || end === null) {
    const parts = Array.from(
      root.querySelectorAll<HTMLElement>("[data-offset]"),
    ).filter((el) => r.intersectsNode(el));
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    start ??= Number(parts[0].dataset.offset);
    end ??= Number(last.dataset.offset) + (last.textContent?.length ?? 0);
  }
  return end > start ? { start, end } : null;
}
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
/**
 * Ajusta un tramo seleccionado a palabras completas y sin espacios en los bordes: arrastrar con
 * prisa no deja media palabra fuera del resaltado.
 */
function snapToWords(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (isWordChar(text[start]))
    for (let n = 0; n < 40 && start > 0 && isWordChar(text[start - 1]); n++)
      start--;
  if (isWordChar(text[end - 1]))
    for (let n = 0; n < 40 && end < text.length && isWordChar(text[end]); n++)
      end++;
  return end > start ? { start, end } : null;
}

export function Readings({
  openId,
  addLink = false,
}: { openId?: string; addLink?: boolean } = {}) {
  const [article, setArticle] = useState<Article | null>(null),
    [marks, setMarks] = useState<Mark[]>([]),
    [id, select] = useState(openId ?? "");
  // Artículo pedido por enlace (p. ej. la recomendación del inicio): al cargarlo se muestra su
  // colección; si ya no existe, se abre Lecturas sin error.
  const linked = useRef(openId ?? "");
  const [view, setView] = useState("inbox"),
    [query, search] = useState(""),
    [adding, add] = useState(addLink);
  const [busy, working] = useState(false),
    [error, fail] = useState(""),
    [folder, setFolder] = useState("");
  const [span, setSpan] = useState<Span | null>(null),
    [note, setNote] = useState("");
  const [editing, setEditing] = useState<Mark | null>(null),
    [color, setColor] = useState("yellow"),
    [moving, setMoving] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false),
    [tagOpen, setTagOpen] = useState(false),
    [tag, setTag] = useState(""),
    [speed, setSpeed] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, string>>({}),
    [showSummary, setShowSummary] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  function anchor(rect: DOMRect | Box) {
    setBox({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
  }
  const palette = {
    yellow: "Amarillo",
    blue: "Azul oscuro",
    orange: "Naranja",
  };
  // Qué abrió la barra: una selección nueva o un resaltado existente (se lee sin esperar render).
  const mode = useRef<"selection" | "mark" | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  function inspect(m: Mark, rect?: DOMRect) {
    if (rect) anchor(rect);
    mode.current = "mark";
    setNoteOpen(false);
    setAskOpen(false);
    setShareOpen(false);
    setSpan({ start: m.start_offset, end: m.end_offset });
    setEditing(m);
    setColor(toneOf(m.color));
    setNote(m.note);
  }
  function closeEditor(clear = false) {
    if (clear && mode.current === "selection")
      window.getSelection()?.removeAllRanges();
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
  const { notify, workspace, confirm } = useApp();
  // Tamaño, fuente, interlineado, ancho y fondo del lector (se recuerdan en el navegador).
  const reader = useReaderPrefs();
  // Sugerencia flotante «Mover a leídos» al llegar al final (id del artículo) y los que ya
  // descartaste en esta visita.
  const [offer, setOffer] = useState("");
  const declined = useRef(new Set<string>());
  // Tarjetas marcadas para acciones en lote y la última que marcaste (para Mayús + clic).
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const lastPick = useRef("");
  // Diccionario de palabras y conceptos por aprender (se carga una vez).
  const dictionary = useWords(notify);
  const pendingWords = dictionary.words.filter((w) => !w.learned_at).length;
  useEffect(() => {
    const refresh = () => bump((v) => v + 1);
    window.addEventListener("nexo:link-saved", refresh);
    return () => window.removeEventListener("nexo:link-saved", refresh);
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
  // Artículos que se están volviendo a descargar. `shown`: el abierto ahora, leído al terminar.
  const [refetching, setRefetching] = useState<ReadonlySet<string>>(new Set());
  const shown = useRef(id);
  shown.current = id;
  /**
   * Vuelve a descargar un artículo que se guardó incompleto. La tarjeta se actualiza sola y, si
   * está abierto, el lector muestra el texto nuevo con sus resaltados recolocados.
   */
  async function refetch(card: Card) {
    if (refetching.has(card.id)) return;
    setRefetching((s) => new Set(s).add(card.id));
    try {
      const result = await refetchReading<Fresh>(card.id, card.url, (warning) =>
        confirm({
          title: "Reemplazar el texto guardado",
          message: warning,
          confirmLabel: "Reemplazar",
          icon: "warning",
        }),
      );
      if (result === "cancelled") return;
      if (result === "same") {
        notify("El artículo ya estaba completo: no hubo cambios.");
        return;
      }
      const { row, lost } = result;
      const len = Math.max(1, row.content.length);
      // Portada, extracto y minutos los recalcula la base al cambiar el texto.
      patchCard(card.id, {
        title: row.title,
        excerpt: row.excerpt ?? "",
        cover: row.cover ?? null,
        minutes: row.minutes ?? minutesOf(row.content),
        progress: row.read_at
          ? 100
          : !row.last_read || row.resume_at <= 0
            ? null
            : Math.min(
                100,
                Math.max(1, Math.round((100 * row.resume_at) / len)),
              ),
      });
      // El porcentaje que llevabas se calculó con el texto viejo.
      setReadNow((p) => {
        const next = { ...p };
        delete next[card.id];
        return next;
      });
      if (shown.current === card.id) {
        const fresh = await loadArticleMarks(card.id);
        if (shown.current === card.id) {
          setArticle(row);
          setMarks(fresh);
        }
      }
      bumpMarks((v) => v + 1);
      notify(
        lost
          ? `Artículo actualizado. ${lost === 1 ? "1 resaltado quedó descolocado" : `${lost} resaltados quedaron descolocados`}.`
          : "Artículo actualizado.",
      );
    } catch (e) {
      notify("No se pudo volver a descargar: " + failure(e, true));
    } finally {
      setRefetching((s) => {
        const next = new Set(s);
        next.delete(card.id);
        return next;
      });
    }
  }
  /** Fija o suelta un artículo al instante; se guarda de fondo. */
  function togglePin(card: Card) {
    const on = !card.pinned_at;
    pinCard(card, on);
    void supabase
      .from("readings")
      .update({ pinned_at: on ? new Date().toISOString() : null })
      .eq("id", card.id)
      .then(({ error }) => {
        if (!error) return;
        pinCard(card, !on);
        notify(
          missingColumn(error)
            ? `Para fijar artículos ejecuta ${PINS_SQL} en el SQL Editor de Supabase.`
            : "No se pudo fijar: " + error.message,
        );
      });
  }
  /**
   * Marca el artículo abierto como leído (o no) al instante; se guarda de fondo. Leído sale de
   * «Por leer» y pasa a «Leídos»: la lista y los contadores se refrescan al guardarse.
   */
  function markRead(done: boolean) {
    if (!article) return;
    const rid = article.id;
    const before = article.read_at ?? null;
    const at = done ? new Date().toISOString() : null;
    if (done) setOffer("");
    setArticle((a) => (a && a.id === rid ? { ...a, read_at: at } : a));
    patchCard(rid, { read_at: at });
    void supabase
      .from("readings")
      .update({ read_at: at })
      .eq("id", rid)
      .then(({ error }) => {
        if (!error) {
          bump((v) => v + 1);
          return;
        }
        setArticle((a) => (a && a.id === rid ? { ...a, read_at: before } : a));
        patchCard(rid, { read_at: before });
        notify(
          missingColumn(error)
            ? `Para marcar lecturas como completadas ejecuta ${PINS_SQL} en el SQL Editor de Supabase.`
            : "No se pudo guardar: " + error.message,
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
          supabase.from("readings").select("*").eq("id", id).single(),
          loadArticleMarks(id),
        ]);
        if (a.error) {
          if (linked.current === id) {
            linked.current = "";
            if (live) select("");
            return;
          }
          throw a.error;
        }
        if (live) {
          setArticle(a.data);
          setFolder(a.data.folder);
          setMarks(m);
          // Un resaltado abierto desde el buscador global: se lleva a él al pintarlo.
          try {
            const jump = JSON.parse(sessionStorage.getItem(JUMP_KEY) ?? "null");
            if (jump?.id === id && Number.isFinite(jump.at)) {
              sessionStorage.removeItem(JUMP_KEY);
              jumpTo.current = Number(jump.at);
            }
          } catch {
            /* Sin almacenamiento de sesión: se abre el artículo sin más. */
          }
          if (linked.current === id) {
            linked.current = "";
            setView(viewOf(a.data));
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
    if (!window.location.hash.startsWith(toHash("Lecturas"))) return;
    const target = toHash("Lecturas", id || null);
    if (window.location.hash !== target) history.replaceState(null, "", target);
  }, [id]);
  const sentinel = useRef<HTMLDivElement>(null);
  // Al buscar, la lista vuelve arriba (los resultados nuevos reemplazan a los que había).
  useEffect(() => {
    const list = sentinel.current?.closest("aside");
    if (list && list.scrollTop > 0) list.scrollTop = 0;
  }, [query]);
  useEffect(() => {
    if (!more || loading || !sentinel.current) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0]?.isIntersecting) void load();
      },
      // Pide la página siguiente bastante antes de llegar al final: el scroll no se detiene.
      { root: sentinel.current.closest("aside"), rootMargin: "900px 0px" },
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [more, loading, load]);
  const [deleting, setDeleting] = useState(false),
    [annotations, setAnnotations] = useState(false),
    [feedback, setFeedback] = useState("");
  // Progreso de lo que lees ahora (la lista se actualiza sin recargarla).
  const [readNow, setReadNow] = useState<Record<string, number>>({});
  useResume(
    article?.id,
    article?.resume_at || 0,
    !annotations && !books && !speed,
    fail,
    (offset) => {
      if (!article) return;
      const pct = Math.min(
        100,
        Math.round((100 * offset) / Math.max(1, article.content.length)),
      );
      // Sin cambios no se vuelve a pintar nada.
      setReadNow((p) =>
        p[article.id] === pct ? p : { ...p, [article.id]: pct },
      );
    },
  );
  const total = (key: string) =>
    filters.counts ? " (" + (filters.counts[key] ?? 0) + ")" : "";
  // Esc quita la selección de tarjetas (antes que cerrar el artículo).
  useEffect(() => {
    if (!picked.size) return;
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        document.querySelector(
          "dialog[open], .confirm-backdrop, .sheet-backdrop",
        )
      )
        return;
      if (
        (e.target as HTMLElement | null)?.closest?.("input, textarea, select")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setPicked(new Set());
    }
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [picked.size]);
  // Otra colección: la selección no se arrastra.
  useEffect(() => {
    setPicked(new Set());
    lastPick.current = "";
  }, [view]);
  useEffect(() => {
    if (!id) return;
    /*
     * Esc va por capas: primero lo que esté abierto encima (lo maneja cada cosa), luego la barra
     * de resaltado, las etiquetas, el resumen y las anotaciones; solo al final cierra el artículo.
     */
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || e.repeat) return;
      if (speed || adding || moving || deleting) return;
      if (
        document.querySelector(
          "dialog[open], .sheet-backdrop, .confirm-backdrop, .picker-backdrop, .lightbox, .nx-peek, .chat-panel, .rd-listen-pop, .rd-qf.open",
        )
      )
        return;
      // En un campo de texto (buscador, etiquetas…), Esc solo sale del campo.
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.('input, textarea, select, [contenteditable="true"]')
      ) {
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
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [
    id,
    speed,
    adding,
    moving,
    deleting,
    span,
    tagOpen,
    askOpen,
    showSummary,
    annotations,
  ]);
  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copiado al portapapeles.");
    } catch {
      setFeedback("El navegador no permitió copiar el texto.");
    }
  }
  async function deleteArticle() {
    const { error } = await supabase
      .from("readings")
      .delete()
      .eq("id", id)
      .select("id")
      .single();
    if (error) throw error;
    bump((v) => v + 1);
    setMarks((v) => v.filter((m) => m.reading_id !== id));
    open(visible.find((a) => a.id !== id));
  }
  function open(a?: { id: string }) {
    // Al cambiar de artículo (o cerrarlo) se vacía ya: nunca se pinta el anterior en el panel nuevo.
    if ((a?.id ?? "") !== id) {
      setArticle(null);
      setMarks([]);
    }
    window.getSelection()?.removeAllRanges();
    showBooks(false);
    showDict(false);
    setSpeed(false);
    setTagOpen(false);
    setTag("");
    setShowSummary(false);
    setDeleting(false);
    setAnnotations(false);
    setOffer("");
    setFeedback("");
    select(a?.id ?? "");
    setEditing(null);
    setMoving(false);
    setFolder("");
    mode.current = null;
    setSpan(null);
    setNote("");
  }
  async function run(fn: () => Promise<void>) {
    working(true);
    fail("");
    try {
      await fn();
    } catch (e) {
      fail(
        e instanceof Error
          ? e.message
          : String((e as { message?: string })?.message || e),
      );
    } finally {
      working(false);
    }
  }
  async function update(
    changes: Partial<
      Pick<Article, "folder" | "archived" | "tags" | "favorite" | "question">
    >,
  ) {
    if (!article) return;
    const { data, error } = await supabase
      .from("readings")
      .update(changes)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    setArticle(data);
    bump((v) => v + 1);
    if (changes.favorite !== undefined || changes.question !== undefined)
      return;
    if (changes.tags) {
      setTag("");
      return;
    }
    open(data);
    if (changes.archived !== undefined || view.startsWith("f:"))
      setView(viewOf(data));
  }
  const mine = useMemo(
    () => marks.filter((m) => m.reading_id === id),
    [marks, id],
  );
  function readSelection() {
    const root = articleRef.current;
    const s = window.getSelection();
    if (!root || !s?.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    if (!r.intersectsNode(root)) return;
    const raw = selectionSpan(root, r);
    const next = raw && article ? snapToWords(article.content, raw) : null;
    const rect = next && boxOfRange(r);
    if (!next || !rect) return;
    // La misma selección: solo se recoloca la barra.
    if (
      mode.current === "selection" &&
      span?.start === next.start &&
      span.end === next.end
    ) {
      setBox(rect);
      return;
    }
    mode.current = "selection";
    setBox(rect);
    setNoteOpen(false);
    setAskOpen(false);
    setShareOpen(false);
    setEditing(null);
    setColor("yellow");
    setSpan(next);
    setNote("");
  }
  // Las funciones y el estado cambian en cada render; los escuchas globales leen lo último.
  const live = useRef({
    readSelection,
    closeEditor,
    span,
    noteOpen,
    askOpen,
    shareOpen,
  });
  live.current = {
    readSelection,
    closeEditor,
    span,
    noteOpen,
    askOpen,
    shareOpen,
  };

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
        const inside = document.activeElement?.closest(".rd-marktools");
        const writing =
          live.current.noteOpen ||
          live.current.askOpen ||
          live.current.shareOpen;
        if (mode.current === "selection" && !inside && !writing)
          live.current.closeEditor();
        return;
      }
      if (!pressed)
        timer = window.setTimeout(() => live.current.readSelection(), 160);
    };
    let moving = 0;
    const follow = () => {
      cancelAnimationFrame(moving);
      moving = requestAnimationFrame(() => {
        const current = live.current.span;
        if (!current) return;
        const s = window.getSelection();
        const rect =
          mode.current === "selection" && s?.rangeCount && !s.isCollapsed
            ? boxOfRange(s.getRangeAt(0))
            : (articleRef.current
                ?.querySelector(`[data-offset="${current.start}"]`)
                ?.getBoundingClientRect() ?? null);
        if (rect) anchor(rect);
      });
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("selectionchange", change);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moving);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("selectionchange", change);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [article?.id]);
  /** Guarda la pregunta a la IA y su respuesta como nota del resaltado (nuevo o el que editas). */
  async function keepAnswer(prompt: string, answer: string) {
    const qa = aiNote(prompt, answer);
    const own = editing?.note.trim() ?? note.trim();
    working(true);
    fail("");
    try {
      await highlight(
        editing ? toneOf(editing.color) : "blue",
        own ? `${own}\n\n${qa}` : qa,
      );
      notify("Respuesta guardada como resaltado en el artículo.");
      return true;
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "No se pudo guardar la respuesta.",
      );
      return false;
    } finally {
      working(false);
    }
  }
  /**
   * Respuesta a la pregunta guía: se guarda como resaltado sobre la cita que la respalda (o,
   * si la IA no dio una cita que exista en el texto, sobre el primer párrafo).
   */
  async function keepQuestionAnswer(
    question: string,
    { answer, quote }: ReadingAnswer,
  ) {
    if (!article) return false;
    let at = locateQuote(article.content, quote);
    if (!at) {
      const first = Array.from(
        articleRef.current?.querySelectorAll<HTMLElement>("[data-offset]") ??
          [],
      ).find((el) => (el.textContent?.trim().length ?? 0) > 20);
      if (first) {
        const start = Number(first.dataset.offset);
        at = { start, end: start + Math.min(first.textContent!.length, 220) };
      }
    }
    if (!at) {
      notify(
        "No encontré dónde guardarla en el texto. Cópiala o selecciona un fragmento.",
      );
      return false;
    }
    try {
      const { data, error } = await supabase
        .from("reading_marks")
        .insert({
          note: aiNote(question, answer),
          color: "blue",
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
      notify("Respuesta guardada como resaltado en el artículo.");
      return true;
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "No se pudo guardar la respuesta.",
      );
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
    markId.startsWith("tmp:")
      ? ((await savedId.current.get(markId)) ?? null)
      : markId;
  /**
   * Guarda el resaltado (nuevo o el que editas). Con `keepOpen` la barra sigue abierta sobre el
   * resaltado (p. ej. para compartirlo con varias personas). La promesa termina al guardarse.
   */
  function highlight(
    chosen = color,
    text = note,
    keepOpen = false,
  ): Promise<void> {
    if (!span || !article) return Promise.resolve();
    const rid = article.id;
    // Una selección nueva que pisa resaltados ya hechos los une en uno solo: nada de capas
    // superpuestas ni notas repartidas. Se conserva el primero y se borran los demás.
    const overlaps = editing
      ? []
      : mine
          .filter((m) => m.start_offset < span.end && m.end_offset > span.start)
          .sort((a, b) => a.start_offset - b.start_offset);
    const merged = overlaps.length > 0;
    const start = Math.min(span.start, ...overlaps.map((m) => m.start_offset));
    const end = Math.max(span.end, ...overlaps.map((m) => m.end_offset));
    const notes = [text.trim(), ...overlaps.map((m) => m.note.trim())].filter(
      (v, i, all) => v && all.indexOf(v) === i,
    );
    const fields = {
      note: notes.join("\n\n"),
      color: chosen,
      edited_at: new Date().toISOString(),
      quote: readableSlice(article.content, start, end),
      ...(merged ? { start_offset: start, end_offset: end } : {}),
    };
    const before = editing ?? overlaps[0] ?? null;
    const others = overlaps.slice(1);
    const local: Mark = before
      ? { ...before, ...fields }
      : {
          ...fields,
          id: "tmp:" + crypto.randomUUID(),
          reading_id: rid,
          start_offset: span.start,
          end_offset: span.end,
        };
    if (before) {
      const gone = new Set(others.map((m) => m.id));
      setMarks((v) =>
        v.flatMap((m) =>
          m.id === before.id ? [local] : gone.has(m.id) ? [] : [m],
        ),
      );
      if (others.length)
        patchCard(rid, (c) => ({
          mark_count: Math.max(0, c.mark_count - others.length),
        }));
    } else {
      setMarks((v) => [...v, local]);
      patchCard(rid, (c) => ({ mark_count: c.mark_count + 1 }));
    }
    if (keepOpen) {
      // Desde ahora la barra edita ese resaltado (la selección ya no hace falta).
      mode.current = "mark";
      setEditing(local);
      setColor(chosen);
      setNote(local.note);
    } else {
      closeEditor(true);
      setNote("");
    }

    let target = local.id;
    const save = (async () => {
      if (before) {
        const real = await realId(before.id);
        if (!real) throw Error("El resaltado no se llegó a guardar.");
        target = real;
        const { error } = await supabase
          .from("reading_marks")
          .update(fields)
          .eq("id", real);
        if (error) throw error;
        // Los que quedaron dentro del unido se borran (los recién hechos, en cuanto tienen id).
        for (const o of others) {
          removed.current.add(o.id);
          const id = await realId(o.id);
          if (!id) continue;
          const gone = await supabase
            .from("reading_marks")
            .delete()
            .eq("id", id);
          if (gone.error) throw gone.error;
        }
        return real;
      }
      const { data, error } = await supabase
        .from("reading_marks")
        .insert({
          ...fields,
          reading_id: rid,
          start_offset: local.start_offset,
          end_offset: local.end_offset,
        })
        .select("id")
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
        setMarks((v) =>
          v.map((m) => (m.id === local.id ? { ...m, id: real } : m)),
        );
        setEditing((e) => (e?.id === local.id ? { ...e, id: real } : e));
        // Lo borraste mientras se guardaba: se borra también en la base.
        if (removed.current.has(local.id))
          void supabase.from("reading_marks").delete().eq("id", real);
      },
      (e) => {
        if (before) {
          setMarks((v) => {
            const back = v.map((m) =>
              m.id === target || m.id === before.id ? before : m,
            );
            // Los unidos vuelven si no se llegaron a borrar.
            const missing = others.filter(
              (o) => !back.some((m) => m.id === o.id),
            );
            return missing.length ? [...back, ...missing] : back;
          });
          if (others.length)
            patchCard(rid, (c) => ({
              mark_count: c.mark_count + others.length,
            }));
          setEditing((x) =>
            x && (x.id === target || x.id === before.id) ? before : x,
          );
        } else {
          // Ya lo habías quitado: no hay nada que deshacer ni avisar.
          if (removed.current.has(local.id)) return;
          setMarks((v) => v.filter((m) => m.id !== local.id));
          setEditing((x) => (x?.id === local.id ? null : x));
          patchCard(rid, (c) => ({
            mark_count: Math.max(0, c.mark_count - 1),
          }));
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
    if (m.id.startsWith("tmp:")) {
      // Aún no tiene id real: se borra en cuanto se guarde (o nada, si no se llega a guardar).
      removed.current.add(m.id);
      return;
    }
    void supabase
      .from("reading_marks")
      .delete()
      .eq("id", m.id)
      .then(({ error }) => {
        if (!error) {
          bumpMarks((v) => v + 1);
          return;
        }
        setMarks((v) => (v.some((x) => x.id === m.id) ? v : [...v, m]));
        patchCard(rid, (c) => ({ mark_count: c.mark_count + 1 }));
        notify("No se pudo quitar el resaltado: " + error.message);
      });
  }
  /** Para la barra: pinta ya y avisa solo si el guardado de fondo falla. */
  const highlightNow = (chosen?: string, text?: string) =>
    void highlight(chosen, text).catch((e: Error) => notify(e.message));
  /** Deja el fragmento resaltado con una línea de para quién era («→ Para Laura»). */
  async function keepShareMark(line: string) {
    const prev = (editing ? editing.note : note).trim();
    if (prev.split("\n").includes(line)) return;
    try {
      await highlight(
        editing ? toneOf(editing.color) : "yellow",
        prev ? `${prev}\n${line}` : line,
        true,
      );
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "No se pudo guardar el resaltado.",
      );
    }
  }
  // Lo que no depende de los resaltados (formato, imágenes, párrafos) se calcula una vez por
  // artículo: resaltar o quitar un resaltado solo vuelve a cortar el texto.
  const layout = useMemo(() => {
    if (!article) return null;
    const content = article.content;
    const images = pictures(content);
    const rules = formats(content);
    const cuts = [
      0,
      content.length,
      ...Array.from(content.matchAll(/\n+/g), (m) => m.index! + m[0].length),
      ...rules.flatMap((r) => [r.start, r.end]),
      ...images.flatMap((i) => [i.index!, i.index! + i[0].length]),
    ];
    return { images, rules, cuts };
  }, [article?.content]);
  // Palabras y minutos de lectura del artículo abierto.
  const size = useMemo(
    () =>
      article
        ? {
            words: wordCount(article.content),
            minutes: minutesOf(article.content),
          }
        : null,
    [article?.content],
  );
  function body(
    a: Article,
    { images, rules, cuts }: NonNullable<typeof layout>,
  ) {
    const points = [
      ...new Set([
        ...cuts,
        ...mine.flatMap((m) => [m.start_offset, m.end_offset]),
      ]),
    ].sort((x, y) => x - y);
    const n = points.length - 1;
    // Qué toca a cada fragmento, en una sola pasada (en artículos largos, recorrer todas las
    // reglas por cada fragmento se notaba al abrirlos). Todos los bordes son puntos de corte.
    const at = new Map(points.map((p, i) => [p, i]));
    const kinds: string[][] = Array.from({ length: Math.max(0, n) }, () => []);
    const hidden = new Uint8Array(Math.max(0, n));
    const hrefOf: (string | undefined)[] = new Array(Math.max(0, n));
    const imageAt = new Map<number, (typeof images)[number]>();
    const markOf: (Mark | undefined)[] = new Array(Math.max(0, n));
    for (const r of rules)
      for (let i = at.get(r.start)!, end = at.get(r.end)!; i < end; i++) {
        if (r.kind === "hidden") hidden[i] = 1;
        else if (r.kind === "link") hrefOf[i] = r.href;
        else kinds[i].push("rd-f-" + r.kind);
      }
    for (const img of images) {
      const start = at.get(img.index!)!;
      if (!imageAt.has(start)) imageAt.set(start, img);
      for (
        let i = start + 1, end = at.get(img.index! + img[0].length)!;
        i < end;
        i++
      )
        hidden[i] = 1;
    }
    // Si dos resaltados se pisan, manda el primero (como antes).
    for (const m of mine)
      for (
        let i = at.get(m.start_offset)!, end = at.get(m.end_offset)!;
        i < end;
        i++
      )
        markOf[i] ??= m;
    // Primer y último fragmento visible de cada resaltado: ahí van las esquinas redondeadas y
    // el punto de «tiene nota». Las marcas de formato ocultas no lo cortan.
    const visible = (i: number) =>
      !hidden[i] && !imageAt.has(i) && points[i + 1] > points[i];
    const first = new Uint8Array(Math.max(0, n));
    const last = new Uint8Array(Math.max(0, n));
    for (let i = 0, prev: Mark | undefined; i < n; i++) {
      if (!visible(i)) continue;
      if (markOf[i] && markOf[i] !== prev) first[i] = 1;
      prev = markOf[i];
    }
    for (let i = n - 1, next: Mark | undefined; i >= 0; i--) {
      if (!visible(i)) continue;
      if (markOf[i] && markOf[i] !== next) last[i] = 1;
      next = markOf[i];
    }
    return points.slice(0, -1).map((p, i) => {
      const img = imageAt.get(i);
      if (img)
        return (
          <img
            key={p}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            src={a.media?.[img[2]] || img[2]}
            alt={img[1]}
          />
        );
      if (hidden[i]) return null;
      const marked = markOf[i];
      const names = kinds[i];
      if (marked) {
        names.push("lit", marked.color || "yellow");
        if (first[i]) names.push("lit-start");
        if (last[i])
          names.push(marked.note.trim() ? "lit-end noted" : "lit-end");
      }
      const piece = (
        <span
          key={p}
          data-offset={p}
          data-mark={marked?.id}
          className={names.join(" ") || undefined}
          role={marked ? "button" : undefined}
          tabIndex={marked ? 0 : undefined}
        >
          {a.content.slice(p, points[i + 1])}
        </span>
      );
      const href = hrefOf[i];
      return href ? (
        <a
          key={p}
          className="rd-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          title={href}
        >
          {piece}
        </a>
      ) : (
        piece
      );
    });
  }
  // El artículo solo se vuelve a pintar si cambian él o sus resaltados: abrir la barra es instantáneo.
  const rendered = useMemo(
    () => (article && layout ? body(article, layout) : null),
    [article, mine, layout],
  );
  // Los resaltados se abren con un solo escucha en el artículo (no uno por fragmento).
  const markAt = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>(
      "[data-mark]",
    );
    const m = el && mine.find((x) => x.id === el.dataset.mark);
    return m && el ? { m, el } : null;
  };
  // Al pasar el cursor por un resaltado se ilumina entero, aunque esté partido en fragmentos.
  const hovered = useRef("");
  function hoverMark(markId: string) {
    const root = articleRef.current;
    if (!root || hovered.current === markId) return;
    const group = (k: string) =>
      root.querySelectorAll(`[data-mark="${CSS.escape(k)}"]`);
    if (hovered.current)
      group(hovered.current).forEach((el) => el.classList.remove("hover"));
    hovered.current = markId;
    if (markId) group(markId).forEach((el) => el.classList.add("hover"));
  }
  // El resaltado que editas en la barra queda marcado en el texto.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || !editing) return;
    const els = root.querySelectorAll(
      `[data-mark="${CSS.escape(editing.id)}"]`,
    );
    els.forEach((el) => el.classList.add("editing"));
    return () => els.forEach((el) => el.classList.remove("editing"));
  }, [editing?.id, rendered]);
  // A quién le puede interesar el fragmento seleccionado (el título da contexto).
  const spanText =
    article && span ? readableSlice(article.content, span.start, span.end) : "";
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
        label: "Ver",
        icon: "open",
        run: () => {
          closeEditor(true);
          select("");
          showBooks(false);
          showDict(true);
        },
      });
  }
  const interested = useMemo(
    () =>
      spanText
        ? whoMightCare(spanText, workspace.people, article?.title ?? "")
        : [],
    [spanText, workspace.people, article?.title],
  );
  // «Ver en el texto» desde Anotaciones: al volver al artículo, lleva al resaltado y lo destaca.
  const jumpTo = useRef<number | null>(null);
  const flashAt = (at: number) => {
    const el = articleRef.current?.querySelector<HTMLElement>(
      `[data-offset="${at}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("rd-flash");
    window.setTimeout(() => el.classList.remove("rd-flash"), 1800);
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
        const [first, ...rest] = note.slice(AI_MARK.length).split("\n");
        const debate = first.startsWith(DEBATE_LABEL);
        const guide =
          first.startsWith(QUESTION_LABEL) ||
          Boolean(
            article?.question && first.trim() === article.question.trim(),
          );
        if (!debate && !guide) return [];
        return [
          {
            id: m.id,
            kind: debate ? ("debate" as const) : ("pregunta" as const),
            title: debate
              ? "Contraargumentos"
              : first.replace(QUESTION_LABEL, "").trim(),
            body: rest
              .join("\n")
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
  const listed = useMemo(() => {
    if (view === "marks") return [];
    const top = new Set(pinned.map((p) => p.id));
    return [...pinned, ...visible.filter((c) => !top.has(c.id))];
  }, [view, pinned, visible]);
  // Marca o desmarca una tarjeta; con Mayús, todo el tramo desde la última que marcaste.
  function pick(card: Card, range: boolean) {
    const ids = listed.map((c) => c.id);
    const from = ids.indexOf(lastPick.current),
      to = ids.indexOf(card.id);
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (let i = a; i <= b; i++) next.add(ids[i]);
      } else if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
    lastPick.current = card.id;
    window.getSelection()?.removeAllRanges();
  }
  const pickedCards = useMemo(
    () => listed.filter((c) => picked.has(c.id)),
    [listed, picked],
  );
  /** Terminó una acción en lote: la lista se actualiza y la selección se vacía. */
  function batchDone(kind: string, ids: string[], changes?: Partial<Card>) {
    setPicked(new Set());
    lastPick.current = "";
    bump((v) => v + 1);
    if (!article || !ids.includes(article.id)) return;
    if (kind === "delete") open();
    else if (kind === "tag") {
      // Las etiquetas del abierto se vuelven a leer de la base.
      const rid = article.id;
      void supabase
        .from("readings")
        .select("tags")
        .eq("id", rid)
        .single()
        .then(({ data }) => {
          if (data)
            setArticle((a) =>
              a && a.id === rid ? { ...a, tags: data.tags } : a,
            );
        });
    } else if (changes)
      setArticle((a) => (a ? ({ ...a, ...changes } as Article) : a));
  }
  // Las tarjetas reciben siempre las mismas funciones (leen lo último al pulsarse): así no se
  // vuelven a pintar todas con cada cambio del lector.
  const rowLive = useRef({ open, togglePin, refetch, pick });
  rowLive.current = { open, togglePin, refetch, pick };
  const rowActions = useMemo<RowActions>(
    () => ({
      open: (card) => rowLive.current.open(card),
      pin: (card) => rowLive.current.togglePin(card),
      refetch: (card) => void rowLive.current.refetch(card),
      pick: (card, range) => rowLive.current.pick(card, range),
    }),
    [],
  );
  return (
    <section
      className="readings"
      data-open={!!article || books || dict}
      data-paper={reader.paper}
      data-align={reader.prefs.align}
      style={reader.style}
    >
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
                <option value="inbox">Por leer{total("inbox")}</option>
                <option value="read">Leídos{total("read")}</option>
                <option value="favorites">Favoritos{total("favorites")}</option>
                <option value="archive">Archivados{total("archive")}</option>
                <option value="marks">Anotaciones{total("marks")}</option>
                {filters.tags.map((t) => (
                  <option key={"t:" + t} value={"t:" + t}>
                    Etiqueta · {t}
                    {total("t:" + t)}
                  </option>
                ))}
                {filters.folders.map((f) => (
                  <option key={f} value={"f:" + f}>
                    {f}
                    {total("f:" + f)}
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
                select("");
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
                  : "Diccionario: palabras y conceptos por aprender"
              }
              aria-label="Diccionario"
              aria-pressed={dict}
              onClick={() => {
                select("");
                showBooks(false);
                showDict(true);
              }}
            >
              <BookA size={18} />
              {pendingWords > 0 && (
                <i className="rd-dict-count">
                  {pendingWords > 99 ? "99+" : pendingWords}
                </i>
              )}
            </button>
            <button
              className="rd-add"
              title="Guardar enlace"
              aria-label="Guardar enlace"
              onClick={() => {
                fail("");
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
              placeholder={
                view === "marks"
                  ? "Buscar en tus anotaciones…"
                  : "Buscar artículos…"
              }
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  search("");
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="rd-search-x"
                aria-label="Borrar la búsqueda"
                onClick={() => search("")}
              >
                <X size={14} />
              </button>
            ) : (
              loading && (
                <LoaderCircle className="spin rd-search-spin" size={14} />
              )
            )}
          </label>
          {picked.size > 0 && view !== "marks" && (
            <BatchBar
              cards={pickedCards}
              allPicked={
                listed.length > 0 && pickedCards.length === listed.length
              }
              folders={filters.folders}
              tags={filters.tags}
              selectAll={() => setPicked(new Set(listed.map((c) => c.id)))}
              clear={() => {
                setPicked(new Set());
                lastPick.current = "";
              }}
              done={batchDone}
            />
          )}
        </div>
        {adding && (
          <SaveLink
            close={() => add(false)}
            saved={(a) => {
              bump((v) => v + 1);
              setView(viewOf(a));
              search("");
              open(a);
              add(false);
            }}
            savedMany={() => {
              // Los nuevos entran en la bandeja de entrada.
              bump((v) => v + 1);
              setView("inbox");
              search("");
              add(false);
            }}
          />
        )}
        {view === "marks" && (
          <MarkGroups
            query={query}
            current={annotations ? id : ""}
            revision={revision + markRev}
            open={(reading) => {
              open({ id: reading });
              setAnnotations(true);
            }}
          />
        )}
        {pinned.length > 0 && view !== "marks" && (
          <small className="rd-pinned-label">
            <Pin size={12} aria-hidden="true" /> Fijados
          </small>
        )}
        {listed.map((a, i, all) => (
          <ReadingRow
            key={a.id}
            card={a}
            current={id === a.id}
            pct={a.read_at ? 100 : (readNow[a.id] ?? a.progress ?? 0)}
            lastPinned={Boolean(a.pinned_at) && !all[i + 1]?.pinned_at}
            reloading={refetching.has(a.id)}
            selecting={picked.size > 0}
            picked={picked.has(a.id)}
            actions={rowActions}
          />
        ))}
        <div ref={sentinel} />
        {more && (
          <button disabled={loading} onClick={() => void load()}>
            Más artículos
          </button>
        )}
        {listError && <p role="alert">{listError}</p>}
        {view !== "marks" && !loading && !visible.length && !pinned.length && (
          <p>Sin artículos en esta vista.</p>
        )}
      </aside>
      {/* Claves distintas para cada hermano: si se repiten, React no sabe cuál quitar. */}
      <main key={"reader:" + id}>
        {error && <p role="alert">{error}</p>}
        {books ? (
          <Notebooks
            open={(id) => open({ id })}
            back={() => showBooks(false)}
          />
        ) : dict ? (
          <Dictionary
            api={dictionary}
            open={(id) => open({ id })}
            back={() => showDict(false)}
          />
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
                onClick={() =>
                  void run(() => update({ favorite: !article.favorite }))
                }
              >
                <Heart
                  size={17}
                  fill={article.favorite ? "currentColor" : "none"}
                />
              </button>
              <button
                disabled={busy}
                title={article.archived ? "Desarchivar" : "Archivar"}
                aria-label={article.archived ? "Desarchivar" : "Archivar"}
                onClick={() =>
                  void run(() => update({ archived: !article.archived }))
                }
              >
                <Archive size={16} />
              </button>
              <button
                title={article.folder || "Carpeta"}
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
                  setFeedback("");
                }}
              >
                <Highlighter size={16} />
                {annotations
                  ? "Volver al texto"
                  : "Anotaciones (" + mine.length + ")"}
              </button>
              <button
                disabled={busy}
                title="Resumir con IA"
                onClick={() => {
                  if (summaries[id]) setShowSummary(!showSummary);
                  else
                    void run(async () => {
                      const { summary } = await readingAI(id, "summary");
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
                  pane={() =>
                    document.querySelector<HTMLElement>(".readings > main")
                  }
                />
              )}
              {!annotations && <ReaderSettings api={reader} />}
              <button
                aria-label="Eliminar artículo"
                title="Eliminar artículo"
                onClick={() => {
                  fail("");
                  setDeleting(true);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {deleting && (
              <ReaderDialog
                title="Eliminar artículo"
                close={() => setDeleting(false)}
                busy={busy}
              >
                <p>Se eliminarán «{article.title}» y sus resaltados y notas.</p>
                <div className="rd-dlg-foot">
                  <button
                    className="rd-dlg-btn ghost"
                    disabled={busy}
                    onClick={() => setDeleting(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="rd-dlg-btn danger"
                    disabled={busy}
                    onClick={() => void run(deleteArticle)}
                  >
                    Eliminar artículo
                  </button>
                </div>
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
                      void run(() =>
                        update({ tags: [...(article.tags || []), value] }),
                      );
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
                    aria-label={"Quitar etiqueta " + t}
                    onClick={() =>
                      void run(() =>
                        update({ tags: article.tags?.filter((x) => x !== t) }),
                      )
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
              <SpeedReader
                key={id}
                id={id}
                text={article.content}
                close={() => setSpeed(false)}
              />
            )}
            {moving && (
              <ReaderDialog
                title="Mover a carpeta"
                close={() => setMoving(false)}
              >
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
                  <button disabled={busy || folder.trim() === article.folder}>
                    Mover
                  </button>
                </form>
              </ReaderDialog>
            )}
            {article.last_read &&
              Date.now() - Date.parse(article.last_read) > 2 * 86400000 && (
                <details className="rd-summary">
                  <summary>Retomar la lectura</summary>
                  <p>
                    {readableSlice(
                      article.content,
                      article.resume_at,
                      article.resume_at + 240,
                    )}
                  </p>
                  {[...mine]
                    .filter((m) => m.note)
                    .sort((a, b) => b.edited_at.localeCompare(a.edited_at))
                    .slice(0, 1)
                    .map((m) => (
                      <p key={m.id}>Última nota · {m.note}</p>
                    ))}
                  {article.question && (
                    <p>Pregunta pendiente · {article.question}</p>
                  )}
                </details>
              )}
            <small className="rd-source">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir el artículo original"
              >
                {new URL(article.url).hostname}
              </a>
              <span
                className="rd-source-time"
                title={`${(size?.words ?? 0).toLocaleString("es-CO")} palabras`}
              >
                {" · "}
                {size?.minutes ?? 1} min
              </span>
            </small>
            <h2>{article.title}</h2>
            {!annotations && (
              <small>
                Selecciona texto para resaltarlo, anotarlo o preguntarle a la
                IA.
              </small>
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
                <article
                  ref={articleRef}
                  onClick={(e) => {
                    const collapsed =
                      window.getSelection()?.isCollapsed !== false;
                    const link = (e.target as HTMLElement).closest?.(
                      "a.rd-link",
                    );
                    // Soltar una selección sobre un enlace no lo abre.
                    if (link) {
                      if (!collapsed) e.preventDefault();
                      return;
                    }
                    const hit = collapsed && markAt(e.target);
                    if (hit) inspect(hit.m, hit.el.getBoundingClientRect());
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const hit = markAt(e.target);
                    if (hit) inspect(hit.m, hit.el.getBoundingClientRect());
                  }}
                  onMouseOver={(e) =>
                    hoverMark(
                      (e.target as HTMLElement).closest?.<HTMLElement>(
                        "[data-mark]",
                      )?.dataset.mark ?? "",
                    )
                  }
                  onMouseLeave={() => hoverMark("")}
                >
                  {rendered}
                </article>
                <ReadEnd
                  key={article.id}
                  readAt={article.read_at}
                  onToggle={markRead}
                  onReachEnd={() => {
                    if (!declined.current.has(article.id)) setOffer(article.id);
                  }}
                />
                {offer === article.id && !article.read_at && (
                  <FinishPrompt
                    onYes={() => {
                      markRead(true);
                      notify("Movido a Leídos.", {
                        label: "Deshacer",
                        icon: "undo",
                        run: () => markRead(false),
                      });
                    }}
                    onNo={() => {
                      declined.current.add(article.id);
                      setOffer("");
                    }}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <div className="rd-empty">
            <BookOpen size={34} />
            <h2>Tu lista de lectura</h2>
            <p>
              {visible.length
                ? "Selecciona un artículo para leerlo."
                : "Guarda tu primer artículo para leerlo aquí."}
            </p>
            <button onClick={() => add(true)}>Guardar enlace</button>
          </div>
        )}
      </main>
      {/* Fuera del área que se desplaza: queda siempre en la esquina del lector. */}
      {article && !books && (
        <QuestionFab
          key={"fab:" + article.id}
          question={article.question ?? ""}
          busy={busy}
          saved={fabSaved}
          onSave={async (value) => {
            let ok = false;
            await run(async () => {
              await update({ question: value });
              ok = true;
            });
            if (ok) notify(value ? "Pregunta guardada." : "Pregunta resuelta.");
            return ok;
          }}
          onAsk={(prompt) => askReading(article.id, "", prompt)}
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
      .from("reading_marks")
      .select("*")
      .eq("reading_id", id)
      .order("id")
      .range(n, n + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

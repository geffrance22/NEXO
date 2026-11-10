import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Brackets,
  Check,
  ChevronDown,
  Highlighter,
  Layers,
  LoaderCircle,
  MessageCircleQuestion,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import {
  errorMessage,
  friendlyDate,
  normalizeText,
  shortDate,
  todayInputValue,
} from "../lib/format";
import {
  deleteFlashcard,
  FLASHCARDS_SQL,
  generateFlashcards,
  loadFlashcards,
  loadHighlights,
  readArticles,
  type Flashcard,
  type Highlight,
  type ReadArticle,
} from "./flashcardStore";
import { CardEditor, type CardSeed } from "./CardEditor";
import { clozePlain, flashFaces } from "./cloze";
import { recallToday, memoryOf } from "../review/fsrs";
import { FlashcardViewer } from "./FlashcardViewer";
import "./dictionary.css";
import "./flashcards.css";

type Tab = "articles" | "cards" | "marks";
type Status = "wait" | "busy" | "done" | "error";

/** Artículos plegados en «Tus flashcards», recordados entre visitas. */
const FOLDED = "nexo-flashcards-folded";
const groupKey = (c: Flashcard) => c.reading_id ?? "—" + c.source;
function loadFolded(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLDED) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

const needleOf = (q: string) => normalizeText(q.trim());

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Cuándo vuelve una tarjeta al repaso y, si ya la repasaste, qué tan fresca la tienes. */
function nextReview(c: Flashcard) {
  if (c.review_step < 0) return "Fuera del repaso";
  if (!c.review_due) return "Entra al repaso mañana";
  const today = todayInputValue();
  const when =
    c.review_due <= today
      ? "Toca repasarla hoy"
      : "Repaso: " + friendlyDate(c.review_due, today).toLowerCase();
  const r = recallToday(memoryOf(c), today);
  return r === null ? when : `${when} · la recuerdas al ${Math.round(r * 100)} %`;
}

/** ¿Ya hay una tarjeta hecha con este subrayado? */
const madeFrom = (h: Highlight, cards: Flashcard[]) => {
  const q = normalizeText(h.quote.replace(/\s+/g, " ").trim());
  return cards.some(
    (c) =>
      c.reading_id === h.reading_id &&
      (normalizeText(clozePlain(c.front).replace(/\s+/g, " ")).includes(q) ||
        normalizeText(c.back.replace(/\s+/g, " ")).includes(q)),
  );
};

/**
 * Flashcards de Lecturas: eliges artículos ya leídos, la IA saca lo esencial en tarjetas de
 * pregunta y respuesta, y estas entran en el repaso espaciado de la agenda.
 */
export function Flashcards({
  open,
  back,
}: {
  /** Abre el artículo de donde salió una tarjeta. */
  open: (readingId: string) => void;
  back: () => void;
}) {
  const { notify } = useApp();
  const [articles, setArticles] = useState<ReadArticle[] | null>(null);
  // null: falta la migración.
  const [cards, setCards] = useState<Flashcard[] | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("articles");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  // Modo estudio: las tarjetas que se ven, desde la elegida.
  const [study, setStudy] = useState<{ deck: Flashcard[]; start: number } | null>(
    null,
  );
  // Tarjeta abierta en el editor: una tuya para editarla o una nueva (vacía o de un subrayado).
  const [editor, setEditor] = useState<{
    card?: Flashcard;
    seed?: CardSeed;
  } | null>(null);
  // Tus subrayados: se cargan al abrir su pestaña.
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [hlError, setHlError] = useState("");
  useEffect(() => {
    if (tab !== "marks" || highlights) return;
    let live = true;
    loadHighlights()
      .then((h) => live && setHighlights(h))
      .catch((e) => live && setHlError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [tab, highlights]);
  const shownHighlights = useMemo(
    () =>
      (highlights ?? []).filter(
        (h) =>
          !needleOf(query) ||
          normalizeText(`${h.quote} ${h.note} ${h.title}`).includes(
            needleOf(query),
          ),
      ),
    [highlights, query],
  );
  function savedCards(rows: Flashcard[], edited: boolean) {
    if (edited)
      setCards((v) =>
        (v ?? []).map((c) => rows.find((r) => r.id === c.id) ?? c),
      );
    else {
      setCards((v) => [...rows, ...(v ?? [])]);
      notify(
        rows.length === 1
          ? "Flashcard creada: entra a tu repaso mañana."
          : `${rows.length} flashcards creadas: entran a tu repaso mañana.`,
      );
    }
  }

  useEffect(() => {
    let live = true;
    Promise.all([readArticles(), loadFlashcards()])
      .then(([a, c]) => {
        if (!live) return;
        setArticles(a);
        setCards(c);
      })
      .catch((e) => live && setLoadError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  const byArticle = useMemo(() => {
    const m = new Map<string, Flashcard[]>();
    for (const c of cards ?? [])
      if (c.reading_id) m.set(c.reading_id, [...(m.get(c.reading_id) ?? []), c]);
    return m;
  }, [cards]);
  const needle = normalizeText(query.trim());
  const shownArticles = useMemo(
    () =>
      (articles ?? []).filter(
        (a) =>
          !needle || normalizeText(`${a.title} ${a.url}`).includes(needle),
      ),
    [articles, needle],
  );
  const shownCards = useMemo(
    () =>
      (cards ?? []).filter(
        (c) =>
          !needle ||
          normalizeText(`${c.front} ${c.back} ${c.source}`).includes(needle),
      ),
    [cards, needle],
  );
  // Tarjetas agrupadas por artículo, en el orden en que se crearon.
  const groups = useMemo(() => {
    const m = new Map<string, Flashcard[]>();
    for (const c of shownCards) {
      const k = groupKey(c);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.values()];
  }, [shownCards]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(loadFolded);
  const fold = (key: string) =>
    setFolded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(FOLDED, JSON.stringify([...next]));
      } catch {
        /* sin almacenamiento: se pliega solo en esta visita */
      }
      return next;
    });
  // En el mismo orden en que se ven en la lista.
  const deck = useMemo(() => groups.flat(), [groups]);
  const studyFrom = (c: Flashcard) =>
    setStudy({ deck, start: Math.max(0, deck.indexOf(c)) });

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function generate() {
    const list = (articles ?? []).filter((a) => picked.has(a.id));
    if (!list.length || running) return;
    setRunning(true);
    setStatus(Object.fromEntries(list.map((a) => [a.id, "wait" as Status])));
    setErrors({});
    let made = 0;
    let failed = 0;
    // De uno en uno: cada artículo es una consulta a la IA.
    for (const a of list) {
      setStatus((s) => ({ ...s, [a.id]: "busy" }));
      try {
        const avoid = (byArticle.get(a.id) ?? []).map((c) => c.front);
        const fresh = await generateFlashcards(a, avoid);
        made += fresh.length;
        setCards((v) => [...fresh, ...(v ?? [])]);
        setStatus((s) => ({ ...s, [a.id]: "done" }));
        setPicked((s) => {
          const next = new Set(s);
          next.delete(a.id);
          return next;
        });
      } catch (e) {
        failed++;
        const msg = errorMessage(e);
        setStatus((s) => ({ ...s, [a.id]: "error" }));
        setErrors((v) => ({ ...v, [a.id]: msg }));
        // Sin la migración, la función actualizada o cuota, no tiene sentido seguir.
        if (/SQL Editor|functions deploy|Límite diario|límite de uso/.test(msg)) {
          notify(msg);
          break;
        }
      }
    }
    setRunning(false);
    if (made)
      notify(
        `${made} ${made === 1 ? "flashcard nueva" : "flashcards nuevas"} en tu repaso espaciado` +
          (failed ? ` · ${failed} con error.` : "."),
      );
  }

  async function remove(c: Flashcard) {
    setCards((v) => (v ?? []).filter((x) => x.id !== c.id));
    try {
      await deleteFlashcard(c.id);
    } catch (e) {
      setCards((v) => [c, ...(v ?? [])]);
      notify("No se pudo eliminar: " + errorMessage(e));
    }
  }

  const total = cards?.length ?? 0;
  const inReview = (cards ?? []).filter((c) => c.review_step >= 0).length;
  const withCards = byArticle.size;
  const pickedCount = picked.size;

  return (
    <section className="dc fc" aria-label="Flashcards">
      <header className="dc-head">
        <span className="dc-mark" aria-hidden="true">
          <Layers size={19} />
        </span>
        <div className="dc-title">
          <h2>Flashcards</h2>
          <small>
            {cards === undefined && !loadError
              ? "Cargando…"
              : total
                ? `${inReview} en tu repaso · de ${withCards} ${withCards === 1 ? "artículo" : "artículos"}`
                : "Lo esencial de tus lecturas, en tarjetas de estudio"}
          </small>
        </div>
        <button
          type="button"
          className="dc-btn"
          disabled={!cards}
          title="Escribir una tarjeta a mano"
          onClick={() => setEditor({ seed: {} })}
        >
          <Plus size={15} /> Nueva
        </button>
        <button
          type="button"
          className="dc-btn primary"
          disabled={!pickedCount || running || cards === null}
          onClick={() => void generate()}
        >
          {running ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Sparkles size={15} />
          )}
          {running
            ? "Creando…"
            : pickedCount
              ? `Crear flashcards (${pickedCount})`
              : "Crear flashcards"}
        </button>
        <button
          type="button"
          className="dc-icon"
          title="Volver a Lecturas"
          aria-label="Cerrar las flashcards"
          onClick={back}
        >
          <X size={18} />
        </button>
      </header>

      {loadError ? (
        <div className="dc-empty" role="alert">
          <strong>No se pudieron cargar</strong>
          <p>{loadError}</p>
        </div>
      ) : cards === null ? (
        <div className="dc-empty">
          <Layers size={26} />
          <strong>Falta un paso</strong>
          <p>
            Para usar las flashcards ejecuta <code>{FLASHCARDS_SQL}</code> en el
            SQL Editor de Supabase.
          </p>
        </div>
      ) : (
        <>
          <div className="dc-tools">
            <div className="dc-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "articles"}
                className={tab === "articles" ? "on" : ""}
                onClick={() => setTab("articles")}
              >
                Artículos leídos <b>{articles?.length ?? ""}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "cards"}
                className={tab === "cards" ? "on" : ""}
                onClick={() => setTab("cards")}
              >
                Tus flashcards <b>{cards ? total : ""}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "marks"}
                className={tab === "marks" ? "on" : ""}
                onClick={() => setTab("marks")}
              >
                Tus subrayados <b>{highlights?.length ?? ""}</b>
              </button>
            </div>
            <label className="dc-search">
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="Buscar"
                placeholder={
                  tab === "articles"
                    ? "Buscar artículos…"
                    : tab === "marks"
                      ? "Buscar subrayados…"
                      : "Buscar tarjetas…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Borrar la búsqueda"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          {tab === "marks" ? (
            hlError ? (
              <div className="dc-empty" role="alert">
                <strong>No se pudieron cargar tus subrayados</strong>
                <p>{hlError}</p>
              </div>
            ) : !highlights ? (
              <p className="dc-none">Cargando…</p>
            ) : !highlights.length ? (
              <div className="dc-empty">
                <Highlighter size={26} />
                <strong>Aún no tienes subrayados</strong>
                <p>
                  Selecciona un fragmento de un artículo para resaltarlo. Luego
                  podrás convertirlo aquí en una tarjeta de huecos o de
                  pregunta.
                </p>
              </div>
            ) : !shownHighlights.length ? (
              <p className="dc-none">Nada coincide con «{query}».</p>
            ) : (
              <>
                <div className="fc-bulk">
                  <span>
                    Convierte un subrayado en tarjeta: con huecos (ocultas lo
                    que quieres recordar) o con una pregunta tuya.
                  </span>
                </div>
                <ul className="dc-list">
                  {shownHighlights.slice(0, 300).map((h) => {
                    const done = madeFrom(h, cards ?? []);
                    const seed = {
                      reading_id: h.reading_id,
                      source: h.title,
                    };
                    return (
                      <li key={h.id} className="dc-item fc-hl">
                        <div className="dc-main">
                          <q>{h.quote}</q>
                          {h.note.trim() && !h.note.startsWith("✦") && (
                            <span className="fc-hl-note">{h.note.trim()}</span>
                          )}
                          <span className="dc-meta">
                            <span>{h.title}</span>
                            {done && (
                              <span className="fc-has">Ya tiene tarjeta</span>
                            )}
                          </span>
                        </div>
                        <div className="dc-acts">
                          <button
                            type="button"
                            className="dc-btn ghost sm"
                            title="Tarjeta de huecos: ocultas las palabras clave"
                            onClick={() =>
                              setEditor({
                                seed: { ...seed, kind: "cloze", front: h.quote },
                              })
                            }
                          >
                            <Brackets size={14} /> Huecos
                          </button>
                          <button
                            type="button"
                            className="dc-btn ghost sm"
                            title="Tarjeta de pregunta: el subrayado es la respuesta"
                            onClick={() =>
                              setEditor({
                                seed: { ...seed, kind: "qa", back: h.quote },
                              })
                            }
                          >
                            <MessageCircleQuestion size={14} /> Pregunta
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {shownHighlights.length > 300 && (
                  <p className="dc-none">
                    Se muestran 300 de {shownHighlights.length}: busca para
                    encontrar el resto.
                  </p>
                )}
              </>
            )
          ) : tab === "articles" ? (
            articles === null || cards === undefined ? (
              <p className="dc-none">Cargando…</p>
            ) : !articles.length ? (
              <div className="dc-empty">
                <Layers size={26} />
                <strong>Aún no hay artículos leídos</strong>
                <p>
                  Marca un artículo como leído al terminarlo y aquí podrás
                  convertir lo esencial en flashcards.
                </p>
              </div>
            ) : (
              <>
                <div className="fc-bulk">
                  <span>
                    {pickedCount
                      ? `${pickedCount} ${pickedCount === 1 ? "elegido" : "elegidos"}`
                      : "Elige los artículos que quieres estudiar"}
                  </span>
                  <button
                    type="button"
                    className="dc-btn ghost sm"
                    disabled={running}
                    onClick={() =>
                      setPicked(
                        new Set(
                          shownArticles
                            .filter((a) => !byArticle.has(a.id))
                            .map((a) => a.id),
                        ),
                      )
                    }
                  >
                    Elegir los que no tienen
                  </button>
                  {pickedCount > 0 && (
                    <button
                      type="button"
                      className="dc-btn ghost sm"
                      disabled={running}
                      onClick={() => setPicked(new Set())}
                    >
                      Quitar selección
                    </button>
                  )}
                </div>
                {!shownArticles.length ? (
                  <p className="dc-none">Nada coincide con «{query}».</p>
                ) : (
                  <ul className="dc-list">
                    {shownArticles.map((a) => {
                      const n = byArticle.get(a.id)?.length ?? 0;
                      const st = status[a.id];
                      const on = picked.has(a.id);
                      return (
                        <li
                          key={a.id}
                          className={"dc-item fc-article" + (on ? " on" : "")}
                        >
                          <button
                            type="button"
                            className="dc-check"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={"Elegir «" + a.title + "»"}
                            disabled={running}
                            onClick={() => toggle(a.id)}
                          >
                            <Check size={13} strokeWidth={3} />
                          </button>
                          <button
                            type="button"
                            className="dc-main"
                            disabled={running}
                            onClick={() => toggle(a.id)}
                          >
                            <span className="fc-title">{a.title}</span>
                            <span className="dc-meta">
                              {host(a.url) && <span>{host(a.url)}</span>}
                              <span>Leído el {shortDate(a.read_at)}</span>
                              {n > 0 && (
                                <span className="fc-has">
                                  {n} {n === 1 ? "flashcard" : "flashcards"}
                                </span>
                              )}
                            </span>
                            {st === "error" && errors[a.id] && (
                              <span className="fc-error" role="alert">
                                {errors[a.id]}
                              </span>
                            )}
                          </button>
                          <span className="fc-status" aria-live="polite">
                            {st === "busy" && (
                              <LoaderCircle className="spin" size={16} />
                            )}
                            {st === "wait" && <i>En cola</i>}
                            {st === "done" && (
                              <Check size={16} className="fc-ok" />
                            )}
                          </span>
                          <div className="dc-acts">
                            <button
                              type="button"
                              className="dc-icon sm"
                              title="Abrir el artículo"
                              aria-label="Abrir el artículo"
                              onClick={() => open(a.id)}
                            >
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )
          ) : cards === undefined ? (
            <p className="dc-none">Cargando…</p>
          ) : !total ? (
            <div className="dc-empty">
              <Layers size={26} />
              <strong>Todavía no tienes flashcards</strong>
              <p>
                En «Artículos leídos» elige los que quieres estudiar y pulsa
                «Crear flashcards», escribe una con «Nueva» o conviértelos desde
                «Tus subrayados». Desde mañana aparecen en el repaso de la
                agenda.
              </p>
            </div>
          ) : !groups.length ? (
            <p className="dc-none">Nada coincide con «{query}».</p>
          ) : (
            <>
            <div className="fc-bulk">
              <span>
                {deck.length}{" "}
                {deck.length === 1 ? "tarjeta" : "tarjetas"} · toca una para
                estudiarla
              </span>
              <button
                type="button"
                className="dc-btn primary sm"
                onClick={() => setStudy({ deck, start: 0 })}
              >
                <Play size={14} />
                Estudiar {query ? "estas" : "todas"}
              </button>
            </div>
            <div className="fc-groups">
              {groups.map((g) => {
                const first = g[0];
                const key = groupKey(first);
                // Al buscar se despliegan todas, para ver las coincidencias.
                const shut = !needle && folded.has(key);
                const listId = "fc-list-" + first.id;
                return (
                  <section
                    key={key}
                    className={"fc-group" + (shut ? " shut" : "")}
                  >
                    <h3>
                      <button
                        type="button"
                        className="fc-fold"
                        aria-expanded={!shut}
                        aria-controls={listId}
                        title={shut ? "Mostrar las tarjetas" : "Plegar las tarjetas"}
                        aria-label={
                          (shut ? "Mostrar" : "Plegar") +
                          " las flashcards de «" +
                          (first.source || "este artículo") +
                          "»"
                        }
                        disabled={!!needle}
                        onClick={() => fold(key)}
                      >
                        <ChevronDown size={16} />
                      </button>
                      {first.reading_id ? (
                        <button
                          type="button"
                          title="Abrir el artículo"
                          onClick={() => open(first.reading_id!)}
                        >
                          {first.source || "Artículo"}
                          <ArrowUpRight size={14} />
                        </button>
                      ) : (
                        <span>{first.source || "Artículo eliminado"}</span>
                      )}
                      <small>{g.length}</small>
                      <button
                        type="button"
                        className="fc-play"
                        title="Estudiar las de este artículo"
                        aria-label={
                          "Estudiar las flashcards de «" +
                          (first.source || "este artículo") +
                          "»"
                        }
                        onClick={() => setStudy({ deck: g, start: 0 })}
                      >
                        <Play size={13} />
                        Estudiar
                      </button>
                    </h3>
                    {!shut && (
                    <ul className="dc-list" id={listId}>
                      {g.map((c) => {
                        const f = flashFaces(c);
                        return (
                        <li
                          key={c.id}
                          className={
                            "dc-item fc-card" + (c.review_step < 0 ? " off" : "")
                          }
                        >
                          <button
                            type="button"
                            className="fc-faces"
                            title="Estudiar desde esta tarjeta"
                            onClick={() => studyFrom(c)}
                          >
                            <strong>{f.front}</strong>
                            <p>{f.cloze ? f.back.replace(/\*\*/g, "") : f.back}</p>
                            <span className="dc-meta">
                              {f.cloze && (
                                <span className="fc-type">
                                  <Brackets size={12} /> Huecos
                                </span>
                              )}
                              <span>{nextReview(c)}</span>
                            </span>
                          </button>
                          <div className="dc-acts">
                            <button
                              type="button"
                              className="dc-icon sm"
                              title="Editar la flashcard"
                              aria-label="Editar la flashcard"
                              onClick={() => setEditor({ card: c })}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="dc-icon sm danger"
                              title="Eliminar la flashcard"
                              aria-label="Eliminar la flashcard"
                              onClick={() => void remove(c)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                    )}
                  </section>
                );
              })}
            </div>
            </>
          )}
        </>
      )}
      {study && (
        <FlashcardViewer
          cards={study.deck}
          start={study.start}
          onClose={() => setStudy(null)}
        />
      )}
      {editor && (
        <CardEditor
          card={editor.card}
          seed={editor.seed}
          close={() => setEditor(null)}
          saved={savedCards}
        />
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Lightbulb,
  Map as MapIcon,
} from "lucide-react";
import { layersOf, wordsIn, type Paragraph } from "./layers";
import { WORDS_PER_MINUTE } from "./media";

type Layer = "map" | "ideas" | "guided";
type Mark = { start_offset: number; end_offset: number };

const minutes = (n: number) => Math.max(1, Math.round(n / WORDS_PER_MINUTE));

/**
 * Lectura en capas: primero el mapa (títulos y primeras frases), luego las ideas clave y al final
 * la lectura guiada, párrafo a párrafo, con una pausa para recordar al cerrar cada sección.
 * Tocar cualquier frase del mapa o de las ideas lleva a ese punto de la lectura guiada.
 */
export function LayeredReader({
  title,
  content,
  marks,
  close,
}: {
  title: string;
  content: string;
  marks: Mark[];
  /** Vuelve al artículo; `at`: la posición del texto donde ibas. */
  close: (at?: number) => void;
}) {
  const sections = useMemo(() => layersOf(content, marks), [content, marks]);
  // Todos los párrafos en orden, con su sección.
  const flat = useMemo(
    () =>
      sections.flatMap((sec, si) =>
        sec.paragraphs.map((p, pi) => ({
          p,
          si,
          last: pi === sec.paragraphs.length - 1,
        })),
      ),
    [sections],
  );
  const [layer, setLayer] = useState<Layer>("map");
  const [at, setAt] = useState(0);
  // Pausa para recordar al terminar una sección (antes de pasar a la siguiente).
  const [pause, setPause] = useState<number | null>(null);
  const [recall, setRecall] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const stage = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => {
    const every = sections.flatMap((s) =>
      s.paragraphs.flatMap((p) => p.sentences),
    );
    return {
      map: wordsIn(
        sections.flatMap((s) =>
          s.paragraphs.map((p) => p.sentences[0]).filter(Boolean),
        ),
      ),
      ideas: wordsIn(every.filter((s) => s.key)),
      all: wordsIn(every),
    };
  }, [sections]);

  const goTo = (start: number) => {
    const i = flat.findIndex((f) => f.p.start >= start);
    setAt(i < 0 ? flat.length - 1 : i);
    setPause(null);
    setLayer("guided");
  };
  function next() {
    const cur = flat[at];
    if (!cur) return;
    // Al cerrar una sección (si hay otra después), primero la pausa para recordar.
    if (
      cur.last &&
      pause === null &&
      at < flat.length - 1 &&
      sections.length > 1
    ) {
      setPause(cur.si);
      return;
    }
    setPause(null);
    setAt((i) => Math.min(flat.length, i + 1));
  }
  function prev() {
    if (pause !== null) return setPause(null);
    setAt((i) => Math.max(0, i - 1));
  }

  // Teclado: flechas o espacio para avanzar; Esc vuelve al artículo.
  const keys = useRef({ next, prev, layer, close, at });
  keys.current = { next, prev, layer, close, at };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea")) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const k = keys.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        k.close(flat[k.at]?.p.start);
      } else if (
        k.layer === "guided" &&
        (e.key === "ArrowRight" || e.key === " ")
      ) {
        e.preventDefault();
        k.next();
      } else if (k.layer === "guided" && e.key === "ArrowLeft") {
        e.preventDefault();
        k.prev();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [flat]);
  useEffect(() => {
    stage.current?.scrollTo({ top: 0 });
  }, [layer]);

  const done = at >= flat.length;
  const cur = flat[at];
  const section = cur ? sections[cur.si] : null;

  const para = (p: Paragraph, focus: boolean) => (
    <p className={"ly-para " + p.kind + (focus ? " focus" : "")}>
      {p.sentences.map((s, i) => (
        <span key={i} className={s.key ? "ly-key" : undefined}>
          {s.text}{" "}
        </span>
      ))}
    </p>
  );

  return (
    <section className="ly" aria-label="Lectura en capas">
      <header className="ly-head">
        <button type="button" onClick={() => close(flat[at]?.p.start)}>
          <ArrowLeft size={17} /> Volver al texto
        </button>
        <div className="ly-tabs" role="tablist" aria-label="Capas">
          {(
            [
              ["map", MapIcon, "1 · Mapa", totals.map],
              ["ideas", Lightbulb, "2 · Ideas clave", totals.ideas],
              ["guided", Footprints, "3 · Lectura guiada", totals.all],
            ] as const
          ).map(([id, Icon, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={layer === id}
              className={layer === id ? "on" : ""}
              onClick={() => setLayer(id)}
            >
              <Icon size={15} /> {label} <small>{minutes(n)} min</small>
            </button>
          ))}
        </div>
      </header>

      <div className="ly-stage" ref={stage}>
        {layer === "map" && (
          <div className="ly-doc">
            <h2>{title}</h2>
            <p className="ly-lead">
              La estructura en un vistazo: cada título y la primera frase de
              cada párrafo. Toca una frase para leer desde ahí.
            </p>
            {sections.map((sec, si) => (
              <div key={si} className="ly-sec">
                {sec.title && <h3>{sec.title}</h3>}
                <ul>
                  {sec.paragraphs.map((p) =>
                    p.sentences[0] ? (
                      <li key={p.start}>
                        <button type="button" onClick={() => goTo(p.start)}>
                          {p.sentences[0].text}
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ))}
            <button
              type="button"
              className="ly-next"
              onClick={() => setLayer("ideas")}
            >
              Siguiente capa: ideas clave <ChevronRight size={16} />
            </button>
          </div>
        )}

        {layer === "ideas" && (
          <div className="ly-doc">
            <h2>Ideas clave</h2>
            <p className="ly-lead">
              Las frases que más concentran los temas del artículo (y las que
              resaltaste). Toca una para leerla en su contexto.
            </p>
            {sections.map((sec, si) => {
              const keys = sec.paragraphs.flatMap((p) =>
                p.sentences.filter((s) => s.key).map((s) => ({ s, p })),
              );
              if (!keys.length) return null;
              return (
                <div key={si} className="ly-sec">
                  {sec.title && <h3>{sec.title}</h3>}
                  <ul className="ly-ideas">
                    {keys.map(({ s, p }, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => goTo(p.start)}>
                          {s.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <button type="button" className="ly-next" onClick={() => goTo(0)}>
              Siguiente capa: lectura guiada <ChevronRight size={16} />
            </button>
          </div>
        )}

        {layer === "guided" && (
          <div className="ly-guided">
            <progress
              aria-label="Progreso de la lectura guiada"
              max={flat.length || 1}
              value={Math.min(at, flat.length)}
            />
            {done ? (
              <div className="ly-end">
                <h2>Lectura completada</h2>
                <p>
                  Leíste el artículo en tres pasadas: estructura, ideas y
                  detalle. Lo que recuerdes ahora es lo que te llevas.
                </p>
                <div>
                  <button type="button" onClick={() => setAt(0)}>
                    Empezar de nuevo
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => close()}
                  >
                    Volver al texto
                  </button>
                </div>
              </div>
            ) : pause !== null ? (
              <div className="ly-pause">
                <small>
                  Pausa para recordar · {sections[pause].title || "Esta parte"}
                </small>
                <h3>Antes de seguir: ¿qué te llevas de esta parte?</h3>
                <textarea
                  autoFocus
                  rows={3}
                  value={recall[pause] ?? ""}
                  placeholder="En una o dos frases, con tus palabras (no se guarda)"
                  onChange={(e) =>
                    setRecall((r) => ({ ...r, [pause]: e.target.value }))
                  }
                />
                {revealed.has(pause) ? (
                  <ul className="ly-ideas">
                    {sections[pause].paragraphs
                      .flatMap((p) => p.sentences.filter((s) => s.key))
                      .map((s, i) => (
                        <li key={i}>{s.text}</li>
                      ))}
                  </ul>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => new Set(r).add(pause))}
                  >
                    <Lightbulb size={14} /> Comparar con las ideas clave
                  </button>
                )}
              </div>
            ) : (
              cur && (
                <div className="ly-focus" key={at}>
                  {section?.title && (
                    <small className="ly-where">{section.title}</small>
                  )}
                  {at > 0 && flat[at - 1].si === cur.si && (
                    <div className="ly-ghost">
                      {para(flat[at - 1].p, false)}
                    </div>
                  )}
                  {para(cur.p, true)}
                  {flat[at + 1] && flat[at + 1].si === cur.si && (
                    <div className="ly-ghost">
                      {para(flat[at + 1].p, false)}
                    </div>
                  )}
                </div>
              )
            )}
            {!done && (
              <footer className="ly-foot">
                <button
                  type="button"
                  aria-label="Anterior"
                  disabled={at === 0 && pause === null}
                  onClick={prev}
                >
                  <ChevronLeft size={20} />
                </button>
                <span>
                  {Math.min(at + 1, flat.length)} / {flat.length} · espacio o →
                  para seguir
                </span>
                <button type="button" aria-label="Siguiente" onClick={next}>
                  <ChevronRight size={20} />
                </button>
              </footer>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

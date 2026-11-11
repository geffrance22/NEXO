import { useEffect, useState, type CSSProperties } from "react";
import { Calendar, Check, CheckSquare, Eye, LoaderCircle } from "lucide-react";
import { supabase } from "../backend";
import { CardText } from "./BoardCard";
import { backgroundOf, dueState, isDivider, tagTone, toneOf } from "./boardTheme";
import { priorityLabels } from "./boardRules";
import type { Priority } from "./boardStore";
import type { Check as CheckItem } from "./shared";
import { usePan } from "./usePan";
import "./boards.css";
import "./shared-board.css";

type SharedCard = {
  id: string;
  list_id: string;
  title: string;
  body: string;
  tags: string[];
  checks: CheckItem[];
  due: string | null;
  starts: string | null;
  done: boolean;
  color: string;
  priority: Priority;
};
type Shared = {
  board: { name: string; background: string; updated: string | null };
  lists: { id: string; name: string; color: string }[];
  cards: SharedCard[];
};

/**
 * Un tablero visto desde un enlace de solo lectura (?ver=…). No pide sesión: la base solo
 * entrega columnas y tarjetas sin archivar de ese tablero, y nada más. Se refresca cada minuto.
 */
export function SharedBoard({ token }: { token: string }) {
  const [data, setData] = useState<Shared | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  const [hideDone, setHideDone] = useState(false);
  const pan = usePan({ vertical: ".bd-stack" });

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("shared_board", { p_token: token });
      if (!live) return;
      if (error) return setState((s) => (s === "ready" ? s : "error"));
      if (!data) return setState("gone");
      setData(data as Shared);
      setState("ready");
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    if (data) document.title = `${data.board.name} · Nexo`;
  }, [data?.board.name]);

  if (state !== "ready" || !data)
    return (
      <div className="shb-msg">
        {state === "loading" ? (
          <LoaderCircle className="spin" size={26} />
        ) : (
          <>
            <Eye size={26} />
            <p>
              {state === "gone"
                ? "Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió."
                : "No se pudo abrir el tablero. Revisa tu conexión e inténtalo de nuevo."}
            </p>
          </>
        )}
      </div>
    );

  const bg = backgroundOf(data.board.background);
  const cards = data.cards.filter((c) => !isDivider(c.title) && (!hideDone || !c.done));
  const total = data.cards.filter((c) => !isDivider(c.title));
  const done = total.filter((c) => c.done).length;
  return (
    <section
      className={"shb" + (bg.dark ? " on-dark" : "")}
      style={{ "--bd-bg": bg.css } as CSSProperties}
    >
      <header className="shb-bar">
        <span className="shb-mark">
          <Eye size={14} />
        </span>
        <div>
          <h1>{data.board.name}</h1>
          <small>
            Solo lectura · {done} de {total.length} completadas
            {data.board.updated &&
              ` · actualizado ${new Date(data.board.updated).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          </small>
        </div>
        <label className="shb-toggle">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Ocultar completadas
        </label>
      </header>
      {/* Se desplaza agarrando el fondo o una tarjeta y arrastrando (en una columna larga, sube y baja). */}
      <div className="shb-canvas" {...pan}>
        {data.lists.map((l) => {
          const tone = toneOf(l.color);
          const here = cards.filter((c) => c.list_id === l.id);
          return (
            <section
              key={l.id}
              className={"bd-list shb-list" + (tone ? " toned" : "")}
              style={tone ? ({ "--lc": tone.c } as CSSProperties) : undefined}
            >
              <header className="bd-list-head">
                <span className="bd-list-title">
                  {tone && <i className="bd-list-dot" />}
                  <span>{l.name}</span>
                </span>
                <span className="bd-list-count">{here.length}</span>
              </header>
              <div className="bd-stack">
                {here.map((c) => {
                  const t = toneOf(c.color);
                  const due = dueState(c.due, c.done);
                  const ticked = c.checks.filter((x) => x.done).length;
                  return (
                    <article
                      key={c.id}
                      className={"bd-card shb-card" + (c.done ? " done" : "") + (t ? " tinted" : "")}
                      style={t ? ({ "--cc": t.c } as CSSProperties) : undefined}
                    >
                      <div className="bd-card-row">
                        <span className={"bd-done" + (c.done ? " on" : "")} aria-hidden="true">
                          <Check size={11} strokeWidth={3.2} />
                        </span>
                        <div className="bd-card-body">
                          {c.tags.length > 0 && (
                            <div className="bd-tags">
                              {c.tags.slice(0, 4).map((x) => {
                                const tt = tagTone(x);
                                return (
                                  <span key={x} style={{ "--tc": tt.c, "--ts": tt.s } as CSSProperties}>
                                    {x}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <span className="bd-card-title">
                            <CardText text={c.title} />
                          </span>
                          {(due || c.checks.length > 0 || c.priority) && (
                            <div className="bd-badges">
                              {c.priority && (
                                <span className={"bd-prio " + c.priority}>{priorityLabels[c.priority]}</span>
                              )}
                              {due && (
                                <span className={"bd-due " + due.tone}>
                                  <Calendar size={12} /> {due.label}
                                </span>
                              )}
                              {c.checks.length > 0 && (
                                <span>
                                  <CheckSquare size={12} /> {ticked}/{c.checks.length}
                                </span>
                              )}
                            </div>
                          )}
                          {c.body.trim() && (
                            <details className="shb-body">
                              <summary>Descripción</summary>
                              <p>
                                <CardText text={c.body} />
                              </p>
                            </details>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                {!here.length && <p className="bd-list-none">Sin tarjetas</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

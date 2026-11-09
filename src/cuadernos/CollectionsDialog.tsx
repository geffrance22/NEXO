import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BookMarked, Check, Plus, Search, X } from "lucide-react";
import type { Episode } from "../data";
import { normalizeText, shortDate } from "../lib/format";
import { episodeKindOf } from "../lib/episodes";
import { notebookColors, type Notebook } from "./model";
import "../composer/composer.css";

/** Cuántos sugeridos se ven en el menú rápido, sin buscar. */
export const SUGGESTED = 3;
/** Cuántos resultados por grupo se ven en el menú rápido al buscar. */
export const QUICK_RESULTS = 5;

const notebookText = (nb: Notebook) =>
  normalizeText(`${nb.name} ${nb.description}`);
const episodeText = (ep: Episode) =>
  normalizeText(`${ep.title} ${ep.summary} ${episodeKindOf(ep.kind).label}`);
const episodeDate = (ep: Episode) => ep.starts_on ?? ep.created_at;

/** Cuadernos: primero en los que ya está; luego los últimos que tocaste. */
export function rankNotebooks(
  list: Notebook[],
  inNotebook: (nb: Notebook) => boolean,
  needle: string,
) {
  return list
    .filter((nb) => !needle || notebookText(nb).includes(needle))
    .sort(
      (a, b) =>
        Number(inNotebook(b)) - Number(inNotebook(a)) ||
        b.updated_at.localeCompare(a.updated_at),
    );
}

/**
 * Episodios: sin buscar, solo los activos (y el elegido aunque esté cerrado, para poder quitarlo).
 * Al buscar aparecen también los cerrados, después de los activos.
 */
export function rankEpisodes(
  episodes: Episode[],
  current: string | null,
  needle: string,
) {
  return episodes
    .filter((ep) =>
      needle
        ? episodeText(ep).includes(needle)
        : ep.status === "activo" || ep.id === current,
    )
    .sort(
      (a, b) =>
        Number(b.id === current) - Number(a.id === current) ||
        Number(b.status === "activo") - Number(a.status === "activo") ||
        episodeDate(b).localeCompare(episodeDate(a)),
    );
}

const items = (n: number) => `${n} ${n === 1 ? "elemento" : "elementos"}`;

type Filter = "todo" | "cuadernos" | "episodios";

/** Todos los cuadernos y episodios en una ventana, con buscador. */
export function CollectionsDialog({
  notebooks,
  episodes,
  initialQuery = "",
  inNotebook,
  onToggleNotebook,
  episodeId,
  onEpisode,
  onCreate,
  onClose,
}: {
  notebooks: Notebook[];
  /** Vacío si aquí no se elige episodio. */
  episodes: Episode[];
  initialQuery?: string;
  inNotebook: (nb: Notebook) => boolean;
  onToggleNotebook: (nb: Notebook) => void;
  episodeId: string | null;
  onEpisode?: (id: string | null) => void;
  onCreate?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>("todo");
  const input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('.confirm[role="alertdialog"]')) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const needle = normalizeText(query.trim());
  // Lo elegido al abrir va primero y no se mueve al marcar o desmarcar.
  const [pinned] = useState(
    () => new Set(notebooks.filter(inNotebook).map((nb) => nb.id)),
  );
  const [pinnedEpisode] = useState(episodeId);
  const withEpisodes = Boolean(onEpisode) && episodes.length > 0;
  const nbs =
    filter === "episodios"
      ? []
      : rankNotebooks(notebooks, (nb) => pinned.has(nb.id), needle);
  const eps =
    !withEpisodes || filter === "cuadernos"
      ? []
      : rankEpisodes(episodes, pinnedEpisode, needle);
  const active = eps.filter(
    (ep) => ep.status === "activo" || ep.id === pinnedEpisode,
  );
  const closed = eps.filter((ep) => !active.includes(ep));
  const closedCount = episodes.filter((ep) => ep.status === "cerrado").length;

  const notebookRow = (nb: Notebook) => {
    const on = inNotebook(nb);
    const c = notebookColors[nb.color];
    return (
      <button
        type="button"
        key={nb.id}
        className={"pk-row" + (on ? " on" : "")}
        style={{ "--c": c.accent, "--s": c.soft } as CSSProperties}
        aria-pressed={on}
        onClick={() => onToggleNotebook(nb)}
      >
        <span className="pk-tile">
          <BookMarked size={17} />
        </span>
        <span>
          <strong>{nb.name}</strong>
          <small>
            {items(nb.items.length)}
            {nb.description ? ` · ${nb.description}` : ""}
          </small>
        </span>
        <i className={"pk-tick" + (on ? " on" : "")}>
          <Check size={13} strokeWidth={3} />
        </i>
      </button>
    );
  };

  const episodeRow = (ep: Episode) => {
    const on = ep.id === episodeId;
    const m = episodeKindOf(ep.kind);
    return (
      <button
        type="button"
        key={ep.id}
        className={"pk-row" + (on ? " on" : "")}
        style={{ "--c": m.color, "--s": m.soft } as CSSProperties}
        aria-pressed={on}
        onClick={() => onEpisode?.(on ? null : ep.id)}
      >
        <span className="pk-tile">
          <m.icon size={17} />
        </span>
        <span>
          <strong>{ep.title}</strong>
          <small>
            {m.label}
            {ep.starts_on ? ` · ${shortDate(ep.starts_on)}` : ""}
            {ep.status === "cerrado" ? " · cerrado" : ""}
          </small>
        </span>
        <i className={"pk-tick" + (on ? " on" : "")}>
          <Check size={13} strokeWidth={3} />
        </i>
      </button>
    );
  };

  const nothing = !nbs.length && !eps.length;

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      // Se abre desde dentro de formularios: sus eventos no deben llegar a ellos.
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
      onSubmit={(e) => e.stopPropagation()}
    >
      <div
        className="pk"
        role="dialog"
        aria-modal="true"
        aria-label="Cuadernos y episodios"
      >
        <header className="pk-head">
          <h3>{withEpisodes ? "Cuadernos y episodios" : "Cuadernos"}</h3>
          <button
            type="button"
            className="cp-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label className="pk-search">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            maxLength={80}
            placeholder={
              withEpisodes
                ? "Buscar cuadernos o episodios…"
                : "Buscar cuadernos…"
            }
            aria-label="Buscar"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          />
          {query && (
            <button
              type="button"
              className="cz-clear"
              aria-label="Borrar la búsqueda"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>
        {withEpisodes && (
          <div className="cp-chips pk-filters">
            {(["todo", "cuadernos", "episodios"] as Filter[]).map((f) => (
              <button
                type="button"
                key={f}
                className={"cp-chip" + (filter === f ? " on" : "")}
                onClick={() => setFilter(f)}
              >
                {f === "todo"
                  ? "Todo"
                  : f === "cuadernos"
                    ? "Cuadernos"
                    : "Episodios"}
              </button>
            ))}
          </div>
        )}

        <div className="pk-list">
          {nbs.length > 0 && (
            <>
              <span className="pk-group">Cuadernos</span>
              {nbs.map(notebookRow)}
            </>
          )}
          {active.length > 0 && (
            <>
              <span className="pk-group">
                {needle ? "Episodios activos" : "Episodios en curso"}
              </span>
              {active.map(episodeRow)}
            </>
          )}
          {closed.length > 0 && (
            <>
              <span className="pk-group">Episodios cerrados</span>
              {closed.map(episodeRow)}
            </>
          )}
          {nothing && (
            <p className="pp-empty pk-empty">
              {needle
                ? `Nada coincide con «${query.trim()}».`
                : filter === "episodios"
                  ? "No tienes episodios en curso."
                  : "Aún no tienes cuadernos."}
            </p>
          )}
          {!needle &&
            filter !== "cuadernos" &&
            withEpisodes &&
            closedCount > 0 && (
              <p className="cz-hint">
                Los {closedCount}{" "}
                {closedCount === 1
                  ? "episodio cerrado aparece"
                  : "episodios cerrados aparecen"}{" "}
                al buscarlos.
              </p>
            )}
        </div>

        <footer className="pk-foot">
          {onCreate ? (
            <button type="button" className="cp-btn ghost" onClick={onCreate}>
              <Plus size={16} /> Nuevo cuaderno
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="cp-btn cta" onClick={onClose}>
            <Check size={16} /> Listo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

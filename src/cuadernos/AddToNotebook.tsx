import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  FolderCheck,
  FolderPlus,
  Layers,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import type { Entry } from "../data";
import { normalizeText } from "../lib/format";
import { MenuItem, Popover } from "../planner/BoardPopover";
import {
  CollectionsDialog,
  QUICK_RESULTS,
  SUGGESTED,
  rankEpisodes,
  rankNotebooks,
} from "./CollectionsDialog";
import { hasRef, notebookColors, type Notebook } from "./model";
import { NotebookForm } from "./NotebookForm";
import { addToNotebook, updateNotebook, useCuadernos } from "./useCuadernos";
import "./cuadernos.css";

// El formulario de cuaderno se abre fuera del árbol (p. ej. del formulario de un recuerdo):
// sus eventos no deben llegar al formulario de fuera (Enter guardaría el recuerdo).
const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Icono para meter algo en tus cuadernos de Agenda (acceso directo, no se mueve de su sección)
 * y/o en un episodio. Solo muestra y avisa: quien lo usa decide si se guarda al momento o después.
 */
export function CollectionsPicker({
  inNotebook,
  onToggleNotebook,
  episodeId = null,
  onEpisode,
  className,
}: {
  inNotebook: (nb: Notebook) => boolean;
  onToggleNotebook: (nb: Notebook) => void;
  episodeId?: string | null;
  /** Sin esto no se ofrece elegir episodio. */
  onEpisode?: (id: string | null) => void;
  className: string;
}) {
  const { workspace, experiencesMissing } = useApp();
  const { list, missing } = useCuadernos();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const notebooks = list ?? [];
  const inside = notebooks.filter(inNotebook);
  const allEpisodes =
    onEpisode && !experiencesMissing ? (workspace.episodes ?? []) : [];
  const episode = episodeId
    ? workspace.episodes.find((ep) => ep.id === episodeId)
    : undefined;
  // Dónde estaba al abrir: eso va primero y no se mueve al marcar o desmarcar (la lista no salta).
  const [pinned, setPinned] = useState<{
    ids: Set<string>;
    episode: string | null;
  }>({
    ids: new Set(),
    episode: null,
  });
  const open = (rect: DOMRect) => {
    setPinned({ ids: new Set(inside.map((nb) => nb.id)), episode: episodeId });
    setAnchor(rect);
  };

  // Con ratón, el buscador queda listo para escribir; en el móvil no se abre el teclado solo.
  useEffect(() => {
    if (!anchor || !window.matchMedia("(pointer: fine)").matches) return;
    const t = window.setTimeout(() => search.current?.focus());
    return () => window.clearTimeout(t);
  }, [anchor]);

  const needle = normalizeText(query.trim());
  const limit = needle ? QUICK_RESULTS : SUGGESTED;
  const nbMatches = missing
    ? []
    : rankNotebooks(notebooks, (nb) => pinned.ids.has(nb.id), needle);
  const epMatches = rankEpisodes(allEpisodes, pinned.episode, needle);
  const nbShown = nbMatches.slice(0, limit);
  const epShown = epMatches.slice(0, limit);
  // Sin buscar, «Ver todo» también lleva a los episodios cerrados (se encuentran buscando allí).
  const hidden =
    nbMatches.length > nbShown.length ||
    epMatches.length > epShown.length ||
    (!needle && allEpisodes.length > epShown.length);

  const where = [
    ...inside.map((n) => `«${n.name}»`),
    ...(episode ? [`el episodio «${episode.title}»`] : []),
  ];
  const label = where.length
    ? `En ${where.join(", ")}`
    : "Añadir a un cuaderno o episodio";
  const Icon = where.length ? FolderCheck : FolderPlus;

  const close = () => {
    setAnchor(null);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        className={className + (where.length ? " on" : "")}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) =>
          anchor ? close() : open(e.currentTarget.getBoundingClientRect())
        }
      >
        <Icon size={16} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label="Cuadernos y episodios"
          width={280}
          align="start"
          onClose={close}
        >
          {/* Lo que se escribe aquí no debe llegar al formulario de fuera (atajos, Enter). */}
          <div onKeyDown={stop} onPaste={stop}>
            <label className="cz-qsearch">
              <Search size={14} />
              <input
                ref={search}
                value={query}
                maxLength={80}
                placeholder={
                  allEpisodes.length
                    ? "Buscar cuaderno o episodio…"
                    : "Buscar cuaderno…"
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
                    search.current?.focus();
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </label>

            <div className="bd-pop-label">
              {needle ? "Cuadernos" : "Cuadernos sugeridos"}
            </div>
            {missing ? (
              <MenuItem disabled onClick={() => undefined}>
                Falta la migración de cuadernos
              </MenuItem>
            ) : (
              <>
                {nbShown.map((nb) => (
                  <MenuItem
                    key={nb.id}
                    icon={
                      inNotebook(nb) ? (
                        <Check size={14} />
                      ) : (
                        <i
                          className="cz-dot"
                          style={{
                            background: notebookColors[nb.color].accent,
                          }}
                        />
                      )
                    }
                    hint={String(nb.items.length)}
                    onClick={() => onToggleNotebook(nb)}
                  >
                    {nb.name}
                  </MenuItem>
                ))}
                {needle && !nbShown.length && (
                  <p className="cz-qempty">Ningún cuaderno coincide.</p>
                )}
                {!needle && (
                  <MenuItem
                    icon={<Plus size={14} />}
                    onClick={() => {
                      close();
                      setCreating(true);
                    }}
                  >
                    Nuevo cuaderno…
                  </MenuItem>
                )}
              </>
            )}

            {allEpisodes.length > 0 && (
              <>
                <div className="bd-pop-sep" />
                <div className="bd-pop-label">
                  {needle ? "Episodios" : "Episodios en curso"}
                </div>
                {epShown.map((ep) => (
                  <MenuItem
                    key={ep.id}
                    icon={
                      ep.id === episodeId ? (
                        <Check size={14} />
                      ) : (
                        <Layers size={14} />
                      )
                    }
                    hint={ep.status === "cerrado" ? "cerrado" : undefined}
                    onClick={() =>
                      onEpisode?.(ep.id === episodeId ? null : ep.id)
                    }
                  >
                    {ep.title}
                  </MenuItem>
                ))}
                {!epShown.length && (
                  <p className="cz-qempty">
                    {needle
                      ? "Ningún episodio coincide."
                      : "Ningún episodio en curso."}
                  </p>
                )}
              </>
            )}

            {hidden && (
              <>
                <div className="bd-pop-sep" />
                <button
                  type="button"
                  className="cz-qmore"
                  onClick={() => {
                    setAnchor(null);
                    setBrowsing(true);
                  }}
                >
                  {needle ? "Ver todos los resultados" : "Ver todos"}
                  <ChevronRight size={14} />
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
      {browsing && (
        <CollectionsDialog
          notebooks={missing ? [] : notebooks}
          episodes={allEpisodes}
          initialQuery={query}
          inNotebook={inNotebook}
          onToggleNotebook={onToggleNotebook}
          episodeId={episodeId}
          onEpisode={onEpisode}
          onCreate={
            missing
              ? undefined
              : () => {
                  setBrowsing(false);
                  setQuery("");
                  setCreating(true);
                }
          }
          onClose={() => {
            setBrowsing(false);
            setQuery("");
          }}
        />
      )}
      {creating &&
        createPortal(
          <div
            style={{ display: "contents" }}
            onSubmit={stop}
            onKeyDown={stop}
            onPaste={stop}
            onDragOver={stop}
            onDrop={stop}
          >
            <NotebookForm
              onClose={() => setCreating(false)}
              onCreated={onToggleNotebook}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/** En la ficha de un recuerdo: cada cambio se guarda al momento. */
export function AddToNotebook({ entry }: { entry: Entry }) {
  const { notify, go, linkEntries } = useApp();
  const { list } = useCuadernos();

  async function toggle(nb: Notebook) {
    // El cuaderno recién creado aún no está en la lista de este render.
    const current = (list ?? []).find((n) => n.id === nb.id) ?? nb;
    if (hasRef(current, "entry", entry.id)) {
      const ok = await updateNotebook(nb.id, {
        items: current.items.filter(
          (i) => !(i.type === "entry" && i.id === entry.id),
        ),
      });
      notify(ok === true ? `Quitado de «${nb.name}».` : ok);
      return;
    }
    const n = await addToNotebook(nb.id, [{ type: "entry", id: entry.id }]);
    if (typeof n === "string") notify(n);
    else
      notify(`Añadido a «${nb.name}».`, {
        label: "Abrir",
        icon: "open",
        run: () => go("Agenda", nb),
      });
  }

  return (
    <CollectionsPicker
      className="ev-btn ev-icon"
      inNotebook={(nb) => hasRef(nb, "entry", entry.id)}
      onToggleNotebook={(nb) => void toggle(nb)}
      episodeId={entry.episode_id ?? null}
      onEpisode={(id) => void linkEntries([entry.id], id)}
    />
  );
}

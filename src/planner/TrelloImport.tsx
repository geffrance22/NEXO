import { useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Check, FileUp, LoaderCircle, Trello, X } from "lucide-react";
import { useApp } from "../AppContext";
import type { BoardListApi } from "./boardStore";
import {
  MAX_TRELLO_BYTES,
  readTrello,
  trelloToSpec,
  type TrelloBoard,
  type TrelloOptions,
} from "./trelloParse";
import "./trello.css";

type Item =
  | { key: string; ok: true; board: TrelloBoard; name: string; on: boolean }
  | { key: string; ok: false; file: string; error: string };

const n = (v: number, one: string, many: string) => `${v.toLocaleString("es")} ${v === 1 ? one : many}`;

/**
 * Importar tableros completos desde Trello: uno o varios archivos JSON exportados. Cada uno se
 * convierte en un tablero con sus listas, tarjetas, etiquetas, listas de verificación y fechas.
 */
export function TrelloImport({
  list,
  onDone,
  onClose,
}: {
  list: BoardListApi;
  /** El último tablero creado (para abrirlo) y cuántos se importaron. */
  onDone: (id: string, count: number) => void;
  onClose: () => void;
}) {
  const { notify } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [opts, setOpts] = useState<TrelloOptions>({ archived: false, comments: true });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<{ at: number; of: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | File[]) => {
    const next: Item[] = [];
    for (const f of Array.from(files)) {
      const key = crypto.randomUUID();
      if (!/\.json$/i.test(f.name) && f.type !== "application/json") {
        next.push({ key, ok: false, file: f.name, error: "No es un archivo .json." });
        continue;
      }
      if (f.size > MAX_TRELLO_BYTES) {
        next.push({ key, ok: false, file: f.name, error: "Es demasiado grande (máximo 60 MB)." });
        continue;
      }
      try {
        const board = readTrello(await f.text(), f.name);
        next.push({ key, ok: true, board, name: board.name, on: true });
      } catch (e) {
        next.push({ key, ok: false, file: f.name, error: (e as Error).message });
      }
    }
    setItems((v) => [...v, ...next]);
  };

  const ready = items.filter((i): i is Extract<Item, { ok: true }> => i.ok && i.on);
  const run = async () => {
    if (!ready.length || busy) return;
    let last = "";
    let made = 0;
    for (let k = 0; k < ready.length; k++) {
      const it = ready[k];
      setBusy({ at: k + 1, of: ready.length });
      const id = await list.createFrom(
        trelloToSpec(it.board, opts),
        it.name.trim() || it.board.name,
      );
      if (!id) continue;
      last = id;
      made += 1;
      setItems((v) => v.filter((x) => x.key !== it.key));
    }
    setBusy(null);
    if (made) onDone(last, made);
    else notify("No se pudo importar. Revisa la conexión e inténtalo de nuevo.");
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
  };
  const cards = ready.reduce(
    (s, i) => s + i.board.stats.cards + (opts.archived ? i.board.stats.archived : 0),
    0,
  );

  return createPortal(
    <div
      className="bv-modal-back"
      onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="bv-modal tri"
        role="dialog"
        aria-modal="true"
        aria-label="Importar de Trello"
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!over) setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDrop={drop}
      >
        <header className="bv-modal-head">
          <span className="tri-mark" aria-hidden="true">
            <Trello size={18} />
          </span>
          <div>
            <strong>Importar de Trello</strong>
            <span>
              En Trello, abre el tablero y ve a Menú → Imprimir, exportar y compartir → Exportar
              como JSON. Puedes traer varios a la vez.
            </span>
          </div>
          <button
            type="button"
            className="bv-icon"
            aria-label="Cerrar"
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <button
          type="button"
          className={"tri-drop" + (over ? " over" : "")}
          disabled={Boolean(busy)}
          onClick={() => input.current?.click()}
        >
          <FileUp size={20} />
          <strong>{items.length ? "Añadir más archivos" : "Elige los archivos .json"}</strong>
          <small>o arrástralos aquí</small>
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void add(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 && (
          <ul className="tri-list">
            {items.map((it) =>
              it.ok ? (
                <li key={it.key} className={it.on ? "" : "off"}>
                  <button
                    type="button"
                    className="tri-check"
                    role="checkbox"
                    aria-checked={it.on}
                    aria-label={it.on ? "No importar este tablero" : "Importar este tablero"}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setItems((v) =>
                        v.map((x) => (x.key === it.key && x.ok ? { ...x, on: !x.on } : x)),
                      )
                    }
                  >
                    <Check size={11} strokeWidth={3.2} />
                  </button>
                  <div className="tri-main">
                    <input
                      value={it.name}
                      maxLength={120}
                      aria-label="Nombre del tablero"
                      disabled={Boolean(busy)}
                      onChange={(e) =>
                        setItems((v) =>
                          v.map((x) =>
                            x.key === it.key && x.ok ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <small>
                      {[
                        n(it.board.stats.lists, "columna", "columnas"),
                        n(it.board.stats.cards, "tarjeta", "tarjetas"),
                        it.board.stats.checks > 0 &&
                          n(it.board.stats.checks, "punto de lista", "puntos de lista"),
                        it.board.stats.archived > 0 &&
                          n(it.board.stats.archived, "archivada", "archivadas"),
                        it.board.stats.comments > 0 &&
                          n(it.board.stats.comments, "comentario", "comentarios"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="bv-icon"
                    aria-label="Quitar de la lista"
                    disabled={Boolean(busy)}
                    onClick={() => setItems((v) => v.filter((x) => x.key !== it.key))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ) : (
                <li key={it.key} className="bad">
                  <span className="tri-bad" aria-hidden="true">
                    !
                  </span>
                  <div className="tri-main">
                    <b>{it.file}</b>
                    <small>{it.error}</small>
                  </div>
                  <button
                    type="button"
                    className="bv-icon"
                    aria-label="Quitar de la lista"
                    onClick={() => setItems((v) => v.filter((x) => x.key !== it.key))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        <div className="tri-opts">
          <button
            type="button"
            role="switch"
            aria-checked={opts.archived}
            disabled={Boolean(busy)}
            onClick={() => setOpts((o) => ({ ...o, archived: !o.archived }))}
          >
            <i aria-hidden="true" />
            <span>
              Traer también las tarjetas archivadas
              <small>Quedan en Archivados, no en las columnas</small>
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={opts.comments}
            disabled={Boolean(busy)}
            onClick={() => setOpts((o) => ({ ...o, comments: !o.comments }))}
          >
            <i aria-hidden="true" />
            <span>
              Añadir los comentarios a la descripción
              <small>Con su fecha y autor</small>
            </span>
          </button>
        </div>

        <footer className="bv-modal-foot">
          <small className="tri-note">
            Miembros, archivos subidos y campos personalizados no se traen. Las listas archivadas
            tampoco.
          </small>
          <button
            type="button"
            className="bd-btn primary"
            disabled={!ready.length || Boolean(busy)}
            onClick={() => void run()}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={14} />
                {busy.of > 1 ? `Importando ${busy.at} de ${busy.of}…` : "Importando…"}
              </>
            ) : (
              <>
                <FileUp size={14} />
                {ready.length > 1
                  ? `Importar ${ready.length} tableros`
                  : ready.length
                    ? `Importar ${n(cards, "tarjeta", "tarjetas")}`
                    : "Importar"}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

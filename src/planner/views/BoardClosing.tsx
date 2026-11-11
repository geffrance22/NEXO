import { useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Layers, Lightbulb, X } from "lucide-react";
import { friendlyDate } from "../../lib/format";
import { dayDiff } from "../boardDates";
import type { Board, BoardClosing } from "../boardStore";

export type ClosingStats = {
  from: string;
  to: string;
  cards: number;
  done: number;
};

/** El resumen del proyecto, listo para guardarse como aprendizaje. */
export function closingSummary(name: string, c: BoardClosing) {
  const lines = [
    `Proyecto «${name}»: del ${c.from} al ${c.to}.`,
    `${c.done ?? 0} de ${c.cards ?? 0} tarjetas completadas.`,
  ];
  if (c.well?.trim()) lines.push("", "Qué salió bien:", c.well.trim());
  if (c.different?.trim())
    lines.push("", "Qué haría distinto:", c.different.trim());
  return lines.join("\n");
}

/**
 * Archivar un tablero con su cierre: las fechas, cuántas tarjetas se hicieron, qué salió bien y
 * qué harías distinto. Opcionalmente queda como aprendizaje en Nexo.
 */
export function BoardClosingDialog({
  board,
  stats,
  onArchive,
  onClose,
}: {
  board: Board;
  stats: ClosingStats;
  onArchive: (closing: BoardClosing, learn: boolean, episode: boolean) => void;
  onClose: () => void;
}) {
  const prev = board.closing ?? {};
  const [well, setWell] = useState(prev.well ?? "");
  const [different, setDifferent] = useState(prev.different ?? "");
  const [learn, setLearn] = useState(true);
  const [episode, setEpisode] = useState(!prev.episodeId);
  const days = Math.max(1, dayDiff(stats.from, stats.to) + 1);
  const pct = stats.cards ? Math.round((100 * stats.done) / stats.cards) : 0;
  const open = stats.cards - stats.done;
  const today = stats.to;

  return createPortal(
    <div
      className="bv-modal-back"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="bv-modal bv-closing"
        role="dialog"
        aria-modal="true"
        aria-label={`Cerrar «${board.name}»`}
        onSubmit={(e) => {
          e.preventDefault();
          onArchive(
            {
              from: stats.from,
              to: stats.to,
              cards: stats.cards,
              done: stats.done,
              well: well.trim().slice(0, 4000),
              different: different.trim().slice(0, 4000),
              ...(prev.learningId && { learningId: prev.learningId }),
              ...(prev.episodeId && { episodeId: prev.episodeId }),
            },
            learn && Boolean(well.trim() || different.trim()),
            episode || Boolean(prev.episodeId),
          );
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="bv-modal-head">
          <div>
            <strong>Cerrar «{board.name}»</strong>
            <span>
              Se archiva sin borrarse. Puedes volver a abrirlo cuando quieras.
            </span>
          </div>
          <button
            type="button"
            className="bv-icon"
            aria-label="Cancelar"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="bv-closing-stats">
          <div>
            <b>{days}</b>
            <span>{days === 1 ? "día" : "días"}</span>
            <small>
              {friendlyDate(stats.from, today).toLowerCase()} →{" "}
              {friendlyDate(stats.to, today).toLowerCase()}
            </small>
          </div>
          <div>
            <b>{stats.done}</b>
            <span>de {stats.cards} hechas</span>
            <small className="bv-meter wide">
              <i style={{ width: pct + "%" }} />
            </small>
          </div>
          <div>
            <b>{pct} %</b>
            <span>avance</span>
            <small>
              {open > 0 ? `${open} quedaron abiertas` : "Todo cerrado"}
            </small>
          </div>
        </div>
        <label className="bv-field">
          <span>Qué salió bien</span>
          <textarea
            value={well}
            rows={3}
            autoFocus
            placeholder="Lo que repetirías: decisiones, personas, herramientas…"
            onChange={(e) => setWell(e.target.value)}
          />
        </label>
        <label className="bv-field">
          <span>Qué harías distinto</span>
          <textarea
            value={different}
            rows={3}
            placeholder="Lo que cambiarías la próxima vez"
            onChange={(e) => setDifferent(e.target.value)}
          />
        </label>
        <label className="bv-check">
          <input
            type="checkbox"
            checked={learn}
            onChange={(e) => setLearn(e.target.checked)}
          />
          <Lightbulb size={14} />
          {prev.learningId
            ? "Guardar de nuevo como aprendizaje"
            : "Guardar el cierre como aprendizaje en Nexo"}
        </label>
        <label className="bv-check">
          <input
            type="checkbox"
            checked={episode}
            disabled={Boolean(prev.episodeId)}
            onChange={(e) => setEpisode(e.target.checked)}
          />
          <Layers size={14} />
          {prev.episodeId
            ? "Ya tiene su episodio (se actualiza con este cierre)"
            : "Guardarlo como episodio: un proyecto cerrado, con sus fechas, personas y resultado"}
        </label>
        <footer className="bv-modal-foot end">
          <button type="button" className="bv-pill" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="bv-pill strong">
            <Archive size={14} /> Archivar tablero
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

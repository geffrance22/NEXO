import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckSquare,
  FileDown,
  Hash,
  Image as ImageIcon,
  Layers,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { Sheet } from "../components/Sheet";
import type { Entry } from "../data";
import { useDismiss } from "../hooks/useDismiss";
import { friendlyDate, normalizeText } from "../lib/format";
import { toneNames, toneOfEntry } from "./insights";
import { dayOf } from "./model";

/* ───────── Por etiqueta ───────── */

type TagStat = { label: string; n: number; tone: number | null; last: string };

export function tagStats(entries: Entry[]) {
  const map = new Map<string, TagStat & { sum: number; toned: number }>();
  for (const e of entries)
    for (const t of e.tags) {
      const k = normalizeText(t);
      const hit = map.get(k) ?? {
        label: t,
        n: 0,
        tone: null,
        last: "",
        sum: 0,
        toned: 0,
      };
      hit.n++;
      const tone = toneOfEntry(e);
      if (tone !== null) {
        hit.sum += tone;
        hit.toned++;
      }
      const d = dayOf(e);
      if (d > hit.last) hit.last = d;
      map.set(k, hit);
    }
  return [...map.values()].map((s) => ({
    label: s.label,
    n: s.n,
    last: s.last,
    tone: s.toned ? s.sum / s.toned : null,
  }));
}

type Sort = "usadas" | "recientes" | "az";

/** Ventana para elegir una etiqueta y ver solo sus entradas. */
export function TagSheet({
  entries,
  value,
  onPick,
  onClose,
}: {
  entries: Entry[];
  value: string | null;
  onPick: (tag: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("usadas");
  const stats = useMemo(() => tagStats(entries), [entries]);
  const max = Math.max(1, ...stats.map((s) => s.n));
  const shown = useMemo(() => {
    const needle = normalizeText(q.trim().replace(/^#/, ""));
    return stats
      .filter((s) => !needle || normalizeText(s.label).includes(needle))
      .sort((a, b) =>
        sort === "az"
          ? a.label.localeCompare(b.label, "es")
          : sort === "recientes"
            ? b.last.localeCompare(a.last)
            : b.n - a.n || a.label.localeCompare(b.label, "es"),
      );
  }, [stats, q, sort]);
  const pick = (t: string | null) => {
    onPick(t);
    onClose();
  };

  return createPortal(
    <Sheet
      label="Por etiqueta"
      className="dyy dy-tg-sheet"
      onRequestClose={onClose}
    >
      <section className="dy-tg">
        <button
          type="button"
          className="dy-map-close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <header className="dy-tg-head">
          <span className="dy-map-eyebrow">Agrupar el diario</span>
          <h3>Por etiqueta</h3>
          <p>
            {stats.length} {stats.length === 1 ? "etiqueta" : "etiquetas"} en
            tus entradas. Elige una para leer solo lo suyo.
          </p>
          <div className="dy-tg-tools">
            <label className="dy-tg-search">
              <Search size={15} />
              <input
                type="search"
                placeholder="Buscar etiqueta"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
            </label>
            <div className="dy-seg" role="radiogroup" aria-label="Ordenar">
              {(
                [
                  ["usadas", "Más usadas"],
                  ["recientes", "Recientes"],
                  ["az", "A–Z"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={sort === id}
                  className={sort === id ? "on" : ""}
                  onClick={() => setSort(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="dy-tg-grid">
          {value && (
            <button
              type="button"
              className="dy-tg-tile clear"
              onClick={() => pick(null)}
            >
              <Layers size={18} />
              <strong>Todas las entradas</strong>
              <small>Quitar «#{value}»</small>
            </button>
          )}
          {shown.map((s) => {
            const on =
              value !== null && normalizeText(value) === normalizeText(s.label);
            const tone = s.tone === null ? 0 : Math.round(s.tone);
            return (
              <button
                key={s.label}
                type="button"
                className={"dy-tg-tile" + (on ? " on" : "")}
                aria-pressed={on}
                onClick={() => pick(on ? null : s.label)}
              >
                <span className="dy-tg-name">
                  <Hash size={14} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="dy-tg-count">
                  <b>{s.n}</b> {s.n === 1 ? "entrada" : "entradas"}
                </span>
                <span className="dy-tg-bar" aria-hidden="true">
                  <i
                    className={"t" + tone}
                    style={{ width: `${(s.n / max) * 100}%` }}
                  />
                </span>
                <small>
                  {tone ? `Ánimo: ${toneNames[tone].toLowerCase()} · ` : ""}
                  {friendlyDate(s.last).toLowerCase()}
                </small>
              </button>
            );
          })}
          {!shown.length && (
            <p className="dy-tg-none">
              {stats.length
                ? `Ninguna etiqueta coincide con «${q.trim()}».`
                : "Aún no etiquetas tus entradas."}
            </p>
          )}
        </div>
      </section>
    </Sheet>,
    document.body,
  );
}

/* ───────── Exportar a PDF ───────── */

export function ExportMenu({
  total,
  visible,
  filtered,
  photos,
  setPhotos,
  onAll,
  onVisible,
  onChoose,
}: {
  total: number;
  visible: number;
  /** ¿Hay un filtro, día, etiqueta o búsqueda activa? */
  filtered: boolean;
  photos: boolean;
  setPhotos: (v: boolean) => void;
  onAll: () => void;
  onVisible: () => void;
  onChoose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(open, ref, close);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <div className="dy-export" ref={ref}>
      <button
        type="button"
        className="dy-tool"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Exportar a PDF"
      >
        <FileDown size={13} /> <span>PDF</span>
      </button>
      {open && (
        <div className="dy-export-menu" role="menu">
          <small>Exportar a PDF</small>
          <button type="button" role="menuitem" onClick={run(onAll)}>
            <Layers size={15} />
            <span>
              Todo el diario <i>{total}</i>
            </span>
          </button>
          {filtered && visible > 0 && visible !== total && (
            <button type="button" role="menuitem" onClick={run(onVisible)}>
              <ListFilter size={15} />
              <span>
                Lo que estás viendo <i>{visible}</i>
              </span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={run(onChoose)}>
            <CheckSquare size={15} />
            <span>Elegir entradas…</span>
          </button>
          <label className="dy-export-opt">
            <input
              type="checkbox"
              checked={photos}
              onChange={(e) => setPhotos(e.target.checked)}
            />
            <ImageIcon size={14} /> Incluir fotos
          </label>
        </div>
      )}
    </div>
  );
}

/** La barra de abajo mientras eliges qué entradas exportar. */
export function SelectBar({
  count,
  onAllVisible,
  onExport,
  onCancel,
  busy,
}: {
  count: number;
  onAllVisible: () => void;
  onExport: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return createPortal(
    <div
      className="dy-selbar"
      role="toolbar"
      aria-label="Exportar entradas elegidas"
    >
      <span>
        <b>{count}</b> {count === 1 ? "elegida" : "elegidas"}
      </span>
      <button type="button" className="ghost" onClick={onAllVisible}>
        Todas las visibles
      </button>
      <button
        type="button"
        className="go"
        disabled={!count || busy}
        onClick={onExport}
      >
        <FileDown size={15} /> {busy ? "Preparando…" : "Exportar PDF"}
      </button>
      <button
        type="button"
        className="x"
        aria-label="Cancelar"
        onClick={onCancel}
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}

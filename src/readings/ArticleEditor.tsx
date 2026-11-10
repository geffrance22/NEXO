import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Eraser,
  Highlighter,
  LoaderCircle,
  Redo2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { cutsFor, linesOf, planMarks } from "./trim";
import type { Cut } from "./anchors";

type MarkLike = { id: string; start_offset: number; end_offset: number };

/**
 * Limpiar un artículo: tocas las líneas que sobran (o arrastras sobre varias; con Mayús eliges un
 * tramo), las quitas con Supr y guardas. No se cambian letras: solo se quitan líneas enteras,
 * así los resaltados se recolocan de forma exacta.
 */
export function ArticleEditor({
  content,
  media,
  marks,
  save,
  cancel,
}: {
  content: string;
  media?: Record<string, string>;
  marks: MarkLike[];
  /** Guarda el texto sin esos tramos (en las posiciones del texto actual). */
  save: (cuts: Cut[]) => Promise<void>;
  cancel: () => void;
}) {
  const { confirm } = useApp();
  const lines = useMemo(() => linesOf(content), [content]);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());
  // Historial para deshacer y rehacer (cada entrada: las líneas quitadas).
  const [past, setPast] = useState<ReadonlySet<number>[]>([]);
  const [future, setFuture] = useState<ReadonlySet<number>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anchor = useRef<number | null>(null);
  const drag = useRef<{ from: number; base: ReadonlySet<number> } | null>(null);

  // Resaltados por línea: se avisa antes de quitar una que tiene alguno.
  const marked = useMemo(
    () =>
      lines.map(
        (l) =>
          marks.filter(
            (m) => m.start_offset < l.textEnd && m.end_offset > l.start,
          ).length,
      ),
    [lines, marks],
  );

  function commit(next: ReadonlySet<number>) {
    setPast((p) => [...p.slice(-99), removed]);
    setFuture([]);
    setRemoved(next);
  }
  function removePicked() {
    if (!picked.size) return;
    commit(new Set([...removed, ...picked]));
    setPicked(new Set());
  }
  function restore(group: number[]) {
    const next = new Set(removed);
    group.forEach((i) => next.delete(i));
    commit(next);
  }
  function undo() {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [removed, ...f]);
    setPast((p) => p.slice(0, -1));
    setRemoved(prev);
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, removed]);
    setFuture((f) => f.slice(1));
    setRemoved(next);
  }
  const range = (a: number, b: number) =>
    Array.from(
      { length: Math.abs(b - a) + 1 },
      (_, k) => Math.min(a, b) + k,
    ).filter((i) => !removed.has(i));
  function pickTo(edge: "start" | "end") {
    if (!picked.size) return;
    const from = edge === "end" ? Math.min(...picked) : Math.max(...picked);
    setPicked(new Set(range(from, edge === "end" ? lines.length - 1 : 0)));
  }

  const plan = useMemo(() => {
    const cuts = cutsFor(lines, removed);
    return { cuts, ...planMarks(content, cuts, marks as never) };
  }, [lines, removed, content, marks]);
  const empty = !plan.after.trim();

  async function done() {
    if (!removed.size || busy || empty) return;
    const lost = plan.deleted.length;
    if (
      lost &&
      !(await confirm({
        title: "Quitar líneas con resaltados",
        message:
          lost === 1
            ? "1 resaltado quedaba dentro de lo que quitas y se borrará con su nota. Podrás deshacerlo justo después de guardar."
            : `${lost} resaltados quedaban dentro de lo que quitas y se borrarán con sus notas. Podrás deshacerlo justo después de guardar.`,
        confirmLabel: "Quitar y guardar",
        icon: "warning",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await save(plan.cuts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  async function leave() {
    if (
      removed.size &&
      !(await confirm({
        title: "Descartar los cambios",
        message: "Las líneas que quitaste volverán al artículo.",
        confirmLabel: "Descartar",
        icon: "warning",
      }))
    )
      return;
    cancel();
  }

  // Teclado: Supr quita, Ctrl+Z deshace, Ctrl+Mayús+Z (o Ctrl+Y) rehace, Esc suelta o sale.
  const keys = useRef({ removePicked, undo, redo, leave, done, picked });
  keys.current = { removePicked, undo, redo, leave, done, picked };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".confirm-backdrop")) return;
      if ((e.target as HTMLElement).closest?.("input, textarea")) return;
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        k.removePicked();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) k.redo();
        else k.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        k.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void k.done();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (k.picked.size) setPicked(new Set());
        else void k.leave();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const up = () => (drag.current = null);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // Las líneas quitadas seguidas se pliegan en un solo aviso con «Restaurar».
  const rows: (
    { kind: "line"; i: number } | { kind: "gone"; lines: number[] }
  )[] = [];
  lines.forEach((_, i) => {
    if (!removed.has(i)) return void rows.push({ kind: "line", i });
    const last = rows[rows.length - 1];
    if (last?.kind === "gone") last.lines.push(i);
    else rows.push({ kind: "gone", lines: [i] });
  });
  const pickedMarks = [...picked].reduce((n, i) => n + marked[i], 0);

  return (
    <section className="rd-trim" aria-label="Limpiar el artículo">
      <div
        className="rd-trim-bar"
        role="toolbar"
        aria-label="Edición del artículo"
      >
        <span className="rd-trim-hint">
          {picked.size
            ? `${picked.size} ${picked.size === 1 ? "línea elegida" : "líneas elegidas"}` +
              (pickedMarks
                ? ` · ${pickedMarks} ${pickedMarks === 1 ? "resaltado" : "resaltados"}`
                : "")
            : removed.size
              ? `${removed.size} ${removed.size === 1 ? "línea quitada" : "líneas quitadas"}`
              : "Toca las líneas que sobran · Mayús para un tramo · arrastra para varias"}
        </span>
        {picked.size > 0 && (
          <>
            <button
              type="button"
              title="Elegir también todo lo que sigue"
              onClick={() => pickTo("end")}
            >
              <ArrowDownToLine size={15} /> Hasta el final
            </button>
            <button
              type="button"
              title="Elegir también todo lo anterior"
              onClick={() => pickTo("start")}
            >
              <ArrowUpToLine size={15} /> Desde el principio
            </button>
            <button
              type="button"
              className="rd-trim-cut"
              title="Quitar las líneas elegidas (Supr)"
              onClick={removePicked}
            >
              <Eraser size={15} /> Quitar
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Deshacer"
          title="Deshacer (Ctrl+Z)"
          disabled={!past.length}
          onClick={undo}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          aria-label="Rehacer"
          title="Rehacer (Ctrl+Mayús+Z)"
          disabled={!future.length}
          onClick={redo}
        >
          <Redo2 size={15} />
        </button>
        <span className="rd-trim-sep" aria-hidden="true" />
        <button type="button" disabled={busy} onClick={() => void leave()}>
          <X size={15} /> Cancelar
        </button>
        <button
          type="button"
          className="rd-trim-save"
          disabled={!removed.size || busy || empty}
          title={empty ? "No puedes quitar todo el texto" : "Guardar (Ctrl+S)"}
          onClick={() => void done()}
        >
          {busy && <LoaderCircle className="spin" size={15} />} Guardar cambios
        </button>
      </div>
      {error && (
        <p className="rd-trim-error" role="alert">
          {error}
        </p>
      )}
      <ol className="rd-trim-lines">
        {rows.map((r) => {
          if (r.kind === "gone") {
            const n = r.lines.length;
            return (
              <li key={"g" + r.lines[0]} className="rd-trim-gone">
                <span>
                  {n === 1 ? "1 línea quitada" : `${n} líneas quitadas`}
                </span>
                <button type="button" onClick={() => restore(r.lines)}>
                  <RotateCcw size={13} /> Restaurar
                </button>
              </li>
            );
          }
          const i = r.i;
          const l = lines[i];
          const on = picked.has(i);
          return (
            <li
              key={i}
              className={"rd-trim-line " + l.kind + (on ? " on" : "")}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                if (e.shiftKey && anchor.current !== null) {
                  setPicked(new Set([...picked, ...range(anchor.current, i)]));
                  return;
                }
                anchor.current = i;
                const next = new Set(picked);
                if (on) next.delete(i);
                else next.add(i);
                setPicked(next);
                // Arrastrar con el ratón elige (o suelta) todo el tramo recorrido.
                if (e.pointerType === "mouse")
                  drag.current = { from: i, base: picked };
              }}
              onPointerEnter={() => {
                const d = drag.current;
                if (!d) return;
                const span = range(d.from, i);
                const adding = !d.base.has(d.from);
                const next = new Set(d.base);
                span.forEach((k) => (adding ? next.add(k) : next.delete(k)));
                setPicked(next);
              }}
              onKeyDown={(e) => {
                if (e.key !== " " && e.key !== "Enter") return;
                e.preventDefault();
                anchor.current = i;
                const next = new Set(picked);
                if (on) next.delete(i);
                else next.add(i);
                setPicked(next);
              }}
            >
              {l.image ? (
                <img
                  src={media?.[l.image.url] || l.image.url}
                  alt={l.image.alt}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : (
                <span className="rd-trim-text">{l.text}</span>
              )}
              {marked[i] > 0 && (
                <i
                  className="rd-trim-mark"
                  title={
                    marked[i] === 1
                      ? "Tiene un resaltado"
                      : `Tiene ${marked[i]} resaltados`
                  }
                >
                  <Highlighter size={12} />
                  {marked[i] > 1 && marked[i]}
                </i>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  Folder,
  LoaderCircle,
} from "lucide-react";
import { Minus, Tag, Trash2, X } from "lucide-react";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import type { Card } from "./library";
import { ReaderDialog } from "./ReaderDialog";

type Kind = "delete" | "move" | "tag" | "archive" | "read";

const many = (n: number) => (n === 1 ? "1 artículo" : `${n} artículos`);

/**
 * Acciones sobre las tarjetas marcadas: mover a una carpeta, etiquetar, archivar, marcar como
 * leídas y eliminar. Aparece en el encabezado de la lista mientras haya alguna marcada.
 */
export function BatchBar({
  cards,
  allPicked,
  folders,
  tags,
  selectAll,
  clear,
  done,
}: {
  cards: Card[];
  /** Están marcadas todas las de la lista. */
  allPicked: boolean;
  folders: string[];
  tags: string[];
  selectAll: () => void;
  clear: () => void;
  /** Terminó una acción sobre `ids` (con los cambios aplicados, si los hubo). */
  done: (kind: Kind, ids: string[], changes?: Partial<Card>) => void;
}) {
  const { notify, confirm } = useApp();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [dialog, setDialog] = useState<"move" | "tag" | null>(null);
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const ids = cards.map((c) => c.id);
  const n = ids.length;
  const archived = n > 0 && cards.every((c) => c.archived);
  const read = n > 0 && cards.every((c) => c.read_at);

  async function run(
    kind: Kind,
    fn: () => Promise<string>,
    changes?: Partial<Card>,
  ) {
    if (busy || !n) return;
    setBusy(kind);
    try {
      const message = await fn();
      setDialog(null);
      done(kind, ids, changes);
      notify(message);
    } catch (e) {
      notify(
        "No se pudo completar: " +
          ((e as Error)?.message || "error desconocido"),
      );
    } finally {
      setBusy(null);
    }
  }
  const update = (changes: Partial<Card>, message: string) =>
    run(
      Object.keys(changes)[0] === "folder"
        ? "move"
        : "archived" in changes
          ? "archive"
          : "read",
      async () => {
        const { error } = await supabase
          .from("readings")
          .update(changes)
          .in("id", ids);
        if (error) throw error;
        return message;
      },
      changes,
    );

  async function remove() {
    const ok = await confirm({
      title: n === 1 ? "Eliminar artículo" : `Eliminar ${n} artículos`,
      message: `Se eliminarán ${n === 1 ? "el artículo marcado" : `los ${n} artículos marcados`} con sus resaltados y notas.`,
      confirmLabel: "Eliminar",
      icon: "trash",
      danger: true,
    });
    if (!ok) return;
    void run("delete", async () => {
      const { error } = await supabase.from("readings").delete().in("id", ids);
      if (error) throw error;
      return n === 1 ? "Artículo eliminado." : `${n} artículos eliminados.`;
    });
  }

  function addTag(value: string) {
    const label = value.trim().slice(0, 48);
    if (!label) return;
    void run("tag", async () => {
      const todo = cards.filter((c) => !(c.tags ?? []).includes(label));
      // De a pocos: cada artículo conserva sus etiquetas y suma la nueva.
      for (let i = 0; i < todo.length; i += 8) {
        const results = await Promise.all(
          todo.slice(i, i + 8).map((c) =>
            supabase
              .from("readings")
              .update({ tags: [...(c.tags ?? []), label] })
              .eq("id", c.id),
          ),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      }
      setTag("");
      return `«${label}» en ${many(n)}.`;
    });
  }

  const icon = (kind: Kind, node: ReactNode) =>
    busy === kind ? <LoaderCircle size={15} className="spin" /> : node;

  return (
    <div
      className="rd-batch"
      role="toolbar"
      aria-label="Acciones con la selección"
    >
      <button
        type="button"
        className={"rd-batch-all" + (allPicked ? " on" : "")}
        role="checkbox"
        aria-checked={allPicked ? true : "mixed"}
        title={allPicked ? "Quitar la selección" : "Seleccionar todos"}
        onClick={allPicked ? clear : selectAll}
      >
        {allPicked ? (
          <Check size={11} strokeWidth={3.2} />
        ) : (
          <Minus size={11} strokeWidth={3.2} />
        )}
      </button>
      <strong className="rd-batch-n" aria-live="polite">
        {n}
      </strong>
      <span className="rd-batch-acts">
        <button
          type="button"
          title="Mover a carpeta"
          aria-label="Mover a carpeta"
          disabled={Boolean(busy)}
          onClick={() => {
            setFolder("");
            setDialog("move");
          }}
        >
          {icon("move", <Folder size={15} />)}
        </button>
        <button
          type="button"
          title="Etiquetar"
          aria-label="Etiquetar"
          disabled={Boolean(busy)}
          onClick={() => {
            setTag("");
            setDialog("tag");
          }}
        >
          {icon("tag", <Tag size={15} />)}
        </button>
        <button
          type="button"
          title={read ? "Volver a «Por leer»" : "Mover a leídos"}
          aria-label={read ? "Volver a «Por leer»" : "Mover a leídos"}
          aria-pressed={read}
          disabled={Boolean(busy)}
          onClick={() =>
            void update(
              { read_at: read ? null : new Date().toISOString() },
              read
                ? `${many(n)} de vuelta en Por leer.`
                : `${many(n)} en Leídos.`,
            )
          }
        >
          {icon("read", <CheckCheck size={15} />)}
        </button>
        <button
          type="button"
          title={archived ? "Desarchivar" : "Archivar"}
          aria-label={archived ? "Desarchivar" : "Archivar"}
          disabled={Boolean(busy)}
          onClick={() =>
            void update(
              { archived: !archived },
              archived ? `${many(n)} desarchivados.` : `${many(n)} archivados.`,
            )
          }
        >
          {icon(
            "archive",
            archived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
          )}
        </button>
        <button
          type="button"
          className="danger"
          title="Eliminar"
          aria-label="Eliminar"
          disabled={Boolean(busy)}
          onClick={() => void remove()}
        >
          {icon("delete", <Trash2 size={15} />)}
        </button>
      </span>
      <button
        type="button"
        className="rd-batch-x"
        title="Cancelar (Esc)"
        aria-label="Cancelar la selección"
        onClick={clear}
      >
        <X size={15} />
      </button>

      {dialog === "move" && (
        <ReaderDialog
          title={`Mover ${many(n)}`}
          className="rd-batch-dlg"
          busy={Boolean(busy)}
          close={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = folder.trim();
              void update(
                { folder: value },
                value ? `${many(n)} en «${value}».` : `${many(n)} sin carpeta.`,
              );
            }}
          >
            <input
              data-initial-focus
              list="rd-batch-folders"
              value={folder}
              maxLength={80}
              placeholder="Carpeta (vacío: sin carpeta)"
              aria-label="Carpeta"
              onChange={(e) => setFolder(e.target.value)}
            />
            <datalist id="rd-batch-folders">
              {folders.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </datalist>
            {folders.length > 0 && (
              <div className="rd-batch-chips">
                {folders.slice(0, 12).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={folder === f ? "on" : ""}
                    onClick={() => setFolder(f)}
                  >
                    <Folder size={12} /> {f}
                  </button>
                ))}
              </div>
            )}
            <button disabled={Boolean(busy)}>
              {busy === "move" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                "Mover"
              )}
            </button>
          </form>
        </ReaderDialog>
      )}
      {dialog === "tag" && (
        <ReaderDialog
          title={`Etiquetar ${many(n)}`}
          className="rd-batch-dlg"
          busy={Boolean(busy)}
          close={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag(tag);
            }}
          >
            <input
              data-initial-focus
              value={tag}
              maxLength={48}
              placeholder="Etiqueta nueva o existente"
              aria-label="Etiqueta"
              onChange={(e) => setTag(e.target.value)}
            />
            {tags.length > 0 && (
              <div className="rd-batch-chips">
                {tags.slice(0, 18).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => addTag(t)}
                  >
                    <Tag size={12} /> {t}
                  </button>
                ))}
              </div>
            )}
            <button disabled={Boolean(busy) || !tag.trim()}>
              {busy === "tag" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                "Etiquetar"
              )}
            </button>
          </form>
        </ReaderDialog>
      )}
    </div>
  );
}

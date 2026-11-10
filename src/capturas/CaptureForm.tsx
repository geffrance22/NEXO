import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  ImagePlus,
  Loader2,
  Minimize2,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { Sheet } from "../components/Sheet";
import { goLibroteca } from "../library/shelf";
import {
  MAX_BATCH,
  MAX_SHOT_BYTES,
  cleanTags,
  flatTree,
  formatBytes,
  imageFiles,
} from "./model";
import { createFolder, useCapturas } from "./useCapturas";
import {
  clearFinished,
  enqueue,
  minimizeDraft,
  retryItem,
  setWebp,
  toTray,
  useUploads,
} from "./uploads";
import { canCompress } from "./compress";
import { openCapturasFolder } from "./nav";
import "./capturas.css";

type Picked = { id: string; file: File; url: string };
const keyOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
let seq = 0;

/**
 * «Guardar captura»: pega (Ctrl+V), arrastra o elige muchas imágenes, ponles descripción y
 * etiquetas y elige la carpeta. Una sola se sube aquí mismo; varias, en la ventana flotante.
 * Se puede minimizar a la esquina: ahí lo que pegues o sueltes se sube directo.
 * `docked`: se abrió desde esa ventanita (al cerrar, vuelve a ella).
 */
export function CaptureForm({
  initialFiles = [],
  initialNote = "",
  initialTags = [],
  folderId = null,
  docked = false,
  onClose,
}: {
  initialFiles?: File[];
  initialNote?: string;
  initialTags?: string[];
  folderId?: string | null;
  docked?: boolean;
  onClose: () => void;
}) {
  const { confirm, notify, go } = useApp();
  const { folders, shots } = useCapturas();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [note, setNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagDraft, setTagDraft] = useState("");
  const [folder, setFolder] = useState<string | null>(folderId);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [peek, setPeek] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const uploads = useUploads();
  const inline = batch
    ? uploads.items.find((i) => i.batch === batch)
    : undefined;
  const sending =
    inline &&
    (inline.status === "uploading" ||
      inline.status === "queued" ||
      inline.status === "waiting");

  const tree = useMemo(() => flatTree(folders ?? []), [folders]);
  const knownTags = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of shots ?? [])
      for (const t of s.tags) seen.set(t, (seen.get(t) ?? 0) + 1);
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .slice(0, 60);
  }, [shots]);

  function add(list: File[]) {
    const images = imageFiles(list);
    const skipped = list.length - images.length;
    const have = new Set(pickedRef.current.map((p) => keyOf(p.file)));
    let heavy = 0;
    let over = 0;
    const fresh: Picked[] = [];
    for (const file of images) {
      if (file.size > MAX_SHOT_BYTES) {
        heavy++;
        continue;
      }
      if (have.has(keyOf(file))) continue;
      if (pickedRef.current.length + fresh.length >= MAX_BATCH) {
        over++;
        continue;
      }
      have.add(keyOf(file));
      fresh.push({ id: "p" + ++seq, file, url: URL.createObjectURL(file) });
    }
    const notes = [
      skipped
        ? `${skipped} ${skipped === 1 ? "archivo no es imagen" : "archivos no son imágenes"}`
        : "",
      heavy ? `${heavy} ${heavy === 1 ? "pasa" : "pasan"} de 60 MB` : "",
      over ? `máximo ${MAX_BATCH} por tanda` : "",
    ].filter(Boolean);
    setNotice(
      notes.length ? `Se omitieron algunas: ${notes.join(" · ")}.` : "",
    );
    if (fresh.length) setPicked((p) => [...p, ...fresh]);
  }

  // Lo inicial (lo que pegaste o soltaste en CAPTURAS) entra una sola vez.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialFiles.length) add(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );

  // Ctrl+V en cualquier parte de la ventana: las imágenes del portapapeles se suman.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (batch) return;
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      add(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [batch]);

  // Subida de una sola: al terminar se cierra; si falla, se queda para reintentar.
  useEffect(() => {
    if (inline?.status !== "done") return;
    clearFinished(inline.batch);
    notify("Captura guardada en CAPTURAS.", {
      label: "Ver",
      icon: "open",
      run: () => {
        openCapturasFolder(folder);
        goLibroteca(go, "capturas");
      },
    });
    finish();
  }, [inline?.status]);

  /** Cerrar: desde la ventanita, se vuelve a ella (en la carpeta elegida). */
  function finish() {
    if (docked)
      minimizeDraft({ files: [], note: "", tags, folder_id: folder });
    else onClose();
  }

  /** A la esquina: lo elegido, la descripción y las etiquetas se guardan en la ventanita. */
  function minimize() {
    if (flying) return;
    if (batch && sending) toTray(batch);
    else if (batch) clearFinished(batch);
    const draft = {
      files: batch ? [] : picked.map((p) => p.file),
      note: batch ? "" : note,
      tags: cleanTags([...tags, ...tagDraft.split(",")]),
      folder_id: folder,
    };
    setFlying(true);
    window.setTimeout(() => {
      minimizeDraft(draft);
      if (!docked) onClose();
    }, 380);
  }

  const remove = (id: string) =>
    setPicked((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return list.filter((p) => p.id !== id);
    });
  const clearAll = () =>
    setPicked((list) => {
      list.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });

  const commitTag = (raw = tagDraft) => {
    const parts = raw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length) setTags((t) => cleanTags([...t, ...parts]));
    setTagDraft("");
  };

  async function createHere() {
    const name = (newFolder ?? "").trim();
    if (!name) return setNewFolder(null);
    const made = await createFolder(name, folder);
    if (typeof made === "string") return setNotice(made);
    setFolder(made.id);
    setNewFolder(null);
  }

  function save() {
    if (!picked.length || batch) return;
    const finalTags = cleanTags([...tags, ...tagDraft.split(",")]);
    const opts = { folder_id: folder, note: note.trim(), tags: finalTags };
    if (picked.length === 1) {
      setBatch(enqueue([picked[0].file], { ...opts, mode: "inline" }));
      return;
    }
    // Varias: la ventana se va a la esquina y la subida sigue en la ventana flotante.
    enqueue(
      picked.map((p) => p.file),
      { ...opts, mode: "tray" },
    );
    setFlying(true);
    window.setTimeout(finish, 380);
  }

  // Ctrl+Enter (o ⌘+Enter) sube, esté donde esté el foco.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.defaultPrevented)
        return;
      if (document.querySelector(".confirm-backdrop")) return;
      e.preventDefault();
      saveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function requestClose() {
    if (flying) return;
    if (batch && sending) {
      toTray(batch);
      return finish();
    }
    if (batch) clearFinished(batch);
    if (picked.length && !batch) {
      const ok = await confirm({
        title:
          picked.length === 1
            ? "¿Descartar la imagen?"
            : `¿Descartar ${picked.length} imágenes?`,
        message: "Todavía no se han subido.",
        confirmLabel: "Descartar",
        danger: true,
      });
      if (!ok) return;
    }
    finish();
  }

  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");
  const total = picked.reduce((n, p) => n + p.file.size, 0);
  const compressible = picked.filter((p) => canCompress(p.file)).length;
  const one = picked.length === 1 ? picked[0] : null;
  const pct = inline ? Math.round(inline.progress * 100) : 0;
  const saving = inline?.status === "uploading" && inline.progress >= 1;

  return (
    <Sheet
      label="Guardar captura"
      size="lg"
      className={"cap-sheet" + (flying ? " cap-fly" : "")}
      yieldTo=".cap-peek"
      onRequestClose={() => void requestClose()}
    >
      <div
        className={"cap-form" + (dragging ? " dragging" : "")}
        onDragOver={(e) => {
          if (!hasFiles(e) || batch) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e) || batch) return;
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="cap-form-head">
          <div>
            <h2>Guardar captura</h2>
            <p>
              {picked.length
                ? `${picked.length} ${picked.length === 1 ? "imagen" : "imágenes"} · ${formatBytes(total)}`
                : "Pega con Ctrl+V, arrastra o elige imágenes"}
            </p>
          </div>
          <div className="cap-head-tools">
            <button
              type="button"
              className="cap-x"
              aria-label="Minimizar a la esquina"
              title="Minimizar: pega o suelta imágenes ahí y se suben solas"
              onClick={minimize}
            >
              <Minimize2 size={16} />
            </button>
            <button
              type="button"
              className="cap-x"
              aria-label="Cerrar"
              onClick={() => void requestClose()}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="cap-form-body">
          {!picked.length ? (
            <button
              type="button"
              className="cap-drop"
              onClick={() => input.current?.click()}
              data-autofocus
            >
              <span className="cap-drop-ico">
                <UploadCloud size={26} strokeWidth={1.6} />
              </span>
              <strong>Suelta aquí tus capturas</strong>
              <span>
                o <u>elige archivos</u> · también puedes pegar con{" "}
                <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </span>
              <small>PNG, JPG, WEBP, GIF, AVIF… hasta 60 MB cada una</small>
            </button>
          ) : one ? (
            <div className="cap-single">
              <button
                type="button"
                className="cap-single-img"
                onClick={() => setPeek(0)}
                aria-label="Ver en grande"
              >
                <img src={one.url} alt="" />
                {inline && inline.status !== "error" && (
                  <span className="cap-single-progress">
                    <i
                      style={{ width: `${saving ? 100 : pct}%` }}
                      className={saving ? "saving" : ""}
                    />
                  </span>
                )}
              </button>
              <div className="cap-single-meta">
                <strong title={one.file.name}>
                  {one.file.name || "Captura pegada"}
                </strong>
                <span>{formatBytes(one.file.size)}</span>
                {!batch && (
                  <span className="cap-single-actions">
                    <button
                      type="button"
                      onClick={() => input.current?.click()}
                    >
                      <ImagePlus size={14} /> Añadir más
                    </button>
                    <button type="button" onClick={() => remove(one.id)}>
                      <Trash2 size={14} /> Quitar
                    </button>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="cap-thumbs-head">
                <span>Vista previa</span>
                <button type="button" onClick={clearAll}>
                  Quitar todas
                </button>
              </div>
              <ul className="cap-thumbs">
                {picked.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="cap-thumb"
                      onClick={() => setPeek(i)}
                      title={p.file.name}
                    >
                      <img src={p.url} alt="" loading="lazy" decoding="async" />
                    </button>
                    <button
                      type="button"
                      className="cap-thumb-x"
                      aria-label={`Quitar ${p.file.name}`}
                      onClick={() => remove(p.id)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="cap-thumb cap-thumb-add"
                    onClick={() => input.current?.click()}
                  >
                    <ImagePlus size={20} strokeWidth={1.7} />
                    <span>Añadir</span>
                  </button>
                </li>
              </ul>
            </>
          )}
          {notice && <p className="cap-notice">{notice}</p>}
          {inline?.status === "error" && (
            <p className="cap-notice error">
              {inline.error}
              <button type="button" onClick={() => retryItem(inline.id)}>
                <RotateCcw size={13} /> Reintentar
              </button>
            </p>
          )}

          <div
            className="cap-fields"
            aria-disabled={Boolean(batch) || undefined}
          >
            <textarea
              className="cap-note"
              placeholder="Descripción (opcional)"
              rows={2}
              maxLength={4000}
              value={note}
              disabled={Boolean(batch)}
              onChange={(e) => {
                setNote(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(180, e.target.scrollHeight) + "px";
              }}
            />
            <div className="cap-row">
              <label
                className="cap-tags"
                onClick={(e) => e.currentTarget.querySelector("input")?.focus()}
              >
                {tags.map((t) => (
                  <span key={t} className="cap-tag">
                    #{t}
                    {!batch && (
                      <button
                        type="button"
                        aria-label={`Quitar ${t}`}
                        onClick={() => setTags(tags.filter((x) => x !== t))}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
                <input
                  list="cap-known-tags"
                  placeholder={tags.length ? "" : "Etiquetas"}
                  value={tagDraft}
                  disabled={Boolean(batch)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/[,\n]/.test(v)) commitTag(v);
                    else setTagDraft(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagDraft.trim()) {
                      e.preventDefault();
                      commitTag();
                    } else if (
                      e.key === "Backspace" &&
                      !tagDraft &&
                      tags.length
                    ) {
                      setTags(tags.slice(0, -1));
                    }
                  }}
                  onBlur={() => commitTag()}
                />
                <datalist id="cap-known-tags">
                  {knownTags
                    .filter((t) => !tags.includes(t))
                    .map((t) => (
                      <option key={t} value={t} />
                    ))}
                </datalist>
              </label>
              {newFolder === null ? (
                <div className="cap-folder-pick">
                  <select
                    aria-label="Carpeta"
                    value={folder ?? ""}
                    disabled={Boolean(batch)}
                    onChange={(e) => setFolder(e.target.value || null)}
                  >
                    <option value="">CAPTURAS</option>
                    {tree.map(({ folder: f, depth }) => (
                      <option key={f.id} value={f.id}>
                        {"\u00a0\u00a0\u00a0".repeat(depth + 1)}
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cap-icon-btn"
                    title="Nueva carpeta aquí"
                    aria-label="Nueva carpeta"
                    disabled={Boolean(batch)}
                    onClick={() => setNewFolder("")}
                  >
                    <FolderPlus size={15} />
                  </button>
                </div>
              ) : (
                <div className="cap-folder-pick">
                  <input
                    autoFocus
                    placeholder="Nombre de la carpeta"
                    maxLength={80}
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createHere();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setNewFolder(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="cap-icon-btn"
                    aria-label="Crear"
                    onClick={() => void createHere()}
                  >
                    <FolderPlus size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="cap-form-foot">
          {batch ? (
            <span className="cap-foot-hint">
              {inline?.compressing
                ? "Comprimiendo a WebP…"
                : saving
                  ? "Guardando en YourImageShare…"
                  : inline?.status === "waiting"
                    ? "Esperando turno en YourImageShare…"
                    : inline?.status === "error"
                      ? "No se pudo subir."
                      : `Subiendo… ${pct} %`}
            </span>
          ) : (
            <label
              className="cap-webp"
              title="Pasa PNG y JPG a WebP antes de subir (solo si queda más liviana)"
            >
              <input
                type="checkbox"
                checked={uploads.webp}
                onChange={(e) => setWebp(e.target.checked)}
              />
              <span className="cap-switch" aria-hidden="true" />
              <span>
                Comprimir a WebP
                {uploads.webp && compressible > 0 && picked.length > 1 && (
                  <small>
                    {" "}
                    · {compressible} de {picked.length}
                  </small>
                )}
              </span>
            </label>
          )}
          <span className="cap-foot-keys" aria-hidden="true">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
          </span>
          <button
            type="button"
            className="cap-btn ghost"
            onClick={() => void requestClose()}
          >
            {sending ? "Seguir en segundo plano" : "Cancelar"}
          </button>
          <button
            type="button"
            className="cap-btn primary"
            disabled={!picked.length || Boolean(batch)}
            onClick={save}
          >
            {sending ? (
              <>
                <Loader2 size={15} className="cap-spin" />{" "}
                {saving ? "Guardando" : `${pct} %`}
              </>
            ) : picked.length > 1 ? (
              `Guardar ${picked.length} capturas`
            ) : (
              "Guardar captura"
            )}
          </button>
        </footer>

        {dragging && (
          <div className="cap-dropping" aria-hidden="true">
            <UploadCloud size={30} strokeWidth={1.6} />
            <strong>Suelta para añadir</strong>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {peek !== null && picked[peek] && (
          <Peek
            items={picked}
            index={peek}
            onIndex={setPeek}
            onRemove={
              batch
                ? undefined
                : (id) => {
                    const next = picked.length - 1;
                    remove(id);
                    if (!next) setPeek(null);
                    else setPeek(Math.min(peek, next - 1));
                  }
            }
            onClose={() => setPeek(null)}
          />
        )}
      </div>
    </Sheet>
  );
}

/** Vista previa en grande dentro del formulario, con flechas. */
function Peek({
  items,
  index,
  onIndex,
  onRemove,
  onClose,
}: {
  items: Picked[];
  index: number;
  onIndex: (i: number) => void;
  onRemove?: (id: string) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const go = (d: number) => onIndex((index + d + items.length) % items.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Delete" && onRemove) onRemove(item.id);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return (
    <div
      className="cap-peek"
      role="dialog"
      aria-label="Vista previa"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header>
        <span>
          {index + 1} / {items.length} · {item.file.name || "Captura pegada"} ·{" "}
          {formatBytes(item.file.size)}
        </span>
        {onRemove && (
          <button type="button" onClick={() => onRemove(item.id)}>
            <Trash2 size={15} /> Quitar
          </button>
        )}
        <button
          type="button"
          aria-label="Cerrar vista previa"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <img src={item.url} alt="" onClick={onClose} />
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="cap-peek-nav prev"
            aria-label="Anterior"
            onClick={() => go(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="cap-peek-nav next"
            aria-label="Siguiente"
            onClick={() => go(1)}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}

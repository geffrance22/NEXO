import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { ImagePlus, Maximize2, UploadCloud, X } from "lucide-react";
import { useApp } from "../AppContext";
import { CaptureForm } from "./CaptureForm";
import { flatTree, imageFiles } from "./model";
import { useCapturasWhen } from "./useCapturas";
import {
  closeDraft,
  expandDraft,
  quickUpload,
  setDraftFolder,
  setWebp,
  useUploads,
} from "./uploads";

/** Algo encima donde pegar o soltar imágenes es para eso (un formulario, el visor, etc.). */
const overlayOpen = () =>
  Boolean(
    document.querySelector(
      ".sheet-backdrop, .cap-lb, .confirm-backdrop, .lightbox, .modal-backdrop",
    ),
  );

/**
 * «Guardar captura» minimizado abajo a la derecha. Pega (Ctrl+V) en cualquier parte, suelta
 * imágenes encima o elígelas con el botón: se suben directo a la carpeta, sin abrir el formulario.
 */
export function CaptureDock() {
  const { confirm, notify } = useApp();
  const { draft, webp } = useUploads();
  const { folders } = useCapturasWhen(Boolean(draft && !draft.open));
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tree = useMemo(() => flatTree(folders ?? []), [folders]);
  const minimized = Boolean(draft && !draft.open);

  const upload = (files: File[]) => {
    const warn = quickUpload(files);
    if (warn) notify(warn);
  };
  const uploadRef = useRef(upload);
  uploadRef.current = upload;

  useEffect(() => {
    if (!minimized) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || overlayOpen()) return;
      // Un editor de texto enriquecido puede querer la imagen para sí.
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable) return;
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      uploadRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [minimized]);

  if (!draft || draft.open) return null;

  const pending = draft.files.length;
  async function close() {
    if (pending) {
      const ok = await confirm({
        title:
          pending === 1
            ? "¿Descartar la imagen?"
            : `¿Descartar ${pending} imágenes?`,
        message: "Las elegiste en el formulario y todavía no se han subido.",
        confirmLabel: "Descartar",
        danger: true,
      });
      if (!ok) return;
    }
    closeDraft();
  }
  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  return (
    <section
      className={"cap-dock" + (dragging ? " dragging" : "")}
      aria-label="Guardar captura (minimizado)"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        upload(Array.from(e.dataTransfer.files));
      }}
    >
      <header>
        <button
          type="button"
          className="cap-dock-drop"
          title="Elegir imágenes"
          onClick={() => input.current?.click()}
        >
          <span className="cap-dock-ico" aria-hidden="true">
            <UploadCloud size={18} />
          </span>
          <span className="cap-dock-title">
            <strong>{dragging ? "Suelta para subir" : "Guardar captura"}</strong>
            <small>
              {pending
                ? `${pending} sin subir · ábrelo para guardarlas`
                : "Pega, suelta o elige: se suben solas"}
            </small>
          </span>
        </button>
        <button
          type="button"
          aria-label="Elegir imágenes"
          title="Elegir imágenes"
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={16} />
        </button>
        <button
          type="button"
          aria-label="Abrir el formulario"
          title="Abrir el formulario"
          onClick={expandDraft}
        >
          <Maximize2 size={15} />
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => void close()}
        >
          <X size={16} />
        </button>
      </header>
      <div className="cap-dock-opts">
        <select
          aria-label="Carpeta de destino"
          value={draft.folder_id ?? ""}
          onChange={(e) => setDraftFolder(e.target.value || null)}
        >
          <option value="">CAPTURAS</option>
          {tree.map(({ folder: f, depth }) => (
            <option key={f.id} value={f.id}>
              {"\u00a0\u00a0\u00a0".repeat(depth + 1)}
              {f.name}
            </option>
          ))}
        </select>
        {draft.tags.length > 0 && (
          <span className="cap-dock-tags" title={draft.tags.join(", ")}>
            #{draft.tags[0]}
            {draft.tags.length > 1 ? ` +${draft.tags.length - 1}` : ""}
          </span>
        )}
        <label
          className="cap-webp small"
          title="Pasa PNG y JPG a WebP antes de subir"
        >
          <input
            type="checkbox"
            checked={webp}
            onChange={(e) => setWebp(e.target.checked)}
          />
          <span className="cap-switch" aria-hidden="true" />
          <span>WebP</span>
        </label>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </section>
  );
}

/** El formulario en grande, abierto desde la ventanita (al cerrarlo vuelve a ella). */
export function DockForm() {
  const { draft } = useUploads();
  if (!draft?.open) return null;
  return (
    <CaptureForm
      docked
      initialFiles={draft.files}
      initialNote={draft.note}
      initialTags={draft.tags}
      folderId={draft.folder_id}
      onClose={closeDraft}
    />
  );
}

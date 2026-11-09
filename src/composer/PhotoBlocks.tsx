import type { CSSProperties, ChangeEvent, ClipboardEvent } from "react";
import {
  FileText,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ImageUploads, UploadItem } from "./useImageUploads";

const pick = (e: ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  e.target.value = ""; // permite elegir la misma foto otra vez
  return files;
};

function Progress({ item }: { item: UploadItem }) {
  return (
    <span
      className="cp-progress"
      style={{ "--p": item.progress } as CSSProperties}
      role="status"
    >
      <i />
      {Math.round(item.progress * 100)}%
    </span>
  );
}

/** Varias fotos en una fila de miniaturas, con progreso de subida y reintento. */
export function PhotoStrip({
  uploads,
  addLabel = "Añadir fotos",
}: {
  uploads: ImageUploads;
  addLabel?: string;
}) {
  const failed = uploads.items.find((i) => i.status === "error");
  return (
    <div className="cp-photos-wrap">
      <div className="cp-photos">
        {uploads.items.map((item) => (
          <div className={"cp-photo " + item.status} key={item.id}>
            <img src={item.preview} alt="" loading="lazy" />
            {item.status === "uploading" && <Progress item={item} />}
            {item.status === "error" && (
              <button
                type="button"
                className="cp-photo-retry"
                aria-label="Reintentar subida"
                onClick={() => uploads.retry(item.id)}
              >
                <RotateCw size={18} />
              </button>
            )}
            <button
              type="button"
              className="cp-photo-x"
              aria-label="Quitar foto"
              onClick={() => uploads.remove(item.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {uploads.items.length < uploads.max && (
          <label className="cp-photo-add">
            <input
              type="file"
              accept="image/*"
              multiple
              className="cp-sr"
              onChange={(e) => uploads.add(pick(e))}
            />
            <ImagePlus size={20} />
            <span>{addLabel}</span>
          </label>
        )}
      </div>
      {uploads.notice && <p className="cp-notice">{uploads.notice}</p>}
      {failed && <p className="cp-notice error">{failed.error}</p>}
    </div>
  );
}

/** Imágenes pegadas desde el portapapeles (Ctrl+V) en un campo de texto. */
export const pastedImages = (e: ClipboardEvent<HTMLElement>) =>
  Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));

/**
 * Fotos para notas y novedades: un botón pequeño y, al lado, miniaturas. Sirve para varias
 * fotos a la vez, con progreso de subida y reintento, sin ocupar un recuadro grande.
 */
export function MiniPhotos({
  uploads,
  label = "Foto",
  hint,
  className = "",
}: {
  uploads: ImageUploads;
  label?: string;
  /** Texto suave que se ve mientras no hay fotos (p. ej. «o pégalas con Ctrl+V»). */
  hint?: string;
  /** «roomy»: miniaturas más grandes (fotos de un libro). */
  className?: string;
}) {
  const failed = uploads.items.find((i) => i.status === "error");
  const full = uploads.items.length >= uploads.max;
  return (
    <div className={"cp-mini" + (className ? " " + className : "")}>
      <div className="cp-mini-row">
        {!full && (
          <label
            className="cp-mini-add"
            title="Añadir fotos · también puedes pegarlas con Ctrl+V"
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="cp-sr"
              onChange={(e) => uploads.add(pick(e))}
            />
            <ImagePlus size={15} />
            {label}
          </label>
        )}
        {uploads.items.map((item) => (
          <div className={"cp-mini-item " + item.status} key={item.id}>
            <img src={item.preview} alt="" />
            {item.status === "uploading" && (
              <span
                className="cp-mini-busy"
                role="status"
                aria-label="Subiendo foto"
              >
                <LoaderCircle className="spin" size={15} />
              </span>
            )}
            {item.status === "error" && (
              <button
                type="button"
                className="cp-mini-retry"
                aria-label="Reintentar subida"
                title={item.error}
                onClick={() => uploads.retry(item.id)}
              >
                <RotateCw size={15} />
              </button>
            )}
            <button
              type="button"
              className="cp-mini-x"
              aria-label="Quitar foto"
              onClick={() => uploads.remove(item.id)}
            >
              <X size={11} strokeWidth={3} />
            </button>
          </div>
        ))}
        {hint && !uploads.items.length && (
          <span className="cp-mini-hint">{hint}</span>
        )}
      </div>
      {uploads.notice && <p className="cp-notice">{uploads.notice}</p>}
      {failed && <p className="cp-notice error">{failed.error}</p>}
    </div>
  );
}

/** Una sola imagen grande (póster, portada, comprobante) que se puede cambiar o quitar. */
export function CoverDrop({
  uploads,
  icon: Icon,
  title,
  hint,
  shape = "poster",
  external,
  clearExternal,
}: {
  uploads: ImageUploads;
  icon: LucideIcon;
  title: string;
  hint: string;
  external?: string;
  clearExternal?: () => void;
  shape?: "poster" | "wide";
}) {
  const item = uploads.items[0];
  return (
    <div className={"cp-cover " + shape + (item ? " filled" : "")}>
      <label className="cp-cover-drop">
        <input
          type="file"
          accept="image/*"
          className="cp-sr"
          onChange={(e) => uploads.add(pick(e).slice(0, 1), true)}
        />
        {item || external ? (
          <>
            <img src={item?.preview || external} alt="" />
            <span className="cp-cover-change">Cambiar</span>
          </>
        ) : (
          <>
            <Icon size={30} strokeWidth={1.5} />
            <strong>{title}</strong>
            <span>{hint}</span>
          </>
        )}
        {item?.status === "uploading" && <Progress item={item} />}
      </label>
      {item?.status === "error" && (
        <button
          type="button"
          className="cp-cover-retry"
          onClick={() => uploads.retry(item.id)}
        >
          <RotateCw size={14} /> Reintentar
        </button>
      )}
      {(item || external) && (
        <button
          type="button"
          className="cp-photo-x"
          aria-label="Quitar imagen"
          onClick={() => {
            if (item) uploads.remove(item.id);
            clearExternal?.();
          }}
        >
          <X size={13} />
        </button>
      )}
      {uploads.notice && <p className="cp-notice">{uploads.notice}</p>}
      {item?.status === "error" && (
        <p className="cp-notice error">{item.error}</p>
      )}
    </div>
  );
}

/** Documento (PDF o texto) que va a Supabase; las fotos van a ImgBB. */
/** Botón compacto para elegir fotos (se usa en la barra inferior de las notas). */
export function PhotoButton({
  uploads,
  label,
}: {
  uploads: ImageUploads;
  label: string;
}) {
  return (
    <label className="cp-tray-btn">
      <input
        type="file"
        accept="image/*"
        multiple
        className="cp-sr"
        onChange={(e) => uploads.add(pick(e))}
      />
      <ImagePlus size={17} />
      {label}
    </label>
  );
}

export function DocAttach({
  currentPath,
  removed,
  onRemoveCurrent,
  file,
  onFile,
  notice,
}: {
  currentPath?: string | null;
  removed: boolean;
  onRemoveCurrent: (removed: boolean) => void;
  file: File | null;
  onFile: (file: File | null) => void;
  notice: string;
}) {
  const currentName = currentPath
    ? `Documento .${currentPath.split(".").pop()}`
    : null;
  return (
    <div className="cp-doc">
      {currentName && !removed && !file && (
        <span className="cp-doc-chip">
          <FileText size={15} /> {currentName}
          <button
            type="button"
            aria-label="Quitar documento"
            onClick={() => onRemoveCurrent(true)}
          >
            <X size={13} />
          </button>
        </span>
      )}
      {currentName && removed && !file && (
        <span className="cp-doc-chip removed">
          Se quitará el documento al guardar
          <button type="button" onClick={() => onRemoveCurrent(false)}>
            Deshacer
          </button>
        </span>
      )}
      {file ? (
        <span className="cp-doc-chip">
          <FileText size={15} /> {file.name}
          <button
            type="button"
            aria-label="Quitar documento nuevo"
            onClick={() => onFile(null)}
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <label className="cp-doc-add">
          <input
            type="file"
            accept="application/pdf,text/plain"
            className="cp-sr"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <Paperclip size={15} />
          {currentName && !removed
            ? "Reemplazar documento"
            : "Adjuntar PDF o texto"}
        </label>
      )}
      {notice && <p className="cp-notice error">{notice}</p>}
    </div>
  );
}

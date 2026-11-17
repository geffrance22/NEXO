import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, LoaderCircle, X } from 'lucide-react';
import type { StoredImage } from '../data';

const extOf = (type: string, url: string) => {
  const fromType = type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  if (fromType && /^[a-z0-9]{2,5}$/.test(fromType)) return fromType;
  return /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.exec(url)?.[1].toLowerCase() ?? 'jpg';
};
/** Sin caracteres que los sistemas de archivos no aceptan. */
const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'imagen';

/**
 * Descarga la imagen con su nombre. Un enlace de otro dominio no respeta `download`, así que se
 * trae primero; si el sitio no lo permite, se abre la original en otra pestaña.
 */
async function downloadImage(url: string, name: string) {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw Error(`Error ${res.status}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${safeName(name)}.${extOf(blob.type, url)}`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener');
    return false;
  }
}

/**
 * Visor de fotos a pantalla completa: flechas para pasar, Esc o clic fuera para cerrar. Con
 * `downloadName`, un botón para descargar la foto con ese nombre.
 */
export function Lightbox({
  images,
  start = 0,
  downloadName,
  onClose,
}: {
  images: StoredImage[];
  start?: number;
  downloadName?: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), images.length - 1));
  const [saving, setSaving] = useState<'idle' | 'busy' | 'done'>('idle');
  const many = images.length > 1;
  const go = (step: number) => {
    setSaving('idle');
    setIndex((i) => (i + step + images.length) % images.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && images.length > 1) go(1);
      else if (e.key === 'ArrowLeft' && images.length > 1) go(-1);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [images.length, onClose]);

  useEffect(() => {
    if (saving !== 'done') return;
    const t = window.setTimeout(() => setSaving('idle'), 1800);
    return () => window.clearTimeout(t);
  }, [saving]);

  const image = images[index];
  if (!image) return null;

  const download = async () => {
    if (!downloadName || saving === 'busy') return;
    setSaving('busy');
    const name = many ? `${downloadName} (${index + 1})` : downloadName;
    setSaving((await downloadImage(image.url, name)) ? 'done' : 'idle');
  };

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Visor de fotos"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <img key={image.url} src={image.url} alt={`Foto ${index + 1} de ${images.length}`} />
      {downloadName && (
        <button
          type="button"
          className={'lightbox-btn download' + (saving === 'done' ? ' done' : '')}
          aria-label="Descargar"
          title={saving === 'done' ? 'Descargada' : 'Descargar'}
          aria-busy={saving === 'busy'}
          onClick={() => void download()}
        >
          {saving === 'busy' ? (
            <LoaderCircle size={19} className="spin" />
          ) : saving === 'done' ? (
            <Check size={19} />
          ) : (
            <Download size={19} />
          )}
        </button>
      )}
      <button type="button" className="lightbox-btn close" aria-label="Cerrar" onClick={onClose}>
        <X size={22} />
      </button>
      {many && (
        <>
          <button
            type="button"
            className="lightbox-btn prev"
            aria-label="Anterior"
            onClick={() => go(-1)}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            className="lightbox-btn next"
            aria-label="Siguiente"
            onClick={() => go(1)}
          >
            <ChevronRight size={24} />
          </button>
          <span className="lightbox-count">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}

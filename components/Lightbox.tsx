import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { StoredImage } from '../data';

/** Visor de fotos a pantalla completa: flechas para pasar, Esc o clic fuera para cerrar. */
export function Lightbox({
  images,
  start = 0,
  onClose,
}: {
  images: StoredImage[];
  start?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), images.length - 1));
  const many = images.length > 1;
  const go = (step: number) => setIndex((i) => (i + step + images.length) % images.length);

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

  const image = images[index];
  if (!image) return null;

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

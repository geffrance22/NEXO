import { useApp } from '../AppContext';
import type { StoredImage } from '../data';

/**
 * Fotos de una nota o novedad: una sola se ve más grande; varias, como miniaturas cuadradas
 * (la última muestra «+N» si hay más). Al pulsar se abre el visor.
 */
export function PhotoThumbs({ images, max = 4 }: { images: StoredImage[]; max?: number }) {
  const { openImages } = useApp();
  if (!images.length) return null;
  const one = images.length === 1;
  const shown = images.slice(0, max);
  const extra = images.length - shown.length;
  return (
    <div className={'ph-thumbs' + (one ? ' one' : '')}>
      {shown.map((img, i) => (
        <button
          type="button"
          key={img.url + i}
          aria-label={`Ver foto ${i + 1} de ${images.length}`}
          onClick={(e) => {
            e.stopPropagation();
            openImages(images, i);
          }}
        >
          <img
            src={one ? (img.medium ?? img.url) : (img.thumb ?? img.medium ?? img.url)}
            alt=""
            loading="lazy"
          />
          {extra > 0 && i === shown.length - 1 && <span>+{extra}</span>}
        </button>
      ))}
    </div>
  );
}

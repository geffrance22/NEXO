import type { StoredImage } from "../data";
import { useApp } from "../AppContext";
import { initials } from "../lib/format";

/** La versión de tu foto que conviene a ese tamaño (miniatura para lo pequeño). */
export const photoSrc = (photo: StoredImage | undefined, size: number) =>
  photo
    ? size > 90
      ? (photo.medium ?? photo.url)
      : (photo.thumb ?? photo.medium ?? photo.url)
    : undefined;

/** Tu foto de «Mi ficha» o, si no tienes, tus iniciales (va dentro de un contenedor redondo). */
export function MyFace({ size = 28 }: { size?: number }) {
  const { me, user } = useApp();
  const src = photoSrc(me.profile.photo, size);
  return src ? (
    <img className="my-face" src={src} alt="" />
  ) : (
    <>{initials(me.profile.name?.trim() || user.email || "Yo").toUpperCase()}</>
  );
}

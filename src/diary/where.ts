/**
 * Dónde estás ahora, en dos palabras como mucho («Laureles, Medellín», «Bogotá»). Usa la
 * ubicación del navegador (pide permiso) y OpenStreetMap para ponerle nombre. Solo se llama
 * cuando la persona toca el botón: nunca en segundo plano.
 */
export async function whereAmI(): Promise<string> {
  if (!("geolocation" in navigator))
    throw new Error("Tu navegador no comparte la ubicación.");
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 10 * 60 * 1000,
    }),
  ).catch((e: GeolocationPositionError) => {
    throw new Error(
      e?.code === 1
        ? "Sin permiso para usar tu ubicación."
        : "No se pudo saber dónde estás.",
    );
  });
  const { latitude, longitude } = pos.coords;
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es" +
    `&lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("No se pudo poner nombre a tu ubicación.");
  const data = (await res.json()) as { address?: Record<string, string> };
  const name = shortPlace(data.address ?? {});
  if (!name) throw new Error("No se pudo poner nombre a tu ubicación.");
  return name;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** El nombre más útil en dos palabras como mucho: barrio y ciudad si caben; si no, la ciudad. */
export function shortPlace(a: Record<string, string>): string {
  const city =
    a.city || a.town || a.village || a.municipality || a.county || "";
  const near = a.neighbourhood || a.suburb || a.quarter || a.city_district || "";
  if (near && city && near !== city && words(near).length + words(city).length <= 2)
    return `${near}, ${city}`;
  const pick = city || near || a.state || a.country || "";
  return clampWhere(pick);
}

/** Recorta cualquier texto de ubicación a dos palabras. */
export const clampWhere = (s: string) =>
  words(s.replace(/,/g, " ")).slice(0, 2).join(" ");

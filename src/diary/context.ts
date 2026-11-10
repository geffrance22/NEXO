import type { Entry, EntryContext } from "../data";
import { normalizeText, todayInputValue } from "../lib/format";
import { lastCoords, rememberCoords } from "./where";

/*
 * El contexto de una entrada del diario: hora, luz del día y clima. Se toma solo, sin preguntar
 * nada: la ubicación se usa únicamente si ya diste permiso antes (o tocaste «dónde estás») y el
 * clima viene de Open-Meteo (gratis, sin cuenta). Si algo falla, la entrada se guarda igual.
 */

type Coords = { lat: number; lon: number };
type Sky = {
  weather?: number;
  temp?: number;
  isDay?: boolean;
  sunrise?: string;
  sunset?: string;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => window.setTimeout(() => r(null), ms)),
  ]);

/** La ubicación sin preguntar: solo si el permiso ya estaba dado; si no, la última conocida. */
async function quietCoords(): Promise<Coords | null> {
  try {
    const perm = await navigator.permissions?.query({
      name: "geolocation" as PermissionName,
    });
    if (perm?.state === "granted") {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 30 * 60 * 1000,
        }),
      );
      rememberCoords(pos.coords.latitude, pos.coords.longitude);
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    }
  } catch {
    /* Sin API de permisos o sin respuesta: se usa la última conocida. */
  }
  return lastCoords();
}

/** Coordenadas aproximadas de un nombre («Laureles, Medellín»). */
async function geocode(name: string): Promise<Coords | null> {
  const q = name.split(",").pop()?.trim() || name.trim();
  if (!q) return null;
  const res = await fetch(
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=" +
      encodeURIComponent(q),
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: { latitude: number; longitude: number }[];
  };
  const hit = data.results?.[0];
  return hit ? { lat: hit.latitude, lon: hit.longitude } : null;
}

async function skyAt({ lat, lon }: Coords): Promise<Sky | null> {
  const url =
    "https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=1" +
    "&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset" +
    `&latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      is_day?: number;
    };
    daily?: { sunrise?: string[]; sunset?: string[] };
  };
  return {
    weather: d.current?.weather_code,
    temp:
      typeof d.current?.temperature_2m === "number"
        ? Math.round(d.current.temperature_2m)
        : undefined,
    isDay: d.current?.is_day === undefined ? undefined : d.current.is_day === 1,
    sunrise: d.daily?.sunrise?.[0],
    sunset: d.daily?.sunset?.[0],
  };
}

/**
 * Empieza a buscar el cielo de ahora (al abrir el diario), para que al publicar ya esté listo.
 * Nunca falla: sin datos devuelve null.
 */
export function prefetchSky(): Promise<Sky | null> {
  return withTimeout(
    (async () => {
      const coords = await quietCoords();
      return coords ? skyAt(coords) : null;
    })(),
    9000,
  );
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const localMinutes = (iso?: string) => {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** La luz según la hora (sin datos del sol se asume 6:00–18:00, el día en el trópico). */
export function lightAt(
  minutes: number,
  sunrise = 6 * 60,
  sunset = 18 * 60,
): NonNullable<EntryContext["light"]> {
  if (minutes >= sunrise - 30 && minutes < sunrise + 60) return "amanecer";
  if (minutes >= sunset - 60 && minutes < sunset + 30) return "atardecer";
  return minutes >= sunrise && minutes < sunset ? "dia" : "noche";
}

/**
 * El contexto que se guarda con la entrada. `sky` es lo que trajo `prefetchSky`; si no hay y
 * escribiste dónde estabas, se intenta con ese nombre. Solo cuenta la hora y el clima cuando la
 * entrada es de hoy (si es de ayer, el clima de ahora no dice nada de ese día).
 */
export async function contextFor(
  date: string,
  sky: Sky | null,
  where?: string,
): Promise<EntryContext | undefined> {
  const now = new Date();
  if (date !== todayInputValue(now)) return undefined;
  if (!sky && where)
    sky = await withTimeout(
      geocode(where).then((c) => (c ? skyAt(c) : null)),
      3500,
    );
  const rise = localMinutes(sky?.sunrise);
  const set = localMinutes(sky?.sunset);
  const ctx: EntryContext = {
    at: now.toISOString(),
    hour: now.getHours(),
    light: lightAt(minutesOf(now), rise ?? undefined, set ?? undefined),
  };
  if (typeof sky?.weather === "number") ctx.weather = sky.weather;
  if (typeof sky?.temp === "number") ctx.temp = sky.temp;
  if (rise !== null && set !== null && set > rise)
    ctx.daylight = Math.round(((set - rise) / 60) * 10) / 10;
  return ctx;
}

/* ───────── Leer el contexto de una entrada (también de las antiguas) ───────── */

export type SkyKind = "despejado" | "nublado" | "lluvia" | "tormenta" | "nieve";

/** El tipo de cielo de un código WMO. */
export function skyKind(code?: number): SkyKind | null {
  if (typeof code !== "number") return null;
  if (code <= 1) return "despejado";
  if (code <= 48) return "nublado";
  if (code >= 95) return "tormenta";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "nieve";
  return "lluvia";
}

export const skyLabel: Record<SkyKind, string> = {
  despejado: "Despejado",
  nublado: "Nublado",
  lluvia: "Lluvia",
  tormenta: "Tormenta",
  nieve: "Nieve",
};

export const lightLabel: Record<NonNullable<EntryContext["light"]>, string> = {
  amanecer: "Al amanecer",
  dia: "De día",
  atardecer: "Al atardecer",
  noche: "De noche",
};

/** La hora en que escribiste: la guardada o, en las antiguas, la del registro si fue ese día. */
export function hourOf(e: Entry): number | null {
  if (typeof e.details.ctx?.hour === "number") return e.details.ctx.hour;
  if (!e.recorded_at) return null;
  const rec = new Date(e.recorded_at);
  return todayInputValue(rec) === todayInputValue(new Date(e.created_at))
    ? rec.getHours()
    : null;
}

export type DayPart = "madrugada" | "manana" | "tarde" | "noche";
export const dayPartLabel: Record<DayPart, string> = {
  madrugada: "De madrugada",
  manana: "En la mañana",
  tarde: "En la tarde",
  noche: "En la noche",
};
export function dayPartOf(e: Entry): DayPart | null {
  const h = hourOf(e);
  if (h === null) return null;
  return h < 6 ? "madrugada" : h < 12 ? "manana" : h < 19 ? "tarde" : "noche";
}

export function lightOf(e: Entry): NonNullable<EntryContext["light"]> | null {
  if (e.details.ctx?.light) return e.details.ctx.light;
  const h = hourOf(e);
  return h === null ? null : lightAt(h * 60 + 30);
}

const textOf = (e: Entry) =>
  normalizeText(
    [
      e.title,
      e.body,
      ...(e.details.feelings ?? []).map((f) => f.why ?? ""),
      ...e.tags,
    ].join(" "),
  );

const POOR_SLEEP =
  /\b(dormi (mal|poco|fatal|horrible|pesimo)|insomnio|no (pude|logre|podia) dormir|desvel|trasnoch|casi no dormi|sin dormir|me desperte (mucho|varias))/;
const GOOD_SLEEP =
  /\b(dormi (bien|rico|delicioso|mucho|como un bebe|profundo|de largo)|descanse (bien|mucho)|buen descanso|siesta)/;
const EXERCISE =
  /\b(gym|gimnasio|entrene|entreno|entrenamiento|corri|trote|nade|natacion|yoga|pilates|bici|cicla|ciclismo|crossfit|pesas|futbol|partido de|ejercicio|caminata|camine|senderismo|escalada|boxeo|baile|bailamos|spinning|funcional)\b/;

/** Cómo dormiste: lo que marcaste o, si no, lo que se lee en la entrada. */
export function sleepOf(e: Entry): "poco" | "regular" | "bien" | null {
  if (e.details.sleep) return e.details.sleep;
  const t = textOf(e);
  if (POOR_SLEEP.test(t)) return "poco";
  if (GOOD_SLEEP.test(t)) return "bien";
  return null;
}

/** Si te moviste ese día: lo que marcaste o lo que se lee en la entrada. */
export function exercisedOf(e: Entry): boolean {
  if (typeof e.details.exercise === "boolean") return e.details.exercise;
  return EXERCISE.test(textOf(e));
}

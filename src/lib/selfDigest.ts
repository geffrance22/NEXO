import type { Entry, MyProfile, Person, Workspace } from '../data';
import { addDays, todayInputValue } from './format';
import { genderOf } from './gender';
import { relationMeta, relationOf } from './people';
import { ME, kindWord, tiesOf, tieKinds } from './relations';

/** Una lectura guardada en Lecturas (solo lo necesario para describirte). */
export type ReadingLite = { title: string; tags: string[] | null; read_at: string | null };

/** Tope del resumen que se envía: la función rechaza lo que pase de 30 000 caracteres. */
const MAX_CHARS = 26000;

const day = (e: Entry) => e.created_at.slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const count = <T>(items: T[], keyOf: (x: T) => string | undefined) => {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = keyOf(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};

/**
 * Todo lo que hay de ti en Nexo, resumido para que la IA escriba quién eres hoy: tu ficha, tu gente
 * (familia, cercanos, con quién más te ves), tus recuerdos recientes, libros, películas,
 * aprendizajes, trabajo, pendientes, episodios, lugares, lecturas y cómo te has sentido.
 */
export function buildSelfDigest(
  ws: Workspace,
  me: MyProfile,
  readings: ReadingLite[],
  today = todayInputValue(),
) {
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  const nameOf = (p: Person) => p.name.trim();
  const since90 = addDays(today, -90);
  const since180 = addDays(today, -180);
  const entries = [...ws.entries].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const recent = entries.filter((e) => day(e) >= since90);

  // Tu gente: parentescos y vínculos contigo, los cercanos y con quién más te ves.
  const mine = tiesOf(ME, ws.ties).filter((v) => v.other !== ME && byId.has(v.other));
  const vinculos = mine.slice(0, 60).map((v) => {
    const p = byId.get(v.other)!;
    return `${nameOf(p)}: tu ${kindWord(v.kind, genderOf(p))}`;
  });
  const family = mine.filter((v) => tieKinds[v.kind].category === 'familia').length;
  const times = new Map<string, number>();
  for (const e of entries)
    if (day(e) >= since180 && e.kind !== 'Movimiento')
      for (const id of e.person_ids) times.set(id, (times.get(id) ?? 0) + 1);
  const masCerca = [...times]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .flatMap(([id, n]) => (byId.has(id) ? [`${nameOf(byId.get(id)!)} (${n} recuerdos)`] : []));
  const cercanos = ws.people
    .filter((p) => p.profile.favorite || (p.profile.closeness ?? 0) >= 4)
    .slice(0, 20)
    .map((p) => `${nameOf(p)} (${relationMeta[relationOf(p)].label.toLowerCase()})`);
  const porRelacion = Object.fromEntries(
    count(ws.people, (p) => relationMeta[relationOf(p)].label).map(([k, n]) => [k, n]),
  );

  const of = (kind: Entry['kind']) => entries.filter((e) => e.kind === kind);
  const libros = of('Libro')
    .slice(0, 30)
    .map((e) =>
      [
        e.title,
        e.details.author && `de ${e.details.author}`,
        e.details.read && `(${e.details.read})`,
        e.details.rating && `${e.details.rating}/5`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  const peliculas = of('Película')
    .slice(0, 30)
    .map((e) =>
      [
        e.title,
        e.details.series ? '(serie)' : '',
        e.details.watch && `(${e.details.watch})`,
        e.details.rating && `${e.details.rating}/5`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  const aprendizajes = of('Aprendizaje')
    .slice(0, 20)
    .map((e) => clip(e.title, 120));
  const trabajo = of('Trabajo')
    .slice(0, 20)
    .map((e) => `${clip(e.title, 100)}${e.details.stage ? ` [${e.details.stage}]` : ''}`);
  const abiertos = of('Pendiente').filter((e) => e.status !== 'completado');
  const plata = recent.filter((e) => e.kind === 'Movimiento');
  const sum = (dir: string) =>
    Math.round(
      plata.filter((e) => e.direction === dir).reduce((s, e) => s + Number(e.amount || 0), 0),
    );
  const moods = recent.map((e) => e.details.mood).filter((m): m is number => typeof m === 'number');

  const digest = {
    hoy: today,
    yo: {
      nombre: me.name,
      apodo: me.alias,
      cumpleanos: me.birthday,
      nacio: me.birthYear,
      ciudad: me.city,
      ocupacion: me.occupation,
      empresa: me.company,
      intereses: me.interests,
      me_encanta: me.likes,
      no_me_gusta: me.dislikes,
      ahora_mismo: me.goals,
      en_mis_palabras: me.about ? clip(me.about, 1500) : undefined,
    },
    mi_gente: {
      personas: ws.people.length,
      por_relacion: porRelacion,
      familiares_vinculados: family,
      vinculos_conmigo: vinculos,
      cercanos,
      con_quien_mas_me_veo_6_meses: masCerca,
      grupos: ws.groups.slice(0, 30).map((g) => `${g.name} (${g.member_ids.length})`),
    },
    recuerdos: {
      total: entries.length,
      ultimos_90_dias: recent.length,
      por_tipo: Object.fromEntries(count(entries, (e) => e.kind)),
      etiquetas_frecuentes: count(
        entries.flatMap((e) => e.tags),
        (t) => t.toLowerCase(),
      )
        .slice(0, 15)
        .map(([t, n]) => `${t} (${n})`),
      recientes: entries
        .filter((e) => e.kind !== 'Movimiento')
        .slice(0, 40)
        .map((e) => ({
          fecha: day(e),
          tipo: e.kind,
          titulo: clip(e.title, 100),
          texto: e.body ? clip(e.body.replace(/\s+/g, ' '), 160) : undefined,
          con: e.person_ids.flatMap((id) => (byId.has(id) ? [nameOf(byId.get(id)!)] : [])),
        })),
      animo_promedio_90_dias: moods.length
        ? Math.round((10 * moods.reduce((s, m) => s + Math.min(5, m), 0)) / moods.length) / 10
        : undefined,
    },
    libros,
    peliculas_y_series: peliculas,
    aprendizajes,
    trabajo,
    pendientes: {
      abiertos: abiertos.length,
      algunos: abiertos.slice(0, 10).map((e) => clip(e.title, 100)),
    },
    finanzas_90_dias: plata.length
      ? {
          ingresos: sum('ingreso'),
          gastos: sum('egreso'),
          en_que_gasto: count(
            plata.filter((e) => e.direction === 'egreso').flatMap((e) => e.tags.slice(0, 1)),
            (t) => t,
          )
            .slice(0, 6)
            .map(([t]) => t),
        }
      : undefined,
    episodios: ws.episodes.slice(0, 20).map((ep) => ({
      titulo: clip(ep.title, 100),
      tipo: ep.kind,
      estado: ep.status,
      desde: ep.starts_on ?? undefined,
    })),
    lugares: {
      total: ws.places.length,
      favoritos: ws.places
        .filter((p) => p.favorite)
        .slice(0, 12)
        .map((p) => p.name),
      por_tipo: Object.fromEntries(count(ws.places, (p) => p.kind).slice(0, 8)),
    },
    lecturas: {
      guardadas: readings.length,
      terminadas: readings.filter((r) => r.read_at).length,
      recientes: readings.slice(0, 30).map((r) => clip(r.title, 110)),
      temas: count(
        readings.flatMap((r) => r.tags ?? []),
        (t) => t.toLowerCase(),
      )
        .slice(0, 10)
        .map(([t]) => t),
    },
  };

  // Si se pasa del tope, se recortan primero los recuerdos y las listas más largas.
  const fits = () => JSON.stringify(digest).length <= MAX_CHARS;
  while (!fits() && digest.recuerdos.recientes.length > 8)
    digest.recuerdos.recientes = digest.recuerdos.recientes.slice(
      0,
      Math.floor(digest.recuerdos.recientes.length * 0.7),
    );
  for (const list of ['libros', 'peliculas_y_series', 'aprendizajes', 'trabajo'] as const)
    if (!fits()) digest[list] = digest[list].slice(0, 10);
  if (!fits()) digest.mi_gente.vinculos_conmigo = digest.mi_gente.vinculos_conmigo.slice(0, 25);
  return digest;
}

/** Cuánto sabe Nexo de ti (para mostrar en qué se basa la lectura). */
export function selfBasis(ws: Workspace) {
  return {
    people: ws.people.length,
    entries: ws.entries.length,
    episodes: ws.episodes.length,
    places: ws.places.length,
  };
}

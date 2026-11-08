import type { AppContextValue } from '../AppContext';
import { supabase } from '../backend';
import { cleanDetails } from '../composer/logic';
import type {
  Entry,
  EntryDetails,
  EntryInput,
  Episode,
  Exchange,
  Person,
  PersonFact,
  PersonProfile,
  PersonUpdate,
  PlaceKind,
} from '../data';
import type { CapturePlan, MediaPiece, Piece } from '../lib/capture';
import { normalizeText, splitList, todayInputValue } from '../lib/format';
import { findMedia } from '../lib/moviePosters';
import { ME } from '../lib/relations';
import { deduceTastes } from '../lib/tastes';
import { capture as captureLink, publicLink } from '../readings/capture';
import { savePictures } from '../readings/media';

const peopleOf = (p: Piece): string[] => {
  switch (p.kind) {
    case 'encuentro':
      return p.personIds;
    case 'novedad':
    case 'intercambio':
    case 'dato':
    case 'preguntar':
      return [p.personId];
    case 'compromiso':
      return [...p.peopleIds, ...(p.personId ? [p.personId] : [])];
    case 'conexion':
      return [p.a, p.b];
    case 'obra':
      return [...p.personIds, ...(p.recommendedBy ? [p.recommendedBy] : [])];
    case 'trabajo':
      return p.personIds;
    case 'enlace':
      return p.personId ? [p.personId] : [];
    default:
      return [];
  }
};

/** Lo que se suma a la ficha de cada persona (una sola escritura por persona). */
type ProfileAdds = {
  updates: PersonUpdate[];
  exchanges: Exchange[];
  /** Intereses deducidos de sus novedades (van a `interests`, fuera de la ficha). */
  interests: string[];
  likes: string[];
  dislikes: string[];
  gifts: string[];
  facts: PersonFact[];
  askNext: string[];
  birthday?: string;
};
const emptyAdds = (): ProfileAdds => ({
  updates: [],
  exchanges: [],
  interests: [],
  likes: [],
  dislikes: [],
  gifts: [],
  facts: [],
  askNext: [],
});
const addUnique = (list: string[] = [], more: string[]) => {
  const seen = new Set(list.map((x) => normalizeText(x)));
  return [
    ...list,
    ...more.filter((x) => !seen.has(normalizeText(x)) && seen.add(normalizeText(x))),
  ];
};

/** Estado de un libro o una película tal como lo guarda su formulario. */
function mediaDetails(p: MediaPiece): EntryDetails {
  if (p.media === 'Libro')
    return cleanDetails('Libro', {
      read: p.status === 'listo' ? 'terminado' : p.status === 'curso' ? 'leyendo' : 'quiero',
      author: p.author,
      rating: p.rating || undefined,
    });
  // Si no dice que es serie, se deja sin fijar: al abrirla, TMDB puede detectarlo.
  return cleanDetails('Película', {
    watch: p.status === 'quiero' ? 'quiero' : p.status === 'curso' && p.series ? 'viendo' : 'vista',
    platform: p.platform,
    rating: p.rating || undefined,
    series: p.series || undefined,
  });
}

const base = (over: Partial<EntryInput> & Pick<EntryInput, 'kind' | 'title'>): EntryInput => ({
  body: '',
  tags: [],
  personIds: [],
  date: todayInputValue(),
  amount: 0,
  direction: 'egreso',
  status: 'pendiente',
  images: [],
  details: {},
  file: null,
  removeFile: false,
  ...over,
});

/**
 * Guarda una experiencia capturada: personas y lugar nuevos, el episodio que la reúne y cada pieza
 * (encuentro, movimiento, compromisos, novedades, conexiones…), todas enlazadas entre sí y al
 * texto original. Devuelve el episodio (si se creó) y cuántas piezas se guardaron.
 */
export async function saveCapture(plan: CapturePlan, app: AppContextValue) {
  // 1. Personas nuevas: se crean todas las que dejaste marcadas. Si alguna no quedó en ninguna
  //    pieza, se suma al encuentro o al compromiso cuya frase la nombra.
  const fresh = plan.newPeople.filter((n) => n.on && n.name.trim());
  const placed = new Set(plan.pieces.filter((p) => p.on).flatMap(peopleOf));
  const pieces: Piece[] = plan.pieces.map((p) => {
    if (!p.on) return p;
    const hits = fresh
      .filter((n) => !placed.has(n.id) && says(p.evidence, n.name))
      .map((n) => n.id);
    if (!hits.length) return p;
    if (p.kind === 'encuentro') return { ...p, personIds: [...new Set([...p.personIds, ...hits])] };
    if (p.kind === 'compromiso')
      return { ...p, peopleIds: [...new Set([...p.peopleIds, ...hits])] };
    return p;
  });
  const on = pieces.filter((p) => p.on);
  const used = new Set(on.flatMap(peopleOf));
  // Las que siguen sueltas igual quedan en el episodio y con una nota de lo que se dijo de ellas.
  const loose = fresh.filter((n) => !used.has(n.id));
  for (const n of loose) used.add(n.id);

  const created = new Map<string, Person>();
  const profiles = new Map<string, Partial<PersonProfile>>();
  for (const n of fresh) {
    const person = await app.createPerson(n.name.trim().slice(0, 120));
    if (!person) continue;
    created.set(n.id, person);
    // Cómo la conociste: la frase del texto que la nombra.
    const said = sentences(plan.text).find((s) => says(s, n.name));
    if (said) {
      profiles.set(person.id, {
        metHow: said.slice(0, 300),
        ...(MET.test(normalizeText(said)) && { metOn: plan.date }),
      });
    }
  }
  // Persona nueva que nombraste por su parentesco («mi tía Rosa»): nace con su sexo.
  for (const k of plan.kinLinks ?? []) {
    const p = k.personId ? created.get(k.personId) : undefined;
    if (p && k.gender) profiles.set(p.id, { ...profiles.get(p.id), gender: k.gender });
  }
  // Los comodines de parentesco sin elegir («kin:…») y las personas nuevas no creadas se omiten.
  const real = (id: string | null | undefined) =>
    !id
      ? null
      : (created.get(id)?.id ?? (id.startsWith('new:') || id.startsWith('kin:') ? null : id));
  const realIds = (ids: string[]) => [
    ...new Set(ids.map(real).filter((x): x is string => Boolean(x))),
  ];

  // 2. Lugar nuevo del encuentro o de la visita (se crea su ficha una sola vez).
  const enc = on.find((p) => p.kind === 'encuentro');
  const visit = on.find((p) => p.kind === 'visita');
  const madePlaces = new Map<string, { id: string | null; name: string }>();
  const placeFor = async (id: string | null, name: string, kind: PlaceKind) => {
    if (id) return { id, name: app.workspace.places.find((p) => p.id === id)?.name ?? '' };
    const clean = name.trim();
    if (!clean) return { id: null, name: '' };
    const key = normalizeText(clean);
    if (madePlaces.has(key)) return madePlaces.get(key)!;
    const place = await app.savePlace({
      name: clean.slice(0, 120),
      kind,
      city: '',
      address: '',
      story: '',
      images: [],
      favorite: false,
    });
    const made = { id: place?.id ?? null, name: place?.name ?? clean };
    madePlaces.set(key, made);
    return made;
  };
  const encPlace = enc
    ? await placeFor(enc.placeId, enc.placeName, enc.placeKind)
    : { id: null, name: '' };
  const visitPlace = visit
    ? await placeFor(visit.placeId, visit.placeName, visit.placeKind)
    : { id: null, name: '' };
  const placeId = encPlace.id ?? visitPlace.id;
  const placeName = encPlace.name;
  const mood = plan.mood ?? undefined;

  // 3. El episodio que lo reúne todo, con el texto original como evidencia.
  const everyone = realIds([...used]);
  let episode: Episode | null = null;
  if (plan.episode.on && !app.experiencesMissing) {
    episode = await app.saveEpisode(
      {
        title: plan.episode.title.trim() || 'Experiencia',
        kind: plan.episode.kind,
        // Un encuentro de un día queda cerrado; un viaje o un proyecto sigue activo.
        status: plan.episode.kind === 'encuentro' ? 'cerrado' : 'activo',
        starts_on: plan.date,
        ends_on: plan.episode.kind === 'encuentro' ? plan.date : null,
        summary: '',
        source: plan.text.slice(0, 4000),
        person_ids: everyone,
        place_ids: placeId ? [placeId] : [],
        budget: null,
        outcome: '',
      },
      true,
    );
  }
  const episodeId = episode?.id ?? null;
  let count = 0;
  let ties = 0;
  const keep = (e: Entry | null) => {
    if (e) count++;
    return e;
  };

  // 4. El encuentro primero: las demás piezas lo citan como origen.
  let origin: Entry | null = null;
  if (enc) {
    const details: EntryDetails = {};
    if (enc.activity) details.activity = enc.activity;
    if (placeName) details.place = placeName;
    if (encPlace.id) details.placeId = encPlace.id;
    if (mood) details.mood = mood;
    origin = keep(
      await app.createEntry(
        base({
          kind: 'Encuentro',
          title: enc.title,
          body: plan.text,
          personIds: realIds(enc.personIds),
          date: enc.date,
          details,
          episodeId,
        }),
        true,
      ),
    );
  }
  const encounterPeople = enc ? realIds(enc.personIds) : [];

  // 5. Las demás piezas.
  const adds = new Map<string, ProfileAdds>();
  const addsFor = (id: string) => {
    let a = adds.get(id);
    if (!a) adds.set(id, (a = emptyAdds()));
    return a;
  };
  const toLink: string[] = [];
  for (const p of pieces) {
    if (p.kind === 'movimiento' && !p.on && p.dupOf) {
      // Ya estaba registrado: se enlaza al episodio en vez de duplicarlo.
      toLink.push(p.dupOf);
      continue;
    }
    if (!p.on) continue;
    switch (p.kind) {
      case 'movimiento':
        keep(
          await app.createEntry(
            base({
              kind: 'Movimiento',
              title: p.title || p.category,
              body: p.evidence,
              tags: p.category && p.category !== 'Otro' ? [p.category] : [],
              personIds: encounterPeople,
              date: p.date,
              amount: p.amount,
              direction: p.direction,
              episodeId,
            }),
            true,
          ),
        );
        break;
      case 'compromiso': {
        const who = real(p.personId);
        const details: EntryDetails = { priority: 'media', commitment: p.commitment };
        if (p.due) details.due = p.due;
        if (who && p.commitment === 'prometi') details.beneficiary = who;
        if (who && (p.commitment === 'espero' || p.commitment === 'depende')) details.owner = who;
        if (origin) details.sourceId = origin.id;
        keep(
          await app.createEntry(
            base({
              kind: 'Pendiente',
              title: p.title,
              body: p.evidence,
              personIds: realIds([...(who ? [who] : []), ...p.peopleIds]),
              date: plan.date,
              details,
              episodeId,
            }),
            true,
          ),
        );
        break;
      }
      case 'aprendizaje':
        keep(
          await app.createEntry(
            base({
              kind: 'Aprendizaje',
              title: p.title,
              body: p.evidence,
              personIds: encounterPeople,
              date: plan.date,
              details: cleanDetails('Aprendizaje', {
                source: p.source || (enc ? 'Persona' : 'Práctica'),
                sourceName:
                  p.sourceName ||
                  (p.source === 'Persona' || (!p.source && enc)
                    ? (app.workspace.people.find((x) => x.id === encounterPeople[0])?.name ??
                      enc?.title)
                    : undefined),
              }),
              episodeId,
            }),
            true,
          ),
        );
        break;
      case 'nota':
        keep(
          await app.createEntry(
            base({
              kind: 'Nota',
              title: p.text.split('\n')[0].slice(0, 80) || 'Nota',
              body: p.text,
              personIds: everyone,
              date: plan.date,
              details: mood ? { mood } : {},
              episodeId,
            }),
            true,
          ),
        );
        break;
      case 'conexion': {
        const a = real(p.a);
        const b = real(p.b);
        if (!a || !b) break;
        keep(
          await app.createEntry(
            base({
              kind: 'Nota',
              title: 'Posible conexión',
              body: `${p.text}\n\nDe: «${p.evidence}»`,
              tags: ['conexión'],
              personIds: [a, b],
              date: plan.date,
              episodeId,
            }),
            true,
          ),
        );
        break;
      }
      case 'novedad': {
        const who = real(p.personId);
        if (!who) break;
        // Lo que la novedad deja ver de sus gustos también se suma a su ficha.
        const tastes = deduceTastes(p.evidence || p.text);
        addsFor(who).interests.push(...tastes.interests);
        addsFor(who).likes.push(...tastes.likes);
        addsFor(who).dislikes.push(...tastes.dislikes);
        addsFor(who).updates.push({
          id: crypto.randomUUID(),
          date: p.date,
          kind: p.updateKind,
          text: p.text.slice(0, 500),
          created_at: new Date().toISOString(),
          ...(episodeId && { episodeId }),
          ...(origin && { entryId: origin.id }),
        });
        break;
      }
      case 'obra': {
        const who = realIds(p.personIds);
        const rec = real(p.recommendedBy);
        const recName = rec ? app.workspace.people.find((x) => x.id === rec)?.name : '';
        const madeName = rec ? [...created.values()].find((x) => x.id === rec)?.name : '';
        const by = recName || madeName;
        let details = mediaDetails(p);
        // Películas y series: el póster y la ficha de TMDB desde el primer momento.
        if (p.media === 'Película')
          try {
            const found = await findMedia(p.title, '', p.series ? 'tv' : undefined);
            if (found) details = cleanDetails('Película', { ...details, ...found });
          } catch {
            /* Sin TMDB se guarda igual; la Libroteca le buscará el póster después. */
          }
        keep(
          await app.createEntry(
            base({
              kind: p.media,
              title: p.title,
              body: [by ? `Te la recomendó ${by.split(' ')[0]}.` : '', `«${p.evidence}»`]
                .filter(Boolean)
                .join('\n\n'),
              personIds: [...new Set([...(rec ? [rec] : []), ...who])],
              date: plan.date,
              details,
              episodeId,
            }),
            true,
          ),
        );
        break;
      }
      case 'idea':
        keep(
          await app.createEntry(
            base({
              kind: p.as === 'trabajo' ? 'Trabajo' : 'Nota',
              title: p.title,
              body: p.evidence,
              tags: ['idea'],
              personIds: encounterPeople,
              date: plan.date,
              details:
                p.as === 'trabajo'
                  ? cleanDetails('Trabajo', { stage: 'idea', priority: 'media' })
                  : {},
              episodeId,
            }),
            true,
          ),
        );
        break;
      case 'trabajo':
        keep(
          await app.createEntry(
            base({
              kind: 'Trabajo',
              title: p.title,
              body: p.evidence,
              personIds: realIds(p.personIds),
              date: plan.date,
              details: cleanDetails('Trabajo', {
                stage: p.stage,
                nextStep: p.nextStep,
                due: p.due || undefined,
                priority: 'media',
              }),
              episodeId,
            }),
            true,
          ),
        );
        break;
      case 'intercambio': {
        const who = real(p.personId);
        if (!who) break;
        addsFor(who).exchanges.push({
          id: crypto.randomUUID(),
          date: p.date,
          dir: p.dir,
          kind: p.exchange,
          weight: 1,
          ...(p.note.trim() && { note: p.note.trim().slice(0, 200) }),
        });
        break;
      }
      case 'dato': {
        const who = real(p.personId);
        const value = p.value.trim();
        if (!who || !value) break;
        const a = addsFor(who);
        if (p.field === 'birthday') a.birthday = value;
        else if (p.field === 'fact')
          a.facts.push({ id: crypto.randomUUID(), label: p.label.trim() || 'Dato', value });
        else a[p.field].push(value.slice(0, 80));
        break;
      }
      case 'preguntar': {
        const who = real(p.personId);
        if (who && p.text.trim()) addsFor(who).askNext.push(p.text.trim().slice(0, 200));
        break;
      }
      case 'visita': {
        const details: EntryDetails = {};
        if (visitPlace.name || p.placeName) details.place = visitPlace.name || p.placeName;
        if (visitPlace.id) details.placeId = visitPlace.id;
        if (mood) details.mood = mood;
        keep(
          await app.createEntry(
            base({
              kind: 'Nota',
              title: p.title,
              body: plan.text,
              tags: ['lugar'],
              date: p.date,
              details,
              episodeId,
            }),
            true,
          ),
        );
        break;
      }
      case 'enlace': {
        const who = real(p.personId);
        const saved = p.save === 'lecturas' && (await saveReading(p.url));
        if (saved) {
          count++;
          break;
        }
        // Sin captura posible: queda como nota con el enlace, para leerlo después.
        keep(
          await app.createEntry(
            base({
              kind: 'Nota',
              title: `Para leer: ${p.title}`.slice(0, 180),
              body: `${p.url}\n\n«${p.evidence}»`,
              tags: ['para leer'],
              personIds: who ? [who] : [],
              date: plan.date,
              episodeId,
            }),
            true,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  // 6. Personas nuevas que no quedaron en ninguna pieza: una nota con lo que se dijo de ellas
  //    (salvo que ya haya una nota general, que las incluye a todas).
  const hasNote = on.some((p) => p.kind === 'nota');
  for (const n of hasNote ? [] : loose) {
    const person = created.get(n.id);
    if (!person) continue;
    const said = sentences(plan.text).filter((s) => says(s, n.name));
    const body = (said.length ? said.join(' ') : plan.text).slice(0, 4000);
    keep(
      await app.createEntry(
        base({
          kind: 'Nota',
          title: (said[0] ?? `Sobre ${person.name.split(' ')[0]}`).slice(0, 80),
          body,
          personIds: [person.id],
          date: plan.date,
          episodeId,
        }),
        true,
      ),
    );
  }

  // 7. Lo que va en las fichas (novedades, dar y recibir, gustos, regalos, cumpleaños, preguntas
  //    y los datos de las personas nuevas): una sola escritura por persona.
  for (const id of new Set([...adds.keys(), ...profiles.keys()])) {
    const person =
      [...created.values()].find((p) => p.id === id) ??
      app.workspace.people.find((p) => p.id === id);
    if (!person) continue;
    const a = adds.get(id) ?? emptyAdds();
    const pr = { ...person.profile, ...profiles.get(id) };
    const next: PersonProfile = {
      ...pr,
      ...(a.updates.length && { updates: [...a.updates, ...(pr.updates ?? [])].slice(0, 300) }),
      ...(a.exchanges.length && {
        exchanges: [...a.exchanges, ...(pr.exchanges ?? [])].slice(0, 500),
      }),
      ...(a.likes.length && { likes: addUnique(pr.likes, a.likes) }),
      ...(a.dislikes.length && { dislikes: addUnique(pr.dislikes, a.dislikes) }),
      ...(a.gifts.length && { gifts: addUnique(pr.gifts, a.gifts) }),
      ...(a.askNext.length && { askNext: addUnique(pr.askNext, a.askNext) }),
      ...(a.facts.length && { facts: [...(pr.facts ?? []), ...a.facts] }),
      ...(a.birthday && { birthday: a.birthday }),
    };
    // Intereses nuevos (sin repetir lo que ya es un gusto o algo que no le gusta).
    const taken = new Set(
      [...(next.likes ?? []), ...(next.dislikes ?? [])].map((x) => normalizeText(x)),
    );
    const before = splitList(person.interests);
    const interests = addUnique(
      before,
      a.interests.filter((x) => !taken.has(normalizeText(x))),
    );
    const moreInterests = interests.length - before.length;
    const ok = await app.patchPerson(
      person,
      { profile: next, ...(moreInterests > 0 && { interests: interests.join(', ') }) },
      true,
    );
    if (ok)
      count +=
        moreInterests +
        a.updates.length +
        a.exchanges.length +
        a.likes.length +
        a.dislikes.length +
        a.gifts.length +
        a.askNext.length +
        a.facts.length +
        (a.birthday ? 1 : 0);
  }
  if (toLink.length && episodeId) await app.linkEntries(toLink, episodeId, true);

  // 8. Parentescos: «Keila es tu mamá» queda guardado para la próxima vez (y su sexo, si faltaba).
  const kinTies = (plan.kinLinks ?? [])
    .filter((k) => k.save && k.personId)
    .flatMap((k) => {
      const id = real(k.personId);
      const owner = k.owner === ME ? ME : real(k.owner);
      return id && owner && id !== owner ? [{ link: k, id, owner }] : [];
    });
  if (kinTies.length) {
    const saved = await app.saveTies(
      kinTies.map(({ link, id, owner }) => ({ a: id, b: owner, kind: link.kind })),
      true,
    );
    for (const { link, id } of kinTies) {
      if (!link.gender || created.has(link.personId!)) continue;
      const p = app.workspace.people.find((x) => x.id === id);
      if (p && !p.profile.gender)
        await app.patchPerson(p, { profile: { ...p.profile, gender: link.gender } }, true);
    }
    ties = saved.length;
  }

  return { episode, count, people: created.size, ties };
}

/** Frases del texto (para saber qué se dijo de cada persona). */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Verbos de conocer a alguien: «conocí a», «me presentaron a»… */
const MET = /\b(conoci|conocimos|me presento|me presentaron|nos presentaron|presente a)\b/;

/** ¿La frase nombra a esta persona? (nombre completo o, si no, el primer nombre). */
function says(text: string, name: string) {
  const t = normalizeText(text);
  const full = normalizeText(name.trim());
  if (!full) return false;
  if (t.includes(full)) return true;
  const first = full.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, '');
  return first.length > 2 && new RegExp(`(^|[^\\p{L}])${first}([^\\p{L}]|$)`, 'u').test(t);
}

/** Guarda un enlace en Lecturas (si ya estaba, lo reutiliza). Devuelve false si no se pudo. */
async function saveReading(url: string) {
  try {
    const link = publicLink(url);
    const found = await supabase.from('readings').select('id').eq('url', link).maybeSingle();
    if (found.error) return false;
    if (found.data) return true;
    const snap = await captureLink(link);
    const { error } = await supabase
      .from('readings')
      .insert({ url: link, ...snap, media: await savePictures(snap.content) });
    if (error) return false;
    // Lecturas se refresca sola si está abierta.
    window.dispatchEvent(new Event('nexo:link-saved'));
    return true;
  } catch {
    return false;
  }
}

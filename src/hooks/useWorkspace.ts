import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import {
  blank,
  type AppUser,
  type Episode,
  type EpisodeChanges,
  type EpisodeInput,
  type Entry,
  type EntryInput,
  type Person,
  type PersonInput,
  type PersonProfile,
  type Place,
  type PlaceInput,
  type Group,
  type GroupInput,
  type Tie,
  type TieKind,
  type TieNature,
  type StoredImage,
  type Workspace,
  type EntryPatch,
  type Status,
} from '../data';
import type { ConfirmFn } from '../components/ConfirmDialog';
import type { TaskOutcome } from '../lib/commitments';
import { errorMessage, todayInputValue } from '../lib/format';
import { prepareImage, uploadToImgbb } from '../lib/imgbb';
import { moodValue } from '../composer/moods';
import { relationMeta } from '../lib/people';
import { ME, canonicalTie, tieKey } from '../lib/relations';
import {
  dismiss,
  forgetDismissed,
  hydrateDismissed,
  setDismissalSync,
} from '../relations/dismissed';
import { groupKey } from '../lib/groupSuggestions';
import { mergedProfile } from '../lib/duplicates';
import { isHiddenCapsule, isReady, isSpent } from '../diary/capsule';
import type { Notify } from './useToast';

export type TieInput = {
  a: string | null;
  b: string;
  kind: TieKind;
  note?: string;
  nature?: TieNature | null;
};

const PAGE_SIZE = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PERSON_COLORS = ['#dce8ce', '#e7d8ed', '#f2dfc5', '#d7e4ed'];
// Solo las columnas que usa la interfaz: así no llegan `owner_id` ni la columna `fts`.
const LEGACY_PERSON_COLUMNS = 'id,name,role,interests,bio,color,created_at';
const PERSON_COLUMNS = LEGACY_PERSON_COLUMNS + ',profile';
const LEGACY_ENTRY_COLUMNS =
  'id,title,body,kind,tags,person_ids,created_at,amount,direction,status,file_path';
const ENTRY_COLUMNS = LEGACY_ENTRY_COLUMNS + ',images,details';
// Con la migración 008: episodio y fecha de registro.
const EXP_ENTRY_COLUMNS = ENTRY_COLUMNS + ',episode_id,recorded_at';
const EPISODE_COLUMNS =
  'id,title,kind,status,starts_on,ends_on,summary,source,person_ids,place_ids,budget,outcome,created_at';
// Con la migración 009: bitácora, episodios relacionados y fotos propias.
const EPISODE_EXTRA_COLUMNS = EPISODE_COLUMNS + ',updates,links,images';
const EXPERIENCES_HINT =
  'Falta ejecutar la migración 202611060008_experiences.sql en el SQL Editor de Supabase.';
const EPISODE_EXTRAS_HINT =
  'Para la bitácora, los episodios relacionados y la galería ejecuta la migración 202611070006_episode_extras.sql en el SQL Editor de Supabase.';

const PLACE_COLUMNS = 'id,name,kind,city,address,story,images,favorite,created_at';
const PLACES_HINT =
  'Falta ejecutar la migración 202611060006_places.sql en el SQL Editor de Supabase.';

/** ¿Falta una tabla (migración sin ejecutar)? */
function isMissingTable(e: unknown, table = 'places') {
  const { code = '', message = '' } = (e ?? {}) as {
    code?: string;
    message?: string;
  };
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes(table) && /does not exist|schema cache|find the table/i.test(message))
  );
}
const TIE_COLUMNS = 'id,a,b,kind,note,created_at';
const TIE_COLUMNS_NATURE = TIE_COLUMNS + ',nature';
const GROUP_COLUMNS = 'id,name,kind,description,member_ids,created_at';
const RELATIONS_HINT =
  'Falta ejecutar la migración 202611060007_relations.sql en el SQL Editor de Supabase.';

const PROFILE_HINT =
  'Falta ejecutar la migración 202611060005_people_profile.sql en el SQL Editor de Supabase.';
const MERGE_HINT =
  'Para unir personas ejecuta la migración 202611080002_merge_people.sql en el SQL Editor de Supabase.';
const MIGRATION_HINT =
  'Falta ejecutar la migración 202611060004_images_details.sql en el SQL Editor de Supabase.';
const UNTITLED_HINT =
  'Para guardar entradas sin título ejecuta la migración 202611100001_untitled_entries.sql en el SQL Editor de Supabase.';
/** La base aún exige título (falta la migración de entradas sin título). */
const isTitleRequired = (e: unknown) => /entries_title_check/.test(errorMessage(e));
const saveError = (e: unknown) =>
  isMissingColumn(e) ? MIGRATION_HINT : isTitleRequired(e) ? UNTITLED_HINT : errorMessage(e);
const OUTCOME_HINT =
  'Para marcar pendientes como no realizados ejecuta la migración 202611120002_pending_outcome.sql en el SQL Editor de Supabase.';
/** La base aún no conoce el estado «no realizado». */
const isStatusLimited = (e: unknown) => /entries_status_check/.test(errorMessage(e));
/** Una entrada del diario (Nota) puede quedar sin título; los demás tipos usan el suyo. */
const titleOf = (input: EntryInput) =>
  input.title.trim().slice(0, 180) || (input.kind === 'Nota' ? '' : input.kind);

/** ¿El error indica que la tabla no tiene las columnas `images` o `details`? */
function isMissingColumn(e: unknown) {
  const { code = '', message = '' } = (e ?? {}) as {
    code?: string;
    message?: string;
  };
  return (
    (code === '42703' || code === 'PGRST204' || /does not exist|schema cache/i.test(message)) &&
    /\b(images|details|profile|episode_id|recorded_at|nature|updates|links)\b/.test(message)
  );
}

const isHttps = (u: unknown): u is string => typeof u === 'string' && u.startsWith('https://');

/** Completa y limpia `images` y `details` de una fila (pueden faltar o venir mal formados). */
function normalizeEntry(e: Entry): Entry {
  const images = (Array.isArray(e.images) ? e.images : [])
    .filter((img): img is StoredImage => Boolean(img) && isHttps(img.url))
    .map((img) => ({
      url: img.url,
      ...(isHttps(img.medium) && { medium: img.medium }),
      ...(isHttps(img.thumb) && { thumb: img.thumb }),
    }));
  const raw =
    e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? e.details : {};
  // Los ánimos de la lista anterior se leen como su equivalente actual.
  const mood = moodValue(raw.mood);
  const details = mood === raw.mood ? raw : { ...raw, mood };
  return { ...e, images, details };
}

/** Completa profile (puede faltar o venir mal formado). */
function normalizePerson(p: Person): Person {
  const pr =
    p.profile && typeof p.profile === 'object' && !Array.isArray(p.profile) ? p.profile : {};
  const photo = pr.photo && isHttps(pr.photo.url) ? pr.photo : undefined;
  // Las fotos de las novedades también deben ser https.
  const updates = Array.isArray(pr.updates)
    ? pr.updates.map((u) =>
        u.images
          ? {
              ...u,
              images: Array.isArray(u.images) ? u.images.filter((i) => isHttps(i?.url)) : [],
            }
          : u,
      )
    : undefined;
  return { ...p, profile: { ...pr, photo, ...(updates && { updates }) } };
}

const cleanImages = (list: unknown): StoredImage[] =>
  (Array.isArray(list) ? list : [])
    .filter((img): img is StoredImage => Boolean(img) && isHttps((img as StoredImage).url))
    .map((img) => ({
      url: img.url,
      ...(isHttps(img.medium) && { medium: img.medium }),
      ...(isHttps(img.thumb) && { thumb: img.thumb }),
    }));

/** Completa la bitácora, los vínculos y las fotos de un episodio (pueden faltar sin la 009). */
function normalizeEpisode(ep: Episode, people: Set<string>, places: Set<string>): Episode {
  const updates = (Array.isArray(ep.updates) ? ep.updates : [])
    .filter((u) => u && typeof u.text === 'string' && typeof u.id === 'string')
    .map((u) => (u.images ? { ...u, images: cleanImages(u.images) } : u));
  const links = (Array.isArray(ep.links) ? ep.links : []).filter(
    (l) => l && typeof l.id === 'string' && l.id !== ep.id,
  );
  return {
    ...ep,
    budget: ep.budget === null || ep.budget === undefined ? null : Number(ep.budget),
    person_ids: (ep.person_ids ?? []).filter((m) => people.has(m)),
    place_ids: (ep.place_ids ?? []).filter((m) => places.has(m)),
    updates,
    links,
    images: cleanImages(ep.images),
  };
}

/** Descarga todas las filas por páginas: PostgREST corta cada respuesta en 1000 filas. */
async function fetchAll<T>(
  table:
    'people' | 'entries' | 'places' | 'person_ties' | 'person_groups' | 'episodes' | 'dismissals',
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data as unknown as T[];
    rows.push(...page);
    from += page.length;
    if (page.length === 0 || count === null || from >= count) return rows;
  }
}

/** Sube un adjunto a la carpeta del usuario y devuelve su ruta en Storage. */
async function uploadAttachment(userId: string, file: File) {
  if (file.size > MAX_FILE_BYTES) throw Error('El archivo debe pesar menos de 10 MB.');
  const ext = file.name.includes('.')
    ? file.name
        .split('.')
        .pop()!
        .replace(/[^a-z0-9]/gi, '')
    : '';
  const path = `${userId}/${crypto.randomUUID()}.${ext || 'bin'}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file);
  if (error) throw error;
  return path;
}

const removeAttachment = (path: string) => supabase.storage.from('attachments').remove([path]);

/**
 * Si la base aún no tiene las columnas `images` y `details` y el recuerdo no usa ninguna, se
 * omiten del envío para que guardar siga funcionando. Si las usa, el error explica qué migrar.
 */
function withoutEmptyExtras<T extends { images: StoredImage[]; details: object }>(
  row: T,
  outdated: boolean,
) {
  if (!outdated || row.images.length || Object.keys(row.details).length) return row;
  const { images: _images, details: _details, ...rest } = row;
  return rest;
}

/** Las fechas se guardan a mediodía de la zona horaria del usuario. */
const dateToTimestamp = (date: string) => new Date(date + 'T12:00:00').toISOString();

export function useWorkspace(user: AppUser, notify: Notify, confirm: ConfirmFn) {
  const [workspace, setWorkspace] = useState<Workspace>(() => structuredClone(blank));
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [schemaOutdated, setSchemaOutdated] = useState(false);
  const [profileOutdated, setProfileOutdated] = useState(false);
  const [placesMissing, setPlacesMissing] = useState(false);
  const [relationsMissing, setRelationsMissing] = useState(false);
  const [experiencesMissing, setExperiencesMissing] = useState(false);
  const [episodeExtrasMissing, setEpisodeExtrasMissing] = useState(false);
  // Cápsulas del tiempo que aún no son entradas normales: van aparte para que no aparezcan en el
  // diario, la búsqueda, las estadísticas ni lo que lee la IA.
  const [capsules, setCapsules] = useState<Entry[]>([]);
  const announcedCapsules = useRef(new Set<string>());
  const request = useRef(0);

  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      // Si la migración de fotos y detalles aún no se ejecutó, se cargan las columnas anteriores.
      let outdated = false;
      let noExperiences = false;
      const loadEntries = async () => {
        // `updated_at` (migración 003): cuándo se tocó por última vez (ordena «Más reciente»).
        try {
          return await fetchAll<Entry>('entries', EXP_ENTRY_COLUMNS + ',updated_at');
        } catch (e) {
          if (!isMissingColumn(e)) throw e;
        }
        try {
          return await fetchAll<Entry>('entries', EXP_ENTRY_COLUMNS);
        } catch (e) {
          if (!isMissingColumn(e)) throw e;
          noExperiences = true;
        }
        try {
          return await fetchAll<Entry>('entries', ENTRY_COLUMNS);
        } catch (e) {
          if (!isMissingColumn(e)) throw e;
          outdated = true;
          return fetchAll<Entry>('entries', LEGACY_ENTRY_COLUMNS);
        }
      };
      let noEpisodeExtras = false;
      const loadEpisodes = async () => {
        try {
          return await fetchAll<Episode>('episodes', EPISODE_EXTRA_COLUMNS);
        } catch (e) {
          // Primero la columna: el mensaje de una columna faltante también nombra la tabla.
          if (isMissingColumn(e)) noEpisodeExtras = true;
          else if (isMissingTable(e, 'episodes')) {
            noExperiences = true;
            return [] as Episode[];
          } else throw e;
        }
        return fetchAll<Episode>('episodes', EPISODE_COLUMNS);
      };
      // Descartes sincronizados; sin la migración se usan solo los de este navegador.
      const loadDismissals = async () => {
        try {
          return (await fetchAll<{ key: string }>('dismissals', 'key,created_at')).map(
            (d) => d.key,
          );
        } catch {
          return null;
        }
      };
      const loadTies = async () => {
        try {
          return await fetchAll<Tie>('person_ties', TIE_COLUMNS_NATURE);
        } catch (e) {
          if (isMissingTable(e, 'person_ties')) throw e;
          if (!isMissingColumn(e)) throw e;
          return fetchAll<Tie>('person_ties', TIE_COLUMNS);
        }
      };
      let noProfile = false;
      const loadPeople = async () => {
        try {
          return await fetchAll<Person>('people', PERSON_COLUMNS + ',updated_at');
        } catch (e) {
          if (!isMissingColumn(e)) throw e;
        }
        try {
          return await fetchAll<Person>('people', PERSON_COLUMNS);
        } catch (e) {
          if (!isMissingColumn(e)) throw e;
          noProfile = true;
          return fetchAll<Person>('people', LEGACY_PERSON_COLUMNS);
        }
      };
      let noPlaces = false;
      const loadPlaces = async () => {
        try {
          return await fetchAll<Place>('places', PLACE_COLUMNS);
        } catch (e) {
          if (!isMissingTable(e)) throw e;
          noPlaces = true;
          return [] as Place[];
        }
      };
      let noRelations = false;
      const loadOptional = async <T>(
        table: 'person_ties' | 'person_groups',
        load: () => Promise<T[]>,
      ) => {
        try {
          return await load();
        } catch (e) {
          if (!isMissingTable(e, table)) throw e;
          noRelations = true;
          return [] as T[];
        }
      };
      const [rawPeople, entries, rawPlaces, ties, groups, rawEpisodes, dismissed] =
        await Promise.all([
          loadPeople(),
          loadEntries(),
          loadPlaces(),
          loadOptional<Tie>('person_ties', loadTies),
          loadOptional<Group>('person_groups', () =>
            fetchAll<Group>('person_groups', GROUP_COLUMNS),
          ),
          loadEpisodes(),
          loadDismissals(),
        ]);
      if (dismissed) hydrateDismissed(dismissed);
      const places = rawPlaces.map((p) => ({
        ...p,
        images: Array.isArray(p.images) ? p.images.filter((i) => isHttps(i?.url)) : [],
      }));
      const people = rawPeople.map(normalizePerson);
      if (id !== request.current) return;
      // Ignora vínculos a personas que ya no existen (p. ej. si falta la migración de borrado).
      const known = new Set(people.map((p) => p.id));
      const clean = entries.map((e) => {
        const entry = normalizeEntry(e);
        return entry.person_ids.every((pid) => known.has(pid))
          ? entry
          : {
              ...entry,
              person_ids: entry.person_ids.filter((pid) => known.has(pid)),
            };
      });
      const placeIds = new Set(places.map((p) => p.id));
      // Las de una sola vez que ya abriste (cerraste la pestaña mientras la leías) se borran.
      const spent = clean.filter(isSpent);
      if (spent.length) {
        void supabase
          .from('entries')
          .delete()
          .in(
            'id',
            spent.map((e) => e.id),
          )
          .then(({ error }) => {
            if (error) console.warn('nexo: cápsula sin borrar', error.message);
            else for (const e of spent) if (e.file_path) void removeAttachment(e.file_path);
          });
      }
      const sealed = clean.filter((e) => isHiddenCapsule(e) && !isSpent(e));
      setCapsules(sealed);
      const ready = sealed.filter((e) => isReady(e) && !announcedCapsules.current.has(e.id));
      if (ready.length) {
        for (const e of ready) announcedCapsules.current.add(e.id);
        notify(
          ready.length === 1
            ? 'Una cápsula del tiempo ya se puede abrir: la tienes en Hoy y en tu diario.'
            : `${ready.length} cápsulas del tiempo ya se pueden abrir: las tienes en Hoy y en tu diario.`,
        );
      }
      setWorkspace({
        people,
        entries: clean.filter((e) => !isHiddenCapsule(e)),
        places,
        ties,
        groups: groups.map((g) => ({
          ...g,
          member_ids: (g.member_ids ?? []).filter((m) => known.has(m)),
        })),
        episodes: rawEpisodes.map((ep) => normalizeEpisode(ep, known, placeIds)),
      });
      setExperiencesMissing(noExperiences);
      setEpisodeExtrasMissing(!noExperiences && noEpisodeExtras);
      setRelationsMissing(noRelations);
      setPlacesMissing(noPlaces);
      setSchemaOutdated(outdated);
      setProfileOutdated(noProfile);
      setLoaded(true);
    } catch (e) {
      if (id !== request.current) return;
      setWorkspace(structuredClone(blank));
      setCapsules([]);
      setError(errorMessage(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Al desmontar, las respuestas pendientes se descartan.
    return () => {
      request.current++;
    };
  }, [reload]);

  /** Crea un recuerdo y lo devuelve (null si falló). Con `silent` no muestra aviso de éxito. */
  const createEntry = useCallback(
    async (input: EntryInput, silent = false) => {
      let uploaded: string | undefined;
      try {
        if (input.file) uploaded = await uploadAttachment(user.id, input.file);
        const entry: Entry = {
          id: crypto.randomUUID(),
          title: titleOf(input),
          body: input.body.trim(),
          kind: input.kind,
          tags: input.tags,
          person_ids: input.personIds,
          created_at: dateToTimestamp(input.date),
          amount: input.amount,
          direction: input.direction,
          status: input.status,
          file_path: uploaded,
          images: input.images,
          details: input.details,
          ...(input.episodeId && !experiencesMissing && { episode_id: input.episodeId }),
        };
        const { error } = await supabase.from('entries').insert({
          ...withoutEmptyExtras(entry, schemaOutdated),
          owner_id: user.id,
        });
        if (error) throw error;
        const saved = { ...entry, recorded_at: new Date().toISOString() };
        if (isHiddenCapsule(saved)) {
          setCapsules((c) => [saved, ...c]);
          return saved;
        }
        setWorkspace((w) => ({ ...w, entries: [saved, ...w.entries] }));
        if (!silent) notify('Recuerdo guardado y conexiones actualizadas.');
        return saved;
      } catch (e) {
        if (uploaded) await removeAttachment(uploaded);
        notify(saveError(e));
        return null;
      }
    },
    [user.id, notify, schemaOutdated, experiencesMissing],
  );
  const saveEntry = useCallback(
    async (input: EntryInput) => Boolean(await createEntry(input)),
    [createEntry],
  );

  /**
   * Crea muchos recuerdos de una vez (p. ej. al importar), en tandas de 100 y sin avisos. Sin
   * adjuntos ni episodio. Devuelve los guardados, o null si alguna tanda falló.
   */
  const createEntries = useCallback(
    async (inputs: EntryInput[]) => {
      const saved: Entry[] = [];
      for (let i = 0; i < inputs.length; i += 100) {
        const rows: Entry[] = inputs.slice(i, i + 100).map((input) => ({
          id: crypto.randomUUID(),
          title: titleOf(input),
          body: input.body.trim(),
          kind: input.kind,
          tags: input.tags,
          person_ids: input.personIds,
          created_at: dateToTimestamp(input.date),
          amount: input.amount,
          direction: input.direction,
          status: input.status,
          images: input.images,
          details: input.details,
        }));
        const { error } = await supabase.from('entries').insert(
          rows.map((r) => ({
            ...withoutEmptyExtras(r, schemaOutdated),
            owner_id: user.id,
          })),
        );
        if (error) {
          notify(saveError(error));
          return null;
        }
        const now = new Date().toISOString();
        const batch = rows.map((r) => ({ ...r, recorded_at: now }));
        saved.push(...batch);
        setWorkspace((w) => ({ ...w, entries: [...batch, ...w.entries] }));
      }
      return saved;
    },
    [user.id, notify, schemaOutdated],
  );

  /** Pone (o quita, con null) varios recuerdos en un episodio. */
  const linkEntries = useCallback(
    async (ids: string[], episodeId: string | null, silent = false) => {
      if (!ids.length) return true;
      if (experiencesMissing) {
        notify(EXPERIENCES_HINT);
        return false;
      }
      const { error } = await supabase
        .from('entries')
        .update({ episode_id: episodeId })
        .in('id', ids);
      if (error) {
        notify(errorMessage(error));
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        entries: w.entries.map((e) => (ids.includes(e.id) ? { ...e, episode_id: episodeId } : e)),
      }));
      if (!silent) notify(episodeId ? 'Añadido al episodio.' : 'Quitado del episodio.');
      return true;
    },
    [notify, experiencesMissing],
  );

  // ───── Episodios ─────
  const saveEpisode = useCallback(
    async (input: EpisodeInput, silent = false) => {
      try {
        if (experiencesMissing) throw Error(EXPERIENCES_HINT);
        const row = {
          ...input,
          title: input.title.trim().slice(0, 120) || 'Episodio',
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        // La bitácora, los vínculos y las fotos arrancan vacíos (los pone la base por defecto).
        const { error } = await supabase.from('episodes').insert({ ...row, owner_id: user.id });
        if (error) throw error;
        const episode: Episode = { ...row, updates: [], links: [], images: [] };
        setWorkspace((w) => ({ ...w, episodes: [episode, ...w.episodes] }));
        if (!silent) notify('Episodio creado.');
        return episode;
      } catch (e) {
        notify(isMissingTable(e, 'episodes') ? EXPERIENCES_HINT : errorMessage(e));
        return null;
      }
    },
    [user.id, notify, experiencesMissing],
  );

  const updateEpisode = useCallback(
    async (episode: Episode, changes: EpisodeChanges, silent = false) => {
      if (
        episodeExtrasMissing &&
        (changes.updates !== undefined ||
          changes.links !== undefined ||
          changes.images !== undefined)
      ) {
        notify(EPISODE_EXTRAS_HINT);
        return false;
      }
      // Se aplica sobre la versión más reciente (puede haber cambiado mientras subían fotos).
      setWorkspace((w) => ({
        ...w,
        episodes: w.episodes.map((x) => (x.id === episode.id ? { ...x, ...changes } : x)),
      }));
      const { data, error } = await supabase
        .from('episodes')
        .update(changes)
        .eq('id', episode.id)
        .select('id');
      if (error || !data?.length) {
        const before = Object.fromEntries(
          Object.keys(changes).map((k) => [k, episode[k as keyof Episode]]),
        );
        setWorkspace((w) => ({
          ...w,
          episodes: w.episodes.map((x) => (x.id === episode.id ? { ...x, ...before } : x)),
        }));
        notify(error ? errorMessage(error) : 'No se encontró el episodio. Recarga la página.');
        return false;
      }
      if (!silent) notify('Episodio actualizado.');
      return true;
    },
    [notify, episodeExtrasMissing],
  );

  const removeEpisode = useCallback(
    async (episode: Episode) => {
      const ok = await confirm({
        title: `¿Eliminar el episodio «${episode.title.slice(0, 60)}»?`,
        message:
          'Sus recuerdos, movimientos y pendientes se conservan; solo dejan de estar agrupados.',
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      });
      if (!ok) return false;
      const { error } = await supabase.from('episodes').delete().eq('id', episode.id);
      if (error) {
        notify(error.message);
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        // También sale de los episodios relacionados (la base lo hace con un disparador).
        episodes: w.episodes
          .filter((x) => x.id !== episode.id)
          .map((x) =>
            x.links.some((l) => l.id === episode.id)
              ? { ...x, links: x.links.filter((l) => l.id !== episode.id) }
              : x,
          ),
        entries: w.entries.map((e) =>
          e.episode_id === episode.id ? { ...e, episode_id: null } : e,
        ),
      }));
      notify('Episodio eliminado.');
      return true;
    },
    [notify, confirm],
  );

  // Los descartes («No es así», tarjetas pospuestas) se guardan también en la base.
  useEffect(() => {
    if (experiencesMissing) return setDismissalSync(null);
    setDismissalSync({
      add: (keys) =>
        void supabase
          .from('dismissals')
          .upsert(
            keys.map((key) => ({ key, owner_id: user.id })),
            { onConflict: 'owner_id,key', ignoreDuplicates: true },
          )
          .then(
            ({ error }) => error && console.warn('nexo: descarte sin sincronizar', error.message),
          ),
      remove: (keys) =>
        void supabase
          .from('dismissals')
          .delete()
          .in('key', keys)
          .then(
            ({ error }) => error && console.warn('nexo: descarte sin sincronizar', error.message),
          ),
    });
    return () => setDismissalSync(null);
  }, [user.id, experiencesMissing]);

  const updateEntry = useCallback(
    async (entry: Entry, input: EntryInput) => {
      let uploaded: string | undefined;
      try {
        if (input.file) uploaded = await uploadAttachment(user.id, input.file);
        // Si no cambió el día, se conserva la hora original del registro.
        const sameDay = input.date === todayInputValue(new Date(entry.created_at));
        const file_path = uploaded ?? (input.removeFile ? null : (entry.file_path ?? null));
        const changes = {
          title: input.title.trim(),
          body: input.body.trim(),
          kind: input.kind,
          tags: input.tags,
          person_ids: input.personIds,
          created_at: sameDay ? entry.created_at : dateToTimestamp(input.date),
          amount: input.amount,
          direction: input.direction,
          status: input.status,
          file_path,
          images: input.images,
          details: input.details,
          ...(input.episodeId !== undefined &&
            !experiencesMissing && { episode_id: input.episodeId }),
        };
        const { data, error } = await supabase
          .from('entries')
          .update(withoutEmptyExtras(changes, schemaOutdated))
          .eq('id', entry.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw Error('No se encontró el recuerdo. Recarga la página.');
        // El adjunto anterior ya no se usa: se borra una vez guardado el cambio.
        if (entry.file_path && entry.file_path !== file_path)
          await removeAttachment(entry.file_path);
        setWorkspace((w) => ({
          ...w,
          entries: w.entries.map((x) =>
            x.id === entry.id ? { ...x, ...changes, updated_at: new Date().toISOString() } : x,
          ),
        }));
        notify('Cambios guardados.');
        return true;
      } catch (e) {
        if (uploaded) await removeAttachment(uploaded);
        notify(saveError(e));
        return false;
      }
    },
    [user.id, notify, schemaOutdated, experiencesMissing],
  );

  /** Cambia solo los detalles o el estado de un recuerdo (posponer, marcar seguimiento…). */
  const patchEntry = useCallback(
    async (entry: Entry, changes: EntryPatch) => {
      const next = { ...entry, ...changes, updated_at: new Date().toISOString() };
      setWorkspace((w) => ({
        ...w,
        entries: w.entries.map((x) => (x.id === entry.id ? next : x)),
      }));
      const { data, error } = await supabase
        .from('entries')
        .update(changes)
        .eq('id', entry.id)
        .select('id');
      if (error || !data?.length) {
        setWorkspace((w) => ({
          ...w,
          entries: w.entries.map((x) => (x.id === entry.id ? entry : x)),
        }));
        notify(error ? saveError(error) : 'No se encontró el recuerdo. Recarga la página.');
        return false;
      }
      return true;
    },
    [notify],
  );

  const peopleCount = workspace.people.length;
  /** Sin la migración 005 no se envía `profile` (si está vacío) para que guardar siga funcionando. */
  const personRow = <T extends { profile: PersonProfile }>(row: T) => {
    if (!profileOutdated) return row;
    if (Object.keys(row.profile).length) throw Error(PROFILE_HINT);
    const { profile: _profile, ...rest } = row;
    return rest;
  };

  const savePerson = useCallback(
    async (input: PersonInput) => {
      try {
        const relation = input.profile.relation;
        const person: Person = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          role: input.role.trim(),
          interests: input.interests.trim(),
          bio: input.bio.trim(),
          color: relation
            ? relationMeta[relation].soft
            : PERSON_COLORS[peopleCount % PERSON_COLORS.length],
          created_at: new Date().toISOString(),
          profile: input.profile,
        };
        const { error } = await supabase
          .from('people')
          .insert({ ...personRow(person), owner_id: user.id });
        if (error) throw error;
        setWorkspace((w) => ({ ...w, people: [...w.people, person] }));
        notify('Persona añadida a tu universo.');
        return person;
      } catch (e) {
        notify(isMissingColumn(e) ? PROFILE_HINT : errorMessage(e));
        return null;
      }
    },
    [user.id, notify, peopleCount, profileOutdated],
  );

  /**
   * Crea muchas personas de una vez (un lote importado), en tandas de 100 y sin avisos. Devuelve
   * las guardadas y, si una tanda falló, el error (las de las tandas anteriores ya quedaron).
   */
  const savePeople = useCallback(
    async (inputs: PersonInput[]) => {
      const saved: Person[] = [];
      try {
        for (let i = 0; i < inputs.length; i += 100) {
          const now = new Date().toISOString();
          const rows: Person[] = inputs.slice(i, i + 100).map((input, k) => {
            const relation = input.profile.relation;
            return {
              id: crypto.randomUUID(),
              name: input.name.trim().slice(0, 120),
              role: input.role.trim().slice(0, 120),
              interests: input.interests.trim(),
              bio: input.bio.trim().slice(0, 8000),
              color: relation
                ? relationMeta[relation].soft
                : PERSON_COLORS[(peopleCount + i + k) % PERSON_COLORS.length],
              created_at: now,
              profile: input.profile,
            };
          });
          const { error } = await supabase
            .from('people')
            .insert(rows.map((r) => ({ ...personRow(r), owner_id: user.id })));
          if (error) throw error;
          saved.push(...rows);
          setWorkspace((w) => ({ ...w, people: [...w.people, ...rows] }));
        }
        return { people: saved, error: null as string | null };
      } catch (e) {
        return { people: saved, error: isMissingColumn(e) ? PROFILE_HINT : errorMessage(e) };
      }
    },
    [user.id, peopleCount, profileOutdated],
  );

  /**
   * Borra sin preguntar personas recién creadas y, si se indican, grupos (para deshacer un lote).
   * Sus vínculos y su lugar en los grupos los quita la base.
   */
  const discardPeople = useCallback(
    async (ids: string[], groupIds: string[] = []) => {
      const gone: string[] = [];
      let ok = true;
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        const { error } = await supabase.from('people').delete().in('id', part);
        if (error) {
          notify(errorMessage(error));
          ok = false;
          break;
        }
        gone.push(...part);
      }
      let groupsGone: string[] = [];
      if (ok && groupIds.length) {
        const { error } = await supabase.from('person_groups').delete().in('id', groupIds);
        if (error) notify(errorMessage(error));
        else groupsGone = groupIds;
      }
      const drop = new Set(gone);
      const dropGroups = new Set(groupsGone);
      setWorkspace((w) => ({
        ...w,
        people: w.people.filter((p) => !drop.has(p.id)),
        ties: w.ties.filter((t) => !(t.a && drop.has(t.a)) && !drop.has(t.b)),
        groups: w.groups
          .filter((g) => !dropGroups.has(g.id))
          .map((g) =>
            g.member_ids.some((m) => drop.has(m))
              ? { ...g, member_ids: g.member_ids.filter((m) => !drop.has(m)) }
              : g,
          ),
        entries: w.entries.map((e) =>
          e.person_ids.some((id) => drop.has(id))
            ? { ...e, person_ids: e.person_ids.filter((id) => !drop.has(id)) }
            : e,
        ),
      }));
      return ok;
    },
    [notify],
  );

  /** Cambia campos de una persona. Con `silent` no muestra aviso (accesos rápidos). */
  const patchPerson = useCallback(
    async (person: Person, changes: Partial<Omit<Person, 'id' | 'created_at'>>, silent = false) => {
      // `updated_at` lo pone la base; aquí se refleja al instante (ordena «Más reciente»).
      const next = { ...person, ...changes, updated_at: new Date().toISOString() };
      // Se aplica al instante y se revierte si el servidor falla.
      setWorkspace((w) => ({
        ...w,
        people: w.people.map((p) => (p.id === person.id ? next : p)),
      }));
      try {
        const { data, error } = await supabase
          .from('people')
          .update(
            personRow({
              ...changes,
              profile: changes.profile ?? person.profile,
            }),
          )
          .eq('id', person.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw Error('No se encontró a la persona. Recarga la página.');
        if (!silent) notify('Cambios guardados.');
        return true;
      } catch (e) {
        setWorkspace((w) => ({
          ...w,
          people: w.people.map((p) => (p.id === person.id ? person : p)),
        }));
        notify(isMissingColumn(e) ? PROFILE_HINT : errorMessage(e));
        return false;
      }
    },
    [notify, profileOutdated],
  );

  const updatePerson = useCallback(
    (person: Person, input: PersonInput) =>
      patchPerson(person, {
        name: input.name.trim(),
        role: input.role.trim(),
        interests: input.interests.trim(),
        bio: input.bio.trim(),
        profile: input.profile,
        ...(input.profile.relation && {
          color: relationMeta[input.profile.relation].soft,
        }),
      }),
    [patchPerson],
  );

  /** Sube una foto de perfil a ImgBB y la guarda en la ficha. */
  const uploadPersonPhoto = useCallback(
    async (person: Person, file: File) => {
      if (!file.type.startsWith('image/')) return notify('Elige una imagen.');
      notify('Subiendo foto…');
      try {
        const blob = await prepareImage(file);
        const photo = await uploadToImgbb(blob, 'perfil.jpg');
        await patchPerson(person, { profile: { ...person.profile, photo } }, true);
        notify('Foto actualizada.');
      } catch (e) {
        notify(errorMessage(e));
      }
    },
    [notify, patchPerson],
  );

  /** Devuelve true si la persona se eliminó. Sus recuerdos se conservan sin ese vínculo. */
  const removePerson = useCallback(
    async (person: Person) => {
      const linked = workspace.entries.filter((e) => e.person_ids.includes(person.id)).length;
      let message = 'Esta acción no se puede deshacer.';
      if (linked === 1) message = 'Su recuerdo vinculado se conserva, pero perderá este vínculo.';
      if (linked > 1) {
        message = `Sus ${linked} recuerdos vinculados se conservan, pero perderán este vínculo.`;
      }
      const accepted = await confirm({
        title: `¿Eliminar a «${person.name.slice(0, 60)}»?`,
        message,
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      });
      if (!accepted) return false;
      const { error } = await supabase.from('people').delete().eq('id', person.id);
      if (error) {
        notify(error.message);
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        people: w.people.filter((p) => p.id !== person.id),
        ties: w.ties.filter((t) => t.a !== person.id && t.b !== person.id),
        groups: w.groups.map((g) => ({
          ...g,
          member_ids: g.member_ids.filter((m) => m !== person.id),
        })),
        entries: w.entries.map((e) =>
          e.person_ids.includes(person.id)
            ? {
                ...e,
                person_ids: e.person_ids.filter((id) => id !== person.id),
              }
            : e,
        ),
      }));
      notify('Persona eliminada.');
      return true;
    },
    [notify, confirm, workspace.entries],
  );

  /**
   * Une dos fichas de la misma persona. Primero `keep` recibe los datos de la ficha de `drop`;
   * luego la base mueve sus recuerdos, compromisos, episodios, grupos, vínculos y tarjetas, y borra
   * `drop` (migración 202611080002_merge_people.sql).
   */
  const mergePeople = useCallback(
    async (keep: Person, drop: Person) => {
      if (keep.id === drop.id) return false;
      const merged = mergedProfile(keep, drop);
      try {
        const { error } = await supabase.from('people').update(personRow(merged)).eq('id', keep.id);
        if (error) throw error;
      } catch (e) {
        notify(isMissingColumn(e) ? PROFILE_HINT : errorMessage(e));
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        people: w.people.map((p) => (p.id === keep.id ? { ...p, ...merged } : p)),
      }));
      const { error } = await supabase.rpc('merge_people', {
        p_keep: keep.id,
        p_drop: drop.id,
      });
      if (error) {
        notify(
          error.code === 'PGRST202' || /merge_people/.test(error.message)
            ? MERGE_HINT
            : errorMessage(error),
        );
        return false;
      }
      // Lo mismo que hizo la base, aquí.
      const swap = (ids: string[]) =>
        !ids.includes(drop.id)
          ? ids
          : ids.includes(keep.id)
            ? ids.filter((id) => id !== drop.id)
            : ids.map((id) => (id === drop.id ? keep.id : id));
      setWorkspace((w) => {
        const otherOf = (t: Tie, id: string) => (t.a === id ? t.b : (t.a ?? ME));
        const touches = (t: Tie, id: string) => t.a === id || t.b === id;
        const keepOthers = new Set(
          w.ties.filter((t) => touches(t, keep.id)).map((t) => otherOf(t, keep.id)),
        );
        return {
          ...w,
          people: w.people.filter((p) => p.id !== drop.id),
          entries: w.entries.map((e) => {
            const owner = e.details.owner === drop.id;
            const beneficiary = e.details.beneficiary === drop.id;
            if (!e.person_ids.includes(drop.id) && !owner && !beneficiary) return e;
            return {
              ...e,
              person_ids: swap(e.person_ids),
              details: {
                ...e.details,
                ...(owner && { owner: keep.id }),
                ...(beneficiary && { beneficiary: keep.id }),
              },
            };
          }),
          episodes: w.episodes.map((ep) =>
            ep.person_ids.includes(drop.id) ? { ...ep, person_ids: swap(ep.person_ids) } : ep,
          ),
          groups: w.groups.map((g) =>
            g.member_ids.includes(drop.id) ? { ...g, member_ids: swap(g.member_ids) } : g,
          ),
          ties: w.ties
            .filter((t) => !(touches(t, keep.id) && touches(t, drop.id)))
            .filter((t) => !touches(t, drop.id) || !keepOthers.has(otherOf(t, drop.id)))
            .map((t) =>
              touches(t, drop.id)
                ? {
                    ...t,
                    a: t.a === drop.id ? keep.id : t.a,
                    b: t.b === drop.id ? keep.id : t.b,
                  }
                : t,
            ),
        };
      });
      forgetDismissed(drop.id);
      notify(`Listo: ${drop.name.slice(0, 60)} ahora es parte de ${keep.name.slice(0, 60)}.`);
      return true;
    },
    [notify, profileOutdated],
  );

  const savePlace = useCallback(
    async (input: PlaceInput) => {
      try {
        if (placesMissing) throw Error(PLACES_HINT);
        const place: Place = {
          ...input,
          name: input.name.trim().slice(0, 120),
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('places').insert({ ...place, owner_id: user.id });
        if (error) throw error;
        setWorkspace((w) => ({ ...w, places: [place, ...w.places] }));
        notify('Lugar guardado.');
        return place;
      } catch (e) {
        notify(isMissingTable(e) ? PLACES_HINT : errorMessage(e));
        return null;
      }
    },
    [user.id, notify, placesMissing],
  );

  const updatePlace = useCallback(
    async (place: Place, changes: Partial<PlaceInput>, silent = false) => {
      const next = { ...place, ...changes };
      setWorkspace((w) => ({
        ...w,
        places: w.places.map((p) => (p.id === place.id ? next : p)),
      }));
      const { data, error } = await supabase
        .from('places')
        .update(changes)
        .eq('id', place.id)
        .select('id');
      if (error || !data?.length) {
        setWorkspace((w) => ({
          ...w,
          places: w.places.map((p) => (p.id === place.id ? place : p)),
        }));
        notify(error ? errorMessage(error) : 'No se encontró el lugar. Recarga la página.');
        return false;
      }
      if (!silent) notify('Cambios guardados.');
      return true;
    },
    [notify],
  );

  const removePlace = useCallback(
    async (place: Place) => {
      const ok = await confirm({
        title: `¿Eliminar «${place.name.slice(0, 60)}»?`,
        message: 'Tus recuerdos se conservan; solo pierden el enlace a este lugar.',
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      });
      if (!ok) return false;
      const { error } = await supabase.from('places').delete().eq('id', place.id);
      if (error) {
        notify(error.message);
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        places: w.places.filter((p) => p.id !== place.id),
      }));
      notify('Lugar eliminado.');
      return true;
    },
    [notify, confirm],
  );

  // ───── Vínculos y grupos ─────
  // Las funciones de vínculos se llaman entre sí para «Deshacer»; el ref evita dependencias circulares.
  const tiesRef = useRef<Tie[]>([]);
  tiesRef.current = workspace.ties;
  const tieApi = useRef<{
    insert: (rows: Tie[]) => Promise<boolean>;
    remove: (rows: Tie[], silent?: boolean) => Promise<boolean>;
  }>(null!);

  /** Inserta filas ya normalizadas (también sirve para deshacer un borrado). */
  const insertTies = useCallback(
    async (rows: Tie[]) => {
      const { error } = await supabase.from('person_ties').insert(
        rows.map(({ inferred: _i, why: _w, via: _v, ...t }) => ({
          ...t,
          owner_id: user.id,
        })),
      );
      if (error) {
        const msg = errorMessage(error);
        notify(
          isMissingTable(error, 'person_ties')
            ? RELATIONS_HINT
            : /duplicate|unique/i.test(msg)
              ? 'Ese vínculo ya existe.'
              : msg,
        );
        return false;
      }
      const ids = new Set(tiesRef.current.map((t) => t.id));
      setWorkspace((w) => ({
        ...w,
        ties: [...w.ties, ...rows.filter((t) => !ids.has(t.id))],
      }));
      return true;
    },
    [user.id, notify],
  );

  /** Guarda varios vínculos a la vez. Omite los que ya existen (en cualquier sentido). */
  const saveTies = useCallback(
    async (inputs: TieInput[], silent = false) => {
      if (relationsMissing) {
        notify(RELATIONS_HINT);
        return [] as Tie[];
      }
      const have = new Set(tiesRef.current.map((t) => tieKey(t.a, t.b, t.kind)));
      const rows: Tie[] = [];
      for (const i of inputs) {
        const c = canonicalTie(i.a === ME ? null : i.a, i.b, i.kind);
        if (!c.b || c.b === ME || c.a === c.b) continue;
        const k = tieKey(c.a, c.b, c.kind);
        if (have.has(k)) continue;
        have.add(k);
        rows.push({
          id: crypto.randomUUID(),
          ...c,
          note: (i.note ?? '').trim().slice(0, 300),
          created_at: new Date().toISOString(),
          ...(i.nature && !experiencesMissing && { nature: i.nature }),
        });
      }
      if (!rows.length) {
        if (!silent)
          notify(inputs.length > 1 ? 'Esos vínculos ya existían.' : 'Ese vínculo ya existe.');
        return [] as Tie[];
      }
      if (!(await insertTies(rows))) return [] as Tie[];
      if (!silent)
        notify(rows.length === 1 ? 'Vínculo guardado.' : `${rows.length} vínculos guardados.`, {
          label: 'Deshacer',
          run: () => void tieApi.current.remove(rows, true),
        });
      return rows;
    },
    [notify, relationsMissing, insertTies, experiencesMissing],
  );

  const saveTie = useCallback(
    async (input: TieInput, silent = false) => (await saveTies([input], silent))[0] ?? null,
    [saveTies],
  );

  /** Borra vínculos guardados; el aviso permite deshacerlo. */
  const removeTies = useCallback(
    async (list: Tie[], silent = false) => {
      const rows = list.filter((t) => !t.inferred);
      if (!rows.length) return true;
      const ids = rows.map((t) => t.id);
      const { error } = await supabase.from('person_ties').delete().in('id', ids);
      if (error) {
        notify(error.message);
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        ties: w.ties.filter((t) => !ids.includes(t.id)),
      }));
      // Al instante (sin esperar al render): así se puede volver a guardar el mismo vínculo
      // enseguida, p. ej. con otra nota.
      tiesRef.current = tiesRef.current.filter((t) => !ids.includes(t.id));
      if (!silent)
        notify(rows.length === 1 ? 'Vínculo eliminado.' : `${rows.length} vínculos eliminados.`, {
          label: 'Deshacer',
          run: () => void tieApi.current.insert(rows),
        });
      return true;
    },
    [notify],
  );
  tieApi.current = { insert: insertTies, remove: removeTies };

  const removeTie = useCallback(
    (tie: Tie, silent = false) => removeTies([tie], silent),
    [removeTies],
  );

  const saveGroup = useCallback(
    async (input: GroupInput, silent = false) => {
      try {
        if (relationsMissing) throw Error(RELATIONS_HINT);
        const group: Group = {
          ...input,
          name: input.name.trim().slice(0, 80),
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        const { error } = await supabase
          .from('person_groups')
          .insert({ ...group, owner_id: user.id });
        if (error) throw error;
        setWorkspace((w) => ({ ...w, groups: [...w.groups, group] }));
        if (!silent) notify('Grupo creado.');
        return group;
      } catch (e) {
        notify(isMissingTable(e, 'person_groups') ? RELATIONS_HINT : errorMessage(e));
        return null;
      }
    },
    [user.id, notify, relationsMissing],
  );

  const updateGroup = useCallback(
    async (group: Group, changes: Partial<GroupInput>, silent = false) => {
      const next = { ...group, ...changes };
      // A quien sacas de un grupo no se le vuelve a sugerir para él.
      if (changes.member_ids) {
        const out = group.member_ids.filter((id) => !changes.member_ids!.includes(id));
        if (out.length) dismiss(...out.map((id) => groupKey(group.id, id)));
      }
      setWorkspace((w) => ({
        ...w,
        groups: w.groups.map((g) => (g.id === group.id ? next : g)),
      }));
      const { data, error } = await supabase
        .from('person_groups')
        .update(changes)
        .eq('id', group.id)
        .select('id');
      if (error || !data?.length) {
        setWorkspace((w) => ({
          ...w,
          groups: w.groups.map((g) => (g.id === group.id ? group : g)),
        }));
        notify(error ? errorMessage(error) : 'No se encontró el grupo. Recarga la página.');
        return false;
      }
      if (!silent) notify('Grupo actualizado.');
      return true;
    },
    [notify],
  );

  const removeGroup = useCallback(
    async (group: Group) => {
      const ok = await confirm({
        title: `¿Eliminar el grupo «${group.name.slice(0, 60)}»?`,
        message: 'Las personas se conservan; solo dejan de estar agrupadas.',
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      });
      if (!ok) return false;
      const { error } = await supabase.from('person_groups').delete().eq('id', group.id);
      if (error) {
        notify(error.message);
        return false;
      }
      setWorkspace((w) => ({
        ...w,
        groups: w.groups.filter((g) => g.id !== group.id),
      }));
      notify('Grupo eliminado.');
      return true;
    },
    [notify, confirm],
  );

  /**
   * Cierra o reabre un pendiente: hecho, no realizado (con su razón, si la das) o abierto otra vez.
   * Se ve al instante y se revierte si el servidor falla. Devuelve cómo quedó (null si no se
   * guardó). La razón y el día se guardan en `details.missed`; al reabrir o marcarlo hecho se quitan.
   */
  const resolveTask = useCallback(
    async (entry: Entry, outcome: TaskOutcome, why = '') => {
      const { missed: _missed, ...rest } = entry.details;
      const reason = why.trim().replace(/\s+/g, ' ').slice(0, 280);
      const status: Status =
        outcome === 'hecho' ? 'completado' : outcome === 'no' ? 'no_realizado' : 'pendiente';
      // Los detalles solo viajan si cambian (marcar hecho uno abierto no los toca).
      const changes: EntryPatch =
        outcome === 'no'
          ? {
              status,
              details: { ...rest, missed: { at: todayInputValue(), ...(reason && { why: reason }) } },
            }
          : entry.details.missed
            ? { status, details: rest }
            : { status };
      const next: Entry = { ...entry, ...changes, updated_at: new Date().toISOString() };
      setWorkspace((w) => ({
        ...w,
        entries: w.entries.map((x) => (x.id === entry.id ? next : x)),
      }));
      const { data, error } = await supabase
        .from('entries')
        .update(changes)
        .eq('id', entry.id)
        .select('id');
      if (error || !data?.length) {
        setWorkspace((w) => ({
          ...w,
          entries: w.entries.map((x) => (x.id === entry.id ? entry : x)),
        }));
        notify(
          !error
            ? 'No se encontró el pendiente. Recarga la página.'
            : isStatusLimited(error)
              ? OUTCOME_HINT
              : saveError(error),
        );
        return null;
      }
      return next;
    },
    [notify],
  );

  /** Lo abierto queda hecho; lo cerrado (hecho o soltado), abierto otra vez. */
  const toggleEntry = useCallback(
    async (entry: Entry) => {
      await resolveTask(entry, entry.status === 'pendiente' ? 'hecho' : 'abierto');
    },
    [resolveTask],
  );

  /** Elimina un recuerdo. Con `silent` no pregunta ni avisa (lo borra otra acción, p. ej. Tableros). */
  const removeEntry = useCallback(
    async (entry: Entry, silent = false) => {
      if (!silent) {
        const accepted = await confirm({
          title: `¿Eliminar «${entry.title.slice(0, 60)}»?`,
          message: 'Esta acción no se puede deshacer.',
          confirmLabel: 'Eliminar',
          danger: true,
          icon: 'trash',
        });
        if (!accepted) return;
      }
      const { error } = await supabase.from('entries').delete().eq('id', entry.id);
      if (error) return notify(error.message);
      if (entry.file_path) await removeAttachment(entry.file_path);
      setWorkspace((w) => ({
        ...w,
        entries: w.entries.filter((x) => x.id !== entry.id),
      }));
      if (!silent) notify('Apunte eliminado.');
    },
    [notify, confirm],
  );

  /**
   * Abre una cápsula del tiempo ya lista: queda la fecha en que la abriste. Si se conserva, pasa
   * a ser una entrada más del diario; si es de una sola vez, sigue aparte hasta que la cierres.
   * Devuelve la cápsula abierta (null si falló).
   */
  const openCapsule = useCallback(
    async (entry: Entry) => {
      const capsule = entry.details.capsule;
      if (!capsule || capsule.opensOn > todayInputValue()) return null;
      if (capsule.seenAt) return entry;
      const details = {
        ...entry.details,
        capsule: { ...capsule, seenAt: new Date().toISOString() },
      };
      const { data, error } = await supabase
        .from('entries')
        .update({ details })
        .eq('id', entry.id)
        .select('id');
      if (error || !data?.length) {
        notify(error ? errorMessage(error) : 'No se encontró la cápsula. Recarga la página.');
        return null;
      }
      const opened = { ...entry, details };
      if (capsule.once) {
        setCapsules((c) => c.map((x) => (x.id === entry.id ? opened : x)));
      } else {
        setCapsules((c) => c.filter((x) => x.id !== entry.id));
        setWorkspace((w) => ({ ...w, entries: [opened, ...w.entries] }));
      }
      return opened;
    },
    [notify],
  );

  /** Borra una cápsula para siempre (la de una sola vez al cerrarla, o una que rompes sin abrir). */
  const burnCapsule = useCallback(
    async (entry: Entry) => {
      const { error } = await supabase.from('entries').delete().eq('id', entry.id);
      if (error) {
        notify(errorMessage(error));
        return false;
      }
      if (entry.file_path) await removeAttachment(entry.file_path);
      setCapsules((c) => c.filter((x) => x.id !== entry.id));
      return true;
    },
    [notify],
  );

  const openAttachment = useCallback(
    async (entry: Entry) => {
      if (!entry.file_path) return;
      const { data, error } = await supabase.storage
        .from('attachments')
        .createSignedUrl(entry.file_path, 60);
      if (error) return notify(error.message);
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    },
    [notify],
  );

  return {
    workspace,
    loading,
    loaded,
    error,
    schemaOutdated,
    profileOutdated,
    placesMissing,
    relationsMissing,
    experiencesMissing,
    episodeExtrasMissing,
    createEntry,
    createEntries,
    patchEntry,
    linkEntries,
    saveEpisode,
    updateEpisode,
    removeEpisode,
    saveTie,
    saveTies,
    removeTie,
    removeTies,
    saveGroup,
    updateGroup,
    removeGroup,
    savePlace,
    updatePlace,
    removePlace,
    reload,
    patchPerson,
    uploadPersonPhoto,
    saveEntry,
    updateEntry,
    savePerson,
    savePeople,
    discardPeople,
    updatePerson,
    removePerson,
    mergePeople,
    toggleEntry,
    resolveTask,
    removeEntry,
    openAttachment,
    capsules,
    openCapsule,
    burnCapsule,
  };
}

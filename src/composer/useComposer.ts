import { useCallback, useMemo, useState } from "react";
import type {
  Direction,
  Entry,
  EntryDetails,
  EntryInput,
  Kind,
  Person,
  Status,
  Tie,
} from "../data";
import { todayInputValue } from "../lib/format";
import {
  cueOptions,
  cueQuestion,
  recognize,
  type KinCue,
} from "../lib/recognize";

/** Algo que preguntar sobre las personas del texto («¿Quién es tu mamá?»). */
export type PeopleCue = {
  key: string;
  question: string;
  /** Personas para elegir, de la más probable a la menos. */
  options: string[];
  /** Si es un parentesco: al elegir se guarda también el vínculo. */
  kin?: KinCue;
};
import {
  allMoneyCategories,
  cleanDetails,
  deriveTitle,
  problemFor,
} from "./logic";
import { useImageUploads } from "./useImageUploads";

const MAX_DOC_BYTES = 10 * 1024 * 1024;

type ComposerInit = {
  entry?: Entry;
  kind: Kind;
  links: string[];
  details?: EntryDetails;
  episodeId?: string;
};

/**
 * Todo el estado de un recuerdo en un solo lugar. Cada tipo (nota, libro, película…) dibuja su
 * propia interfaz sobre este mismo estado, de modo que se puede cambiar de tipo sin perder lo escrito.
 */
export function useComposer(
  {
    entry,
    kind: initialKind,
    links,
    details: initialDetails,
    episodeId: initialEpisode,
  }: ComposerInit,
  people: Person[],
  ties: Tie[] = [],
) {
  const editing = entry !== undefined;
  const [touched, setTouched] = useState(false);
  const mark = useCallback(
    <T>(set: (v: T) => void) =>
      (v: T) => {
        setTouched(true);
        set(v);
      },
    [],
  );

  const [kind, setKindRaw] = useState<Kind>(entry?.kind ?? initialKind);
  const [title, setTitleRaw] = useState(entry?.title ?? "");
  const [body, setBodyRaw] = useState(entry?.body ?? "");
  const [tags, setTagsRaw] = useState<string[]>(entry?.tags ?? []);
  const [personIds, setPersonIdsRaw] = useState<string[]>(
    entry?.person_ids ?? links,
  );
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [date, setDateRaw] = useState(() =>
    todayInputValue(entry ? new Date(entry.created_at) : undefined),
  );
  const [amount, setAmountRaw] = useState(entry?.amount ?? 0);
  const [direction, setDirectionRaw] = useState<Direction>(
    entry?.direction ?? "egreso",
  );
  const [status, setStatusRaw] = useState<Status>(entry?.status ?? "pendiente");
  const [details, setDetailsRaw] = useState<EntryDetails>(
    entry?.details ?? initialDetails ?? {},
  );
  const [docFile, setDocFileRaw] = useState<File | null>(null);
  const [docNotice, setDocNotice] = useState("");
  const [removeDoc, setRemoveDocRaw] = useState(false);
  const [episodeId, setEpisodeIdRaw] = useState<string | null>(
    entry ? (entry.episode_id ?? null) : (initialEpisode ?? null),
  );
  const uploads = useImageUploads(entry?.images ?? []);
  // Libros: fotos aparte de la portada (tu ejemplar, páginas, dedicatorias…).
  const photos = useImageUploads(entry?.details.bookPhotos ?? [], 12);
  /**
   * Libro de tu estantería que coincide con lo que escribes: al guardar, se actualiza esa ficha en
   * vez de crear otra (si aún no lo empezabas). Solo al crear.
   */
  const [shelfBook, setShelfBook] = useState<Entry | null>(null);

  // Elegir el tipo no cuenta como escribir algo: un formulario vacío se cierra sin preguntar.
  const setKind = setKindRaw;
  const setTitle = mark(setTitleRaw);
  const setBody = mark(setBodyRaw);
  const setTags = mark(setTagsRaw);
  const setDate = mark(setDateRaw);
  const setAmount = mark(setAmountRaw);
  const setDirection = mark(setDirectionRaw);
  const setStatus = mark(setStatusRaw);
  const setRemoveDoc = mark(setRemoveDocRaw);
  const setEpisodeId = mark(setEpisodeIdRaw);

  const setDetail = useCallback(
    <K extends keyof EntryDetails>(key: K, value: EntryDetails[K]) => {
      setTouched(true);
      setDetailsRaw((d) => ({ ...d, [key]: value }));
    },
    [],
  );

  const setDocFile = useCallback((file: File | null) => {
    setDocNotice("");
    if (file && file.size > MAX_DOC_BYTES) {
      setDocNotice("El documento debe pesar menos de 10 MB.");
      return;
    }
    setTouched(true);
    setDocFileRaw(file);
  }, []);

  // Personas: las elegidas a mano y las que se reconocen en el texto por nombre, apodo,
  // apellido o parentesco («mi mamá», «los Gómez», «mi tío Carlos»).
  const [dismissedCues, setDismissedCues] = useState<string[]>([]);
  const rec = useMemo(
    () => recognize(`${title}\n${body}`, people, ties),
    [title, body, people, ties],
  );
  const { detected, why } = useMemo(() => {
    const why = new Map<string, string>();
    for (const m of rec.mentions) {
      // Varias personas posibles (dos «Laura»): no se adivina, se pregunta.
      if (m.ids.length > 1 && !m.group) continue;
      for (const id of m.ids) {
        const prev = why.get(id);
        // El parentesco explica mejor que «nombre».
        if (!prev || (prev === "nombre" && m.why !== "apellido"))
          why.set(id, m.why);
      }
    }
    return { detected: people.filter((p) => why.has(p.id)), why };
  }, [rec, people]);
  const suggested = detected.filter(
    (p) => !personIds.includes(p.id) && !dismissed.includes(p.id),
  );

  const togglePerson = useCallback((id: string) => {
    setTouched(true);
    setPersonIdsRaw((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
    // Si la quitas a propósito, no vuelve a sugerirse aunque su nombre siga en el texto.
    setDismissed((d) => (d.includes(id) ? d : [...d, id]));
  }, []);
  const acceptSuggestion = useCallback((id: string) => {
    setTouched(true);
    setPersonIdsRaw((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);
  const dismissSuggestion = useCallback((id: string) => {
    setDismissed((d) => (d.includes(id) ? d : [...d, id]));
  }, []);

  // Al crear, las sugerencias que no descartes se vinculan solas al guardar. Al editar, no.
  const finalPersonIds = editing
    ? personIds
    : [...new Set([...personIds, ...suggested.map((p) => p.id)])];

  // Preguntas pendientes: «¿Quién es tu mamá?», «¿Carlos es tu tío?», «¿Cuál Laura?».
  const cues = useMemo<PeopleCue[]>(() => {
    const out: PeopleCue[] = [];
    const chosen = new Set(finalPersonIds);
    for (const k of rec.cues) {
      if (k.status === "known" || dismissedCues.includes(k.key)) continue;
      // Ya elegiste a una de las opciones a mano.
      if (k.status === "choose" && k.ids.some((id) => chosen.has(id))) continue;
      out.push({
        key: k.key,
        question: cueQuestion(k, people),
        options: k.status === "confirm" ? k.ids : cueOptions(k, people, ties),
        kin: k,
      });
    }
    for (const m of rec.mentions) {
      if (
        m.ids.length < 2 ||
        m.group ||
        rec.cues.some((k) => k.start === m.start)
      )
        continue;
      const key = "name|" + m.ids.slice().sort().join(",");
      if (dismissedCues.includes(key) || m.ids.some((id) => chosen.has(id)))
        continue;
      if (out.some((c) => c.key === key)) continue;
      out.push({ key, question: `¿Cuál «${m.text}»?`, options: m.ids });
    }
    return out;
  }, [rec, people, ties, dismissedCues, finalPersonIds.join()]);
  const dismissCue = useCallback((key: string) => {
    setDismissedCues((d) => (d.includes(key) ? d : [...d, key]));
  }, []);

  /** Categoría de un movimiento: la primera etiqueta que sea una categoría conocida. */
  const category = tags.find((t) => allMoneyCategories.includes(t));
  const setCategory = useCallback((name: string | undefined) => {
    setTouched(true);
    setTagsRaw((list) => {
      const rest = list.filter((t) => !allMoneyCategories.includes(t));
      return name ? [name, ...rest] : rest;
    });
  }, []);

  const cleaned = cleanDetails(kind, details);
  const problem =
    problemFor(kind, {
      title,
      body,
      details: cleaned,
      personIds: finalPersonIds,
      amount,
    }) ??
    (uploads.busy || (kind === "Libro" && photos.busy)
      ? "Subiendo fotos…"
      : uploads.hasError || (kind === "Libro" && photos.hasError)
        ? "Una foto no se subió: reintenta o quítala."
        : null);

  const names = finalPersonIds
    .map((id) => people.find((p) => p.id === id)?.name.split(" ")[0])
    .filter((n): n is string => Boolean(n));
  /** El título que se pondría solo si no escribes ninguno. */
  const suggestedTitle = deriveTitle(kind, {
    title: "",
    body,
    details: cleaned,
    names,
    direction,
    category,
  });

  const toInput = (): EntryInput => {
    // Compromisos: la primera persona es a quién se lo prometiste o de quién depende.
    if (kind === "Pendiente") {
      const k = cleaned.commitment ?? "quiero";
      const who = finalPersonIds[0];
      delete cleaned.beneficiary;
      delete cleaned.owner;
      if (who && k === "prometi") cleaned.beneficiary = who;
      if (who && (k === "espero" || k === "depende")) cleaned.owner = who;
      if (k === "quiero") delete cleaned.commitment;
    }
    if (kind === "Libro") {
      if (photos.images.length) cleaned.bookPhotos = photos.images;
      else delete cleaned.bookPhotos;
    }
    return {
      title: deriveTitle(kind, {
        title,
        body,
        details: cleaned,
        names,
        direction,
        category,
      }),
      body: body.trim(),
      kind,
      tags,
      personIds: finalPersonIds,
      date,
      amount: kind === "Movimiento" ? amount : 0,
      direction: kind === "Movimiento" ? direction : "egreso",
      status: kind === "Pendiente" ? status : "pendiente",
      images: uploads.images,
      details: cleaned,
      file: docFile,
      removeFile: removeDoc,
      // Al editar solo se envía si cambió, para no tocar la columna si aún no existe.
      episodeId: editing
        ? episodeId === (entry?.episode_id ?? null)
          ? undefined
          : episodeId
        : (episodeId ?? undefined),
    };
  };

  return {
    editing,
    entry,
    kind,
    setKind,
    title,
    setTitle,
    body,
    setBody,
    tags,
    setTags,
    category,
    setCategory,
    date,
    setDate,
    amount,
    setAmount,
    direction,
    setDirection,
    status,
    setStatus,
    details,
    setDetail,
    uploads,
    photos,
    shelfBook: editing ? null : shelfBook,
    setShelfBook,
    docFile,
    setDocFile,
    docNotice,
    removeDoc,
    setRemoveDoc,
    episodeId,
    setEpisodeId,
    people: {
      all: people,
      selected: personIds,
      toggle: togglePerson,
      suggested,
      accept: acceptSuggestion,
      dismiss: dismissSuggestion,
      /** Al crear, las sugerencias se vinculan solas al guardar. */
      autoLink: !editing,
      /** Por qué se reconoció a cada persona: «tu mamá», «apellido»… */
      why,
      /** Tramos del texto que nombran a alguien (para resaltarlos). */
      mentions: rec.mentions,
      cues,
      dismissCue,
    },
    problem,
    suggestedTitle,
    dirty: touched || uploads.touched || photos.touched,
    toInput,
  };
}

export type ComposerApi = ReturnType<typeof useComposer>;

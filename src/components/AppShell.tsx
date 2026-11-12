import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Lock } from "lucide-react";
import {
  AppProvider,
  type AppContextValue,
  type OutcomeMode,
  type QuickMode,
} from "../AppContext";
import { supabase } from "../backend";
import { ComposeModal, type ComposeInit } from "../composer/ComposeModal";
import { mergeIntoShelfBook } from "../composer/logic";
import type {
  AppUser,
  Entry,
  EntryInput,
  Episode,
  EpisodeInput,
  EpisodeOrigin,
  Group,
  Page,
  Exchange,
  Person,
  Place,
  StoredImage,
} from "../data";
import {
  deduceTastes,
  hasTastes,
  newTastes,
  tasteSources,
  tastesLabel,
  withTastes,
  type Tastes,
} from "../lib/tastes";
import { PeopleBatch } from "../people/batch/PeopleBatch";
import { givingOf } from "../people/giving";
import { entryAsInput } from "../finance/money";
import { InstantComposer } from "../instants/InstantComposer";
import { InstantSheet, InstantsPanel } from "../instants/InstantsPanel";
import { PiecesBar } from "../instants/PiecesBar";
import { setPiecesReview } from "../instants/analysis";
import { loadInstants } from "../instants/store";
import { useFediverseImport } from "../instants/importer";
import { EpisodeSheet } from "../episodes/EpisodeSheet";
import { EpisodesPage } from "../episodes/EpisodesPage";
import { MeetingBrief } from "../people/MeetingBrief";
import { GroupDialog } from "../relations/GroupDialog";
import { TieDialog } from "../relations/TieDialog";
import { todayInputValue } from "../lib/format";
import { exchangeKinds, type PersonSection } from "../lib/people";
import { PersonSheet } from "../people/PersonSheet";
import { QuickDialog } from "../people/QuickDialog";
import { PlacesPage } from "../pages/PlacesPage";
import { PlaceSheet } from "../places/PlaceSheet";
import { useAssistant } from "../hooks/useAssistant";
import { useToast } from "../hooks/useToast";
import { useWorkspace } from "../hooks/useWorkspace";
import { useMyProfile } from "../hooks/useMyProfile";
import { MyProfileSheet } from "../people/MyProfileSheet";
import { MergeDialog } from "../people/MergeDialog";
import { parseHash, toHash, type Route } from "../lib/route";
import { ConnectionsPage } from "../pages/ConnectionsPage";
import { Agenda, Libroteca } from "../library/Libroteca";
import { UploadTray } from "../capturas/UploadTray";
import { ShotPeek } from "../capturas/ShotPeek";
import { NoteReminders } from "../notes/reminders";
import { BoardInbox } from "../planner/BoardInbox";
import { ColumnDock } from "../planner/ColumnDock";
import { DiaryReader, type DiaryJob } from "../diary/reader/DiaryReader";
import { isVaulted, useDiaryVault } from "../diary/vault";
import { ProgressSheet } from "../library/ProgressSheet";
import { ClosingRitual } from "../ritual/ClosingRitual";
import { isFinished } from "../ritual/learning";
import { FinancePage } from "../pages/FinancePage";
import { PeoplePage } from "../pages/PeoplePage";
import { Boards } from "../planner/Boards";
import { Readings } from "../readings/Readings";
import { SettingsPage } from "../pages/SettingsPage";
import { ChatPanel } from "./ChatPanel";
import { useConfirm } from "./ConfirmDialog";
import { Lightbox } from "./Lightbox";
import { EntryViewer } from "./EntryViewer";
import { OutcomePopover } from "./TaskOutcome";
import { Overview } from "./Overview";
import { PersonPeek } from "../people/PersonPeek";
import { WeeklyDigest } from "../weekly/WeeklyDigest";
import { PageHeading } from "./PageHeading";
import { Sidebar } from "./Sidebar";
import { Toasts } from "./Toast";
import { Topbar } from "./Topbar";

type ModalState =
  | null
  | { type: "person"; person?: Person; section?: PersonSection }
  | { type: "compose"; init: ComposeInit }
  | { type: "place"; place?: Place }
  | {
      type: "episode";
      episode?: Episode;
      init?: Partial<EpisodeInput>;
      from?: EpisodeOrigin;
    }
  | {
      type: "brief";
      personId: string;
      mode: "antes" | "despues";
      entry?: Entry;
    }
  | { type: "entry"; entryId: string };

function renderPage(page: Page, route: Route, toggleMenu: () => void) {
  switch (page) {
    case "Mi espacio":
      return <Overview />;
    case "Episodios":
      return <EpisodesPage />;
    case "Tableros":
      return <Boards toggleMenu={toggleMenu} />;
    case "Lecturas":
      return (
        <Readings
          addLink={route.readingId === "nuevo"}
          openId={
            route.readingId === "nuevo"
              ? undefined
              : (route.readingId ?? undefined)
          }
        />
      );
    case "Libroteca":
      return <Libroteca noteId={route.noteId ?? null} />;
    case "Agenda":
      return <Agenda notebookId={route.notebookId} />;
    case "Personas":
      return <PeoplePage />;
    case "Conexiones":
      return <ConnectionsPage initialTab={route.tab} />;
    case "Lugares":
      return <PlacesPage />;
    case "Finanzas":
      return <FinancePage />;
    case "Ajustes":
      return <SettingsPage />;
  }
}

/** Interfaz principal. Solo se muestra con una sesión iniciada. */
export function AppShell({ user }: { user: AppUser }) {
  const { toasts, notify, dismiss } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const data = useWorkspace(user, notify, confirm);
  const mine = useMyProfile(user, notify);
  const [meOpen, setMeOpen] = useState(false);
  const assistant = useAssistant();
  // La sección actual vive en la URL (`#/personas/<id>`): así sobrevive a recargar la página y
  // funcionan los botones de atrás y adelante. `visit` cambia en cada navegación para volver a
  // montar la página y descartar su búsqueda y sus filtros, incluso al pulsar la sección actual.
  const [route, setRoute] = useState<Route & { visit: number }>(() => ({
    ...parseHash(window.location.hash),
    visit: 0,
  }));
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [chat, setChat] = useState(false);
  const [viewer, setViewer] = useState<{
    images: StoredImage[];
    index: number;
  } | null>(null);
  const [quick, setQuick] = useState<{
    personId: string;
    mode: QuickMode;
  } | null>(null);
  // personId null = vínculos tuyos.
  const [tieFor, setTieFor] = useState<{
    personId: string | null;
    others?: string[];
  } | null>(null);
  const [groupEdit, setGroupEdit] = useState<{
    group?: Group;
    members?: string[];
  } | null>(null);
  // Ficha lateral de una persona abierta desde cualquier sección (sin navegar).
  const [peek, setPeek] = useState<string | null>(null);
  // La elección «Hecho / No lo hice» de un pendiente, junto al botón que la abrió.
  const [outcome, setOutcome] = useState<{
    entryId: string;
    anchor: HTMLElement;
    mode: OutcomeMode;
  } | null>(null);
  // El periódico va en su propia capa: lo que abras desde él (un recuerdo, una persona) queda encima.
  const [weekly, setWeekly] = useState(false);
  // Actualizar el progreso de un libro o una serie (puede abrirse encima de su ficha).
  const [progress, setProgress] = useState<string | null>(null);
  // Ritual de cierre de un libro o una película (también encima de su ficha).
  const [ritual, setRitual] = useState<string | null>(null);
  // Unir dos fichas de la misma persona (con la otra ya elegida o por elegir).
  const [merge, setMerge] = useState<{
    personId: string;
    otherId?: string;
  } | null>(null);
  // Añadir varias personas a la vez (lista escrita o contactos importados).
  const [peopleBatch, setPeopleBatch] = useState(false);
  // Instantes: escribir uno (o un hilo), el feed a la derecha y uno abierto en su ventana.
  const [writing, setWriting] = useState<{
    text?: string;
    people?: string[];
    nonce: number;
  } | null>(null);
  const [instantsOpen, setInstantsOpen] = useState<{ focus?: string } | null>(
    null,
  );
  const [instantId, setInstantId] = useState<string | null>(null);
  const closeInstants = useCallback(() => setInstantsOpen(null), []);
  const closeInstant = useCallback(() => setInstantId(null), []);
  // Se cargan desde el principio: el saludo, la búsqueda y las fichas los citan.
  useEffect(() => {
    void loadInstants();
  }, []);
  // Lo que publicas en Mastodon llega a Instantes (si compartir está configurado).
  useFediverseImport({
    uid: user.id,
    workspace: data.workspace,
    ready: data.loaded,
    notify,
    openInstants: (focus) => setInstantsOpen({ focus }),
  });
  // Una entrada del diario recién guardada que la IA está leyendo.
  const [diaryJob, setDiaryJob] = useState<DiaryJob | null>(null);
  const closeDiaryJob = useCallback(() => setDiaryJob(null), []);

  const { workspace } = data;
  const { page } = route;
  // Las entradas de la bóveda del diario no salen en ninguna otra parte: solo en su carpeta.
  const diaryVault = useDiaryVault(
    workspace.entries,
    data.patchEntry,
    () => void data.reload(),
  );
  const shownWorkspace = useMemo(
    () =>
      workspace.entries.some(isVaulted)
        ? {
            ...workspace,
            entries: workspace.entries.filter((e) => !isVaulted(e)),
          }
        : workspace,
    [workspace],
  );
  // Siempre lo último (para lo que corre después de un guardado).
  const latest = useRef(workspace);
  latest.current = workspace;

  /**
   * Gustos que deja ver una nota o un encuentro («le encanta el café», «empezó clases de salsa»):
   * se suman a la ficha de quien corresponde, con «Quitar» en el aviso. Al editar, solo lo nuevo.
   */
  async function learnTastes(input: EntryInput, before?: Entry) {
    if (input.kind !== "Nota" && input.kind !== "Encuentro") return;
    const textOf = (title: string, body: string) =>
      body.trim().startsWith(title.trim()) ? body : `${title}.\n${body}`;
    const people = input.personIds.flatMap(
      (id) => latest.current.people.find((p) => p.id === id) ?? [],
    );
    const parts = tasteSources(textOf(input.title, input.body), people);
    const old = before
      ? tasteSources(textOf(before.title, before.body), people)
      : null;
    const done: { before: Person; added: Tastes }[] = [];
    for (const [id, said] of parts) {
      let t = deduceTastes(said);
      const prev = old?.get(id);
      if (prev) t = newTastes(t, deduceTastes(prev));
      if (!hasTastes(t)) continue;
      const current = latest.current.people.find((p) => p.id === id);
      if (!current) continue;
      const next = withTastes(current, t);
      if (!next.changed) continue;
      if (
        await data.patchPerson(
          current,
          { interests: next.interests, profile: next.profile },
          true,
        )
      )
        done.push({ before: current, added: next.added });
    }
    if (!done.length) return;
    const first = (p: Person) => p.name.split(" ")[0];
    notify(
      done.length === 1
        ? `Guardado · ${first(done[0].before)} suma a su perfil: ${tastesLabel(done[0].added)}.`
        : `Guardado · gustos nuevos en las fichas de ${done.map((d) => first(d.before)).join(" y ")}.`,
      {
        label: "Quitar",
        run: () => {
          for (const d of done) {
            const now = latest.current.people.find((p) => p.id === d.before.id);
            if (!now) continue;
            void data.patchPerson(
              now,
              {
                interests: d.before.interests,
                profile: {
                  ...now.profile,
                  likes: d.before.profile.likes,
                  dislikes: d.before.profile.dislikes,
                },
              },
              true,
            );
          }
        },
      },
    );
  }
  /**
   * Un movimiento con personas también queda en «Dar y recibir»: un gasto es algo que le diste (con
   * lo clave y cuánto, aproximado); un regalo o un préstamo que te hicieron, algo que recibiste. Va
   * enlazado al movimiento: si lo editas se actualiza, y si quitas a la persona, sale de su ficha.
   */
  async function syncGiving(input: EntryInput, entryId: string) {
    const want = givingOf(input);
    const targets = new Set(want ? input.personIds : []);
    const added: Person[] = [];
    for (const p of latest.current.people) {
      const list = p.profile.exchanges ?? [];
      const had = list.find((x) => x.entryId === entryId);
      if (!targets.has(p.id) && !had) continue;
      let next: Exchange[];
      if (!want || !targets.has(p.id)) next = list.filter((x) => x.entryId !== entryId);
      else {
        const item: Exchange = {
          id: had?.id ?? crypto.randomUUID(),
          date: input.date,
          ...want,
          entryId,
        };
        if (
          had &&
          had.date === item.date &&
          had.dir === item.dir &&
          had.kind === item.kind &&
          had.weight === item.weight &&
          had.note === item.note
        )
          continue;
        next = had
          ? list.map((x) => (x.entryId === entryId ? item : x))
          : [item, ...list].slice(0, 500);
      }
      if (
        (await data.patchPerson(p, { profile: { ...p.profile, exchanges: next } }, true)) &&
        !had &&
        want
      )
        added.push(p);
    }
    if (!added.length || !want) return;
    const names = added.map((p) => p.name.split(" ")[0]);
    const who =
      names.length > 1
        ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
        : names[0];
    notify(
      want.dir === "dar"
        ? `En «Dar y recibir»: le diste a ${who} (${exchangeKinds[want.kind].toLowerCase()}).`
        : `En «Dar y recibir»: recibiste de ${who} (${exchangeKinds[want.kind].toLowerCase()}).`,
      {
        label: "Quitar",
        run: () => {
          for (const a of added) {
            const now = latest.current.people.find((p) => p.id === a.id);
            if (!now) continue;
            void data.patchPerson(
              now,
              {
                profile: {
                  ...now.profile,
                  exchanges: (now.profile.exchanges ?? []).filter(
                    (x) => x.entryId !== entryId,
                  ),
                },
              },
              true,
            );
          }
        },
      },
    );
  }
  const savedThen = async <T,>(
    ok: Promise<T>,
    input: EntryInput,
    before?: Entry,
  ) => {
    const saved = await ok;
    // Una cápsula del tiempo sellada no le enseña nada a las fichas hasta abrirla.
    if (saved && !input.details.capsule) void learnTastes(input, before);
    // El movimiento (nuevo o editado) en «Dar y recibir» de las personas que nombra.
    const entryId = before?.id ?? (typeof saved === "string" ? saved : null);
    if (
      saved &&
      entryId &&
      (input.kind === "Movimiento" || before?.kind === "Movimiento")
    )
      void syncGiving(input, entryId);
    return saved;
  };
  /**
   * Recuerdo nuevo (devuelve su id, o null si falló). Un libro o una película que ya terminaste
   * no abre el ritual de cierre por su cuenta (quizá lo viste hace años): el aviso lo ofrece.
   */
  const saveNew = async (input: EntryInput) => {
    if (!isFinished(input)) return (await data.createEntry(input))?.id ?? null;
    const saved = await data.createEntry(input, true);
    if (!saved) return null;
    notify(
      input.kind === "Libro" ? "Libro guardado." : "Guardado en tu Libroteca.",
      {
        label: "Hacer el cierre",
        run: () => setRitual(saved.id),
      },
    );
    return saved.id;
  };
  const selected = route.personId
    ? (workspace.people.find((p) => p.id === route.personId) ?? null)
    : null;
  const selectedPlace = route.placeId
    ? (workspace.places.find((p) => p.id === route.placeId) ?? null)
    : null;
  const selectedEpisode = route.episodeId
    ? (workspace.episodes.find((e) => e.id === route.episodeId) ?? null)
    : null;

  // Escribe la URL canónica si se abrió sin hash o con uno desconocido (sin añadir historial).
  useEffect(() => {
    const canonical = toHash(
      route.page,
      route.personId ??
        route.placeId ??
        route.episodeId ??
        route.readingId ??
        route.noteId,
    );
    if (window.location.hash !== canonical)
      history.replaceState(null, "", canonical);
    // Solo al montar: después la URL la gobierna `go`.
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setRoute((r) => ({
        ...parseHash(window.location.hash),
        visit: r.visit + 1,
      }));
      setWeekly(false);
      setProgress(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Si la URL apunta a una persona que ya no existe (borrada o de otra cuenta), abre la lista.
  useEffect(() => {
    if (!data.loaded || route.page !== "Personas" || !route.personId) return;
    if (workspace.people.some((p) => p.id === route.personId)) return;
    history.replaceState(null, "", toHash("Personas"));
    setRoute((r) => ({
      page: "Personas",
      personId: null,
      placeId: null,
      episodeId: null,
      readingId: null,
      visit: r.visit + 1,
    }));
  }, [data.loaded, workspace.people, route.page, route.personId]);

  useEffect(() => {
    if (!data.loaded || route.page !== "Lugares" || !route.placeId) return;
    if (workspace.places.some((p) => p.id === route.placeId)) return;
    history.replaceState(null, "", toHash("Lugares"));
    setRoute((r) => ({
      page: "Lugares",
      personId: null,
      placeId: null,
      episodeId: null,
      readingId: null,
      visit: r.visit + 1,
    }));
  }, [data.loaded, workspace.places, route.page, route.placeId]);

  useEffect(() => {
    if (!data.loaded || route.page !== "Episodios" || !route.episodeId) return;
    if (workspace.episodes.some((e) => e.id === route.episodeId)) return;
    history.replaceState(null, "", toHash("Episodios"));
    setRoute((r) => ({
      page: "Episodios",
      personId: null,
      placeId: null,
      episodeId: null,
      readingId: null,
      visit: r.visit + 1,
    }));
  }, [data.loaded, workspace.episodes, route.page, route.episodeId]);

  function go(next: Page, item: { id: string } | null = null) {
    const target = toHash(next, item?.id ?? null);
    if (window.location.hash === target) {
      setRoute((r) => ({ ...r, visit: r.visit + 1 }));
    } else {
      window.location.hash = target;
    }
    setMobile(false);
    setWeekly(false);
    setInstantsOpen(null);
    setInstantId(null);
  }

  const context: AppContextValue = {
    user,
    workspace: shownWorkspace,
    page,
    selected,
    selectedPlace,
    selectedEpisode,
    go,
    openEntry: (kind, links, details, prefill) =>
      setModal({
        type: "compose",
        init: {
          kind,
          links: links ?? (selected ? [selected.id] : []),
          details,
          prefill,
          // Desde la ficha de un episodio, el recuerdo nuevo queda dentro de él.
          episodeId: page === "Episodios" ? selectedEpisode?.id : undefined,
        },
      }),
    openDraft: (draft) =>
      setModal({
        type: "compose",
        init: { kind: "Nota", links: draft.personIds, draft },
      }),
    readDiary: setDiaryJob,
    openImages: (images, index = 0) => setViewer({ images, index }),
    confirm,
    notify,
    openPerson: (section) => setModal({ type: "person", section }),
    editEntry: (entry) =>
      setModal({ type: "compose", init: { entry, links: entry.person_ids } }),
    viewEntry: (entry) => setModal({ type: "entry", entryId: entry.id }),
    openProgress: (entry) => setProgress(entry.id),
    openRitual: (entry) => setRitual(entry.id),
    editPerson: (person, section) =>
      setModal({ type: "person", person, section }),
    quickPerson: (person, mode) => setQuick({ personId: person.id, mode }),
    createPerson: (name) =>
      data.savePerson({ name, role: "", interests: "", bio: "", profile: {} }),
    savePeople: data.savePeople,
    discardPeople: data.discardPeople,
    openPeopleBatch: () => setPeopleBatch(true),
    openTie: (person, others) =>
      setTieFor({ personId: person?.id ?? null, others }),
    saveTie: data.saveTie,
    saveTies: data.saveTies,
    removeTie: data.removeTie,
    removeTies: data.removeTies,
    openGroup: (group, members) => setGroupEdit({ group, members }),
    saveGroup: data.saveGroup,
    updateGroup: data.updateGroup,
    removeGroup: (group) => void data.removeGroup(group),
    openPlace: (place) => setModal({ type: "place", place }),
    savePlace: data.savePlace,
    updatePlace: data.updatePlace,
    removePlace: async (place) => {
      if ((await data.removePlace(place)) && selectedPlace?.id === place.id)
        go("Lugares");
    },
    patchPerson: data.patchPerson,
    uploadPersonPhoto: (person, file) =>
      void data.uploadPersonPhoto(person, file),
    saveQuickNote: (person, text, images = []) => {
      const body = text.trim();
      const input: EntryInput = {
        // Una nota solo con fotos se titula «Foto» / «Fotos».
        title:
          body.split("\n")[0].slice(0, 80) ||
          (images.length > 1 ? "Fotos" : "Foto"),
        body,
        kind: "Nota",
        tags: [],
        personIds: [person.id],
        date: todayInputValue(),
        amount: 0,
        direction: "egreso",
        status: "pendiente",
        images,
        details: {},
        file: null,
        removeFile: false,
      };
      return savedThen(data.saveEntry(input), input);
    },
    createEntry: data.createEntry,
    createEntries: data.createEntries,
    // Una entrada de la bóveda se vuelve a cifrar en vez de guardarse en claro.
    patchEntry: (entry, changes) =>
      isVaulted(entry)
        ? diaryVault.patch(entry, changes)
        : data.patchEntry(entry, changes),
    diaryVault,
    linkEntries: data.linkEntries,
    saveEpisode: data.saveEpisode,
    updateEpisode: data.updateEpisode,
    removeEpisode: async (episode) => {
      if (
        (await data.removeEpisode(episode)) &&
        selectedEpisode?.id === episode.id
      )
        go("Episodios");
    },
    openEpisode: (episode, init, from) =>
      setModal({ type: "episode", episode, init, from }),
    episodeExtrasMissing: data.episodeExtrasMissing,
    peekPerson: (person) => setPeek(person.id),
    openWeekly: () => setWeekly(true),
    // Si ya estás escribiendo uno, se queda abierto (no se pierde lo escrito).
    openCapture: (text, people) =>
      setWriting((w) => w ?? { text, people, nonce: Date.now() }),
    openInstants: (focus) => setInstantsOpen({ focus }),
    openInstant: (id) => setInstantId(id),
    reviewPieces: () => setPiecesReview(true),
    openBrief: (person, mode, entry) =>
      setModal({ type: "brief", personId: person.id, mode, entry }),
    experiencesMissing: data.experiencesMissing,
    openChat: () => setChat(true),
    me: mine.me,
    meMissing: mine.meMissing,
    meLoaded: mine.meLoaded,
    meFailed: mine.meFailed,
    dataReady: data.loaded && mine.meLoaded,
    dataSettled: data.loaded || Boolean(data.error),
    openMe: () => setMeOpen(true),
    saveMe: mine.saveMe,
    patchMe: mine.patchMe,
    saveMyReading: mine.saveMyReading,
    signOut: () => void supabase.auth.signOut(),
    toggleEntry: (entry) => void data.toggleEntry(entry),
    resolveTask: data.resolveTask,
    askOutcome: (entry, anchor, mode = "choose") => {
      // Cerrado (hecho o soltado): el mismo botón lo reabre, sin preguntar.
      if (entry.status !== "pendiente") {
        setOutcome(null);
        void data.resolveTask(entry, "abierto");
        return;
      }
      // Tocar otra vez el mismo botón cierra la elección.
      setOutcome((o) =>
        o && o.entryId === entry.id && o.anchor === anchor
          ? null
          : { entryId: entry.id, anchor, mode },
      );
    },
    removeEntry: (entry, silent) =>
      void data.removeEntry(entry, silent).then((ok: unknown) => {
        // Un movimiento borrado sale también de «Dar y recibir» (removeEntry da true si se borró).
        if (ok === true && entry.kind === "Movimiento")
          void syncGiving({ ...entryAsInput(entry), personIds: [] }, entry.id);
      }),
    removePerson: async (person) => {
      if ((await data.removePerson(person)) && selected?.id === person.id)
        go("Personas");
    },
    mergePeople: async (keep, drop) => {
      const ok = await data.mergePeople(keep, drop);
      if (ok && selected?.id === drop.id) go("Personas", keep);
      if (ok && peek === drop.id) setPeek(keep.id);
      return ok;
    },
    openMerge: (person, other) =>
      setMerge({ personId: person.id, otherId: other?.id }),
    openAttachment: (entry) => void data.openAttachment(entry),
    capsules: data.capsules,
    openCapsule: data.openCapsule,
    burnCapsule: data.burnCapsule,
  };

  const closeModal = () => setModal(null);
  const composing = modal?.type === "compose" ? modal.init : undefined;
  // La ficha lee el recuerdo vivo: refleja cambios (completar, editar) y se cierra si se borra.
  const viewingRow =
    modal?.type === "entry"
      ? workspace.entries.find((e) => e.id === modal.entryId)
      : undefined;
  // Las de la bóveda se ven descifradas; con la bóveda cerrada, la ficha se cierra.
  const viewing =
    viewingRow && isVaulted(viewingRow)
      ? diaryVault.entries?.find((e) => e.id === viewingRow.id)
      : viewingRow;
  const editingPerson = modal?.type === "person" ? modal.person : undefined;
  const quickTarget = quick
    ? workspace.people.find((p) => p.id === quick.personId)
    : undefined;
  const peekTarget = peek
    ? workspace.people.find((p) => p.id === peek)
    : undefined;
  const progressTarget = progress
    ? workspace.entries.find((e) => e.id === progress)
    : undefined;
  const outcomeTarget = outcome
    ? workspace.entries.find((e) => e.id === outcome.entryId)
    : undefined;
  const ritualTarget = ritual
    ? workspace.entries.find((e) => e.id === ritual)
    : undefined;
  const mergeTarget = merge
    ? workspace.people.find((p) => p.id === merge.personId)
    : undefined;

  return (
    <AppProvider value={context}>
      <div className="app">
        <Sidebar mobileOpen={mobile} />
        <div className="main-shell">
          <Topbar onToggleMenu={() => setMobile((open) => !open)} />
          <main>
            {data.error && (
              <div className="database-error" role="alert">
                <strong>No se pudo cargar tu información.</strong>
                <p>{data.error}</p>
                <span>
                  Tu sesión está iniciada. Si faltan tablas o columnas, ejecuta
                  la migración actualizada en Supabase.
                </span>
                <button
                  className="secondary"
                  onClick={() => void data.reload()}
                >
                  Reintentar conexión
                </button>
              </div>
            )}
            {data.schemaOutdated && (
              <div className="schema-notice" role="status">
                Para guardar fotos y los detalles de cada tipo (autor,
                calificación, lugar…), ejecuta{" "}
                <code>supabase/migrations/202611060004_images_details.sql</code>{" "}
                en el SQL Editor de Supabase. Mientras tanto puedes seguir
                usando Nexo.
              </div>
            )}
            {/* Libroteca y Agenda muestran sus propios esqueletos: el aviso las empujaría. */}
            {data.loading && page !== "Libroteca" && page !== "Agenda" && (
              <div className="loading-data">
                <LoaderCircle className="spin" size={15} /> Cargando tu
                información…
              </div>
            )}
            {data.profileOutdated && (
              <div className="schema-notice" role="status">
                Para guardar la ficha completa de cada persona (foto, relación,
                contacto, dar y recibir…), ejecuta{" "}
                <code>supabase/migrations/202611060005_people_profile.sql</code>{" "}
                en el SQL Editor de Supabase.
              </div>
            )}
            {data.relationsMissing && (
              <div className="schema-notice" role="status">
                Para vincular personas entre sí y crear grupos ejecuta{" "}
                <code>supabase/migrations/202611060007_relations.sql</code> en
                el SQL Editor de Supabase.
              </div>
            )}
            {data.placesMissing && (
              <div className="schema-notice" role="status">
                Para usar Lugares ejecuta{" "}
                <code>supabase/migrations/202611060006_places.sql</code> en el
                SQL Editor de Supabase.
              </div>
            )}
            {data.experiencesMissing && !data.loading && (
              <div className="schema-notice" role="status">
                Para usar episodios, separar la fecha de registro y sincronizar
                tus descartes ejecuta{" "}
                <code>supabase/migrations/202611060008_experiences.sql</code> en
                el SQL Editor de Supabase. La captura y la agenda ya funcionan
                sin ella.
              </div>
            )}
            {data.episodeExtrasMissing &&
              !data.loading &&
              page === "Episodios" && (
                <div className="schema-notice" role="status">
                  Para la bitácora, los episodios relacionados y la galería
                  ejecuta{" "}
                  <code>
                    supabase/migrations/202611070006_episode_extras.sql
                  </code>{" "}
                  en el SQL Editor de Supabase.
                </div>
              )}
            {/* Personas pinta su encabezado dentro de su columna (junto a la ficha lateral). */}
            {page !== "Personas" &&
              !(page === "Lugares" && selectedPlace) &&
              !(page === "Episodios" && selectedEpisode) && <PageHeading />}
            <div className="content-wide">
              <section className="primary-content" key={route.visit}>
                {renderPage(page, route, () => setMobile((v) => !v))}
              </section>
            </div>
            <footer className="page-footer">
              <span className="mini-logo">nexo.</span>
              <span>Tu memoria tiene un lugar.</span>
              <span>
                <Lock size={11} /> Espacio personal
              </span>
            </footer>
          </main>
        </div>
        <Toasts items={toasts} onClose={dismiss} />
        {outcome && outcomeTarget && (
          <OutcomePopover
            key={outcome.entryId + outcome.mode}
            entry={outcomeTarget}
            anchor={outcome.anchor}
            mode={outcome.mode}
            onClose={() => setOutcome(null)}
          />
        )}
        <NoteReminders />
        <BoardInbox />
        <ColumnDock />
        {diaryJob && (
          <DiaryReader
            key={diaryJob.entryId}
            job={diaryJob}
            hold={Boolean(modal)}
            onDone={closeDiaryJob}
          />
        )}
        {modal?.type === "person" && (
          <PersonSheet
            person={editingPerson}
            section={modal.section}
            onSave={async (input) =>
              editingPerson
                ? (await data.updatePerson(editingPerson, input))
                  ? editingPerson
                  : null
                : data.savePerson(input)
            }
            onClose={closeModal}
          />
        )}
        {peopleBatch && <PeopleBatch onClose={() => setPeopleBatch(false)} />}
        {modal?.type === "place" && (
          <PlaceSheet
            place={modal.place}
            onSave={(input) =>
              modal.place
                ? data.updatePlace(modal.place, input)
                : data.savePlace(input)
            }
            onClose={closeModal}
          />
        )}
        {tieFor &&
          (tieFor.personId === null ||
            workspace.people.some((p) => p.id === tieFor.personId)) && (
            <TieDialog
              key={(tieFor.personId ?? "me") + (tieFor.others ?? []).join()}
              person={
                workspace.people.find((p) => p.id === tieFor.personId) ?? null
              }
              initialOthers={tieFor.others}
              onClose={() => setTieFor(null)}
            />
          )}
        {groupEdit && (
          <GroupDialog
            group={groupEdit.group}
            members={groupEdit.members}
            onClose={() => setGroupEdit(null)}
          />
        )}
        {quickTarget && quick && (
          <QuickDialog
            key={quick.personId + quick.mode}
            person={quickTarget}
            mode={quick.mode}
            onClose={() => setQuick(null)}
          />
        )}
        {composing && (
          <ComposeModal
            key={
              composing.draft?.id ??
              composing.entry?.id ??
              "new" + (composing.nonce ?? "")
            }
            init={composing}
            onAgain={() =>
              setModal({
                type: "compose",
                init: {
                  kind: "Movimiento",
                  links: [],
                  episodeId: composing.episodeId,
                  nonce: Date.now(),
                },
              })
            }
            onSave={(input, into) => {
              // Un libro que ya tenías en tu estantería: se actualiza esa ficha.
              const before = composing.entry ?? into;
              if (!before) return savedThen(saveNew(input), input);
              // En la bóveda: se vuelve a cifrar y no se le enseña nada a las fichas.
              if (composing.entry && isVaulted(composing.entry)) {
                const entry = composing.entry;
                return diaryVault.saveEdit(entry, input).then((ok) => {
                  if (ok) notify("Cambios guardados en la bóveda.");
                  return ok ? entry.id : null;
                });
              }
              if (!composing.entry) input = mergeIntoShelfBook(before, input);
              // El formulario solo conoce los detalles del tipo: se conserva dónde está la entrada.
              else if (before.kind === "Nota") {
                const { folder, archived } = before.details;
                input = {
                  ...input,
                  details: {
                    ...input.details,
                    ...(folder && { folder }),
                    ...(archived && { archived }),
                  },
                };
              }
              return savedThen(
                data.updateEntry(before, input),
                input,
                before,
              ).then((ok) => {
                // Acabas de marcarlo como terminado: es el momento del ritual de cierre.
                if (
                  ok &&
                  isFinished(input) &&
                  !isFinished(before) &&
                  !before.details.ritual
                )
                  setRitual(before.id);
                return ok ? before.id : null;
              });
            }}
            onClose={closeModal}
          />
        )}
        {modal?.type === "episode" && (
          <EpisodeSheet
            episode={modal.episode}
            init={modal.init}
            from={modal.from}
            onClose={closeModal}
          />
        )}

        {modal?.type === "brief" &&
          workspace.people.some((p) => p.id === modal.personId) && (
            <MeetingBrief
              key={modal.personId + modal.mode}
              person={workspace.people.find((p) => p.id === modal.personId)!}
              mode={modal.mode}
              entry={modal.entry}
              onClose={closeModal}
            />
          )}
        {/* Claves distintas aunque sean del mismo recuerdo: con la misma, React pierde la ficha al
            cerrar «Actualizar progreso» y deja una copia muerta encima que no se puede cerrar. */}
        {viewing && (
          <EntryViewer
            key={"ficha-" + viewing.id}
            entry={viewing}
            onClose={closeModal}
          />
        )}
        {progressTarget && (
          <ProgressSheet
            key={"progreso-" + progressTarget.id}
            entry={progressTarget}
            onClose={() => setProgress(null)}
          />
        )}
        {ritualTarget && (
          <ClosingRitual
            key={"cierre-" + ritualTarget.id}
            entry={ritualTarget}
            onClose={() => setRitual(null)}
          />
        )}
        {weekly && <WeeklyDigest onClose={() => setWeekly(false)} />}
        {peekTarget && (
          <PersonPeek person={peekTarget} onClose={() => setPeek(null)} />
        )}
        {viewer && (
          <Lightbox
            images={viewer.images}
            start={viewer.index}
            onClose={() => setViewer(null)}
          />
        )}
        {chat && (
          <ChatPanel assistant={assistant} onClose={() => setChat(false)} />
        )}
        {instantsOpen && (
          <InstantsPanel
            key={instantsOpen.focus ?? "feed"}
            focus={instantsOpen.focus}
            onClose={closeInstants}
          />
        )}
        {instantId && (
          <InstantSheet key={instantId} id={instantId} onClose={closeInstant} />
        )}
        {writing && (
          <InstantComposer
            key={writing.nonce}
            text={writing.text}
            people={writing.people}
            onClose={() => setWriting(null)}
          />
        )}
        <PiecesBar />
        {meOpen && <MyProfileSheet onClose={() => setMeOpen(false)} />}
        {mergeTarget && merge && (
          <MergeDialog
            key={merge.personId + (merge.otherId ?? "")}
            person={mergeTarget}
            other={workspace.people.find((p) => p.id === merge.otherId)}
            onClose={() => setMerge(null)}
          />
        )}
        {confirmDialog}
        <UploadTray />
        <ShotPeek />
      </div>
    </AppProvider>
  );
}

import { useEffect, useState } from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import { AppProvider, type AppContextValue, type QuickMode } from '../AppContext';
import { supabase } from '../backend';
import { ComposeModal, type ComposeInit } from '../composer/ComposeModal';
import type {
  AppUser,
  Entry,
  EntryDetails,
  Episode,
  EpisodeInput,
  EpisodeOrigin,
  Group,
  Kind,
  Page,
  Person,
  Place,
  StoredImage,
} from '../data';
import { CaptureDialog } from '../capture/CaptureDialog';
import { EpisodeSheet } from '../episodes/EpisodeSheet';
import { EpisodesPage } from '../episodes/EpisodesPage';
import { MeetingBrief } from '../people/MeetingBrief';
import { GroupDialog } from '../relations/GroupDialog';
import { TieDialog } from '../relations/TieDialog';
import { todayInputValue } from '../lib/format';
import type { PersonSection } from '../lib/people';
import { PersonSheet } from '../people/PersonSheet';
import { QuickDialog } from '../people/QuickDialog';
import { PlacesPage } from '../pages/PlacesPage';
import { PlaceSheet } from '../places/PlaceSheet';
import { useAssistant } from '../hooks/useAssistant';
import { useToast } from '../hooks/useToast';
import { useWorkspace } from '../hooks/useWorkspace';
import { useMyProfile } from '../hooks/useMyProfile';
import { MyProfileSheet } from '../people/MyProfileSheet';
import { parseHash, toHash, type Route } from '../lib/route';
import { ComparePage } from '../pages/ComparePage';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { Libroteca } from '../library/Libroteca';
import { ProgressSheet } from '../library/ProgressSheet';
import { FinancePage } from '../pages/FinancePage';
import { PeoplePage } from '../pages/PeoplePage';
import { Notes } from '../planner/Notes';
import { Boards } from '../planner/Boards';
import { Readings } from '../readings/Readings';
import { SettingsPage } from '../pages/SettingsPage';
import { ChatPanel } from './ChatPanel';
import { useConfirm } from './ConfirmDialog';
import { Lightbox } from './Lightbox';
import { EntryViewer } from './EntryViewer';
import { Overview } from './Overview';
import { PersonPeek } from '../people/PersonPeek';
import { WeeklyDigest } from '../weekly/WeeklyDigest';
import { PageHeading } from './PageHeading';
import { Sidebar } from './Sidebar';
import { Toast } from './Toast';
import { Topbar } from './Topbar';

type ModalState =
  | null
  | { type: 'person'; person?: Person; section?: PersonSection }
  | { type: 'compose'; init: ComposeInit }
  | { type: 'place'; place?: Place }
  | {
      type: 'episode';
      episode?: Episode;
      init?: Partial<EpisodeInput>;
      from?: EpisodeOrigin;
    }
  | { type: 'capture'; text?: string; people?: string[] }
  | { type: 'brief'; personId: string; mode: 'antes' | 'despues'; entry?: Entry }
  | { type: 'entry'; entryId: string };

function renderPage(page: Page, route: Route, toggleMenu: () => void) {
  switch (page) {
    case 'Mi espacio':
      return <Overview />;
    case 'Episodios':
      return <EpisodesPage />;
    case 'Notas':
      return (
        <Notes
          create={route.noteId === 'nueva'}
          openId={route.noteId === 'nueva' ? undefined : route.noteId || undefined}
        />
      );
    case 'Tableros':
      return <Boards toggleMenu={toggleMenu} />;
    case 'Lecturas':
      return (
        <Readings
          addLink={route.readingId === 'nuevo'}
          openId={route.readingId === 'nuevo' ? undefined : (route.readingId ?? undefined)}
        />
      );
    case 'Libroteca':
      return <Libroteca />;
    case 'Personas':
      return <PeoplePage />;
    case 'Conexiones':
      return <ConnectionsPage />;
    case 'Lugares':
      return <PlacesPage />;
    case 'Finanzas':
      return <FinancePage />;
    case 'Comparador':
      return <ComparePage />;
    case 'Ajustes':
      return <SettingsPage />;
  }
}

/** Interfaz principal. Solo se muestra con una sesión iniciada. */
export function AppShell({ user }: { user: AppUser }) {
  const { message, action, notify, clear } = useToast();
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
  const [viewer, setViewer] = useState<{ images: StoredImage[]; index: number } | null>(null);
  const [quick, setQuick] = useState<{ personId: string; mode: QuickMode } | null>(null);
  // personId null = vínculos tuyos.
  const [tieFor, setTieFor] = useState<{ personId: string | null; others?: string[] } | null>(null);
  const [groupEdit, setGroupEdit] = useState<{ group?: Group; members?: string[] } | null>(null);
  // Ficha lateral de una persona abierta desde cualquier sección (sin navegar).
  const [peek, setPeek] = useState<string | null>(null);
  // El periódico va en su propia capa: lo que abras desde él (un recuerdo, una persona) queda encima.
  const [weekly, setWeekly] = useState(false);
  // Actualizar el progreso de un libro o una serie (puede abrirse encima de su ficha).
  const [progress, setProgress] = useState<string | null>(null);

  const { workspace } = data;
  const { page } = route;
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
      route.personId ?? route.placeId ?? route.episodeId ?? route.readingId ?? route.noteId,
    );
    if (window.location.hash !== canonical) history.replaceState(null, '', canonical);
    // Solo al montar: después la URL la gobierna `go`.
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setRoute((r) => ({ ...parseHash(window.location.hash), visit: r.visit + 1 }));
      setWeekly(false);
      setProgress(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Si la URL apunta a una persona que ya no existe (borrada o de otra cuenta), abre la lista.
  useEffect(() => {
    if (!data.loaded || route.page !== 'Personas' || !route.personId) return;
    if (workspace.people.some((p) => p.id === route.personId)) return;
    history.replaceState(null, '', toHash('Personas'));
    setRoute((r) => ({
      page: 'Personas',
      personId: null,
      placeId: null,
      episodeId: null,
      readingId: null,
      visit: r.visit + 1,
    }));
  }, [data.loaded, workspace.people, route.page, route.personId]);

  useEffect(() => {
    if (!data.loaded || route.page !== 'Lugares' || !route.placeId) return;
    if (workspace.places.some((p) => p.id === route.placeId)) return;
    history.replaceState(null, '', toHash('Lugares'));
    setRoute((r) => ({
      page: 'Lugares',
      personId: null,
      placeId: null,
      episodeId: null,
      readingId: null,
      visit: r.visit + 1,
    }));
  }, [data.loaded, workspace.places, route.page, route.placeId]);

  useEffect(() => {
    if (!data.loaded || route.page !== 'Episodios' || !route.episodeId) return;
    if (workspace.episodes.some((e) => e.id === route.episodeId)) return;
    history.replaceState(null, '', toHash('Episodios'));
    setRoute((r) => ({
      page: 'Episodios',
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
  }

  const context: AppContextValue = {
    user,
    workspace,
    page,
    selected,
    selectedPlace,
    selectedEpisode,
    go,
    openEntry: (kind?: Kind, links?: string[], details?: EntryDetails) =>
      setModal({
        type: 'compose',
        init: {
          kind,
          links: links ?? (selected ? [selected.id] : []),
          details,
          // Desde la ficha de un episodio, el recuerdo nuevo queda dentro de él.
          episodeId: page === 'Episodios' ? selectedEpisode?.id : undefined,
        },
      }),
    openImages: (images, index = 0) => setViewer({ images, index }),
    confirm,
    notify,
    openPerson: (section) => setModal({ type: 'person', section }),
    editEntry: (entry) => setModal({ type: 'compose', init: { entry, links: entry.person_ids } }),
    viewEntry: (entry) => setModal({ type: 'entry', entryId: entry.id }),
    openProgress: (entry) => setProgress(entry.id),
    editPerson: (person, section) => setModal({ type: 'person', person, section }),
    quickPerson: (person, mode) => setQuick({ personId: person.id, mode }),
    createPerson: (name) =>
      data.savePerson({ name, role: '', interests: '', bio: '', profile: {} }),
    openTie: (person, others) => setTieFor({ personId: person?.id ?? null, others }),
    saveTie: data.saveTie,
    saveTies: data.saveTies,
    removeTie: data.removeTie,
    removeTies: data.removeTies,
    openGroup: (group, members) => setGroupEdit({ group, members }),
    saveGroup: data.saveGroup,
    updateGroup: data.updateGroup,
    removeGroup: (group) => void data.removeGroup(group),
    openPlace: (place) => setModal({ type: 'place', place }),
    savePlace: data.savePlace,
    updatePlace: data.updatePlace,
    removePlace: async (place) => {
      if ((await data.removePlace(place)) && selectedPlace?.id === place.id) go('Lugares');
    },
    patchPerson: data.patchPerson,
    uploadPersonPhoto: (person, file) => void data.uploadPersonPhoto(person, file),
    saveQuickNote: (person, text, images = []) => {
      const body = text.trim();
      return data.saveEntry({
        // Una nota solo con fotos se titula «Foto» / «Fotos».
        title: body.split('\n')[0].slice(0, 80) || (images.length > 1 ? 'Fotos' : 'Foto'),
        body,
        kind: 'Nota',
        tags: [],
        personIds: [person.id],
        date: todayInputValue(),
        amount: 0,
        direction: 'egreso',
        status: 'pendiente',
        images,
        details: {},
        file: null,
        removeFile: false,
      });
    },
    createEntry: data.createEntry,
    patchEntry: data.patchEntry,
    linkEntries: data.linkEntries,
    saveEpisode: data.saveEpisode,
    updateEpisode: data.updateEpisode,
    removeEpisode: async (episode) => {
      if ((await data.removeEpisode(episode)) && selectedEpisode?.id === episode.id)
        go('Episodios');
    },
    openEpisode: (episode, init, from) => setModal({ type: 'episode', episode, init, from }),
    episodeExtrasMissing: data.episodeExtrasMissing,
    peekPerson: (person) => setPeek(person.id),
    openWeekly: () => setWeekly(true),
    openCapture: (text, people) => setModal({ type: 'capture', text, people }),
    openBrief: (person, mode, entry) =>
      setModal({ type: 'brief', personId: person.id, mode, entry }),
    experiencesMissing: data.experiencesMissing,
    openChat: () => setChat(true),
    me: mine.me,
    meMissing: mine.meMissing,
    openMe: () => setMeOpen(true),
    saveMe: mine.saveMe,
    saveMyReading: mine.saveMyReading,
    signOut: () => void supabase.auth.signOut(),
    toggleEntry: (entry) => void data.toggleEntry(entry),
    removeEntry: (entry, silent) => void data.removeEntry(entry, silent),
    removePerson: async (person) => {
      if ((await data.removePerson(person)) && selected?.id === person.id) go('Personas');
    },
    openAttachment: (entry) => void data.openAttachment(entry),
  };

  const closeModal = () => setModal(null);
  const composing = modal?.type === 'compose' ? modal.init : undefined;
  // La ficha lee el recuerdo vivo: refleja cambios (completar, editar) y se cierra si se borra.
  const viewing =
    modal?.type === 'entry' ? workspace.entries.find((e) => e.id === modal.entryId) : undefined;
  const editingPerson = modal?.type === 'person' ? modal.person : undefined;
  const quickTarget = quick ? workspace.people.find((p) => p.id === quick.personId) : undefined;
  const peekTarget = peek ? workspace.people.find((p) => p.id === peek) : undefined;
  const progressTarget = progress ? workspace.entries.find((e) => e.id === progress) : undefined;

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
                  Tu sesión está iniciada. Si faltan tablas o columnas, ejecuta la migración
                  actualizada en Supabase.
                </span>
                <button className="secondary" onClick={() => void data.reload()}>
                  Reintentar conexión
                </button>
              </div>
            )}
            {data.schemaOutdated && (
              <div className="schema-notice" role="status">
                Para guardar fotos y los detalles de cada tipo (autor, calificación, lugar…),
                ejecuta <code>supabase/migrations/202611060004_images_details.sql</code> en el SQL
                Editor de Supabase. Mientras tanto puedes seguir usando Nexo.
              </div>
            )}
            {data.loading && (
              <div className="loading-data">
                <LoaderCircle className="spin" size={15} /> Cargando tu información…
              </div>
            )}
            {data.profileOutdated && (
              <div className="schema-notice" role="status">
                Para guardar la ficha completa de cada persona (foto, relación, contacto, dar y
                recibir…), ejecuta <code>supabase/migrations/202611060005_people_profile.sql</code>{' '}
                en el SQL Editor de Supabase.
              </div>
            )}
            {data.relationsMissing && (
              <div className="schema-notice" role="status">
                Para vincular personas entre sí y crear grupos ejecuta{' '}
                <code>supabase/migrations/202611060007_relations.sql</code> en el SQL Editor de
                Supabase.
              </div>
            )}
            {data.placesMissing && (
              <div className="schema-notice" role="status">
                Para usar Lugares ejecuta <code>supabase/migrations/202611060006_places.sql</code>{' '}
                en el SQL Editor de Supabase.
              </div>
            )}
            {data.experiencesMissing && !data.loading && (
              <div className="schema-notice" role="status">
                Para usar episodios, separar la fecha de registro y sincronizar tus descartes
                ejecuta <code>supabase/migrations/202611060008_experiences.sql</code> en el SQL
                Editor de Supabase. La captura y la agenda ya funcionan sin ella.
              </div>
            )}
            {data.episodeExtrasMissing && !data.loading && page === 'Episodios' && (
              <div className="schema-notice" role="status">
                Para la bitácora, los episodios relacionados y la galería ejecuta{' '}
                <code>supabase/migrations/202611070006_episode_extras.sql</code> en el SQL Editor de
                Supabase.
              </div>
            )}
            {/* Personas pinta su encabezado dentro de su columna (junto a la ficha lateral). */}
            {page !== 'Personas' &&
              !(page === 'Lugares' && selectedPlace) &&
              !(page === 'Episodios' && selectedEpisode) && <PageHeading />}
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
        <Toast message={message} action={action} onClose={clear} />
        {modal?.type === 'person' && (
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
        {modal?.type === 'place' && (
          <PlaceSheet
            place={modal.place}
            onSave={(input) =>
              modal.place ? data.updatePlace(modal.place, input) : data.savePlace(input)
            }
            onClose={closeModal}
          />
        )}
        {tieFor &&
          (tieFor.personId === null || workspace.people.some((p) => p.id === tieFor.personId)) && (
            <TieDialog
              key={(tieFor.personId ?? 'me') + (tieFor.others ?? []).join()}
              person={workspace.people.find((p) => p.id === tieFor.personId) ?? null}
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
            init={composing}
            onSave={
              composing.entry
                ? (input) => data.updateEntry(composing.entry!, input)
                : data.saveEntry
            }
            onClose={closeModal}
          />
        )}
        {modal?.type === 'episode' && (
          <EpisodeSheet
            episode={modal.episode}
            init={modal.init}
            from={modal.from}
            onClose={closeModal}
          />
        )}
        {modal?.type === 'capture' && (
          <CaptureDialog initialText={modal.text} people={modal.people} onClose={closeModal} />
        )}
        {modal?.type === 'brief' && workspace.people.some((p) => p.id === modal.personId) && (
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
          <EntryViewer key={'ficha-' + viewing.id} entry={viewing} onClose={closeModal} />
        )}
        {progressTarget && (
          <ProgressSheet
            key={'progreso-' + progressTarget.id}
            entry={progressTarget}
            onClose={() => setProgress(null)}
          />
        )}
        {weekly && <WeeklyDigest onClose={() => setWeekly(false)} />}
        {peekTarget && <PersonPeek person={peekTarget} onClose={() => setPeek(null)} />}
        {viewer && (
          <Lightbox images={viewer.images} start={viewer.index} onClose={() => setViewer(null)} />
        )}
        {chat && <ChatPanel assistant={assistant} onClose={() => setChat(false)} />}
        {meOpen && <MyProfileSheet onClose={() => setMeOpen(false)} />}
        {confirmDialog}
      </div>
    </AppProvider>
  );
}

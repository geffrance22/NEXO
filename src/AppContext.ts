import { createContext, useContext } from 'react';
import type { ConfirmFn } from './components/ConfirmDialog';
import type {
  AppUser,
  Entry,
  EntryDetails,
  EntryInput,
  Episode,
  EpisodeChanges,
  EpisodeInput,
  EpisodeOrigin,
  Group,
  GroupInput,
  Tie,
  Kind,
  MyProfile,
  MyRecord,
  Page,
  Person,
  Place,
  PlaceInput,
  StoredImage,
  Workspace,
} from './data';
import type { PersonSection } from './lib/people';
import type { TieInput } from './hooks/useWorkspace';
import type { Notify } from './hooks/useToast';

/** Accesos rápidos para alimentar la ficha de una persona sin abrir el formulario completo. */
export type QuickMode = 'nota' | 'novedad' | 'dar' | 'recibir' | 'dato';

export type AppContextValue = {
  user: AppUser;
  workspace: Workspace;
  page: Page;
  /** Persona abierta en la página Personas, si hay una. */
  selected: Person | null;
  /** Lugar abierto en la página Lugares, si hay uno. */
  selectedPlace: Place | null;
  /**
   * Cambia de página y actualiza la URL (`#/personas/<id>`), de modo que recargar o usar «atrás»
   * conserva la sección. Se descartan los filtros y la búsqueda de la página anterior.
   */
  go: (page: Page, item?: { id: string } | null) => void;
  /**
   * Abre la ventana de nuevo recuerdo: con un tipo va directo a él; sin tipo, pregunta cuál.
   * `links` son las personas que arrancan vinculadas (por defecto, la persona abierta).
   */
  openEntry: (kind?: Kind, links?: string[], details?: EntryDetails) => void;
  /** Abre el visor de fotos en la imagen indicada. */
  openImages: (images: StoredImage[], index?: number) => void;
  /** Pregunta con una ventana propia (en lugar del `confirm` del navegador). */
  confirm: ConfirmFn;
  /** Aviso breve; con `action` muestra un botón (p. ej. «Deshacer»). */
  notify: Notify;
  /** Formulario de persona nueva; `section` lo abre en esa parte. */
  openPerson: (section?: PersonSection) => void;
  editPerson: (person: Person, section?: PersonSection) => void;
  quickPerson: (person: Person, mode: QuickMode) => void;
  /** Crea una persona solo con su nombre (desde el buscador de personas). */
  createPerson: (name: string) => Promise<Person | null>;
  /** Formulario de lugar: nuevo, o edita el indicado. */
  openPlace: (place?: Place) => void;
  savePlace: (input: PlaceInput) => Promise<Place | null>;
  updatePlace: (place: Place, changes: Partial<PlaceInput>, silent?: boolean) => Promise<boolean>;
  removePlace: (place: Place) => void;
  /**
   * Vincular personas. `person` es de quién se habla (null = tú); se pueden elegir varias a la
   * vez. `others` arranca con esas personas marcadas.
   */
  openTie: (person: Person | null, others?: string[]) => void;
  saveTie: (input: TieInput, silent?: boolean) => Promise<Tie | null>;
  /** Guarda varios vínculos de una vez (omite los repetidos). */
  saveTies: (inputs: TieInput[], silent?: boolean) => Promise<Tie[]>;
  /** Quitar vínculos; el aviso trae «Deshacer». */
  removeTie: (tie: Tie, silent?: boolean) => Promise<boolean>;
  removeTies: (ties: Tie[], silent?: boolean) => Promise<boolean>;
  /** Crear o editar un grupo; members arranca con esas personas dentro. */
  openGroup: (group?: Group, members?: string[]) => void;
  saveGroup: (input: GroupInput, silent?: boolean) => Promise<Group | null>;
  updateGroup: (group: Group, changes: Partial<GroupInput>, silent?: boolean) => Promise<boolean>;
  removeGroup: (group: Group) => void;
  /** Cambia campos de una persona (se aplica al instante). */
  patchPerson: (
    person: Person,
    changes: Partial<Omit<Person, 'id' | 'created_at'>>,
    silent?: boolean,
  ) => Promise<boolean>;
  uploadPersonPhoto: (person: Person, file: File) => void;
  /** Guarda una nota rápida vinculada a la persona. */
  saveQuickNote: (person: Person, text: string, images?: StoredImage[]) => Promise<boolean>;
  /** Crea un recuerdo y lo devuelve (para encadenar piezas de una experiencia). */
  createEntry: (input: EntryInput, silent?: boolean) => Promise<Entry | null>;
  /** Cambia solo detalles, estado o personas de un recuerdo (posponer, completar…). */
  patchEntry: (
    entry: Entry,
    changes: Partial<Pick<Entry, 'details' | 'status' | 'person_ids' | 'body' | 'title'>>,
  ) => Promise<boolean>;
  /** Pone (o quita con null) recuerdos en un episodio. */
  linkEntries: (ids: string[], episodeId: string | null, silent?: boolean) => Promise<boolean>;
  saveEpisode: (input: EpisodeInput, silent?: boolean) => Promise<Episode | null>;
  updateEpisode: (episode: Episode, changes: EpisodeChanges, silent?: boolean) => Promise<boolean>;
  removeEpisode: (episode: Episode) => void;
  /**
   * Formulario de episodio: nuevo (con datos iniciales) o edita el indicado. Con `from`, el nuevo
   * queda enlazado al episodio de origen (p. ej. «se convirtió en»).
   */
  openEpisode: (episode?: Episode, init?: Partial<EpisodeInput>, from?: EpisodeOrigin) => void;
  /** Falta la migración 009 (bitácora, episodios relacionados y galería). */
  episodeExtrasMissing: boolean;
  /** Abre la ficha lateral de una persona sin salir de donde estás. */
  peekPerson: (person: Person) => void;
  /** Periódico personal de la semana. */
  openWeekly: () => void;
  /** Episodio abierto en la página Episodios. */
  selectedEpisode: Episode | null;
  /** Captura de una experiencia en texto libre; Nexo propone sus piezas. */
  openCapture: (text?: string, people?: string[]) => void;
  /** Antes de ver a alguien (ficha breve) o después (cierre de 30 segundos). */
  openBrief: (person: Person, mode: 'antes' | 'despues', entry?: Entry) => void;
  /** Falta la migración 008 (episodios, fecha de registro…). */
  experiencesMissing: boolean;
  editEntry: (entry: Entry) => void;
  /** Abre la ficha de lectura de un recuerdo (sin editarlo). */
  viewEntry: (entry: Entry) => void;
  /** Actualizar cómo vas en un libro o una serie (página, temporada, episodio, terminado). */
  openProgress: (entry: Entry) => void;
  /**
   * Ritual de cierre de un libro, una película o una serie terminados: preguntas, test opcional de
   * la IA y un aprendizaje enlazado con su repaso espaciado.
   */
  openRitual: (entry: Entry) => void;
  openChat: () => void;
  /** Tu propia ficha y su lectura de la IA (vacía si aún no la llenas). */
  me: MyRecord;
  /** Falta la migración de «Mi ficha»: no se puede guardar. */
  meMissing: boolean;
  /** Tus datos y tu ficha ya terminaron de cargar (lo que se arma con ambos debe esperar). */
  dataReady: boolean;
  /** Abre «Mi ficha». */
  openMe: () => void;
  saveMe: (profile: MyProfile) => Promise<boolean>;
  /** Guarda la lectura que hizo la IA (la descripción general de tu ficha). */
  saveMyReading: (reading: string, highlights: string[]) => Promise<boolean>;
  signOut: () => void;
  toggleEntry: (entry: Entry) => void;
  /** Con `silent`, sin preguntar ni avisar (lo elimina otra acción, como borrar una tarjeta). */
  removeEntry: (entry: Entry, silent?: boolean) => void;
  removePerson: (person: Person) => void;
  /** Une dos fichas de la misma persona: todo lo de `drop` pasa a `keep` y `drop` se borra. */
  mergePeople: (keep: Person, drop: Person) => Promise<boolean>;
  /** Abre «Unir fichas»: con `other`, ya con la pareja elegida; sin él, para buscarla. */
  openMerge: (person: Person, other?: Person) => void;
  openAttachment: (entry: Entry) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider = AppContext.Provider;

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw Error('useApp debe usarse dentro de AppProvider.');
  return value;
}

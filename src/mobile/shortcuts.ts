import {
  Archive,
  BookCheck,
  BookmarkPlus,
  BookOpen,
  Briefcase,
  CalendarDays,
  CircleCheck,
  Columns3,
  Feather,
  Heart,
  Highlighter,
  Hourglass,
  IdCard,
  Inbox,
  Layers,
  Library,
  MapPin,
  MessageCircleWarning,
  MessagesSquare,
  Network,
  Newspaper,
  Search,
  Settings,
  Smile,
  Sparkles,
  Star,
  StickyNote,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AppContextValue } from '../AppContext';
import { kindMeta } from '../composer/kinds';
import type { Kind, Page } from '../data';
import { openFinanceTab } from '../finance/ui';
import { landOn } from '../lib/landing';
import { goSection, sectionTabs, type ShelfSection } from '../library/shelf';
import { connectionTabs } from '../pages/ConnectionsPage';
import { tabList as financeTabs } from '../pages/FinancePage';

/** Un acceso que puede ir en el 2.º o el 4.º botón de la barra inferior del celular. */
export type Shortcut = {
  id: string;
  /** Lo que se lee bajo el ícono, en la barra (corto). */
  label: string;
  /** Nombre completo, en el selector. */
  name: string;
  group: ShortcutGroup;
  icon: LucideIcon;
  /** La sección a la que lleva (para marcar el botón como activo). Las acciones no tienen. */
  page?: Page;
  run: (app: AppContextValue) => void;
};

export type ShortcutGroup =
  | 'secciones'
  | 'agenda'
  | 'libroteca'
  | 'finanzas'
  | 'personas'
  | 'conexiones'
  | 'lecturas'
  | 'episodios'
  | 'acciones';

export const shortcutGroups: { id: ShortcutGroup; label: string }[] = [
  { id: 'secciones', label: 'Secciones' },
  { id: 'acciones', label: 'Acciones rápidas' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'libroteca', label: 'Libroteca' },
  { id: 'finanzas', label: 'Finanzas' },
  { id: 'personas', label: 'Personas' },
  { id: 'conexiones', label: 'Conexiones' },
  { id: 'lecturas', label: 'Lecturas' },
  { id: 'episodios', label: 'Episodios' },
];

// ── Secciones (Mi espacio ya es el primer botón, fijo) ──
const sections: [string, Exclude<Page, 'Mi espacio'>, LucideIcon][] = [
  ['agenda', 'Agenda', CalendarDays],
  ['personas', 'Personas', Users],
  ['libroteca', 'Libroteca', Library],
  ['finanzas', 'Finanzas', Wallet],
  ['episodios', 'Episodios', Layers],
  ['lecturas', 'Lecturas', BookOpen],
  ['tableros', 'Tableros', Columns3],
  ['conexiones', 'Conexiones', Network],
  ['lugares', 'Lugares', MapPin],
  ['ajustes', 'Ajustes', Settings],
];
const sectionShortcuts: Shortcut[] = sections.map(([id, page, icon]) => ({
  id,
  label: page,
  name: page,
  group: 'secciones',
  icon,
  page,
  run: (app) => app.go(page),
}));

// ── Pestañas de Agenda y Libroteca (abren donde pidas y la página lo recuerda) ──
/** Nombres más cortos para la barra, donde el de la pestaña no se entendería solo. */
const shelfLabels: Partial<Record<string, string>> = {
  'libroteca/inicio': 'Libroteca',
  'libroteca/capturas': 'Capturas',
};
const shelfShortcuts = (section: ShelfSection): Shortcut[] =>
  sectionTabs[section].map((t) => {
    const id = `${section.toLowerCase()}/${t.id}`;
    const label = t.id === 'capturas' ? 'Capturas' : t.label;
    return {
      id,
      label: shelfLabels[id] ?? label,
      name: `${section} · ${label}`,
      group: section === 'Agenda' ? 'agenda' : 'libroteca',
      icon: t.icon,
      page: section,
      run: (app) => goSection(app.go, section, t.id),
    };
  });

// ── Pestañas de Finanzas (sin sus ajustes: en la barra se confundirían con los de la app) ──
const financeShortcuts: Shortcut[] = financeTabs
  .filter((t) => t.key !== 'ajustes')
  .map((t) => ({
    id: `finanzas/${t.key}`,
    label: t.short ?? t.label,
    name: `Finanzas · ${t.label}`,
    group: 'finanzas',
    icon: t.icon,
    page: 'Finanzas',
    run: (app) => openFinanceTab(app.go, t.key),
  }));

// ── Pestañas que la página lee una sola vez al abrir (ver `landOn`) ──
const landing = (
  group: ShortcutGroup,
  page: Page,
  tabs: { tab: string; label: string; short?: string; icon: LucideIcon }[],
): Shortcut[] =>
  tabs.map((t) => ({
    id: `${group}/${t.tab}`,
    label: t.short ?? t.label,
    name: `${page} · ${t.label}`,
    group,
    icon: t.icon,
    page,
    run: (app) => {
      landOn(page, t.tab);
      app.go(page);
    },
  }));

const peopleShortcuts = landing('personas', 'Personas', [
  { tab: 'favoritos', label: 'Favoritos', icon: Star },
  { tab: 'contactar', label: 'Por contactar', short: 'Contactar', icon: MessageCircleWarning },
  { tab: 'familia', label: 'Familia', icon: UsersRound },
  { tab: 'amistad', label: 'Amistad', icon: Smile },
  { tab: 'trabajo', label: 'Trabajo', icon: Briefcase },
  { tab: 'pareja', label: 'Romance', icon: Heart },
]);
const connectionShortcuts = landing(
  'conexiones',
  'Conexiones',
  connectionTabs.map((t) => ({
    tab: t.id,
    label: t.label,
    short: t.id === 'social' ? 'Grafo' : t.id === 'arbol' ? 'Árbol' : undefined,
    icon: t.icon,
  })),
);
const readingShortcuts: Shortcut[] = [
  ...landing('lecturas', 'Lecturas', [
    { tab: 'inbox', label: 'Por leer', icon: Inbox },
    { tab: 'read', label: 'Leídos', icon: BookCheck },
    { tab: 'favorites', label: 'Favoritos', icon: Star },
    { tab: 'marks', label: 'Anotaciones', icon: Highlighter },
    { tab: 'archive', label: 'Archivados', icon: Archive },
  ]),
  {
    id: 'lecturas/nuevo',
    label: 'Enlace',
    name: 'Lecturas · Guardar un enlace',
    group: 'lecturas',
    icon: BookmarkPlus,
    page: 'Lecturas',
    run: (app) => app.go('Lecturas', { id: 'nuevo' }),
  },
];
const episodeShortcuts = landing('episodios', 'Episodios', [
  { tab: 'activo', label: 'En curso', icon: Hourglass },
  { tab: 'cerrado', label: 'Cerrados', icon: CircleCheck },
]);

// ── Acciones: abren una ventana, no una sección ──
const newEntry = (id: string, kind: Kind, label: string, name: string): Shortcut => ({
  id,
  label,
  name,
  group: 'acciones',
  icon: kindMeta[kind].icon,
  run: (app) => app.openEntry(kind, []),
});
const actionShortcuts: Shortcut[] = [
  {
    id: 'accion/instante',
    label: 'Instante',
    name: 'Escribir un instante',
    group: 'acciones',
    icon: Feather,
    run: (app) => app.openCapture(),
  },
  {
    id: 'accion/instantes',
    label: 'Instantes',
    name: 'Tus instantes (el feed)',
    group: 'acciones',
    icon: MessagesSquare,
    run: (app) => app.openInstants(),
  },
  {
    id: 'accion/buscar',
    label: 'Buscar',
    name: 'Buscar en todo tu espacio',
    group: 'acciones',
    icon: Search,
    // El buscador del encabezado escucha este aviso: se abre y toma el foco.
    run: () => window.dispatchEvent(new Event('nexo:search')),
  },
  {
    id: 'accion/nexo',
    label: 'Nexo',
    name: 'Preguntarle a Nexo',
    group: 'acciones',
    icon: Sparkles,
    run: (app) => app.openChat(),
  },
  {
    id: 'accion/semana',
    label: 'Tu semana',
    name: 'Tu periódico de la semana',
    group: 'acciones',
    icon: Newspaper,
    run: (app) => app.openWeekly(),
  },
  {
    id: 'accion/ficha',
    label: 'Mi ficha',
    name: 'Mi ficha',
    group: 'acciones',
    icon: IdCard,
    run: (app) => app.openMe(),
  },
  newEntry('accion/movimiento', 'Movimiento', 'Gasto', 'Nuevo gasto o ingreso'),
  newEntry('accion/pendiente', 'Pendiente', 'Pendiente', 'Nuevo pendiente'),
  newEntry('accion/diario', 'Nota', 'Diario', 'Nueva entrada del diario'),
  newEntry('accion/encuentro', 'Encuentro', 'Encuentro', 'Nuevo encuentro'),
  {
    id: 'accion/nota',
    label: 'Nota',
    name: 'Nueva nota libre',
    group: 'acciones',
    icon: StickyNote,
    run: (app) => app.go('Libroteca', { id: 'nueva' }),
  },
  {
    id: 'accion/persona',
    label: 'Persona',
    name: 'Agregar una persona',
    group: 'acciones',
    icon: UserPlus,
    run: (app) => app.openPerson(),
  },
];

/** Todo lo que se puede poner en la barra, en el orden del selector. */
export const shortcuts: Shortcut[] = [
  ...sectionShortcuts,
  ...actionShortcuts,
  ...shelfShortcuts('Agenda'),
  ...shelfShortcuts('Libroteca'),
  ...financeShortcuts,
  ...peopleShortcuts,
  ...connectionShortcuts,
  ...readingShortcuts,
  ...episodeShortcuts,
];
const byId = new Map(shortcuts.map((s) => [s.id, s]));
export const shortcutOf = (id: string) => byId.get(id);

/** Lo que trae la barra hasta que elijas otra cosa. */
export const DEFAULT_SLOTS: [string, string] = ['agenda', 'personas'];

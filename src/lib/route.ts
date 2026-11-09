import type { Page } from '../data';

export type Route = {
  page: Page;
  personId: string | null;
  placeId: string | null;
  episodeId: string | null;
  noteId?: string | null;
  readingId: string | null;
  /** Cuaderno de Agenda abierto en su lienzo (`#/agenda/<id>`). */
  notebookId?: string | null;
  /** Pestaña con la que abre la página (hoy solo «Comparar» en Conexiones). */
  tab?: 'comparar';
};

const slugs: Record<Page, string> = {
  'Mi espacio': 'mi-espacio',
  Episodios: 'episodios',
  Personas: 'personas',
  Conexiones: 'conexiones',
  Lugares: 'lugares',
  Notas: 'notas',
  Tableros: 'tableros',
  Lecturas: 'lecturas',
  Agenda: 'agenda',
  Libroteca: 'libroteca',
  Finanzas: 'finanzas',
  Ajustes: 'ajustes',
};
const pageBySlug = new Map<string, Page>([
  ...(Object.keys(slugs) as Page[]).map((page) => [slugs[page], page] as const),
  // Antes se llamaba «Biblioteca»: los enlaces guardados siguen funcionando.
  ['biblioteca', 'Libroteca'],
  // El comparador ahora es una pestaña de Conexiones.
  ['comparador', 'Conexiones'],
]);
/** Páginas que pueden abrir un elemento concreto: `#/personas/<id>`. */
const withId: Page[] = ['Personas', 'Lugares', 'Episodios', 'Lecturas', 'Notas', 'Agenda'];

/** Interpreta el hash de la URL (`#/personas/<id>`, `#/lugares/<id>`). Si no se reconoce, abre «Mi espacio». */
export function parseHash(hash: string): Route {
  const [slug = '', rawId = ''] = hash.replace(/^#\/?/, '').split('/');
  const page = pageBySlug.get(slug) ?? 'Mi espacio';
  let id: string | null = null;
  if (withId.includes(page) && rawId) {
    try {
      id = decodeURIComponent(rawId);
    } catch {
      id = null;
    }
  }
  return {
    page,
    personId: page === 'Personas' ? id : null,
    placeId: page === 'Lugares' ? id : null,
    episodeId: page === 'Episodios' ? id : null,
    noteId: page === 'Notas' ? id : null,
    readingId: page === 'Lecturas' ? id : null,
    notebookId: page === 'Agenda' ? id : null,
    ...(slug === 'comparador' ? { tab: 'comparar' as const } : {}),
  };
}

export function toHash(page: Page, id: string | null = null) {
  const suffix = withId.includes(page) && id ? '/' + encodeURIComponent(id) : '';
  return '#/' + slugs[page] + suffix;
}

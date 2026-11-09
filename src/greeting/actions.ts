import type { AppContextValue } from '../AppContext';
import type { Page } from '../data';
import { feedCard } from '../planner/boardFeed';
import { aimBoard } from '../planner/boardView';

/** Secciones a las que un saludo puede llevar. */
const PAGES: readonly Page[] = [
  'Libroteca',
  'Personas',
  'Lecturas',
  'Tableros',
  'Episodios',
  'Lugares',
  'Finanzas',
  'Notas',
  'Conexiones',
];

export type ActionIcon =
  | 'capture'
  | 'chat'
  | 'weekly'
  | 'go'
  | 'book'
  | 'show'
  | 'person'
  | 'entry'
  | 'card';
type Deps = Pick<
  AppContextValue,
  | 'workspace'
  | 'go'
  | 'openCapture'
  | 'openChat'
  | 'openWeekly'
  | 'openProgress'
  | 'peekPerson'
  | 'viewEntry'
>;

/**
 * Convierte el id de un acceso directo en lo que hace. Solo existen estas acciones (la IA no puede
 * inventar otras) y las que apuntan a algo que ya no existe se descartan.
 */
export function resolveAction(
  id: string,
  app: Deps,
): { icon: ActionIcon; run: () => void } | null {
  if (id === 'capture') return { icon: 'capture', run: () => app.openCapture() };
  if (id === 'chat') return { icon: 'chat', run: () => app.openChat() };
  if (id === 'weekly') return { icon: 'weekly', run: () => app.openWeekly() };

  const cut = id.indexOf(':');
  if (cut < 1) return null;
  const kind = id.slice(0, cut);
  const ref = id.slice(cut + 1);

  if (kind === 'go') {
    const page = PAGES.find((p) => p === ref);
    return page ? { icon: 'go', run: () => app.go(page) } : null;
  }
  if (kind === 'person') {
    const person = app.workspace.people.find((p) => p.id === ref);
    return person ? { icon: 'person', run: () => app.peekPerson(person) } : null;
  }
  if (kind === 'card') {
    const card = feedCard(ref);
    return card
      ? {
          icon: 'card',
          run: () => {
            aimBoard(card.board_id, card.list_id, card.id);
            app.go('Tableros');
          },
        }
      : null;
  }
  const entry = app.workspace.entries.find((e) => e.id === ref);
  if (!entry) return null;
  if (kind === 'progress') {
    return { icon: entry.kind === 'Libro' ? 'book' : 'show', run: () => app.openProgress(entry) };
  }
  if (kind === 'entry') return { icon: 'entry', run: () => app.viewEntry(entry) };
  return null;
}

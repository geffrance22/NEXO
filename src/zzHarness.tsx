// Archivo temporal para reproducir el bloqueo de la ficha (se borra después).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, type AppContextValue } from './AppContext';
import { blank, type Entry } from './data';
import { EntryViewer } from './components/EntryViewer';
import { ProgressSheet } from './library/ProgressSheet';
import './style.css';
import './composer/composer.css';

const book: Entry = {
  id: 'b1',
  title: 'El nombre del viento',
  body: 'Muy bueno.',
  kind: 'Libro',
  tags: [],
  person_ids: [],
  created_at: new Date(Date.now() - 10 * 864e5).toISOString(),
  amount: 0,
  direction: 'egreso',
  status: 'pendiente',
  images: [],
  details: { read: 'leyendo', pagesRead: 120, pagesTotal: 600, author: 'Patrick Rothfuss' },
};

function Harness() {
  const [entries, setEntries] = useState([book]);
  const [modal, setModal] = useState<string | null>('b1');
  const [progress, setProgress] = useState<string | null>(null);
  const noop = () => {};
  const ctx = {
    workspace: { ...blank, entries },
    patchEntry: async (e: Entry, ch: Partial<Entry>) => {
      setEntries((list) => list.map((x) => (x.id === e.id ? { ...x, ...ch } : x)));
      return true;
    },
    notify: noop,
    viewEntry: (e: Entry) => setModal(e.id),
    openProgress: (e: Entry) => setProgress(e.id),
    openImages: noop,
    peekPerson: noop,
    go: noop,
    openBrief: noop,
    toggleEntry: noop,
    editEntry: noop,
    removeEntry: noop,
    openAttachment: noop,
  } as unknown as AppContextValue;
  const viewing = modal ? entries.find((e) => e.id === modal) : undefined;
  const target = progress ? entries.find((e) => e.id === progress) : undefined;
  return (
    <AppProvider value={ctx}>
      <div className="app">
        <button id="reopen" onClick={() => setModal('b1')}>
          reabrir
        </button>
        <span id="state">{viewing ? 'ficha-abierta' : 'ficha-cerrada'}</span>
        {viewing && <EntryViewer key={viewing.id} entry={viewing} onClose={() => setModal(null)} />}
        {target && (
          <ProgressSheet key={target.id} entry={target} onClose={() => setProgress(null)} />
        )}
      </div>
    </AppProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

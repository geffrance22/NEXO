import { Plus } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Page } from '../data';

const headings: Record<Page, { title: string; text: string }> = {
  'Mi espacio': {
    title: 'Tu vida tiene muchas conexiones.',
    text: 'Un lugar para recordarlas, entenderlas y descubrir lo que viene.',
  },
  Episodios: {
    title: 'Las historias completas.',
    text: 'Viajes, cenas, proyectos y mudanzas con todo lo que reunieron: personas, lugares, dinero y lo que quedó pendiente.',
  },
  Personas: {
    title: 'Personas que dejan huella.',
    text: 'Más que contactos. Historias, intereses y momentos compartidos.',
  },
  Conexiones: {
    title: 'Todo tiene un hilo.',
    text: 'Explora los encuentros que acercan a las personas de tu universo.',
  },
  Lugares: {
    title: 'Lugares con historia.',
    text: 'Donde pasan las cosas: cafés, casas, viajes y todo lo que viviste en cada uno.',
  },
  Notas: { title: 'Notas', text: '' },
  Tableros: { title: 'Tableros', text: '' },
  Lecturas: { title: 'Lecturas', text: 'Artículos guardados para leer y anotar.' },
  Libroteca: { title: 'Libroteca', text: '' },
  Finanzas: {
    title: 'Tus números, con contexto.',
    text: 'Cada ingreso y cada gasto también cuentan una historia.',
  },
  Comparador: {
    title: 'Dos historias, otra perspectiva.',
    text: 'Compara evidencia disponible, sin convertir personas en puntuaciones.',
  },
  Ajustes: {
    title: 'Un espacio a tu medida.',
    text: 'Controla tus datos y prepara tus integraciones.',
  },
};

export function PageHeading() {
  const { page, selected, openEntry, openPerson, openPlace } = useApp();
  if (page === 'Lecturas' || page === 'Tableros' || page === 'Notas' || page === 'Libroteca')
    return null;

  // «Nuevo recuerdo» vive en el encabezado de la app; aquí solo queda la acción propia de cada
  // sección (y ninguna en Episodios, que trae las suyas).
  const action =
    page === 'Personas' && !selected
      ? { label: 'Nueva persona', run: () => openPerson() }
      : page === 'Lugares'
        ? { label: 'Nuevo lugar', run: () => openPlace() }
        : page === 'Finanzas'
          ? { label: 'Nuevo movimiento', run: () => openEntry('Movimiento') }
          : null;

  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          {page === 'Mi espacio' ? 'UN POCO DE TODO LO QUE ERES' : 'TU MEMORIA, CONECTADA'}
        </div>
        <h1>{selected ? selected.name : headings[page].title}</h1>
        <p>{selected ? selected.role : headings[page].text}</p>
      </div>
      {action && (
        <button className="primary" onClick={action.run}>
          <Plus size={18} />
          {action.label}
        </button>
      )}
    </div>
  );
}

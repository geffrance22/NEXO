import { Plus, UsersRound } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Page } from '../data';
import { GreetingHeading } from '../greeting/GreetingHeading';

// Mi espacio no está aquí: su encabezado es el saludo (ver GreetingHeading).
const headings: Record<Exclude<Page, 'Mi espacio'>, { title: string; text: string }> = {
  Episodios: {
    title: 'Las historias completas.',
    text: 'Viajes, cenas, proyectos y mudanzas con todo lo que reunieron: personas, lugares, dinero y lo que quedó pendiente.',
  },
  Personas: {
    title: 'Personas que dejan huella.',
    text: 'Más que contactos. Historias, intereses y momentos compartidos.',
  },
  Conexiones: { title: 'Conexiones', text: '' },
  Lugares: {
    title: 'Lugares con historia.',
    text: 'Donde pasan las cosas: cafés, casas, viajes y todo lo que viviste en cada uno.',
  },
  Tableros: { title: 'Tableros', text: '' },
  Lecturas: { title: 'Lecturas', text: 'Artículos guardados para leer y anotar.' },
  Libroteca: { title: 'Libroteca', text: '' },
  Agenda: { title: 'Agenda', text: '' },
  Finanzas: {
    title: 'Tus números, con contexto.',
    text: 'Cada ingreso y cada gasto también cuentan una historia.',
  },
  Ajustes: {
    title: 'Un espacio a tu medida.',
    text: 'Controla tus datos y prepara tus integraciones.',
  },
};

export function PageHeading() {
  const { page, selected, openPerson, openPlace, openPeopleBatch } = useApp();
  if (page === 'Mi espacio') return <GreetingHeading />;
  if (
    page === 'Lecturas' ||
    page === 'Tableros' ||
    page === 'Libroteca' ||
    page === 'Agenda' ||
    page === 'Conexiones' ||
    page === 'Finanzas'
  )
    return null;

  // «Nuevo recuerdo» vive en el encabezado de la app; aquí solo queda la acción propia de cada
  // sección (y ninguna en Episodios, que trae las suyas).
  const action =
    page === 'Personas' && !selected
      ? { label: 'Nueva persona', run: () => openPerson() }
      : page === 'Lugares'
        ? { label: 'Nuevo lugar', run: () => openPlace() }
        : null;

  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">TU MEMORIA, CONECTADA</div>
        <h1>{selected ? selected.name : headings[page].title}</h1>
        <p>{selected ? selected.role : headings[page].text}</p>
      </div>
      {action && (
        <div className="heading-actions">
          {page === 'Personas' && (
            <button
              type="button"
              className="heading-icon"
              onClick={openPeopleBatch}
              title="Añadir varias personas (lista, TXT, CSV o contactos)"
              aria-label="Añadir varias personas"
            >
              <UsersRound size={18} />
            </button>
          )}
          <button className="primary" onClick={action.run}>
            <Plus size={18} />
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

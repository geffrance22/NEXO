import { useEffect, useRef } from 'react';
import type { Person } from '../data';
import { PersonPanel } from './PersonPanel';
import './people.css';

/**
 * Ficha lateral de una persona sobre cualquier sección (incluso sobre la ficha de un recuerdo):
 * la consultas y vuelves a lo que estabas, sin ir a Personas. Esc o un clic fuera la cierran.
 */
export function PersonPeek({ person, onClose }: { person: Person; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Si encima hay un formulario, una confirmación o el visor de fotos, Esc es para ellos.
      if (
        document.querySelector(
          // La ficha de un recuerdo, el periódico, «Mi ficha» y «Dinero con personas» quedan
          // debajo: no cuentan.
          '.lightbox, .confirm-backdrop, .modal-backdrop, .bdp-backdrop, .sheet-backdrop:not(:has(> .sheet.ev, > .sheet.wk, > .sheet.wkp, > .sheet.bdm, > .sheet.cz-peek, > .sheet.mf, > .sheet.pmd))',
        )
      )
        return;
      e.preventDefault();
      close.current();
    };
    const onNavigate = () => close.current();
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onNavigate);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onNavigate);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <div className="nx-peek-backdrop" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panel}
        className="pp-drawer nx-peek"
        role="dialog"
        aria-label={`Ficha de ${person.name}`}
        tabIndex={-1}
      >
        <PersonPanel key={person.id} person={person} variant="drawer" onClose={onClose} />
      </aside>
    </>
  );
}

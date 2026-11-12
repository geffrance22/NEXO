import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BellPlus,
  Camera,
  Cake,
  ClipboardCheck,
  NotebookPen,
  Feather,
  IdCard,
  Link2,
  Merge,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Star,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import { PersonGroupsDialog } from '../relations/TiesTab';

/** Botón «⋯» con todos los accesos rápidos para alimentar la ficha de una persona. */
export function PersonMenu({
  person,
  align = 'right',
}: {
  person: Person;
  align?: 'right' | 'left';
}) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // El menú flota sobre todo (portal en <body>): se abre hacia donde haya espacio y sigue al botón.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = trigger.current?.getBoundingClientRect();
      const m = menu.current;
      if (!b || !m) return;
      const gap = 6;
      const edge = 10;
      // Nunca por encima de la barra superior.
      const ceiling =
        (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + edge;
      const w = m.offsetWidth;
      const h = m.scrollHeight;
      const below = window.innerHeight - b.bottom - gap - edge;
      const above = b.top - gap - ceiling;
      // Hacia abajo salvo que no quepa ni lo esencial y arriba haya más sitio.
      const up = below < Math.min(h, 260) && above > below;
      const left = Math.min(
        Math.max(edge, align === 'right' ? b.right - w : b.left),
        window.innerWidth - w - edge,
      );
      setPos(
        up
          ? {
              left,
              bottom: window.innerHeight - b.top + gap,
              maxHeight: above,
              transformOrigin: 'bottom',
            }
          : { left, top: b.bottom + gap, maxHeight: below, transformOrigin: 'top' },
      );
    };
    place();
    let frame = 0;
    const onMove = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const fav = Boolean(person.profile.favorite);

  return (
    <div className="pp-menu" ref={root} onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        className={'pp-icon-btn' + (open ? ' on' : '')}
        aria-label={`Más opciones para ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={17} />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) app.uploadPersonPhoto(person, f);
        }}
      />
      {open &&
        createPortal(
          <div ref={menu} className="pp-dropdown floating" role="menu" style={pos}>
            <span className="pp-dropdown-label">Encuentros</span>
            <button role="menuitem" onClick={run(() => app.openBrief(person, 'antes'))}>
              <NotebookPen size={15} /> Preparar encuentro
            </button>
            <button role="menuitem" onClick={run(() => app.openBrief(person, 'despues'))}>
              <ClipboardCheck size={15} /> Cerrar encuentro (30 s)
            </button>
            <button role="menuitem" onClick={run(() => app.openCapture('', [person.id]))}>
              <Feather size={15} /> Escribir un instante
            </button>
            <span className="pp-dropdown-sep" />
            <span className="pp-dropdown-label">Añadir rápido</span>
            <button role="menuitem" onClick={run(() => app.openEntry(undefined, [person.id]))}>
              <Feather size={15} /> Recuerdo
            </button>
            <button
              role="menuitem"
              className="accent"
              onClick={run(() => app.quickPerson(person, 'novedad'))}
            >
              <Activity size={15} /> ¿Qué hay de nuevo?
            </button>
            <button role="menuitem" onClick={run(() => app.quickPerson(person, 'nota'))}>
              <StickyNote size={15} /> Nota rápida
            </button>
            <button role="menuitem" onClick={run(() => app.openEntry('Pendiente', [person.id]))}>
              <BellPlus size={15} /> Recordatorio
            </button>
            <button role="menuitem" onClick={run(() => app.quickPerson(person, 'dar'))}>
              <ArrowUpRight size={15} /> Algo que le di
            </button>
            <button role="menuitem" onClick={run(() => app.quickPerson(person, 'recibir'))}>
              <ArrowDownLeft size={15} /> Algo que me dio
            </button>
            <button role="menuitem" onClick={run(() => app.openTie(person))}>
              <Link2 size={15} /> Vincular con alguien
            </button>
            <button role="menuitem" onClick={run(() => setGroups(true))}>
              <Users size={15} /> Añadir a un grupo
            </button>
            <button role="menuitem" onClick={run(() => app.quickPerson(person, 'dato'))}>
              <Plus size={15} /> Un dato sobre su vida
            </button>
            <span className="pp-dropdown-sep" />
            <span className="pp-dropdown-label">Completar ficha</span>
            <button role="menuitem" onClick={run(() => file.current?.click())}>
              <Camera size={15} /> {person.profile.photo ? 'Cambiar foto' : 'Subir foto'}
            </button>
            <button role="menuitem" onClick={run(() => app.editPerson(person, 'contacto'))}>
              <Phone size={15} /> Contacto
            </button>
            <button role="menuitem" onClick={run(() => app.editPerson(person, 'fechas'))}>
              <Cake size={15} /> Cumpleaños y fechas
            </button>
            <button role="menuitem" onClick={run(() => app.editPerson(person, 'esencia'))}>
              <IdCard size={15} /> Relación y cercanía
            </button>
            <span className="pp-dropdown-sep" />
            <button
              role="menuitem"
              onClick={run(
                () =>
                  void app.patchPerson(
                    person,
                    { profile: { ...person.profile, favorite: !fav } },
                    true,
                  ),
              )}
            >
              <Star size={15} className={fav ? 'pp-star-on' : ''} />{' '}
              {fav ? 'Quitar de favoritos' : 'Marcar favorito'}
            </button>
            <button role="menuitem" onClick={run(() => app.editPerson(person))}>
              <Pencil size={15} /> Editar todo
            </button>
            <button role="menuitem" onClick={run(() => app.openMerge(person))}>
              <Merge size={15} /> Unir con otra ficha…
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={run(() => app.removePerson(person))}
            >
              <Trash2 size={15} /> Eliminar
            </button>
          </div>,
          document.body,
        )}
      {groups && <PersonGroupsDialog person={person} onClose={() => setGroups(false)} />}
    </div>
  );
}

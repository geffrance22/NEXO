import { useEffect, useRef } from 'react';
import { Menu, Moon, Plus, Sun } from 'lucide-react';
import { useApp } from '../AppContext';
import { useTheme } from '../hooks/useTheme';
import { GlobalSearch } from './GlobalSearch';
import { UserMenu } from './UserMenu';

/** ¿Hay algo abierto encima o se está escribiendo? Entonces el atajo no actúa. */
const busy = (target: EventTarget | null) =>
  (target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) ||
  Boolean(
    document.querySelector(
      '.sheet-backdrop, .confirm-backdrop, .modal-backdrop, .lightbox, .nx-peek, .chat-panel, .readings[data-open="true"]',
    ),
  );

export function Topbar({ onToggleMenu }: { onToggleMenu: () => void }) {
  const { page, openEntry, openCapture } = useApp();
  const { dark, toggle } = useTheme();
  const themeLabel = dark ? 'Desactivar modo oscuro' : 'Activar modo oscuro';

  // Atajos desde cualquier sección: «N» abre «¿Qué quieres guardar?»; «P» (o «W») escribe un
  // instante.
  const open = useRef(openEntry);
  open.current = openEntry;
  const write = useRef(openCapture);
  write.current = openCapture;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key !== 'n' && key !== 'p' && key !== 'w') return;
      if (busy(e.target)) return;
      e.preventDefault();
      if (key === 'n') open.current();
      else write.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onToggleMenu} aria-label="Abrir menú">
        <Menu size={21} />
      </button>
      <div className="breadcrumb">
        Mi universo <span>/</span> <strong>{page}</strong>
      </div>
      <div className="top-actions">
        <GlobalSearch />
        <button
          type="button"
          className="top-new"
          title="Nuevo recuerdo (N)"
          aria-label="Nuevo recuerdo"
          aria-keyshortcuts="N"
          onClick={() => openEntry()}
        >
          <Plus size={18} strokeWidth={2.4} />
        </button>
        <button
          className="icon-button"
          title={themeLabel}
          aria-label={themeLabel}
          aria-pressed={dark}
          onClick={toggle}
        >
          {dark ? <Moon size={19} /> : <Sun size={19} />}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

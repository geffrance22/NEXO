import { useCallback, useRef, useState } from 'react';
import { Download, LogOut, Settings, Sparkles } from 'lucide-react';
import { useApp } from '../AppContext';
import { useDismiss } from '../hooks/useDismiss';
import { downloadWorkspace } from '../lib/export';
import { initials } from '../lib/format';

/** Avatar del encabezado con el menú de la cuenta. */
export function UserMenu() {
  const { user, workspace, go, openChat, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="pp-menu" ref={root}>
      <button
        type="button"
        className="top-avatar"
        title="Mi cuenta"
        aria-label="Menú de la cuenta"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(user.email || 'Yo').toUpperCase()}
      </button>
      {open && (
        <div className="pp-dropdown right" role="menu">
          <button role="menuitem" onClick={run(signOut)}>
            <LogOut size={15} /> Cerrar sesión
          </button>
          <button role="menuitem" onClick={run(() => go('Ajustes'))}>
            <Settings size={15} /> Configuración
          </button>
          <button role="menuitem" onClick={run(() => downloadWorkspace(workspace))}>
            <Download size={15} /> Exportar mis datos
          </button>
          <button role="menuitem" onClick={run(openChat)}>
            <Sparkles size={15} /> Preguntar a Nexo
          </button>
        </div>
      )}
    </div>
  );
}

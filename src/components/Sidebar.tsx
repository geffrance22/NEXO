import {
  Columns3,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Layers,
  Library,
  LogOut,
  MapPin,
  Network,
  Settings,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { compactCount, initials } from '../lib/format';

const nav = [
  ['Mi espacio', BookOpen],
  ['Agenda', CalendarDays],
  ['Episodios', Layers],
  ['Personas', Users],
  ['Libroteca', Library],
  ['Lecturas', BookOpen],
  ['Tableros', Columns3],
  ['Finanzas', Wallet],
  ['Conexiones', Network],
  ['Lugares', MapPin],
] as const;

export function Sidebar({ mobileOpen }: { mobileOpen: boolean }) {
  const { user, workspace, page, go, openChat, signOut } = useApp();

  return (
    <aside className={'sidebar ' + (mobileOpen ? 'mobile-open' : '')}>
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          go('Mi espacio');
        }}
      >
        <span className="brand-mark">n</span>nexo<span className="brand-dot">.</span>
      </a>
      <div className="workspace-label">TU UNIVERSO PERSONAL</div>
      <nav>
        {nav.map(([label, Icon]) => (
          <button key={label} className={page === label ? 'active' : ''} onClick={() => go(label)}>
            <Icon size={19} />
            {label}
            {label === 'Mi espacio' && (
              <span
                className="nav-count"
                title={`${workspace.entries.length.toLocaleString('es-CO')} recuerdos`}
              >
                {compactCount(workspace.entries.length)}
              </span>
            )}
          </button>
        ))}
      </nav>
      <button className="assistant-nav" onClick={openChat}>
        <Sparkles size={18} />
        <span>
          Pregúntale a Nexo<small>Conecta los puntos</small>
        </span>
        <ArrowUpRight size={16} />
      </button>
      <div className="sidebar-bottom">
        <button
          className={page === 'Ajustes' ? 'settings active' : 'settings'}
          onClick={() => go('Ajustes')}
        >
          <Settings size={18} /> Ajustes
        </button>
        <button className="user-profile" onClick={signOut}>
          <span className="avatar">{initials(user.email || 'Yo').toUpperCase()}</span>
          <span>
            Mi cuenta<small>{user.email}</small>
            <span className="connection connected">
              <i />
              Sesión privada
            </span>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

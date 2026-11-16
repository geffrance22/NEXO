import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Download,
  House,
  IdCard,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { downloadWorkspace } from '../lib/export';
import { MyFace } from '../people/MyFace';
import { useNavSlots } from './navSlots';
import { shortcutOf, type Shortcut } from './shortcuts';

/** Al cambiar de sección desde la barra, la nueva abre arriba (como en una app). */
const toTop = () => window.scrollTo({ top: 0 });

const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']);
/** ¿Se está escribiendo en un campo? */
const editing = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NOT_TYPED.has((el as HTMLInputElement).type);
};

/**
 * ¿El teclado del celular está a la vista? Se nota en que el área visible se encoge mientras
 * escribes. Solo con el foco no basta: un campo con foco automático no abre el teclado.
 */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const visible = () => vv?.height ?? window.innerHeight;
    // El alto sin teclado; se vuelve a medir al girar el teléfono.
    let full = Math.max(window.innerHeight, visible());
    let width = window.innerWidth;
    const check = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        full = Math.max(window.innerHeight, visible());
      }
      const typing = editing();
      if (!typing) full = Math.max(full, window.innerHeight, visible());
      setOpen(typing && visible() < full - 120);
    };
    // Al soltar el foco el teclado tarda un momento en bajar.
    const later = () => window.setTimeout(check, 120);
    vv?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', later);
    return () => {
      vv?.removeEventListener('resize', check);
      window.removeEventListener('resize', check);
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return open;
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={'bnav-item' + (active ? ' on' : '')}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="bnav-ico">
        <Icon size={21} strokeWidth={active ? 2.2 : 1.9} />
      </span>
      <span className="bnav-label">{label}</span>
    </button>
  );
}

/**
 * Barra inferior fija del celular: Mi espacio, dos accesos a tu gusto (se eligen en
 * Configuración), «+» para agregar algo y tu perfil.
 */
export function BottomNav() {
  const app = useApp();
  const { page, go, openEntry } = app;
  const { slots } = useNavSlots();
  const [account, setAccount] = useState(false);
  const keyboard = useKeyboardOpen();
  const items = slots.map(shortcutOf).filter((s): s is Shortcut => Boolean(s));

  // Si los dos accesos son de la sección abierta, se marca la sección (o el primero).
  const here = items.filter((s) => s.page === page);
  const active = here.find((s) => s.group === 'secciones') ?? here[0];

  const open = (s: Shortcut) => {
    // Tocar otra vez la sección en la que estás te sube al principio, sin recargarla.
    if (s === active && s.group === 'secciones' && window.scrollY > 40) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    s.run(app);
    if (s.page) toTop();
  };

  const home = () => {
    if (page === 'Mi espacio' && window.scrollY > 40) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    go('Mi espacio');
    toTop();
  };

  const slot = (s: Shortcut | undefined) =>
    s ? (
      <NavItem icon={s.icon} label={s.label} active={s === active} onClick={() => open(s)} />
    ) : (
      <span />
    );

  return (
    <>
      <nav className={'bnav' + (keyboard ? ' kb' : '')} aria-label="Accesos rápidos">
        <div className="bnav-bar">
          <NavItem icon={House} label="Mi espacio" active={page === 'Mi espacio'} onClick={home} />
          {slot(items[0])}
          <button
            type="button"
            className="bnav-add"
            aria-label="Agregar algo nuevo"
            title="Agregar"
            onClick={() => openEntry()}
          >
            <span className="bnav-add-orb">
              <Plus size={25} strokeWidth={2.4} />
            </span>
          </button>
          {slot(items[1])}
          <button
            type="button"
            className={'bnav-item bnav-me' + (account || page === 'Ajustes' ? ' on' : '')}
            aria-haspopup="dialog"
            aria-expanded={account}
            onClick={() => setAccount(true)}
          >
            <span className="bnav-ico">
              <span className="bnav-face">
                <MyFace size={28} />
              </span>
            </span>
            <span className="bnav-label">Perfil</span>
          </button>
        </div>
      </nav>
      {account && <AccountSheet onClose={() => setAccount(false)} />}
    </>
  );
}

/** El perfil del celular: lo que en escritorio está en el avatar del encabezado. */
function AccountSheet({ onClose }: { onClose: () => void }) {
  const { user, me, workspace, go, openMe, openChat, signOut } = useApp();
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const name = me.profile.name?.trim() || me.profile.alias?.trim() || 'Tu cuenta';
  const rows: { icon: LucideIcon; title: string; hint: string; run: () => void; danger?: boolean }[] = [
    {
      icon: IdCard,
      title: 'Mi ficha',
      hint: 'Tus datos, gustos y la lectura de Nexo',
      run: openMe,
    },
    {
      icon: Settings,
      title: 'Configuración',
      hint: 'Accesos de la barra inferior, tus datos y la IA',
      run: () => {
        go('Ajustes');
        toTop();
      },
    },
    {
      icon: Download,
      title: 'Exportar mis datos',
      hint: 'Una copia JSON de tus personas y apuntes',
      run: () => downloadWorkspace(workspace),
    },
    {
      icon: Sparkles,
      title: 'Preguntar a Nexo',
      hint: 'Conecta los puntos de tu memoria',
      run: openChat,
    },
  ];

  return (
    <Sheet label="Tu cuenta" className="bn-acc" onRequestClose={onClose}>
      <header className="bn-acc-head">
        <span className="bn-acc-face">
          <MyFace size={56} />
        </span>
        <span className="bn-acc-who">
          <strong>{name}</strong>
          <small>{user.email}</small>
        </span>
        <button type="button" className="bn-acc-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="bn-acc-list">
        {rows.map((r) => (
          <button type="button" key={r.title} onClick={run(r.run)}>
            <span className="bn-acc-ico">
              <r.icon size={18} />
            </span>
            <span className="bn-acc-text">
              <b>{r.title}</b>
              <small>{r.hint}</small>
            </span>
            <ChevronRight size={17} className="bn-acc-chev" />
          </button>
        ))}
        <span className="bn-acc-sep" role="separator" />
        <button type="button" className="danger" onClick={run(signOut)}>
          <span className="bn-acc-ico">
            <LogOut size={18} />
          </span>
          <span className="bn-acc-text">
            <b>Cerrar sesión</b>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

import { useEffect, type CSSProperties } from 'react';

import { X, StickyNote, Link2, UserPlus, ScanLine } from 'lucide-react';
import { kinds, type Kind } from '../data';
import { kindMeta } from './kinds';

/** Primera pantalla: elegir qué vas a guardar. Cada tipo abre su propio espacio. */
export function KindPicker({
  current,
  onPick,
  onClose,
  onShortcut,
}: {
  onShortcut: (kind: 'idea' | 'link' | 'person' | 'capture') => void;
  current?: Kind;
  onPick: (kind: Kind) => void;
  onClose: () => void;
}) {
  const letters: Record<Kind, string> = {
    Nota: 'H',
    Encuentro: 'E',
    Película: 'P',
    Libro: 'L',
    Trabajo: 'T',
    Aprendizaje: 'A',
    Movimiento: 'M',
    Pendiente: 'D',
  };
  const extras = [
    {
      label: 'Nota',
      hint: 'Guardar en Notas de Libroteca',
      Icon: StickyNote,
      key: 'N',
      action: () => onShortcut('idea'),
    },
    {
      label: 'Enlace',
      hint: 'Guardar en Lecturas',
      Icon: Link2,
      key: 'V',
      action: () => onShortcut('link'),
    },
    {
      label: 'Agregar persona',
      hint: 'Crear una ficha',
      Icon: UserPlus,
      key: 'G',
      action: () => onShortcut('person'),
    },
    {
      label: 'Guardar Captura',
      hint: 'Subir a CAPTURAS',
      Icon: ScanLine,
      key: 'C',
      action: () => onShortcut('capture'),
    },
  ];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector('.confirm-backdrop,dialog[open]') ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.closest('input,textarea,select')))
      )
        return;
      const key = event.key.toUpperCase();
      const kind = kinds.find((k) => letters[k] === key);
      const action = extras.find((e) => e.key === key)?.action;
      if (!kind && !action) return;
      event.preventDefault();
      if (kind) onPick(kind);
      else action?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onPick, onShortcut]);
  return (
    <div className="cp-picker">
      <header>
        <div>
          <h2>{current ? 'Cambiar el tipo' : '¿Qué quieres guardar?'}</h2>
          <p>Cada tipo tiene su propio espacio, pensado para lo que vas a registrar.</p>
        </div>
        <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="cp-tiles">
        {kinds.map((kind, i) => {
          const meta = kindMeta[kind];
          const Icon = meta.icon;
          return (
            <button
              type="button"
              key={kind}
              className={'cp-tile' + (kind === current ? ' current' : '')}
              style={
                {
                  '--accent': meta.accent,
                  '--soft': meta.soft,
                  '--ink': meta.ink,
                  '--delay': `${i * 35}ms`,
                } as CSSProperties
              }
              onClick={() => onPick(kind)}
              data-autofocus={i === 0 ? true : undefined}
            >
              <span className="cp-tile-icon">
                <Icon size={24} strokeWidth={1.7} />
              </span>
              <strong>{meta.label}</strong>
              <span className="cp-tile-hint">{meta.hint}</span>
              <kbd>{letters[kind]}</kbd>
            </button>
          );
        })}
        {extras.map(({ label, hint, Icon, action, key }) => (
          <button
            key={label}
            type="button"
            disabled={!action}
            className="cp-tile"
            style={
              { '--accent': '#547663', '--soft': '#edf3ed', '--ink': '#355849' } as CSSProperties
            }
            onClick={action}
          >
            <span className="cp-tile-icon">
              <Icon size={24} strokeWidth={1.7} />
            </span>
            <strong>{label}</strong>
            <span className="cp-tile-hint">{hint}</span>
            {key && <kbd>{key}</kbd>}
          </button>
        ))}
      </div>
      <p className="cp-picker-tip">Pulsa la letra de una opción para abrirla.</p>
    </div>
  );
}

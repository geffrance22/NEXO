import type { CSSProperties } from 'react';
import {
  BookOpen,
  Columns3,
  Feather,
  Images,
  Layers,
  Library,
  MapPin,
  Newspaper,
  Sparkles,
  UserPlus,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import { kindMeta } from '../../composer/kinds';
import type { Kind } from '../../data';
import { goLibroteca } from '../../library/shelf';
import { Card } from '../Card';
import { list, str, type BlockProps, type Choice } from '../types';

type Action = { label: string; icon: LucideIcon; color: string; soft: string };
const kindAction = (k: Kind, label?: string): Action => ({
  label: label ?? kindMeta[k].label,
  icon: kindMeta[k].icon,
  color: kindMeta[k].accent,
  soft: kindMeta[k].soft,
});

export const actions: Record<string, Action> = {
  nota: kindAction('Nota', 'Diario'),
  encuentro: kindAction('Encuentro'),
  pendiente: kindAction('Pendiente'),
  movimiento: kindAction('Movimiento', 'Gasto o ingreso'),
  libro: kindAction('Libro'),
  pelicula: kindAction('Película', 'Película o serie'),
  aprendizaje: kindAction('Aprendizaje'),
  trabajo: kindAction('Trabajo'),
  capturar: { label: 'Escribir un instante', icon: Feather, color: '#6b62b5', soft: '#eeebfa' },
  persona: { label: 'Persona', icon: UserPlus, color: '#4f6bb5', soft: '#e7ecf7' },
  lugar: { label: 'Lugar', icon: MapPin, color: '#c0674a', soft: '#f9e9e2' },
  episodio: { label: 'Episodio', icon: Layers, color: '#3c9186', soft: '#dff2ef' },
  chat: { label: 'Consultar memoria', icon: Sparkles, color: '#6b62b5', soft: '#eeebfa' },
  semana: { label: 'Tu semana', icon: Newspaper, color: '#b0703a', soft: '#f8ecdf' },
  finanzas: { label: 'Finanzas', icon: Wallet, color: '#3f6b4f', soft: '#e6efe7' },
  tableros: { label: 'Tableros', icon: Columns3, color: '#4f6b3d', soft: '#e8f0df' },
  lecturas: { label: 'Lecturas', icon: BookOpen, color: '#365c52', soft: '#e4efe8' },
  libroteca: { label: 'Libroteca', icon: Library, color: '#5f8247', soft: '#eaf1e0' },
  capturas: { label: 'Capturas', icon: Images, color: '#4f6b3d', soft: '#e8f0df' },
};
export const actionChoices: Choice[] = Object.entries(actions).map(([value, a]) => ({ value, label: a.label }));

/** Botones a lo que más usas: crear algo, abrir una sección o preguntarle a tu memoria. */
export function ShortcutsBlock({ opts, zone }: BlockProps) {
  const app = useApp();
  const chosen = list(opts, 'actions').filter((k) => actions[k]);
  const run = (k: string) => {
    switch (k) {
      case 'nota':
        return app.openEntry('Nota', []);
      case 'encuentro':
        return app.openEntry('Encuentro', []);
      case 'pendiente':
        return app.openEntry('Pendiente', []);
      case 'movimiento':
        return app.openEntry('Movimiento', []);
      case 'libro':
        return app.openEntry('Libro', []);
      case 'pelicula':
        return app.openEntry('Película', []);
      case 'aprendizaje':
        return app.openEntry('Aprendizaje', []);
      case 'trabajo':
        return app.openEntry('Trabajo', []);
      case 'capturar':
        return app.openCapture();
      case 'persona':
        return app.openPerson();
      case 'lugar':
        return app.openPlace();
      case 'episodio':
        return app.openEpisode();
      case 'chat':
        return app.openChat();
      case 'semana':
        return app.openWeekly();
      case 'finanzas':
        return app.go('Finanzas');
      case 'tableros':
        return app.go('Tableros');
      case 'lecturas':
        return app.go('Lecturas');
      case 'libroteca':
        return goLibroteca(app.go, 'inicio');
      case 'capturas':
        return goLibroteca(app.go, 'capturas');
    }
  };
  const style = str(opts, 'style', 'iconos');
  return (
    <Card zone={zone} opts={opts} icon={Zap} tone="#c58a1c" title="Atajos" empty={!chosen.length} emptyText="Elige tus atajos en Personalizar.">
      <div className={'hk-shortcuts ' + style}>
        {chosen.map((k) => {
          const a = actions[k];
          return (
            <button
              type="button"
              key={k}
              onClick={() => run(k)}
              style={{ '--c': a.color, '--s': a.soft } as CSSProperties}
              title={a.label}
            >
              <span>
                <a.icon size={16} />
              </span>
              <small>{a.label}</small>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

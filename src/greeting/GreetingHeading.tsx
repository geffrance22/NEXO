import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Columns3,
  Compass,
  MessageCircle,
  Moon,
  Newspaper,
  PenLine,
  Sun,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { resolveAction, type ActionIcon } from './actions';
import type { WeatherIcon } from './greeting';
import { useGreeting } from './useGreeting';
import './greeting.css';

const weatherIcons: Record<WeatherIcon, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  storm: CloudLightning,
  snow: CloudSnow,
};

const actionIcons: Record<ActionIcon, LucideIcon> = {
  capture: PenLine,
  chat: MessageCircle,
  weekly: Newspaper,
  go: Compass,
  book: BookOpen,
  show: Tv,
  person: MessageCircle,
  entry: CalendarCheck,
  card: Columns3,
};

/**
 * Encabezado de Mi espacio: un saludo para este momento, escrito por la IA con tu ficha, tu día en
 * Nexo y lo de afuera (clima, noticias). Puede traer accesos directos. Nunca queda vacío: mientras
 * llega el de la IA se ve el saludo con tu nombre, y si falla, uno de respaldo.
 */
export function GreetingHeading() {
  const app = useApp();
  const { phase, greeting: g, weather: w, pending, part } = useGreeting();

  const weekday = new Date().toLocaleDateString('es-CO', { weekday: 'long' });
  const when = `${part.charAt(0).toUpperCase()}${part.slice(1)} de ${weekday}`;
  const WeatherGlyph = w ? weatherIcons[w.icon] : null;
  const actions =
    phase === 'wait'
      ? []
      : g.actions.flatMap((a) => {
          const found = resolveAction(a.id, app);
          return found ? [{ ...a, ...found }] : [];
        });
  const range = w && w.min !== null && w.max !== null ? ` · de ${w.min}° a ${w.max}°` : '';

  return (
    <div className="page-heading greet" data-phase={phase}>
      <div className="greet-body" key={phase === 'ai' ? 'ai|' + g.title : phase}>
        <div className="greet-meta">
          <span className="greet-when">{when}</span>
          {w && WeatherGlyph && (
            <span className="greet-wx" title={`${w.label}, sensación de ${w.feels}°${range}`}>
              <WeatherGlyph size={14} /> {w.temp}° · {w.city}
            </span>
          )}
          {pending && <i className="greet-pulse" aria-hidden="true" />}
        </div>
        <h1>{g.title}</h1>
        {phase === 'wait' ? (
          <div className="greet-skel" aria-hidden="true">
            <i />
            <i />
          </div>
        ) : (
          <p className="greet-text">{g.text}</p>
        )}
        {actions.length > 0 && (
          <div className="greet-actions">
            {actions.map((a) => {
              const Glyph = actionIcons[a.icon];
              return (
                <button key={a.id} type="button" className="greet-chip" onClick={a.run}>
                  <Glyph size={14} /> {a.label} <ArrowRight size={13} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

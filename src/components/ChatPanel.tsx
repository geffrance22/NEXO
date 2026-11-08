import type { FormEvent, ReactNode } from 'react';
import {
  ArrowUpRight,
  Calculator,
  FileText,
  Layers,
  LoaderCircle,
  MapPin,
  Search,
  Send,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { AssistantSource } from '../assistant';
import type { Assistant } from '../hooks/useAssistant';

const suggestions = [
  '¿Qué compromisos tengo abiertos y con quién?',
  '¿Cuánto gasté este mes y en qué?',
  '¿Qué sé de Laura y qué novedades tiene?',
  '¿Quién me recomendó un libro?',
];

const sourceIcon = { entry: FileText, person: UserRound, place: MapPin, episode: Layers };

export function ChatPanel({ assistant, onClose }: { assistant: Assistant; onClose: () => void }) {
  const { question, setQuestion, result, busy, ask } = assistant;
  const { workspace, go, viewEntry, peekPerson } = useApp();

  function submit(ev: FormEvent) {
    ev.preventDefault();
    void ask();
  }

  const open = (s: AssistantSource) => {
    if (s.type === 'entry') {
      const e = workspace.entries.find((x) => x.id === s.id);
      if (e) viewEntry(e);
    } else if (s.type === 'person') {
      const p = workspace.people.find((x) => x.id === s.id);
      if (p) peekPerson(p);
    } else if (s.type === 'place') {
      const p = workspace.places.find((x) => x.id === s.id);
      if (p) go('Lugares', p);
    } else {
      const ep = workspace.episodes.find((x) => x.id === s.id);
      if (ep) go('Episodios', ep);
    }
  };

  /** Convierte las citas [r3] de la respuesta en enlaces a sus fuentes. */
  const render = (text: string): ReactNode[] => {
    const byRef = new Map((result?.sources ?? []).map((s) => [s.ref, s]));
    return text.split(/(\[[a-z]\d+(?:\s*,\s*[a-z]\d+)*\])/g).map((part, i) => {
      const refs = part.match(/^\[(.+)\]$/)?.[1].split(/\s*,\s*/);
      if (!refs) return part;
      return refs.map((r) => {
        const s = byRef.get(r);
        if (!s) return null;
        const Icon = sourceIcon[s.type];
        return (
          <button
            type="button"
            key={i + r}
            className="chat-cite"
            title={s.title}
            onClick={() => open(s)}
          >
            <Icon size={11} />
            {s.title.length > 26 ? s.title.slice(0, 24) + '…' : s.title}
          </button>
        );
      });
    });
  };

  const cov = result?.coverage;
  return (
    <div className="chat-panel" role="dialog" aria-label="Asistente Nexo">
      <header>
        <span>
          <Sparkles size={19} /> Nexo · con contexto
        </span>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar asistente">
          <X size={20} />
        </button>
      </header>
      <div className="chat-content">
        {!result && !busy && (
          <>
            <span className="chat-emblem">
              <Sparkles size={28} />
            </span>
            <h2>Conectemos los puntos.</h2>
            <p>
              Pregunta por personas, lugares, compromisos, gastos o recuerdos. Nexo busca por
              persona, fecha y tipo, calcula lo exacto y te muestra de dónde sacó cada cosa.
            </p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} onClick={() => setQuestion(s)}>
                  {s}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          </>
        )}
        {result && (
          <div className="answer">
            {result.answer.split('\n').map((line, i) => (
              <p key={i}>{render(line)}</p>
            ))}
          </div>
        )}
        {cov && (
          <div className="chat-coverage">
            <span>
              <Search size={13} /> Consulté {cov.consulted} de {cov.matching}{' '}
              {cov.matching === 1 ? 'recuerdo que coincide' : 'recuerdos que coinciden'}
              {cov.matching > cov.consulted && ` · ${cov.matching - cov.consulted} quedaron fuera`}
            </span>
            {cov.filters.length > 0 && <span>Filtros: {cov.filters.join(' · ')}</span>}
            <span>
              Además: {cov.people} personas, {cov.places} lugares, {cov.episodes} episodios
            </span>
            {cov.calculations.map((c) => (
              <span key={c} className="calc">
                <Calculator size={13} /> {c}
              </span>
            ))}
          </div>
        )}
        {result && result.sources.length > 0 && (
          <div className="chat-sources">
            <strong>Fuentes</strong>
            {result.sources.slice(0, 12).map((s) => {
              const Icon = sourceIcon[s.type];
              return (
                <button type="button" key={s.ref} onClick={() => open(s)} title={s.title}>
                  <Icon size={12} /> {s.title}
                  {s.date && <small> · {s.date}</small>}
                </button>
              );
            })}
          </div>
        )}
        {busy && <LoaderCircle className="spin" />}
        <small>
          Tus datos solo se envían al consultar. Los totales se calculan antes, no los adivina la
          IA.
        </small>
      </div>
      <form onSubmit={submit}>
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (question.trim() && !busy) void ask();
            }
          }}
          placeholder="Pregúntale a tu memoria…"
        />
        <button className="primary" disabled={busy} aria-label="Enviar pregunta">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

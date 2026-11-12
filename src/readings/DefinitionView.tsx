import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  ExternalLink,
  Eye,
  Lightbulb,
  Quote,
  Shuffle,
  Sprout,
  TriangleAlert,
} from 'lucide-react';
import type { Definition } from './define';
import { fetchEtymology, wiktionarySearch, type Etymology } from './etymology';

function Chips({ label, items, tone }: { label: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className={'df-chips' + (tone ? ' ' + tone : '')}>
      <span className="df-label">{label}</span>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** La ficha completa de una palabra: significado, raíz, truco, ejemplo, relaciones y ejercicio. */
export function DefinitionView({
  d,
  term = '',
  plain = false,
}: {
  d: Definition;
  term?: string;
  /** Sin avisos de que lo escribió la IA (p. ej. en el repaso). */
  plain?: boolean;
}) {
  const [shown, show] = useState(false);
  // Fichas de antes de usar Wiktionary: se busca la fuente al abrirlas (no se guarda).
  const [late, setLate] = useState<Etymology | null | undefined>(undefined);
  useEffect(() => {
    if (d.source !== undefined || !term) return;
    let live = true;
    void fetchEtymology(term).then((e) => live && setLate(e));
    return () => {
      live = false;
    };
  }, [d.source, term]);
  const source = d.source !== undefined ? d.source : late;
  return (
    <div className="df">
      {d.kind && <span className="df-kind">{d.kind}</span>}
      <p className="df-meaning">{d.meaning}</p>

      {(d.root || d.history || source) && (
        <section className="df-block">
          <span className="df-label">
            <Sprout size={13} /> Raíz e historia
          </span>
          {d.root && <p>{d.root}</p>}
          {d.history && <p className="df-soft">{d.history}</p>}
          {source ? (
            <details className="df-source" open={!d.root && !d.history}>
              <summary>
                <BadgeCheck size={13} /> Según Wiktionary
                {source.language ? ` · ${source.language}` : ''}
              </summary>
              <p>{source.text}</p>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                Ver la entrada en Wiktionary <ExternalLink size={11} />
              </a>
              <small>Texto de Wiktionary, CC BY-SA 4.0.</small>
            </details>
          ) : (
            !plain &&
            (d.root || d.history) && (
              <small className="df-unverified">
                <TriangleAlert size={12} />
                {source === undefined
                  ? 'Escrito por la IA.'
                  : 'Wiktionary no tiene su etimología: lo escribió la IA y puede tener errores.'}{' '}
                {term && (
                  <a href={wiktionarySearch(term)} target="_blank" rel="noopener noreferrer">
                    Verificar
                  </a>
                )}
              </small>
            )
          )}
        </section>
      )}

      {d.hook && (
        <section className="df-block df-hook">
          <span className="df-label">
            <Lightbulb size={13} /> Para no olvidarla
          </span>
          <p>{d.hook}</p>
        </section>
      )}

      {d.example && (
        <section className="df-block">
          <span className="df-label">
            <Quote size={13} /> Ejemplo
          </span>
          <q className="df-example">{d.example}</q>
        </section>
      )}

      <Chips label="Sinónimos" items={d.synonyms} />
      <Chips label="Antónimos" items={d.antonyms} tone="anti" />
      <Chips label="Familia de palabras" items={d.family} tone="family" />

      {d.confusions && (
        <section className="df-block df-warn">
          <span className="df-label">
            <TriangleAlert size={13} /> No confundir
          </span>
          <p>{d.confusions}</p>
        </section>
      )}

      {d.practice.q && (
        <section className="df-block df-practice">
          <span className="df-label">
            <Shuffle size={13} /> Ponte a prueba
          </span>
          <p>{d.practice.q}</p>
          {d.practice.a &&
            (shown ? (
              <p className="df-answer">{d.practice.a}</p>
            ) : (
              <button type="button" className="df-reveal" onClick={() => show(true)}>
                <Eye size={13} /> Ver respuesta
              </button>
            ))}
        </section>
      )}
    </div>
  );
}

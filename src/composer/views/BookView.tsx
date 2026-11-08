import { BookMarked, Plus, Quote, X } from 'lucide-react';
import { AutoTextarea, Label, Segmented, Stars } from '../controls';
import { DateChips } from '../DateChips';
import { PeoplePicker } from '../PeoplePicker';
import { CoverDrop } from '../PhotoBlocks';
import type { ViewProps } from './shared';

const toCount = (v: string) => (v ? Math.min(Number(v.replace(/\D/g, '')) || 0, 99999) : undefined);

/** Libro: portada, progreso de lectura y frases que te marcaron. */
export function BookView({ c }: ViewProps) {
  const read = c.details.read ?? 'leyendo';
  const { pagesRead = 0, pagesTotal = 0 } = c.details;
  const percent = pagesTotal > 0 ? Math.min(100, Math.round((pagesRead / pagesTotal) * 100)) : 0;
  const quotes = c.details.quotes ?? [];
  const setQuote = (i: number, text: string) =>
    c.setDetail(
      'quotes',
      quotes.map((q, j) => (j === i ? text : q)),
    );

  return (
    <div className="cp-media">
      <div className="cp-media-side">
        <CoverDrop
          uploads={c.uploads}
          icon={BookMarked}
          title="Portada"
          hint="Toca para subirla"
          external={c.details.bookEdition?.image}
          clearExternal={() => {
            if (c.details.bookEdition)
              c.setDetail('bookEdition', { ...c.details.bookEdition, image: '' });
          }}
        />
      </div>
      <div className="cp-media-main">
        <input
          className="cp-title-input"
          placeholder="¿Qué libro?"
          maxLength={180}
          value={c.title}
          onChange={(e) => c.setTitle(e.target.value)}
          aria-label="Título del libro"
          data-autofocus
        />
        <input
          className="cp-author"
          placeholder="Autor"
          maxLength={120}
          value={c.details.author ?? ''}
          onChange={(e) => c.setDetail('author', e.target.value)}
          aria-label="Autor"
        />

        <Segmented
          label="Estado de lectura"
          value={read}
          onChange={(v) => c.setDetail('read', v)}
          options={[
            { value: 'quiero', label: 'Quiero leerlo' },
            { value: 'leyendo', label: 'Leyendo' },
            { value: 'terminado', label: 'Terminado' },
          ]}
        />

        {read === 'leyendo' && (
          <div className="cp-progress-card">
            <div className="cp-pages">
              <label>
                <span>Página</span>
                <input
                  inputMode="numeric"
                  value={pagesRead || ''}
                  placeholder="0"
                  onChange={(e) => c.setDetail('pagesRead', toCount(e.target.value))}
                  aria-label="Página actual"
                />
              </label>
              <span className="cp-pages-of">de</span>
              <label>
                <span>Total</span>
                <input
                  inputMode="numeric"
                  value={pagesTotal || ''}
                  placeholder="0"
                  onChange={(e) => c.setDetail('pagesTotal', toCount(e.target.value))}
                  aria-label="Total de páginas"
                />
              </label>
              <strong>{pagesTotal > 0 ? `${percent}%` : ''}</strong>
            </div>
            <div className="cp-bar" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {read === 'terminado' && (
          <>
            <Label>Tu calificación</Label>
            <Stars
              label="Calificación"
              value={c.details.rating}
              onChange={(v) => c.setDetail('rating', v)}
            />
            <Label>¿Cuándo lo terminaste?</Label>
            <DateChips
              label="Fecha"
              options={['today', 'yesterday']}
              value={c.date}
              onChange={c.setDate}
            />
          </>
        )}

        <Label hint="Las que quieras guardar">Frases que te marcaron</Label>
        <div className="cp-quotes">
          {quotes.map((q, i) => (
            <div className="cp-quote" key={i}>
              <Quote size={15} />
              <AutoTextarea
                minRows={1}
                value={q}
                placeholder="Escribe la frase…"
                onChange={(e) => setQuote(i, e.target.value)}
                aria-label={`Frase ${i + 1}`}
              />
              <button
                type="button"
                aria-label="Quitar frase"
                onClick={() =>
                  c.setDetail(
                    'quotes',
                    quotes.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cp-add-line"
            onClick={() => c.setDetail('quotes', [...quotes, ''])}
          >
            <Plus size={15} /> Añadir una frase
          </button>
        </div>

        <Label>Con quién lo comentas</Label>
        <PeoplePicker api={c.people} variant="compact" />

        <Label>Lo que pienso</Label>
        <AutoTextarea
          className="cp-soft-area"
          minRows={3}
          placeholder="Ideas, dudas, lo que te dejó…"
          value={c.body}
          onChange={(e) => c.setBody(e.target.value)}
          aria-label="Reflexión"
        />
      </div>
    </div>
  );
}

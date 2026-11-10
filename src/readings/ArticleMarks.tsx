import { useMemo, useState, type CSSProperties } from 'react';
import {
  CornerDownRight,
  Copy,
  Highlighter,
  Pencil,
  Search,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { MarkNote } from './AiText';
import { AI_MARK } from './ask';
import { readableSlice } from './formatting';

export type MarkLike = {
  id: string;
  start_offset: number;
  end_offset: number;
  note: string;
  color?: string;
  edited_at: string;
  /** El texto que se leía al resaltarlo. */
  quote?: string | null;
};

/**
 * Los colores del resaltado y lo que significa cada uno (solo para organizarte: no cambian nada
 * más). El verde necesita la migración 202611100005.
 */
export const MARK_COLORS: Record<string, { label: string; name: string; hint: string; ink: string }> =
  {
    yellow: { label: 'Dato', name: 'Amarillo', hint: 'Hechos, cifras y fechas', ink: '#f5b800' },
    blue: { label: 'Idea', name: 'Azul', hint: 'Conceptos y argumentos', ink: '#1e3a8a' },
    orange: { label: 'Cita', name: 'Naranja', hint: 'Frases para citar tal cual', ink: '#f2760a' },
    green: { label: 'Acción', name: 'Verde', hint: 'Algo para aplicar o probar', ink: '#12a150' },
  };
const colorInfo = MARK_COLORS;
const colorOrder = Object.keys(colorInfo);
/** Colores de antes de la migración 011: se muestran como el más cercano. */
const LEGACY: Record<string, string> = { mint: 'yellow', red: 'orange', rose: 'orange' };
export const toneOf = (c?: string | null) =>
  c && colorInfo[c] ? c : (LEGACY[c ?? ''] ?? 'yellow');
/** Color sólido del resaltado (para barras y puntos). */
export const inkOf = (c?: string | null) => colorInfo[toneOf(c)].ink;

type Filter = 'todas' | 'notas' | 'ia' | `c:${string}`;
const isAi = (m: MarkLike) => m.note.startsWith(AI_MARK) || m.note.includes('\n\n' + AI_MARK);

/**
 * Todas las anotaciones de un artículo, en el orden del texto: la cita, tu nota y lo que
 * respondió la IA. Se filtran por color, por las que tienen nota o por las de la IA, y se pueden
 * copiar todas en Markdown.
 */
export function ArticleMarks({
  marks,
  content,
  title,
  feedback,
  copy,
  onEdit,
  onJump,
  lost,
}: {
  /** Resaltados que ya no aparecen en el texto (se muestra la cita que guardaron). */
  lost?: ReadonlySet<string>;
  marks: MarkLike[];
  content: string;
  title: string;
  feedback: string;
  copy: (text: string) => void;
  onEdit: (mark: MarkLike, rect: DOMRect) => void;
  onJump: (start: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>('todas');
  const [q, setQ] = useState('');

  const rows = useMemo(
    () =>
      [...marks]
        .sort((a, b) => a.start_offset - b.start_offset)
        .map((m) => ({
          mark: m,
          quote:
            lost?.has(m.id) && m.quote
              ? m.quote
              : readableSlice(content, m.start_offset, m.end_offset),
        })),
    [marks, content, lost],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: rows.length, notas: 0, ia: 0 };
    for (const { mark } of rows) {
      if (mark.note.trim()) c.notas++;
      if (isAi(mark)) c.ia++;
      const k = 'c:' + toneOf(mark.color);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(({ mark, quote }) => {
    if (filter === 'notas' && !mark.note.trim()) return false;
    if (filter === 'ia' && !isAi(mark)) return false;
    if (filter.startsWith('c:') && 'c:' + toneOf(mark.color) !== filter) return false;
    return !needle || (quote + '\n' + mark.note).toLowerCase().includes(needle);
  });

  const markdown = () =>
    `# ${title}\n\n` +
    shown
      .map(
        ({ mark, quote }) =>
          `> ${quote.replace(/\n+/g, '\n> ')}${mark.note.trim() ? `\n\n${mark.note.trim()}` : ''}`,
      )
      .join('\n\n---\n\n');

  if (!rows.length) {
    return (
      <section className="rd-am empty">
        <Highlighter size={26} />
        <h3>Aún no hay anotaciones</h3>
        <p>Selecciona un fragmento del artículo para resaltarlo, anotarlo o preguntarle a la IA.</p>
      </section>
    );
  }

  const chips: { id: Filter; label: string; icon?: typeof Sparkles; dot?: string }[] = [
    { id: 'todas', label: 'Todas' },
    ...(counts.notas ? [{ id: 'notas' as Filter, label: 'Con nota', icon: StickyNote }] : []),
    ...(counts.ia ? [{ id: 'ia' as Filter, label: 'IA', icon: Sparkles }] : []),
    ...colorOrder
      .filter((c) => counts['c:' + c])
      .map((c) => ({ id: `c:${c}` as Filter, label: colorInfo[c].label, dot: colorInfo[c].ink })),
  ];

  return (
    <section className="rd-am" aria-label="Anotaciones del artículo">
      <header className="rd-am-head">
        <div>
          <strong>
            {rows.length} {rows.length === 1 ? 'anotación' : 'anotaciones'}
          </strong>
          <span>
            {counts.notas} con nota{counts.ia ? ` · ${counts.ia} de la IA` : ''}
          </span>
        </div>
        <button type="button" className="rd-am-copyall" onClick={() => copy(markdown())}>
          <Copy size={14} /> Copiar {shown.length === rows.length ? 'todo' : shown.length}
        </button>
      </header>

      <div className="rd-am-tools">
        <div className="rd-am-chips" role="tablist" aria-label="Filtrar anotaciones">
          {chips.map((c) => (
            <button
              type="button"
              role="tab"
              key={c.id}
              aria-selected={filter === c.id}
              className={filter === c.id ? 'on' : ''}
              onClick={() => setFilter(c.id)}
            >
              {c.dot && <i style={{ background: c.dot }} />}
              {c.icon && <c.icon size={12} />}
              {c.label}
              <b>{counts[c.id] ?? 0}</b>
            </button>
          ))}
        </div>
        {rows.length > 6 && (
          <label className="rd-am-search">
            <Search size={14} />
            <input
              value={q}
              placeholder="Buscar en las anotaciones…"
              aria-label="Buscar en las anotaciones"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        )}
      </div>
      {feedback && (
        <small className="rd-am-feedback" role="status">
          {feedback}
        </small>
      )}

      <ol className="rd-am-list">
        {shown.map(({ mark, quote }) => {
          const ink = colorInfo[toneOf(mark.color)].ink;
          const where = Math.round((mark.start_offset / Math.max(1, content.length)) * 100);
          return (
            <li key={mark.id} className="rd-am-card" style={{ '--mc': ink } as CSSProperties}>
              <div className="rd-am-meta">
                <span className="rd-am-where" title="Posición en el artículo">
                  <i style={{ width: `${Math.max(4, where)}%` }} />
                </span>
                <small>{where < 8 ? 'Inicio' : where > 92 ? 'Final' : `${where}%`}</small>
                {lost?.has(mark.id) && (
                  <small
                    className="rd-am-lost"
                    title="El texto cambió y este fragmento ya no aparece: la cita es la que guardaste."
                  >
                    No está en el texto
                  </small>
                )}
                {isAi(mark) && (
                  <small className="rd-am-ai">
                    <Sparkles size={11} /> IA
                  </small>
                )}
                <div className="rd-am-actions">
                  <button
                    type="button"
                    title="Ver en el texto"
                    aria-label="Ver en el texto"
                    onClick={() => onJump(mark.start_offset)}
                  >
                    <CornerDownRight size={14} />
                  </button>
                  <button
                    type="button"
                    title="Editar"
                    aria-label="Editar el resaltado"
                    onClick={(e) => onEdit(mark, e.currentTarget.getBoundingClientRect())}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    title="Copiar"
                    aria-label="Copiar la cita y la nota"
                    onClick={() =>
                      copy(mark.note.trim() ? `«${quote}»\n\n${mark.note.trim()}` : quote)
                    }
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
              <blockquote>{quote}</blockquote>
              {mark.note.trim() && <MarkNote text={mark.note.trim()} />}
            </li>
          );
        })}
      </ol>
      {!shown.length && <p className="rd-am-none">Nada coincide con ese filtro.</p>}
    </section>
  );
}

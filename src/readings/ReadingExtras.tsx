import { useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import { Highlighter, Sparkles, StickyNote } from 'lucide-react';

type MarkGroup = {
  id: string;
  title: string;
  count: number;
  notes: number;
  ai: number;
  /** Última vez que anotaste en ese artículo. */
  last: string;
  /** La cita más reciente, como adelanto. */
  preview: string;
};

const PAGE = 1000;
const MAX_ROWS = 6000;

const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
};

/**
 * Anotaciones agrupadas por artículo: una fila por artículo con cuántas tiene, cuántas con nota
 * y de la IA, y la cita más reciente. Al tocarla se abren todas a la derecha.
 */
export function MarkGroups({
  query,
  current,
  revision,
  open,
}: {
  query: string;
  /** Artículo cuyas anotaciones están abiertas. */
  current: string;
  revision: number;
  open: (readingId: string) => void;
}) {
  const [groups, setGroups] = useState<MarkGroup[] | null>(null);
  const [err, fail] = useState('');

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      async () => {
        fail('');
        const rows: {
          reading_id: string;
          title: string;
          edited_at: string;
          quote: string | null;
          note: string;
        }[] = [];
        for (let from = 0; from < MAX_ROWS; from += PAGE) {
          let q = supabase
            .from('reading_annotations')
            .select('reading_id,title,edited_at,quote,note')
            .order('edited_at', { ascending: false })
            .order('id')
            .range(from, from + PAGE - 1);
          if (query.trim()) {
            const value = '"%' + query.trim().replace(/["\\]/g, '') + '%"';
            q = q.or(['title', 'quote', 'note'].map((k) => k + '.ilike.' + value).join(','));
          }
          const { data, error } = await q;
          if (!live) return;
          if (error) {
            fail(error.message);
            return;
          }
          rows.push(...data);
          if (data.length < PAGE) break;
        }
        // Ya vienen de la más reciente a la más antigua: el primer resaltado de cada artículo
        // es su adelanto y su fecha.
        const map = new Map<string, MarkGroup>();
        for (const r of rows) {
          const ai = r.note.startsWith('✦ ') || r.note.includes('\n\n✦ ') ? 1 : 0;
          const g = map.get(r.reading_id);
          if (g) {
            g.count++;
            if (r.note.trim()) g.notes++;
            g.ai += ai;
          } else
            map.set(r.reading_id, {
              id: r.reading_id,
              title: r.title,
              count: 1,
              notes: r.note.trim() ? 1 : 0,
              ai,
              last: r.edited_at,
              preview: (r.quote ?? '').replace(/\s+/g, ' ').trim(),
            });
        }
        setGroups([...map.values()]);
      },
      query ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, revision]);

  if (err) return <p role="alert">{err}</p>;
  if (!groups)
    return (
      <div className="rd-mg-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    );
  if (!groups.length)
    return (
      <p className="rd-mg-empty">
        {query.trim()
          ? 'Ninguna anotación coincide.'
          : 'Aún no tienes anotaciones. Resalta algo en un artículo.'}
      </p>
    );

  const total = groups.reduce((s, g) => s + g.count, 0);
  return (
    <div className="rd-mg">
      <small className="rd-mg-total">
        {total} {total === 1 ? 'anotación' : 'anotaciones'}
        {query.trim() ? ' coinciden' : ''} en {groups.length}{' '}
        {groups.length === 1 ? 'artículo' : 'artículos'}
      </small>
      {groups.map((g) => (
        <button
          type="button"
          key={g.id}
          className={'rd-mg-row' + (current === g.id ? ' current' : '')}
          aria-current={current === g.id || undefined}
          onClick={() => open(g.id)}
        >
          <span className="rd-mg-top">
            <strong>{g.title}</strong>
            <b className="rd-mg-count" title="Anotaciones">
              <Highlighter size={11} /> {g.count}
            </b>
          </span>
          {g.preview && <span className="rd-mg-preview">«{g.preview.slice(0, 140)}»</span>}
          <span className="rd-mg-meta">
            <span>{when(g.last)}</span>
            {g.notes > 0 && (
              <span>
                <StickyNote size={11} /> {g.notes}
              </span>
            )}
            {g.ai > 0 && (
              <span className="ai">
                <Sparkles size={11} /> {g.ai}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
export function useResume(
  id: string | undefined,
  offset: number,
  enabled: boolean,
  onError: (s: string) => void,
  /** Cada vez que se guarda dónde vas (para actualizar el progreso en la lista). */
  onSaved?: (offset: number) => void,
) {
  const saved = useRef(onSaved);
  saved.current = onSaved;
  useEffect(() => {
    if (!id || !enabled) return;
    const pane = document.querySelector<HTMLElement>('.readings>main'),
      article = pane?.querySelector('article');
    if (!pane || !article) return;
    let last = offset,
      timer = 0;
    function save() {
      clearTimeout(timer);
      if (last !== offset)
        void supabase
          .from('readings')
          .update({ resume_at: last, last_read: new Date().toISOString() })
          .eq('id', id!)
          .then(({ error }) => {
            if (error) onError(error.message);
            else saved.current?.(last);
          });
    }
    const nodes = Array.from(article.querySelectorAll<HTMLElement>('[data-offset]'));
    const top = () =>
      pane.getBoundingClientRect().top +
      (pane.querySelector('.read-tools')?.getBoundingClientRect().height || 0) +
      6;

    if (offset > 0) {
      const match = [...nodes].reverse().find((n) => Number(n.dataset.offset) <= offset);
      if (match) pane.scrollTop += match.getBoundingClientRect().top - top();
    }
    function scroll() {
      let lo = 0,
        hi = nodes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (nodes[mid].getBoundingClientRect().bottom <= top()) lo = mid + 1;
        else hi = mid;
      }
      last = pane!.scrollTop < 4 ? 0 : Number(nodes[lo]?.dataset.offset ?? last);
      clearTimeout(timer);
      timer = window.setTimeout(save, 750);
    }
    pane.addEventListener('scroll', scroll, { passive: true });
    return () => {
      pane.removeEventListener('scroll', scroll);
      if (timer) save();
    };
  }, [id, enabled]);
}

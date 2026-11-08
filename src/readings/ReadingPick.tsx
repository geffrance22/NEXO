import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Clock, Shuffle } from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { preview } from './media';

type Pick = {
  id: string;
  title: string;
  url: string;
  excerpt: string | null;
  cover: string | null;
  minutes: number | null;
  folder: string;
};

const COLUMNS = 'id,title,url,excerpt,cover,minutes,folder';
const STORAGE = 'nexo-reading-pick';

/** Un artículo al azar de Lecturas: primero entre los que siguen por leer; si no hay, de todos. */
async function randomReading(exclude?: string): Promise<Pick | null> {
  const count = async (unread: boolean) => {
    let q = supabase.from('reading_cards').select('id', { count: 'exact', head: true });
    if (unread) q = q.eq('archived', false);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const at = async (unread: boolean, from: number, to: number) => {
    let q = supabase.from('reading_cards').select(COLUMNS);
    if (unread) q = q.eq('archived', false);
    const { data, error } = await q.order('id').range(from, to);
    if (error) throw error;
    return (data ?? []) as Pick[];
  };

  let unread = true;
  let n = await count(true);
  if (!n) {
    unread = false;
    n = await count(false);
  }
  if (!n) return null;
  const k = Math.floor(Math.random() * n);
  // Se piden dos para poder saltar el que ya se estaba mostrando.
  const rows = await at(unread, k, k + 1);
  const pick = rows.find((r) => r.id !== exclude);
  if (pick) return pick;
  if (n > 1) return (await at(unread, 0, 1)).find((r) => r.id !== exclude) ?? null;
  return rows[0] ?? null;
}

const remembered = (): Pick | null => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null') as Pick | null;
  } catch {
    return null;
  }
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Recomendación de lectura para el inicio. Se mantiene durante la sesión; «Otra» elige otra al
 * azar. Al tocarla abre el artículo en Lecturas.
 */
export function ReadingPick() {
  const { go } = useApp();
  const [pick, setPick] = useState<Pick | null>(remembered);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>(
    pick ? 'idle' : 'loading',
  );
  const [coverOk, setCoverOk] = useState(true);

  const shuffle = useCallback(async (exclude?: string) => {
    setState('loading');
    try {
      const next = await randomReading(exclude);
      setPick(next);
      setCoverOk(true);
      setState(next ? 'idle' : 'empty');
      if (next) sessionStorage.setItem(STORAGE, JSON.stringify(next));
      else sessionStorage.removeItem(STORAGE);
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!remembered()) void shuffle();
  }, [shuffle]);

  // Sin la tabla de Lecturas (o sin conexión) la tarjeta no aparece.
  if (state === 'error' && !pick) return null;

  const summary = pick ? preview(pick.excerpt ?? '').slice(0, 150) : '';

  return (
    <section className="hc rp" aria-label="Lectura recomendada">
      <header className="hc-head">
        <h3>
          <BookOpen size={15} /> Para leer
        </h3>
        {pick && (
          <button
            type="button"
            className="hc-icon"
            aria-label="Otra recomendación"
            title="Otra"
            disabled={state === 'loading'}
            onClick={() => void shuffle(pick.id)}
          >
            <Shuffle size={14} className={state === 'loading' ? 'spin' : ''} />
          </button>
        )}
      </header>

      {state === 'empty' ? (
        <button type="button" className="rp-empty" onClick={() => go('Lecturas')}>
          Guarda artículos en Lecturas y aquí aparecerá uno para ti.
        </button>
      ) : !pick ? (
        <div className="rp-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <button type="button" className="rp-body" onClick={() => go('Lecturas', pick)}>
          {pick.cover && coverOk && (
            <img
              className="rp-cover"
              src={pick.cover}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setCoverOk(false)}
            />
          )}
          <strong>{pick.title}</strong>
          {summary && <p>{summary}</p>}
          <span className="rp-meta">
            <span>{host(pick.url)}</span>
            {pick.minutes ? (
              <span>
                <Clock size={11} /> {pick.minutes} min
              </span>
            ) : null}
            {pick.folder && <span>{pick.folder}</span>}
          </span>
          <span className="rp-go">
            Leer ahora <ArrowRight size={14} />
          </span>
        </button>
      )}
    </section>
  );
}

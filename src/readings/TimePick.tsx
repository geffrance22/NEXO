import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Shuffle } from 'lucide-react';
import { supabase } from '../backend';
import './timepick.css';

type Pick = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  minutes: number;
};

const COLUMNS = 'id,title,url,cover,minutes';
const TIMES = [5, 10, 15, 20, 30, 45, 60];
const STORE = 'nexo-reading-time';

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Por leer (sin archivar ni terminar) que caben en `max` minutos, de la más larga a la más corta. */
async function fitting(max: number) {
  const base = () =>
    supabase
      .from('reading_cards')
      .select(COLUMNS)
      .eq('archived', false)
      .gt('minutes', 0)
      .lte('minutes', max)
      .order('minutes', { ascending: false })
      .limit(80);
  let { data, error } = await base().is('read_at', null);
  // Sin la migración 012 no hay «terminado»: valen todas las no archivadas.
  if (error) ({ data, error } = await base());
  if (error) throw error;
  return (data ?? []) as Pick[];
}

/** La más corta de las que no caben (para decir cuánto tiempo haría falta). */
async function shortestOver(max: number) {
  const { data } = await supabase
    .from('reading_cards')
    .select(COLUMNS)
    .eq('archived', false)
    .gt('minutes', max)
    .order('minutes', { ascending: true })
    .limit(1);
  return ((data ?? [])[0] as Pick | undefined) ?? null;
}

/**
 * Dos al azar que aprovechen el tiempo: primero entre las que duran al menos la mitad de lo que
 * tienes y que aún no te sugirió.
 */
function choose(list: Pick[], max: number, seen: Set<string>) {
  const fresh = list.filter((r) => !seen.has(r.id));
  const pool0 = fresh.length >= 2 ? fresh : list;
  const near = pool0.filter((r) => r.minutes >= max * 0.5);
  const pool = [...(near.length >= 2 ? near : pool0)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 2).sort((a, b) => b.minutes - a.minutes);
}

const stored = () => {
  const n = Number(localStorage.getItem(STORE));
  return TIMES.includes(n) ? n : null;
};

/** «¿Cuánto tiempo tienes?»: eliges los minutos y te sugiere dos lecturas que caben. */
export function TimePick({ open }: { open: (id: string) => void }) {
  const [max, setMax] = useState<number | null>(stored);
  const [list, setList] = useState<Pick[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [over, setOver] = useState<Pick | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const seen = useRef(new Set<string>());
  const asked = useRef(0);

  const ask = useCallback(async (minutes: number) => {
    const n = ++asked.current;
    setMax(minutes);
    localStorage.setItem(STORE, String(minutes));
    setState('loading');
    seen.current = new Set();
    try {
      const rows = await fitting(minutes);
      const longer = rows.length < 2 ? await shortestOver(minutes) : null;
      if (n !== asked.current) return;
      const next = choose(rows, minutes, seen.current);
      next.forEach((p) => seen.current.add(p.id));
      setList(rows);
      setPicks(next);
      setOver(longer);
      setState('ready');
    } catch {
      if (n === asked.current) setState('error');
    }
  }, []);

  useEffect(() => {
    const m = stored();
    if (m) void ask(m);
  }, [ask]);

  const another = () => {
    if (!max) return;
    if (list.filter((r) => !seen.current.has(r.id)).length < 2) seen.current = new Set();
    const next = choose(list, max, seen.current);
    next.forEach((p) => seen.current.add(p.id));
    setPicks(next);
  };

  return (
    <section className="tp" aria-label="Sugerencias según tu tiempo">
      <p className="tp-q">
        <Clock size={14} /> ¿Cuánto tiempo tienes para leer?
      </p>
      <div className="tp-times" role="radiogroup" aria-label="Tiempo disponible">
        {TIMES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={max === t}
            className={'tp-time' + (max === t ? ' on' : '')}
            onClick={() => void ask(t)}
          >
            {t === 60 ? '1 h' : `${t} min`}
          </button>
        ))}
      </div>

      {state === 'loading' ? (
        <div className="tp-skel" aria-hidden="true">
          <i />
          <i />
        </div>
      ) : state === 'error' ? (
        <p className="tp-none">No se pudieron cargar las sugerencias.</p>
      ) : state === 'ready' && max ? (
        <>
          {picks.length > 0 && (
            <ul className="tp-list">
              {picks.map((p) => (
                <li key={p.id}>
                  <button type="button" className="tp-card" onClick={() => open(p.id)}>
                    {p.cover && (
                      <img
                        src={p.cover}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    )}
                    <span className="tp-text">
                      <strong>{p.title}</strong>
                      <small>
                        {host(p.url)} · {p.minutes} min
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picks.length < 2 && (
            <p className="tp-none">
              {picks.length
                ? `Solo esta cabe en ${max} min.`
                : `Nada de lo que tienes por leer cabe en ${max} min.`}
              {over && (
                <>
                  {' '}
                  La más corta que sigue dura {over.minutes} min:{' '}
                  <button type="button" className="tp-link" onClick={() => open(over.id)}>
                    {over.title}
                  </button>
                </>
              )}
            </p>
          )}
          {list.length > 2 && (
            <button type="button" className="tp-more" onClick={another}>
              <Shuffle size={13} /> Otras dos
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}

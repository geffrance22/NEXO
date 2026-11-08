import { useCallback, useEffect, useMemo, useState } from 'react';
import { Quote, Shuffle } from 'lucide-react';
import { useApp } from '../AppContext';
import { todayInputValue } from '../lib/format';
import { quotesOf, type BookQuote } from './Quotes';
import './quoteOfDay.css';

const STORAGE = 'nexo-quote-of-day';

/** La cita de hoy: el libro y el texto (su posición dentro del libro puede cambiar). */
type Saved = { day: string; book: string; text: string };

function readSaved(): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<Saved> | null;
    if (!raw?.day || !raw.book || !raw.text) return null;
    return { day: raw.day, book: raw.book, text: raw.text };
  } catch {
    return null;
  }
}

/** Entero al azar de 0 a n-1 con la misma probabilidad para todos (sin sesgo de módulo). */
function randomBelow(n: number) {
  if (n < 2) return 0;
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) return Math.floor(Math.random() * n);
  // Se descarta el sobrante al final del rango para que ningún número pese más que otro.
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  do {
    webCrypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

/** Una cita cualquiera entre todas (cada una con la misma probabilidad), distinta de `avoid`. */
function pickQuote(pool: BookQuote[], avoid?: BookQuote) {
  const rest = avoid && pool.length > 1 ? pool.filter((q) => q.key !== avoid.key) : pool;
  return rest.length ? rest[randomBelow(rest.length)] : null;
}

/**
 * Mi espacio: una cita de tus libros que dura todo el día. Se elige entre todas las que has
 * guardado, de todos los libros, y cada una tiene la misma probabilidad (no cuenta cuándo la
 * añadiste ni cuántas tenga su libro). Queda fija hasta mañana; el botón elige otra, también al
 * azar. Sin citas guardadas, el bloque no aparece.
 */
export function QuoteOfDayCard() {
  const { workspace, viewEntry } = useApp();
  const [day, setDay] = useState(() => todayInputValue());
  const [saved, setSaved] = useState(readSaved);
  const quotes = useMemo(() => quotesOf(workspace.entries), [workspace.entries]);

  // Si la página queda abierta de un día para otro, al volver a ella se renueva.
  useEffect(() => {
    const refresh = () => setDay(todayInputValue());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const current = useMemo(
    () =>
      saved && saved.day === day
        ? quotes.find((q) => q.book.id === saved.book && q.text === saved.text)
        : undefined,
    [saved, day, quotes],
  );

  const choose = useCallback(
    (avoid?: BookQuote) => {
      const next = pickQuote(quotes, avoid);
      if (!next) return;
      const value: Saved = { day, book: next.book.id, text: next.text };
      try {
        localStorage.setItem(STORAGE, JSON.stringify(value));
      } catch {
        // Sin almacenamiento, la cita dura mientras la página siga abierta.
      }
      setSaved(value);
    },
    [quotes, day],
  );

  // Primera vez del día, o la de hoy ya no existe (la borraste): se elige otra. Mientras las
  // citas no hayan cargado no se toca lo guardado.
  useEffect(() => {
    if (quotes.length && !current) choose();
  }, [quotes.length, current, choose]);

  if (!current) return null;
  const { book, text } = current;

  return (
    <section className="hc qd" aria-label="Cita del día" aria-live="polite">
      <header className="hc-head">
        <h3>
          <Quote size={15} /> Cita del día
        </h3>
        {quotes.length > 1 && (
          <button
            type="button"
            className="hc-icon"
            aria-label="Otra cita al azar"
            title="Otra al azar"
            onClick={() => choose(current)}
          >
            <Shuffle size={14} />
          </button>
        )}
      </header>
      <figure className="qd-fig" key={current.key}>
        <blockquote>{text}</blockquote>
        <figcaption>
          <button type="button" title="Abrir el libro" onClick={() => viewEntry(book)}>
            <strong>{book.title}</strong>
            {book.details.author && <small>{book.details.author}</small>}
          </button>
        </figcaption>
      </figure>
    </section>
  );
}

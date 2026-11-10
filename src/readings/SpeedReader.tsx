import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../backend';
import { preview } from './media';
import { ArrowLeft, RotateCcw, Clock3 } from 'lucide-react';

/** `brief`: resumen de dos o tres frases (para guardarlo con un aprendizaje). */
export async function readingAI(id: string, mode: 'summary' | 'quiz', brief = false) {
  const { data, error } = await supabase.functions.invoke('assistant', {
    body: {
      mode: 'reading-' + mode,
      articleId: id,
      ...(brief && { brief: true }),
    },
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw Error(detail?.error || 'No se pudo consultar el asistente.');
  }
  if (mode === 'summary' ? !data?.summary : !Array.isArray(data?.questions))
    throw Error('Actualiza la función assistant para usar la IA de Lecturas.');
  return data;
}
export function SpeedReader({ id, text, close }: { id: string; text: string; close: () => void }) {
  const words = useMemo(() => preview(text).split(/\s+/).filter(Boolean), [text]);
  const [pos, setPos] = useState(0),
    [playing, play] = useState(false),
    [speed, setSpeed] = useState(300),
    [size, setSize] = useState(52);
  const [quiz, setQuiz] = useState<{ question: string; answer: string }[]>([]),
    [loading, load] = useState(false),
    [error, fail] = useState('');
  useEffect(() => {
    if (!playing || pos >= words.length) return;
    const timer = setTimeout(() => setPos((p) => p + 1), 60000 / speed);
    return () => clearTimeout(timer);
  }, [playing, pos, speed, words.length]);
  const done = pos >= words.length;
  const seconds = Math.ceil(((words.length - pos) * 60) / speed);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (playing && !done) play(false);
        else close();
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [playing, done, close]);
  return (
    <section className="speed-view" aria-label="Lectura rápida">
      {(!playing || done) && (
        <header>
          <button onClick={close}>
            <ArrowLeft size={18} /> Volver
          </button>
          <button
            onClick={() => {
              setPos(0);
              play(false);
            }}
          >
            <RotateCcw size={15} /> Reiniciar
          </button>
          <small>
            <Clock3 size={14} /> {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}{' '}
            restantes
          </small>
        </header>
      )}
      <progress aria-label="Progreso de lectura" max={words.length || 1} value={pos} />
      {done ? (
        <div className="speed-end">
          <h2>Lectura completada</h2>
          <button
            disabled={loading}
            onClick={async () => {
              load(true);
              fail('');
              try {
                setQuiz((await readingAI(id, 'quiz')).questions);
              } catch (e) {
                fail(String(e));
              } finally {
                load(false);
              }
            }}
          >
            {loading ? 'Generando…' : 'Generar preguntas de comprensión'}
          </button>
          {error && <p role="alert">{error}</p>}
          {quiz.map((q, i) => (
            <details key={i}>
              <summary>{q.question}</summary>
              <p>{q.answer}</p>
            </details>
          ))}
        </div>
      ) : (
        <>
          <button
            className="speed-word"
            aria-label={playing ? 'Pausar lectura' : 'Iniciar lectura'}
            onClick={() => play(!playing)}
            style={{ fontSize: size }}
          >
            <span className="speed-context before" aria-hidden="true">
              {words[pos - 1]}
            </span>
            <strong>{words[pos]}</strong>
            <span className="speed-context after" aria-hidden="true">
              {words[pos + 1]}
            </span>
          </button>
          {!playing && (
            <footer>
              <label>
                Velocidad · {speed} ppm
                <input
                  type="range"
                  min="60"
                  max="1000"
                  step="10"
                  value={speed}
                  onChange={(e) => setSpeed(+e.target.value)}
                />
              </label>
              <label>
                Tamaño · {size} px
                <input
                  type="range"
                  min="22"
                  max="96"
                  value={size}
                  onChange={(e) => setSize(+e.target.value)}
                />
              </label>
              <small>Haz clic en la palabra para leer o pausar.</small>
            </footer>
          )}
        </>
      )}
    </section>
  );
}

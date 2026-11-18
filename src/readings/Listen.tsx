import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { useOnline } from '../hooks/useOnline';
import { useWakeLock } from '../hooks/useWakeLock';
import { clearNowPlaying, showNowPlaying, track } from './nowPlaying';
import {
  cachedCatalog,
  neuralCatalog,
  NeuralPlayer,
  type Catalog,
  type NeuralVoice,
} from './neuralVoice';

type Piece = { start: number; node: Text };
type Sentence = { start: number; end: number };

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'nexo-listen-rate';
const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const speech = () => (supported() ? window.speechSynthesis : null);
const canHighlight = () => typeof CSS !== 'undefined' && 'highlights' in CSS;
/** Prefijo de las voces neuronales en la elección guardada («n:azure:es-CO-SalomeNeural»). */
const NEURAL = 'n:';
const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
/** Más largo que esto, un tramo se parte en los espacios (la voz del sistema corta las largas). */
const LONG = 400;

/** ¿El texto está en inglés? (palabras muy comunes; si no, se lee en español). */
function looksEnglish(text: string) {
  const sample = ` ${text.slice(0, 3000).toLowerCase()} `;
  const count = (words: string[]) =>
    words.reduce((n, w) => n + (sample.split(` ${w} `).length - 1), 0);
  return (
    count(['the', 'and', 'of', 'to', 'is', 'that', 'with']) >
    count(['el', 'la', 'de', 'que', 'y', 'los', 'con']) * 1.2
  );
}

type Lang = 'es' | 'en';
const VOICE_KEY = (lang: Lang) => `nexo-listen-voice-${lang}`;
const savedFor = (lang: Lang) => {
  try {
    return localStorage.getItem(VOICE_KEY(lang)) ?? '';
  } catch {
    return '';
  }
};

// Las voces neuronales o «naturales» suenan mucho mejor; luego las de Google y las locales.
const score = (v: SpeechSynthesisVoice, lang: Lang) =>
  (/natural|neural|online/i.test(v.name) ? 4 : 0) +
  (/google/i.test(v.name) ? 2 : 0) +
  (v.localService ? 1 : 0) +
  (lang === 'es' && /es-(CO|MX|US|419)/i.test(v.lang) ? 1 : 0);

/** Voces instaladas para ese idioma, de la que mejor suena a la peor. */
function voicesFor(lang: Lang) {
  const synth = speech();
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(lang))
    .sort((a, b) => score(b, lang) - score(a, lang) || a.name.localeCompare(b.name));
}

const regions: Record<string, string> = {
  CO: 'Colombia',
  MX: 'México',
  ES: 'España',
  US: 'EE. UU.',
  AR: 'Argentina',
  CL: 'Chile',
  PE: 'Perú',
  VE: 'Venezuela',
  '419': 'Latinoamérica',
  GB: 'Reino Unido',
  AU: 'Australia',
  CA: 'Canadá',
  IN: 'India',
  IE: 'Irlanda',
};

/** «Microsoft Salome Online (Natural) - Spanish (Colombia)» → «Salome · Colombia ✦». */
function voiceLabel(v: SpeechSynthesisVoice) {
  const region = regions[v.lang.split(/[-_]/)[1]?.toUpperCase() ?? ''] ?? v.lang;
  const natural = /natural|neural|online/i.test(v.name);
  const name = v.name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .replace(/^(Microsoft|Apple|Google)\s+/i, '')
    .replace(/\b(Online|Natural|Neural|Desktop)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const short = /^(español|spanish|english|inglés)\b/i.test(name)
    ? /google/i.test(v.name)
      ? 'Google'
      : name
    : name;
  return `${short} · ${region}${natural ? ' ✦' : ''}`;
}

/** Frases del texto: hasta un punto, signo o salto de línea (las largas se parten). */
function sentencesOf(text: string) {
  const sentences: Sentence[] = [];
  const push = (at: number, part: string) => {
    const body = part.trimEnd();
    if (!body.trim()) return;
    if (body.length <= LONG) {
      sentences.push({ start: at, end: at + body.length });
      return;
    }
    let from = 0;
    while (from < body.length) {
      let to = Math.min(body.length, from + LONG);
      if (to < body.length) {
        const space = body.lastIndexOf(' ', to);
        if (space > from + 80) to = space;
      }
      if (body.slice(from, to).trim()) sentences.push({ start: at + from, end: at + to });
      from = to;
      while (body[from] === ' ') from++;
    }
  };
  for (const m of text.matchAll(/[^.!?…\n]+[.!?…]*["»”)]?\s*/g)) {
    const start = m.index ?? 0;
    const raw = m[0];
    if (!raw.trim() || !/[\p{L}\p{N}]/u.test(raw)) continue;
    if (raw.length <= 260) {
      push(start, raw);
      continue;
    }
    // Las muy largas, en las comas.
    let at = 0;
    for (const part of raw.split(/(?<=[,;:])\s+/)) {
      const i = raw.indexOf(part, at);
      push(start + i, part);
      at = i + part.length;
    }
  }
  return sentences;
}

type State = 'off' | 'playing' | 'paused';
type Engine = 'device' | 'neural';

/**
 * «Escuchar»: lee el artículo en voz alta, frase por frase, y resalta la frase (y, con la voz del
 * sistema, la palabra) que suena. Empieza donde estás leyendo; la página sigue a la voz.
 *
 * Dos clases de voz:
 * - Neuronal (si la función `tts` de Supabase tiene una clave): audio de verdad, sigue sonando con
 *   la pantalla apagada y se maneja desde la pantalla bloqueada y los auriculares.
 * - La del sistema (`speechSynthesis`): sin conexión ni configuración, pero en Android puede
 *   detenerse con la pantalla apagada (por eso, con ella, la pantalla se mantiene encendida).
 *
 * La velocidad y la voz elegidas se recuerdan en este navegador.
 */
export function Listen({
  article,
  pane,
  title = '',
  compact = false,
}: {
  article: RefObject<HTMLElement | null>;
  pane: () => HTMLElement | null;
  /** Título del artículo (para los controles de la pantalla bloqueada). */
  title?: string;
  /** Solo el ícono (la barra del celular). */
  compact?: boolean;
}) {
  const { notify } = useApp();
  const online = useOnline();
  const [state, setState] = useState<State>('off');
  const [engine, setEngine] = useState<Engine>('device');
  const [waiting, setWaiting] = useState(false);
  // Lo último, ya (los controles de fuera y el audio llaman entre renders).
  const stateRef = useRef<State>('off');
  const engineRef = useRef<Engine>('device');
  const put = (s: State) => {
    stateRef.current = s;
    setState(s);
  };
  const use = (e: Engine) => {
    engineRef.current = e;
    setEngine(e);
  };
  // Con la voz del sistema la pantalla no se apaga mientras suena. Con una neuronal puede
  // apagarse: el audio sigue.
  useWakeLock(state === 'playing' && engine === 'device');
  const [rate, setRate] = useState(() => {
    const r = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(r) ? r : 1;
  });
  const run = useRef({
    token: 0,
    index: 0,
    sentences: [] as Sentence[],
    pieces: [] as Piece[],
    text: '',
  });
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const [lang, setLang] = useState<Lang>('es');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Voz elegida: el identificador de una del sistema, «n:…» si es neuronal, o vacío (la recomendada).
  const [voiceId, setVoiceId] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(cachedCatalog);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const player = useRef<NeuralPlayer | null>(null);
  // Si lo detienes desde la pantalla bloqueada, al volver la página va a donde ibas.
  const stoppedAt = useRef(-1);

  const neuralFor = (l: Lang): NeuralVoice[] =>
    (catalogRef.current?.voices ?? []).filter((v) => v.lang === l || v.lang === 'any');

  /** Lo que suena en ese idioma: la elegida o, sin elegir, la neuronal recomendada (si hay). */
  function choiceFor(l: Lang) {
    const saved = l === lang ? voiceId : savedFor(l);
    const neural = neuralFor(l);
    if (saved.startsWith(NEURAL) && neural.some((v) => NEURAL + v.id === saved)) return saved;
    if (saved && !saved.startsWith(NEURAL) && voicesFor(l).some((v) => v.voiceURI === saved))
      return saved;
    return neural[0] ? NEURAL + neural[0].id : (voicesFor(l)[0]?.voiceURI ?? '');
  }
  /** La voz del sistema para ese idioma (la elegida o la que mejor suena). */
  function deviceVoice(l: Lang) {
    const list = voicesFor(l);
    const saved = savedFor(l);
    return list.find((v) => v.voiceURI === saved) ?? list[0] ?? null;
  }

  // Las voces neuronales disponibles (una vez; se vuelve a preguntar al recuperar la conexión).
  useEffect(() => {
    let live = true;
    if (online)
      void neuralCatalog().then((c) => {
        if (live) setCatalog(c);
      });
    return () => {
      live = false;
    };
  }, [online]);
  // Al salir del artículo se detiene y se suelta el audio.
  useEffect(
    () => () => {
      stop();
      player.current?.dispose();
    },
    [],
  );
  useEffect(() => localStorage.setItem(RATE_KEY, String(rate)), [rate]);
  // Las voces del sistema cargan tarde y pueden cambiar (p. ej. al instalar una nueva).
  useEffect(() => {
    const saved = savedFor(lang);
    const synth = speech();
    if (!synth) {
      setVoiceId(saved.startsWith(NEURAL) ? saved : '');
      return;
    }
    const refresh = () => {
      const list = voicesFor(lang);
      setVoices(list);
      setVoiceId(saved.startsWith(NEURAL) || list.some((v) => v.voiceURI === saved) ? saved : '');
    };
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, [lang]);

  // Controles fuera de la página (pantalla bloqueada, notificación, auriculares, teclas
  // multimedia): pausar y seguir, detener, y la frase siguiente o la anterior.
  const controls = useRef({ pause, resume, stop, skip });
  controls.current = { pause, resume, stop, skip };
  useEffect(() => {
    if (state === 'off') return;
    showNowPlaying(title, state, {
      play: () => controls.current.resume(),
      pause: () => controls.current.pause(),
      stop: () => controls.current.stop(),
      next: () => controls.current.skip(1),
      previous: () => controls.current.skip(-1),
    });
  }, [state, title]);

  // Lo que avisa el audio de la voz neuronal (llega entre renders: siempre a lo último).
  const events = useRef({
    sentence: (_i: number) => {},
    end: () => {},
    error: (_e: Error) => {},
    waiting: (_on: boolean) => {},
    external: (_kind: 'pause' | 'play') => {},
  });
  events.current = {
    sentence: (i) => {
      run.current.index = i;
      mark(i);
    },
    end: () => stop(),
    error: (e) => {
      if (engineRef.current !== 'neural' || stateRef.current === 'off') return;
      if (stateRef.current !== 'playing') return stop();
      notify(
        navigator.onLine
          ? `La voz neuronal no respondió (${e.message}). Sigo con la voz del celular.`
          : 'Sin conexión: sigo con la voz del celular.',
      );
      startDevice();
    },
    waiting: (on) => setWaiting(on),
    // Auriculares desconectados, una llamada, otra app con sonido…
    external: (kind) => {
      if (stateRef.current === 'off') return;
      put(kind === 'pause' ? 'paused' : 'playing');
    },
  };

  // Al volver a la página (p. ej. tras escuchar con la pantalla apagada), se ve donde va la voz.
  const latest = useRef({ mark, follow, rangeOf });
  latest.current = { mark, follow, rangeOf };
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const { mark, follow, rangeOf } = latest.current;
      if (stateRef.current !== 'off') mark(run.current.index);
      else if (stoppedAt.current >= 0) {
        const s = run.current.sentences[stoppedAt.current];
        stoppedAt.current = -1;
        if (s) follow(rangeOf(s.start, s.end));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!supported() && !catalog?.voices.length) return null;

  function clearMarks() {
    if (!canHighlight()) return;
    CSS.highlights.delete('rd-tts-sentence');
    CSS.highlights.delete('rd-tts-word');
  }
  function stop() {
    if (document.visibilityState === 'hidden' && stateRef.current !== 'off')
      stoppedAt.current = run.current.index;
    run.current.token++;
    speech()?.cancel();
    player.current?.stop();
    track.interrupted(null);
    clearMarks();
    clearNowPlaying();
    setWaiting(false);
    put('off');
  }

  /** Rango del DOM para un tramo del texto completo. */
  function rangeOf(a: number, b: number) {
    const { pieces } = run.current;
    const find = (i: number) => {
      let lo = 0;
      let hi = pieces.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pieces[mid].start <= i) lo = mid;
        else hi = mid - 1;
      }
      const p = pieces[lo];
      return { node: p.node, offset: Math.min(Math.max(0, i - p.start), p.node.length) };
    };
    const r = document.createRange();
    const s = find(a);
    const e = find(Math.max(a, b - 1));
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, Math.min(e.offset + 1, e.node.length));
    return r;
  }

  function follow(range: Range) {
    // Con la pantalla apagada no hace falta mover nada: se coloca al volver.
    if (document.visibilityState !== 'visible') return;
    const box = pane()?.getBoundingClientRect();
    const r = range.getBoundingClientRect();
    if (!box || !r.height) return;
    if (r.top < box.top + 80 || r.bottom > box.bottom - 100)
      (range.startContainer.parentElement ?? null)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
  }

  /** Resalta la frase que suena y lleva la página hasta ella. */
  function mark(i: number) {
    const s = run.current.sentences[i];
    if (!s || !run.current.pieces.length) return;
    const range = rangeOf(s.start, s.end);
    if (canHighlight()) {
      CSS.highlights.set('rd-tts-sentence', new Highlight(range));
      CSS.highlights.delete('rd-tts-word');
    }
    follow(range);
  }

  /** Voz del sistema: una frase y, al terminar, la siguiente. */
  function speak(token: number) {
    const cur = run.current;
    const synth = speech();
    if (token !== cur.token || !synth) return;
    const s = cur.sentences[cur.index];
    if (!s) return stop();
    const text = cur.text.slice(s.start, s.end);
    mark(cur.index);

    const u = new SpeechSynthesisUtterance(text);
    const textLang: Lang = looksEnglish(cur.text) ? 'en' : 'es';
    const voice = deviceVoice(textLang);
    u.lang = voice?.lang ?? (textLang === 'en' ? 'en-US' : 'es-ES');
    if (voice) u.voice = voice;
    u.rate = rateRef.current;
    u.onboundary = (e) => {
      if (token !== run.current.token || e.name !== 'word' || !canHighlight()) return;
      const a = s.start + e.charIndex;
      const len = e.charLength || (/^\S+/.exec(text.slice(e.charIndex))?.[0].length ?? 1);
      CSS.highlights.set('rd-tts-word', new Highlight(rangeOf(a, a + len)));
    };
    u.onend = () => {
      if (token !== run.current.token) return;
      run.current.index++;
      speak(token);
    };
    u.onerror = (e) => {
      if (token !== run.current.token || e.error === 'interrupted' || e.error === 'canceled')
        return;
      run.current.index++;
      speak(token);
    };
    synth.speak(u);
  }

  /** Con la voz del sistema, desde la frase actual. */
  function startDevice() {
    const synth = speech();
    player.current?.stop();
    if (!synth) {
      notify('Este navegador no tiene voces para leer en voz alta.');
      return stop();
    }
    synth.cancel();
    const token = run.current.token + 1;
    run.current.token = token;
    use('device');
    setWaiting(false);
    // Si el sistema pausa el audio de los controles (auriculares desconectados), se pausa la voz.
    track.interrupted(() => controls.current.pause());
    track.play();
    put('playing');
    // Las voces pueden cargar tarde la primera vez.
    if (!synth.getVoices().length) {
      synth.onvoiceschanged = () => {
        synth.onvoiceschanged = null;
        speak(token);
      };
      window.setTimeout(() => speak(token), 400);
    } else speak(token);
  }

  /** Con una voz neuronal (`id` de la función `tts`), desde la frase actual. */
  function startNeural(id: string) {
    const p = (player.current ??= new NeuralPlayer({
      sentence: (i) => events.current.sentence(i),
      end: () => events.current.end(),
      error: (e) => events.current.error(e),
      waiting: (on) => events.current.waiting(on),
      external: (kind) => events.current.external(kind),
    }));
    run.current.token++;
    speech()?.cancel();
    track.interrupted(null);
    track.stop();
    const cur = run.current;
    p.load(
      cur.sentences.map((s) => cur.text.slice(s.start, s.end)),
      id,
    );
    p.setRate(rateRef.current);
    // Dentro del toque: así el navegador deja sonar el audio (también en el iPhone).
    p.unlock();
    use('neural');
    put('playing');
    setWaiting(true);
    void p.play(cur.index);
  }

  function start() {
    const root = article.current;
    if (!root) return;
    // Texto completo y dónde vive cada trozo en la página.
    const pieces: Piece[] = [];
    let text = '';
    for (const el of root.querySelectorAll<HTMLElement>('[data-offset]')) {
      const node = el.firstChild;
      if (!(node instanceof Text) || !node.length) continue;
      pieces.push({ start: text.length, node });
      text += node.data;
    }
    if (!text.trim()) return;
    const sentences = sentencesOf(text);
    if (!sentences.length) return;
    // Empieza en la primera frase visible.
    const top = (pane()?.getBoundingClientRect().top ?? 0) + 60;
    const firstVisible = pieces.find(
      (p) => p.node.parentElement!.getBoundingClientRect().bottom > top,
    );
    const from = firstVisible?.start ?? 0;
    const index = Math.max(
      0,
      sentences.findIndex((s) => s.end > from),
    );
    speech()?.cancel();
    const token = run.current.token + 1;
    run.current = { token, index, sentences, pieces, text };
    stoppedAt.current = -1;
    const textLang: Lang = looksEnglish(text) ? 'en' : 'es';
    if (textLang !== lang) setLang(textLang);

    const pick = choiceFor(textLang);
    if (pick.startsWith(NEURAL) && navigator.onLine) return startNeural(pick.slice(NEURAL.length));
    if (pick.startsWith(NEURAL)) notify('Sin conexión: se lee con la voz del celular.');
    startDevice();
  }

  /**
   * Pausar. Con la voz del sistema corta la voz y recuerda la frase; seguir la repite desde su
   * inicio (en Android `speechSynthesis.pause()` corta la voz y `resume()` no la retoma).
   */
  function pause() {
    if (stateRef.current !== 'playing') return;
    if (engineRef.current === 'neural') player.current?.pause();
    else {
      run.current.token++;
      speech()?.cancel();
      if (canHighlight()) CSS.highlights.delete('rd-tts-word');
      track.pause();
    }
    put('paused');
  }
  function resume() {
    if (stateRef.current !== 'paused') return;
    if (engineRef.current === 'neural') {
      player.current?.resume();
      put('playing');
    } else restartSentence();
  }

  function toggle() {
    if (stateRef.current === 'off') return start();
    if (stateRef.current === 'playing') pause();
    else resume();
  }

  /** La frase siguiente (1) o la anterior (-1), desde los controles de fuera de la página. */
  function skip(delta: number) {
    if (stateRef.current === 'off') return;
    if (engineRef.current === 'neural') {
      player.current?.skip(delta);
      put('playing');
      return;
    }
    const cur = run.current;
    cur.index = Math.min(Math.max(0, cur.index + delta), Math.max(0, cur.sentences.length - 1));
    restartSentence();
  }

  /** Voz del sistema: repite la frase actual (así se escucha el cambio de velocidad o voz). */
  function restartSentence() {
    if (stateRef.current === 'off') return;
    const token = run.current.token + 1;
    run.current.token = token;
    speech()?.cancel();
    track.play();
    put('playing');
    window.setTimeout(() => speak(token), 60);
  }

  function changeRate(next: number) {
    setRate(next);
    rateRef.current = next;
    // El audio neuronal cambia de velocidad sin volver a pedirlo.
    if (engineRef.current === 'neural') player.current?.setRate(next);
    else restartSentence();
  }

  function changeVoice(id: string) {
    setVoiceId(id);
    localStorage.setItem(VOICE_KEY(lang), id);
    if (stateRef.current === 'off') return;
    if (id.startsWith(NEURAL)) {
      if (!navigator.onLine) {
        notify('Sin conexión: las voces neuronales necesitan internet.');
        return;
      }
      startNeural(id.slice(NEURAL.length));
    } else if (engineRef.current === 'neural') startDevice();
    else restartSentence();
  }

  if (state === 'off')
    return compact ? (
      <button
        type="button"
        className="rd-listen icon-only"
        title="Escuchar el artículo"
        aria-label="Escuchar el artículo"
        onClick={start}
      >
        <Headphones size={19} />
      </button>
    ) : (
      <button type="button" className="rd-listen" title="Escuchar el artículo" onClick={start}>
        <Headphones size={16} /> Escuchar
      </button>
    );

  const rateText = String(rate).replace('.', ',') + '×';
  const loading = waiting && engine === 'neural';

  // Barra compacta (más o menos del ancho de «Escuchar»): pausar, ajustes y detener.
  // La velocidad y la voz van en un desplegable aparte, así el encabezado no crece.
  return (
    <span className="rd-listen-bar" role="group" aria-label="Lectura en voz alta">
      <button
        type="button"
        className="rd-listen on icon"
        title={loading ? 'Preparando la voz…' : state === 'playing' ? 'Pausar' : 'Seguir'}
        aria-label={loading ? 'Preparando la voz' : state === 'playing' ? 'Pausar' : 'Seguir'}
        onClick={toggle}
      >
        {loading ? (
          <LoaderCircle size={15} className="spin" />
        ) : state === 'playing' ? (
          <Pause size={15} />
        ) : (
          <Play size={15} />
        )}
        {state === 'playing' && !loading && (
          <i className="rd-listen-eq" aria-hidden="true">
            <b />
            <b />
            <b />
          </i>
        )}
      </button>
      <ListenSettings
        rateText={rateText}
        rate={rate}
        voices={voices}
        neural={neuralFor(lang)}
        catalog={catalog}
        online={online}
        current={choiceFor(lang)}
        onRate={changeRate}
        onVoice={changeVoice}
      />
      <button
        type="button"
        className="rd-listen-stop"
        title="Detener"
        aria-label="Detener"
        onClick={stop}
      >
        <Square size={13} />
      </button>
    </span>
  );
}

/** Botón «1× ⚙» que despliega la velocidad y la voz (en un portal: no lo recorta el encabezado). */
function ListenSettings({
  rateText,
  rate,
  voices,
  neural,
  catalog,
  online,
  current,
  onRate,
  onVoice,
}: {
  rateText: string;
  rate: number;
  voices: SpeechSynthesisVoice[];
  neural: NeuralVoice[];
  catalog: Catalog | null;
  online: boolean;
  /** La voz que suena: «n:…» o el identificador de una del sistema. */
  current: string;
  onRate: (rate: number) => void;
  onVoice: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = trigger.current?.getBoundingClientRect();
      const w = panel.current?.offsetWidth ?? 280;
      if (!t) return;
      setPos({
        left: Math.min(Math.max(8, t.right - w), window.innerWidth - w - 8),
        top: t.bottom + 8,
      });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Sin voces neuronales: qué falta para tenerlas (solo si ya se sabe).
  const setup =
    !neural.length && catalog && !catalog.voices.length
      ? !catalog.deployed
        ? 'Voces neuronales (siguen sonando con la pantalla apagada): publica la función «tts» de Supabase y configura una clave de voz. La de Gemini es gratis y sin tarjeta.'
        : !catalog.configured
          ? 'Voces neuronales: configura GEMINI_API_KEY (gratis, sin tarjeta) o AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en los secretos de Supabase.'
          : ''
      : '';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={'rd-listen-set' + (open ? ' on' : '')}
        title="Velocidad y voz"
        aria-label={`Velocidad ${rateText} y voz`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <b>{rateText}</b>
        <SlidersHorizontal size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="rd-listen-pop"
            role="dialog"
            aria-label="Velocidad y voz"
            style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
          >
            <small>Velocidad</small>
            <div className="rd-lp-rates" role="radiogroup" aria-label="Velocidad">
              {RATES.map((r) => (
                <button
                  type="button"
                  role="radio"
                  key={r}
                  aria-checked={r === rate}
                  className={r === rate ? 'on' : ''}
                  onClick={() => onRate(r)}
                >
                  {String(r).replace('.', ',')}×
                </button>
              ))}
            </div>
            {(neural.length > 0 || voices.length > 0) && (
              <>
                <small>Voz</small>
                <div className="rd-lp-voices" role="radiogroup" aria-label="Voz">
                  {neural.length > 0 && (
                    <span className="rd-lp-group">
                      Neuronales · siguen con la pantalla apagada
                    </span>
                  )}
                  {neural.map((v, i) => {
                    const id = NEURAL + v.id;
                    const on = id === current;
                    return (
                      <button
                        type="button"
                        role="radio"
                        key={id}
                        aria-checked={on}
                        className={on ? 'on' : ''}
                        disabled={!online}
                        onClick={() => onVoice(id)}
                      >
                        <span>
                          {v.name} · {v.region} ✦
                        </span>
                        {!online ? <em>Sin conexión</em> : i === 0 && <em>Recomendada</em>}
                        {on && <Check size={14} />}
                      </button>
                    );
                  })}
                  {neural.length > 0 && voices.length > 0 && (
                    <span className="rd-lp-group">
                      Del celular{ANDROID ? ' · pueden detenerse con la pantalla apagada' : ''}
                    </span>
                  )}
                  {voices.map((v, i) => {
                    const on = v.voiceURI === current;
                    return (
                      <button
                        type="button"
                        role="radio"
                        key={v.voiceURI}
                        aria-checked={on}
                        className={on ? 'on' : ''}
                        onClick={() => onVoice(v.voiceURI)}
                      >
                        <span>{voiceLabel(v)}</span>
                        {i === 0 && !neural.length && <em>Recomendada</em>}
                        {on && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
                {voices.length === 1 && !neural.length && (
                  <p className="rd-lp-hint">
                    Solo hay una voz instalada para este idioma. Microsoft Edge trae varias voces
                    naturales.
                  </p>
                )}
              </>
            )}
            {setup && <p className="rd-lp-hint">{setup}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}

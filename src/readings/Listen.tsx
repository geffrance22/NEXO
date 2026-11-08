import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Headphones, Pause, Play, SlidersHorizontal, Square } from 'lucide-react';

type Piece = { start: number; node: Text };
type Sentence = { start: number; end: number };

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'nexo-listen-rate';
const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const canHighlight = () => typeof CSS !== 'undefined' && 'highlights' in CSS;

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

// Las voces neuronales o «naturales» suenan mucho mejor; luego las de Google y las locales.
const score = (v: SpeechSynthesisVoice, lang: Lang) =>
  (/natural|neural|online/i.test(v.name) ? 4 : 0) +
  (/google/i.test(v.name) ? 2 : 0) +
  (v.localService ? 1 : 0) +
  (lang === 'es' && /es-(CO|MX|US|419)/i.test(v.lang) ? 1 : 0);

/** Voces instaladas para ese idioma, de la que mejor suena a la peor. */
function voicesFor(lang: Lang) {
  return window.speechSynthesis
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

/**
 * «Escuchar»: lee el artículo en voz alta, frase por frase, y resalta la frase y la palabra que
 * suenan. Empieza donde estás leyendo; la página sigue a la voz.
 */
export function Listen({
  article,
  pane,
}: {
  article: RefObject<HTMLElement | null>;
  pane: () => HTMLElement | null;
}) {
  const [state, setState] = useState<'off' | 'playing' | 'paused'>('off');
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
  // Voz elegida (su identificador); vacío = la que mejor suene.
  const [voiceId, setVoiceId] = useState('');
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  voiceRef.current = voices.find((v) => v.voiceURI === voiceId) ?? voices[0] ?? null;

  // Al salir del artículo se detiene.
  useEffect(() => () => stop(), []);
  useEffect(() => localStorage.setItem(RATE_KEY, String(rate)), [rate]);
  // Las voces del sistema cargan tarde y pueden cambiar (p. ej. al instalar una nueva).
  useEffect(() => {
    if (!supported()) return;
    const refresh = () => {
      const list = voicesFor(lang);
      setVoices(list);
      const saved = localStorage.getItem(VOICE_KEY(lang)) ?? '';
      setVoiceId(list.some((v) => v.voiceURI === saved) ? saved : '');
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, [lang]);

  if (!supported()) return null;

  function clearMarks() {
    if (!canHighlight()) return;
    CSS.highlights.delete('rd-tts-sentence');
    CSS.highlights.delete('rd-tts-word');
  }
  function stop() {
    run.current.token++;
    window.speechSynthesis.cancel();
    clearMarks();
    setState('off');
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
    const box = pane()?.getBoundingClientRect();
    const r = range.getBoundingClientRect();
    if (!box || !r.height) return;
    if (r.top < box.top + 80 || r.bottom > box.bottom - 100)
      (range.startContainer.parentElement ?? null)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
  }

  function speak(token: number) {
    const cur = run.current;
    if (token !== cur.token) return;
    const s = cur.sentences[cur.index];
    if (!s) return stop();
    const text = cur.text.slice(s.start, s.end);
    const range = rangeOf(s.start, s.end);
    if (canHighlight()) {
      CSS.highlights.set('rd-tts-sentence', new Highlight(range));
      CSS.highlights.delete('rd-tts-word');
    }
    follow(range);

    const u = new SpeechSynthesisUtterance(text);
    const textLang: Lang = looksEnglish(cur.text) ? 'en' : 'es';
    const voice =
      voiceRef.current && voiceRef.current.lang.toLowerCase().startsWith(textLang)
        ? voiceRef.current
        : (voicesFor(textLang)[0] ?? null);
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
    window.speechSynthesis.speak(u);
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
    // Frases: hasta un punto, signo o salto de línea (las muy largas se parten en comas).
    const sentences: Sentence[] = [];
    for (const m of text.matchAll(/[^.!?…\n]+[.!?…]*["»”)]?\s*/g)) {
      const start = m.index ?? 0;
      const raw = m[0];
      if (!raw.trim() || !/[\p{L}\p{N}]/u.test(raw)) continue;
      if (raw.length <= 260) sentences.push({ start, end: start + raw.trimEnd().length });
      else {
        let at = 0;
        for (const part of raw.split(/(?<=[,;:])\s+/)) {
          const i = raw.indexOf(part, at);
          if (part.trim())
            sentences.push({ start: start + i, end: start + i + part.trimEnd().length });
          at = i + part.length;
        }
      }
    }
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

    window.speechSynthesis.cancel();
    const token = run.current.token + 1;
    run.current = { token, index, sentences, pieces, text };
    const textLang: Lang = looksEnglish(text) ? 'en' : 'es';
    if (textLang !== lang) {
      // Las voces del otro idioma: se elige ya la guardada para no esperar al render.
      const list = voicesFor(textLang);
      const saved = localStorage.getItem(VOICE_KEY(textLang)) ?? '';
      voiceRef.current = list.find((v) => v.voiceURI === saved) ?? list[0] ?? null;
      setLang(textLang);
    }
    setState('playing');
    // Las voces pueden cargar tarde la primera vez.
    if (!window.speechSynthesis.getVoices().length) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        speak(token);
      };
      window.setTimeout(() => speak(token), 400);
    } else speak(token);
  }

  function toggle() {
    if (state === 'off') return start();
    if (state === 'playing') {
      window.speechSynthesis.pause();
      setState('paused');
    } else {
      window.speechSynthesis.resume();
      setState('playing');
    }
  }

  /** Repite la frase actual con la nueva velocidad o voz (así se escucha el cambio). */
  function restartSentence() {
    if (state === 'off') return;
    const token = run.current.token + 1;
    run.current.token = token;
    window.speechSynthesis.cancel();
    setState('playing');
    window.setTimeout(() => speak(token), 60);
  }

  function changeRate(next: number) {
    setRate(next);
    rateRef.current = next;
    restartSentence();
  }

  function changeVoice(id: string) {
    setVoiceId(id);
    localStorage.setItem(VOICE_KEY(lang), id);
    voiceRef.current = voices.find((v) => v.voiceURI === id) ?? voices[0] ?? null;
    restartSentence();
  }

  if (state === 'off')
    return (
      <button type="button" className="rd-listen" title="Escuchar el artículo" onClick={start}>
        <Headphones size={16} /> Escuchar
      </button>
    );

  const current = voiceRef.current;
  const rateText = String(rate).replace('.', ',') + '×';

  // Barra compacta (más o menos del ancho de «Escuchar»): pausar, ajustes y detener.
  // La velocidad y la voz van en un desplegable aparte, así el encabezado no crece.
  return (
    <span className="rd-listen-bar" role="group" aria-label="Lectura en voz alta">
      <button
        type="button"
        className="rd-listen on icon"
        title={state === 'playing' ? 'Pausar' : 'Seguir'}
        aria-label={state === 'playing' ? 'Pausar' : 'Seguir'}
        onClick={toggle}
      >
        {state === 'playing' ? <Pause size={15} /> : <Play size={15} />}
        {state === 'playing' && (
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
        current={current}
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
  current,
  onRate,
  onVoice,
}: {
  rateText: string;
  rate: number;
  voices: SpeechSynthesisVoice[];
  current: SpeechSynthesisVoice | null;
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
            {voices.length > 0 && (
              <>
                <small>Voz</small>
                <div className="rd-lp-voices" role="radiogroup" aria-label="Voz">
                  {voices.map((v, i) => {
                    const on = v.voiceURI === current?.voiceURI;
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
                        {i === 0 && <em>Recomendada</em>}
                        {on && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
                {voices.length === 1 && (
                  <p className="rd-lp-hint">
                    Solo hay una voz instalada para este idioma. Microsoft Edge trae varias voces
                    naturales.
                  </p>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

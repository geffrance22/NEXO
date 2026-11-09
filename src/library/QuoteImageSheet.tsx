import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Copy, Download, ImageDown, LoaderCircle, Share2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { entryImages } from '../lib/moviePosters';
import type { BookQuote } from './Quotes';
import {
  addQuoteFontSheet,
  canvasBlob,
  drawQuote,
  loadCover,
  loadQuoteFont,
  quoteFileName,
  quoteFontsReady,
  quoteFonts,
  quoteFormats,
  quoteThemes,
} from './quoteImage';
import './quoteImage.css';

const PREFS_KEY = 'nexo-quote-image';

function loadPrefs(): { theme?: string; format?: string; cover?: boolean; font?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** ¿El navegador puede compartir archivos (móvil, Safari, Edge…)? */
function canShareFiles() {
  try {
    const probe = new File([''], 'x.png', { type: 'image/png' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Convierte una cita en imagen: eliges el estilo y el formato (cuadrado, vertical o historia), la
 * ves al momento y la descargas, la copias o la compartes.
 */
export function QuoteImageSheet({ quote, onClose }: { quote: BookQuote; onClose: () => void }) {
  const { notify } = useApp();
  const prefs = useMemo(loadPrefs, []);
  const [themeId, setThemeId] = useState(prefs.theme ?? quoteThemes[0].id);
  const [formatId, setFormatId] = useState(prefs.format ?? quoteFormats[0].id);
  const [withCover, setWithCover] = useState(prefs.cover ?? true);
  const [fontId, setFontId] = useState(prefs.font ?? quoteFonts[0].id);
  // La fuente que ya se puede dibujar (mientras carga la nueva, se ve la anterior).
  const [drawFont, setDrawFont] = useState<string | null>(null);
  const [cover, setCover] = useState<HTMLImageElement | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const share = useMemo(canShareFiles, []);
  const theme = quoteThemes.find((t) => t.id === themeId) ?? quoteThemes[0];
  const format = quoteFormats.find((f) => f.id === formatId) ?? quoteFormats[0];
  const font = quoteFonts.find((f) => f.id === drawFont) ?? quoteFonts[0];

  // Portada y fuentes, una vez.
  useEffect(() => {
    let live = true;
    addQuoteFontSheet();
    const img = entryImages(quote.book)[0];
    void Promise.all([loadCover(img?.medium ?? img?.url), quoteFontsReady()]).then(([c]) => {
      if (live) setCover(c);
    });
    return () => {
      live = false;
    };
  }, [quote.book]);

  // La fuente elegida: se dibuja cuando ya cargó.
  useEffect(() => {
    let live = true;
    const f = quoteFonts.find((x) => x.id === fontId) ?? quoteFonts[0];
    void loadQuoteFont(f).then(() => {
      if (live) setDrawFont(f.id);
    });
    return () => {
      live = false;
    };
  }, [fontId]);

  useEffect(() => {
    if (cover === undefined || drawFont === null || !canvas.current) return;
    drawQuote(canvas.current, {
      text: quote.text,
      title: quote.book.title,
      author: quote.book.details.author,
      cover: withCover ? cover : null,
      theme,
      format,
      font,
    });
    setReady(true);
  }, [cover, withCover, theme, format, font, drawFont, quote]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ theme: themeId, format: formatId, cover: withCover, font: fontId }),
      );
    } catch {
      /* Sin almacenamiento: se usan los de siempre. */
    }
  }, [themeId, formatId, withCover, fontId]);

  const name = quoteFileName(quote.book.title);

  async function download() {
    if (!canvas.current) return;
    const url = URL.createObjectURL(await canvasBlob(canvas.current));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify('Imagen descargada.');
  }

  async function copy() {
    if (!canvas.current) return;
    try {
      // La promesa va directa al ClipboardItem (Safari lo exige dentro del clic).
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': canvasBlob(canvas.current) }),
      ]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('Este navegador no deja copiar imágenes. Descárgala.');
    }
  }

  async function shareIt() {
    if (!canvas.current || busy) return;
    setBusy(true);
    try {
      const file = new File([await canvasBlob(canvas.current)], name, {
        type: 'image/png',
      });
      await navigator.share({ files: [file], title: quote.book.title });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') notify('No se pudo compartir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label="Cita como imagen" size="lg" className="qi" onRequestClose={onClose}>
      <header className="qi-head">
        <h2>
          <ImageDown size={17} /> Cita como imagen
        </h2>
        <button type="button" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="qi-body">
        <div className="qi-stage">
          <div className="qi-fit">
            <div
              className="qi-frame"
              style={{ '--ar': format.w / format.h } as CSSProperties}
            >
              <canvas
                ref={canvas}
                className={ready ? 'on' : ''}
                role="img"
                aria-label={`«${quote.text}» — ${quote.book.title}`}
              />
            </div>
          </div>
          {!ready && (
            <span className="qi-wait">
              <LoaderCircle size={20} />
            </span>
          )}
        </div>

        <div className="qi-side">
          <div className="qi-group">
            <span className="qi-label">Estilo</span>
            <div className="qi-themes" role="radiogroup" aria-label="Estilo">
              {quoteThemes.map((t) => (
                <button
                  type="button"
                  role="radio"
                  key={t.id}
                  aria-checked={t.id === themeId}
                  aria-label={t.label}
                  title={t.label}
                  className={t.id === themeId ? 'on' : ''}
                  style={{
                    background: `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})`,
                    color: t.accent,
                  }}
                  onClick={() => setThemeId(t.id)}
                >
                  <span>“</span>
                </button>
              ))}
            </div>
          </div>

          <div className="qi-group">
            <span className="qi-label">Fuente</span>
            <div className="qi-fonts" role="radiogroup" aria-label="Fuente">
              {quoteFonts.map((f) => (
                <button
                  type="button"
                  role="radio"
                  key={f.id}
                  aria-checked={f.id === fontId}
                  className={f.id === fontId ? 'on' : ''}
                  onClick={() => setFontId(f.id)}
                >
                  <span
                    style={{ fontFamily: f.family, fontStyle: f.style, fontWeight: f.weight }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  <small>{f.label}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="qi-group">
            <span className="qi-label">Formato</span>
            <div className="qi-formats" role="radiogroup" aria-label="Formato">
              {quoteFormats.map((f) => (
                <button
                  type="button"
                  role="radio"
                  key={f.id}
                  aria-checked={f.id === formatId}
                  className={f.id === formatId ? 'on' : ''}
                  title={`${f.label} · ${f.hint}`}
                  onClick={() => setFormatId(f.id)}
                >
                  <i className={'qi-ratio ' + f.id} aria-hidden="true" />
                  <span>{f.label}</span>
                  <small>{f.hint}</small>
                </button>
              ))}
            </div>
          </div>

          {cover && (
            <label className="qi-switch">
              <input
                type="checkbox"
                checked={withCover}
                onChange={(e) => setWithCover(e.target.checked)}
              />
              <span aria-hidden="true" />
              Mostrar la portada
            </label>
          )}

          <div className="qi-actions">
            <button
              type="button"
              className="lt-add"
              disabled={!ready}
              onClick={() => void download()}
            >
              <Download size={15} /> Descargar
            </button>
            <div className="qi-actions-row">
              {typeof ClipboardItem !== 'undefined' && (
                <button
                  type="button"
                  className="lt-add soft"
                  disabled={!ready}
                  onClick={() => void copy()}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copiada' : 'Copiar'}
                </button>
              )}
              {share && (
                <button
                  type="button"
                  className="lt-add soft"
                  disabled={!ready || busy}
                  onClick={() => void shareIt()}
                >
                  <Share2 size={15} /> Compartir
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

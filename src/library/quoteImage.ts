/** Una cita convertida en imagen para compartir: fondo, frase, libro y portada (si se puede). */

export type QuoteTheme = {
  id: string;
  label: string;
  bg: [string, string];
  ink: string;
  accent: string;
  muted: string;
  /** Brillo suave en una esquina. */
  glow: string;
};

export type QuoteFormat = {
  id: string;
  label: string;
  hint: string;
  w: number;
  h: number;
};

export const quoteThemes: QuoteTheme[] = [
  {
    id: 'papel',
    label: 'Papel',
    bg: ['#f8f1e6', '#ecdfcb'],
    ink: '#3a2c1f',
    accent: '#a07a52',
    muted: '#8a7663',
    glow: 'rgba(255,255,255,0.55)',
  },
  {
    id: 'salvia',
    label: 'Salvia',
    bg: ['#eaf0e2', '#d3dfc4'],
    ink: '#26331f',
    accent: '#5f8247',
    muted: '#66745a',
    glow: 'rgba(255,255,255,0.5)',
  },
  {
    id: 'arcilla',
    label: 'Arcilla',
    bg: ['#f5e1d6', '#e6c0ac'],
    ink: '#45261b',
    accent: '#b0603f',
    muted: '#87604f',
    glow: 'rgba(255,255,255,0.45)',
  },
  {
    id: 'noche',
    label: 'Noche',
    bg: ['#232b26', '#111612'],
    ink: '#f2ede3',
    accent: '#d8b88c',
    muted: '#a3ab9f',
    glow: 'rgba(216,184,140,0.14)',
  },
  {
    id: 'tinta',
    label: 'Tinta',
    bg: ['#243152', '#121a2e'],
    ink: '#eef1f8',
    accent: '#a9bdf0',
    muted: '#9ca8c4',
    glow: 'rgba(169,189,240,0.16)',
  },
];

export const quoteFormats: QuoteFormat[] = [
  { id: 'cuadrado', label: 'Cuadrado', hint: '1:1', w: 1080, h: 1080 },
  { id: 'vertical', label: 'Vertical', hint: '4:5', w: 1080, h: 1350 },
  { id: 'historia', label: 'Historia', hint: '9:16', w: 1080, h: 1920 },
];

export type QuoteFont = {
  id: string;
  label: string;
  /** Familia CSS (con respaldo del sistema). */
  family: string;
  style: 'italic' | 'normal';
  weight: number;
  /** Ajuste de tamaño: hay letras que se ven más grandes o más pequeñas al mismo cuerpo. */
  scale: number;
  /** Interlineado. */
  lead: number;
};

export const quoteFonts: QuoteFont[] = [
  {
    id: 'clasica',
    label: 'Clásica',
    family: 'Georgia, "Times New Roman", serif',
    style: 'italic',
    weight: 400,
    scale: 1,
    lead: 1.42,
  },
  {
    id: 'elegante',
    label: 'Elegante',
    family: '"Playfair Display", Georgia, serif',
    style: 'italic',
    weight: 400,
    scale: 1,
    lead: 1.38,
  },
  {
    id: 'libro',
    label: 'Libro',
    family: 'Lora, Georgia, serif',
    style: 'normal',
    weight: 400,
    scale: 0.96,
    lead: 1.48,
  },
  {
    id: 'moderna',
    label: 'Moderna',
    family: '"Manrope", "DM Sans", sans-serif',
    style: 'normal',
    weight: 600,
    scale: 0.9,
    lead: 1.4,
  },
  {
    id: 'maquina',
    label: 'Máquina',
    family: '"Courier Prime", "Courier New", monospace',
    style: 'normal',
    weight: 400,
    scale: 0.86,
    lead: 1.5,
  },
  {
    id: 'mano',
    label: 'A mano',
    family: 'Caveat, "Segoe Print", cursive',
    style: 'normal',
    weight: 500,
    scale: 1.22,
    lead: 1.25,
  },
];

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Courier+Prime&family=Lora&family=Playfair+Display:ital@1&display=swap';

/** Trae las fuentes extra de las citas (una sola vez, al abrir la ventana). */
export function addQuoteFontSheet() {
  if (typeof document === 'undefined' || document.getElementById('nexo-quote-fonts')) return;
  const link = document.createElement('link');
  link.id = 'nexo-quote-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  document.head.append(link);
}

const fontSpec = (f: QuoteFont, size: number) => `${f.style} ${f.weight} ${size}px ${f.family}`;

/** Espera a que la fuente esté lista para dibujar (si no llega en 4 s, se usa la de respaldo). */
export async function loadQuoteFont(f: QuoteFont) {
  try {
    await Promise.race([
      document.fonts.load(fontSpec(f, 40), 'Aa'),
      new Promise((r) => window.setTimeout(r, 4000)),
    ]);
  } catch {
    /* Sin fuentes web: se usa la de respaldo. */
  }
}

export type QuoteArt = {
  text: string;
  title: string;
  author?: string;
  cover: HTMLImageElement | null;
  theme: QuoteTheme;
  format: QuoteFormat;
  font?: QuoteFont;
};

const SERIF = 'Georgia, "Times New Roman", serif';

/** Carga una portada que se pueda dibujar (sin CORS no sirve: se devuelve null). */
export function loadCover(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img.naturalWidth ? img : null);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/** Espera a las fuentes de la app (si no cargan, se dibuja con las del sistema). */
export async function quoteFontsReady() {
  try {
    await Promise.all([
      document.fonts.load('750 40px "Manrope"'),
      document.fonts.load('500 30px "DM Sans"'),
    ]);
  } catch {
    /* Sin fuentes web: se usan las de respaldo. */
  }
}

/** Parte el texto en líneas que caben en `max` (respeta los saltos de línea). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const raw of para.split(/\s+/).filter(Boolean)) {
      let word = raw;
      // Palabras más largas que la línea: se cortan.
      while (ctx.measureText(word).width > max) {
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut) + '-').width > max) cut--;
        if (line) lines.push(line);
        lines.push(word.slice(0, cut) + '-');
        line = '';
        word = word.slice(cut);
      }
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= max) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Recorta con «…» para que quepa en `max`. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Dibuja la cita en el lienzo, al tamaño del formato elegido. */
export function drawQuote(canvas: HTMLCanvasElement, art: QuoteArt) {
  const { w, h } = art.format;
  const { theme } = art;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  // Fondo: degradado, un brillo en la esquina y un borde interior muy sutil.
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.12, h * 0.06, 0, w * 0.12, h * 0.06, w * 0.95);
  glow.addColorStop(0, theme.glow);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const pad = Math.round(w * 0.1);
  const inner = w - pad * 2;

  // Comillas grandes.
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.85;
  ctx.font = `700 ${Math.round(w * 0.2)}px ${SERIF}`;
  ctx.fillText('“', pad - w * 0.012, pad + w * 0.115);
  ctx.globalAlpha = 1;

  // Pie: portada, título y autor.
  const coverH = art.cover ? Math.round(w * 0.15) : 0;
  const coverW = Math.round(coverH * 0.66);
  const titleSize = Math.round(w * 0.034);
  const authorSize = Math.round(w * 0.027);
  const textBlock = titleSize * 1.25 + (art.author ? authorSize * 1.6 : 0);
  const footH = Math.max(coverH, textBlock);
  const footTop = h - pad - footH;

  // La frase: el tamaño más grande que quepa entre las comillas y el pie.
  const top = pad + w * 0.16;
  const bottom = footTop - w * 0.09;
  const room = bottom - top;
  const text = art.text.trim();
  const font = art.font ?? quoteFonts[0];
  const lead = font.lead;
  let size = Math.round(w * 0.074 * font.scale);
  const min = Math.round(w * 0.03 * font.scale);
  let lines: string[] = [];
  for (; size >= min; size -= 2) {
    ctx.font = fontSpec(font, size);
    lines = wrap(ctx, text, inner);
    if (lines.length * size * lead <= room) break;
  }
  size = Math.max(size, min);
  ctx.font = fontSpec(font, size);
  const fit = Math.max(1, Math.floor(room / (size * lead)));
  if (lines.length > fit) {
    lines = lines.slice(0, fit);
    lines[fit - 1] = ellipsize(ctx, lines[fit - 1] + '…', inner);
  }
  const blockH = lines.length * size * lead;
  // Centrada en su espacio, un poco hacia arriba.
  let y = top + Math.max(0, (room - blockH) * 0.42) + size;
  ctx.fillStyle = theme.ink;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += size * lead;
  }

  // Raya de acento sobre el pie.
  ctx.fillStyle = theme.accent;
  roundRect(ctx, pad, footTop - w * 0.045, w * 0.07, Math.max(4, w * 0.005), 3);
  ctx.fill();

  let tx = pad;
  if (art.cover) {
    const cy = footTop + (footH - coverH) / 2;
    const img = art.cover;
    const ratio = coverW / coverH;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // Como object-fit: cover.
    const [sw, sh] = iw / ih > ratio ? [ih * ratio, ih] : [iw, iw / ratio];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = w * 0.025;
    ctx.shadowOffsetY = w * 0.008;
    roundRect(ctx, pad, cy, coverW, coverH, w * 0.008);
    ctx.fillStyle = theme.bg[1];
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, pad, cy, coverW, coverH, w * 0.008);
    ctx.clip();
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, pad, cy, coverW, coverH);
    ctx.restore();
    tx = pad + coverW + Math.round(w * 0.032);
  }
  const maxText = w - pad - tx;
  let ty = footTop + (footH - textBlock) / 2 + titleSize;
  ctx.fillStyle = theme.ink;
  ctx.font = `750 ${titleSize}px "Manrope", "DM Sans", sans-serif`;
  ctx.fillText(ellipsize(ctx, art.title, maxText), tx, ty);
  if (art.author) {
    ty += authorSize * 1.6;
    ctx.fillStyle = theme.muted;
    ctx.font = `500 ${authorSize}px "DM Sans", sans-serif`;
    ctx.fillText(ellipsize(ctx, art.author, maxText), tx, ty);
  }
}

/** PNG del lienzo. */
export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error('No se pudo crear la imagen.'))),
      'image/png',
    ),
  );

/** Nombre de archivo a partir del libro: «cita-cien-anos-de-soledad.png». */
export const quoteFileName = (title: string) =>
  'cita-' +
  (title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'nexo') +
  '.png';

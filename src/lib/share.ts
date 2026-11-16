/**
 * Lo que llega a Nexo desde fuera: «Compartir» del celular (`share_target` del manifiesto, que abre
 * `./?title=…&text=…&url=…`) o los accesos directos del ícono (`./?nuevo=instante`,
 * `./?nuevo=movimiento`, `./?nuevo=persona`).
 *
 * Se lee al cargar la app y se guarda en la sesión de la pestaña, así sobrevive a iniciar sesión.
 * La URL se limpia enseguida (recargar no vuelve a compartir lo mismo).
 */
export type Incoming =
  /** Uno o varios enlaces: van a Lecturas («Guardar enlaces»). */
  | { kind: 'link'; text: string }
  /** Solo texto: abre un instante nuevo con lo compartido. */
  | { kind: 'text'; text: string }
  /** Instante en blanco (acceso directo del ícono). */
  | { kind: 'instant' }
  /** Registrar un movimiento (acceso directo del ícono). */
  | { kind: 'movement' }
  /** Agregar una persona (acceso directo del ícono). */
  | { kind: 'person' };

/** `?nuevo=…` de cada acceso directo del ícono (ver public/manifest.webmanifest). */
const SHORTCUTS: Record<string, Incoming> = {
  instante: { kind: 'instant' },
  movimiento: { kind: 'movement' },
  persona: { kind: 'person' },
};

const KEY = 'nexo-incoming';
const PARAMS = ['title', 'text', 'url', 'nuevo'];
const HAS_LINK = /(?:https?:\/\/|www\.)\S/i;

function read(): Incoming | null {
  const params = new URLSearchParams(window.location.search);
  if (!PARAMS.some((p) => params.has(p))) return null;
  const title = params.get('title')?.trim() ?? '';
  const text = params.get('text')?.trim() ?? '';
  const url = params.get('url')?.trim() ?? '';
  const asked = params.get('nuevo') ?? '';
  const shortcut = Object.prototype.hasOwnProperty.call(SHORTCUTS, asked) ? SHORTCUTS[asked] : null;
  for (const p of PARAMS) params.delete(p);
  const rest = params.toString();
  history.replaceState(
    history.state,
    '',
    window.location.pathname + (rest ? '?' + rest : '') + window.location.hash,
  );
  if (shortcut) return shortcut;
  if (!title && !text && !url) return { kind: 'instant' };
  // Android suele mandar el enlace dentro de `text` (y `url` vacío).
  if (url || HAS_LINK.test(text) || HAS_LINK.test(title))
    return { kind: 'link', text: [url, text, title].filter(Boolean).join('\n') };
  // El título (el asunto) solo si el texto no lo trae ya.
  const body = title && !text.includes(title) ? (text ? `${title}\n${text}` : title) : text;
  return { kind: 'text', text: body };
}

try {
  const now = read();
  if (now) sessionStorage.setItem(KEY, JSON.stringify(now));
} catch {
  /* sin almacenamiento de sesión: se pierde lo compartido, la app abre normal */
}

let taken = false;

/** Lo compartido, una sola vez (la app lo usa al abrirse con la sesión iniciada). */
export function takeIncoming(): Incoming | null {
  if (taken) return null;
  taken = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as Incoming) : null;
  } catch {
    return null;
  }
}

let pendingLink: string | null = null;

/** Deja un texto con enlaces para el próximo «Guardar enlaces» que se abra. */
export function shareLink(text: string) {
  pendingLink = text;
}

/** El texto con enlaces que espera «Guardar enlaces» (una sola vez). */
export function takeSharedLink() {
  const text = pendingLink;
  pendingLink = null;
  return text;
}

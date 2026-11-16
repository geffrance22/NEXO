/**
 * «Escuchar» fuera de la página: controles en la pantalla bloqueada, en las notificaciones y con
 * las teclas multimedia (Media Session). La voz del sistema sola no los muestra: hace falta un
 * audio sonando, así que mientras se escucha corre en bucle uno en silencio.
 */

type Controls = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
};

const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'];

let audio: HTMLAudioElement | null = null;

/** WAV en silencio (8 kHz, 8 bits). Chrome solo muestra los controles con audio de 5 s o más. */
function silence(seconds = 10, rate = 8000) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, 'data');
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 128 = silencio en 8 bits
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** El audio en silencio. `play` debe llamarse desde un toque (o desde los propios controles). */
export const track = {
  play() {
    if (!audio) {
      audio = new Audio(silence());
      audio.loop = true;
    }
    void audio.play().catch(() => {
      /* sin permiso para reproducir: la voz sigue, solo sin controles fuera de la página */
    });
  },
  pause() {
    audio?.pause();
  },
  stop() {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  },
};

const session = () => ('mediaSession' in navigator ? navigator.mediaSession : null);

/** Título, estado y botones de lo que se está escuchando. */
export function showNowPlaying(title: string, state: 'playing' | 'paused', controls: Controls) {
  const ms = session();
  if (!ms) return;
  const icon = (size: number) => ({
    src: new URL(`./icon-${size}.png`, document.baseURI).href,
    sizes: `${size}x${size}`,
    type: 'image/png',
  });
  if (typeof MediaMetadata !== 'undefined')
    ms.metadata = new MediaMetadata({
      title: title.trim() || 'Artículo',
      artist: 'Nexo · Lecturas',
      album: 'Escuchar',
      artwork: [icon(192), icon(512)],
    });
  ms.playbackState = state;
  const handlers: Partial<Record<MediaSessionAction, () => void>> = {
    play: controls.play,
    pause: controls.pause,
    stop: controls.stop,
    nexttrack: controls.next,
    previoustrack: controls.previous,
  };
  for (const action of ACTIONS) {
    try {
      ms.setActionHandler(action, handlers[action] ?? null);
    } catch {
      /* el navegador no conoce esa acción */
    }
  }
}

/** Quita los controles (al detener o salir del artículo). */
export function clearNowPlaying() {
  track.stop();
  const ms = session();
  if (!ms) return;
  ms.metadata = null;
  ms.playbackState = 'none';
  for (const action of ACTIONS) {
    try {
      ms.setActionHandler(action, null);
    } catch {
      /* el navegador no conoce esa acción */
    }
  }
}

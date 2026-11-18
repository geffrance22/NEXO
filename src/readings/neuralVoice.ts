import { supabase } from "../backend";
import { silentUrl } from "./nowPlaying";

/**
 * Voces neuronales para «Escuchar» (función `tts` de Supabase: Gemini, Azure, Google Cloud u
 * OpenAI).
 *
 * A diferencia de la voz del sistema, esto es audio de verdad en un `<audio>`: sigue sonando con
 * la pantalla apagada y lo controlan la pantalla bloqueada, las notificaciones y los auriculares.
 * El artículo se pide por tramos (el primero corto, para empezar rápido) y el siguiente se pide
 * mientras suena el actual, así no hay cortes entre uno y otro.
 */

export type NeuralVoice = {
  id: string;
  provider: "azure" | "google" | "gemini" | "openai";
  name: string;
  lang: "es" | "en" | "any";
  region: string;
};
export type Catalog = {
  /** La función está publicada en Supabase. */
  deployed: boolean;
  /** Tiene la clave de algún proveedor. */
  configured: boolean;
  voices: NeuralVoice[];
};
type Clip = { url: string; marks: number[] | null };

const CACHE = "nexo-neural-voices";

/** La última lista conocida (para mostrarla al instante, también sin conexión). */
export function cachedCatalog(): Catalog | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE) ?? "null") as Catalog | null;
    return raw && Array.isArray(raw.voices) ? raw : null;
  } catch {
    return null;
  }
}
const remember = (c: Catalog) => {
  try {
    localStorage.setItem(CACHE, JSON.stringify(c));
  } catch {
    /* sin almacenamiento */
  }
};

type InvokeError = {
  name?: string;
  context?: { status?: number; json?: () => Promise<{ error?: string } | null> };
};

let pending: Promise<Catalog> | null = null;

/** Las voces neuronales disponibles (una vez por sesión). */
export function neuralCatalog(): Promise<Catalog> {
  pending ??= (async () => {
    const { data, error } = await supabase.functions.invoke("tts", {
      body: { action: "voices" },
    });
    if (error) {
      const status = (error as InvokeError).context?.status;
      if (status === 404) {
        const none = { deployed: false, configured: false, voices: [] };
        remember(none);
        return none;
      }
      // Sin conexión u otro fallo: la última lista conocida, y se vuelve a preguntar después.
      pending = null;
      return cachedCatalog() ?? { deployed: true, configured: false, voices: [] };
    }
    const catalog: Catalog = {
      deployed: true,
      configured: Boolean(data?.configured),
      voices: Array.isArray(data?.voices) ? (data.voices as NeuralVoice[]) : [],
    };
    remember(catalog);
    return catalog;
  })().catch(() => {
    pending = null;
    return cachedCatalog() ?? { deployed: true, configured: false, voices: [] };
  });
  return pending;
}

/** Un tramo de frases como MP3 (y, si el proveedor lo da, el segundo en que empieza cada una). */
async function synthesize(voice: string, sentences: string[]): Promise<Clip> {
  const { data, error } = await supabase.functions.invoke("tts", {
    body: { voice, sentences },
  });
  if (error) {
    const e = error as InvokeError;
    if (e.name === "FunctionsFetchError" || !navigator.onLine)
      throw Error("Sin conexión.");
    const detail = await e.context?.json?.().catch(() => null);
    throw Error(
      detail?.error ||
        (e.context?.status === 404
          ? "La función «tts» no está publicada en Supabase."
          : "No se pudo generar la voz."),
    );
  }
  if (typeof data?.audio !== "string") throw Error("No se pudo generar la voz.");
  const bin = atob(data.audio);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: data.type || "audio/mpeg" }));
  const marks =
    Array.isArray(data.marks) && data.marks.length === sentences.length
      ? (data.marks as number[])
      : null;
  return { url, marks };
}

/** Sin las marcas de tiempo del proveedor: cada frase dura según su largo (más una pausa corta). */
function estimate(texts: string[], duration: number) {
  const weights = texts.map((t) => t.length + 6);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const length = Number.isFinite(duration) && duration > 0 ? duration : total * 0.065;
  const starts: number[] = [];
  let at = 0;
  for (const w of weights) {
    starts.push((at / total) * length);
    at += w;
  }
  return starts;
}

const metadata = (a: HTMLAudioElement) =>
  new Promise<void>((done, fail) => {
    if (a.readyState >= 1) return done();
    const ok = () => {
      a.removeEventListener("error", bad);
      done();
    };
    const bad = () => {
      a.removeEventListener("loadedmetadata", ok);
      fail(Error("El audio no se pudo abrir."));
    };
    a.addEventListener("loadedmetadata", ok, { once: true });
    a.addEventListener("error", bad, { once: true });
  });

/** Tamaño de cada tramo (caracteres): el primero corto para empezar rápido; luego más largos. */
const SIZES = [260, 800, 1500];
/**
 * Gemini gratis cuenta peticiones por día, no caracteres: tramos largos para que un artículo
 * entero gaste pocas (unas 3 o 4). El primero, corto, para no esperar tanto al empezar.
 */
const GEMINI_SIZES = [700, 3600];

type Events = {
  /** Empieza a sonar la frase `index`. */
  sentence: (index: number) => void;
  end: () => void;
  error: (e: Error) => void;
  /** Esperando el audio del tramo (se muestra cargando). */
  waiting: (on: boolean) => void;
  /** El sistema pausó o reanudó por su cuenta (auriculares desconectados, una llamada…). */
  external: (kind: "pause" | "play") => void;
};
type Chunk = { from: number; to: number; clip?: Promise<Clip> };

export class NeuralPlayer {
  readonly audio = new Audio();
  private texts: string[] = [];
  private voice = "";
  private chunks: Chunk[] = [];
  /** El tramo que suena (-1: ninguno). */
  private at = -1;
  private starts: number[] = [];
  private current = -1;
  private token = 0;
  private rate = 1;
  private want = false;
  private selfPause = false;
  private selfPlay = false;
  private urls = new Set<string>();

  constructor(private on: Events) {
    const a = this.audio;
    a.preload = "auto";
    a.addEventListener("timeupdate", () => this.tick());
    a.addEventListener("ended", () => this.next());
    a.addEventListener("pause", () => {
      if (this.selfPause || a.ended) {
        this.selfPause = false;
        return;
      }
      if (this.at >= 0) {
        this.want = false;
        this.on.external("pause");
      }
    });
    a.addEventListener("play", () => {
      if (this.selfPlay) {
        this.selfPlay = false;
        return;
      }
      if (this.at >= 0) {
        this.want = true;
        this.on.external("play");
      }
    });
  }

  /** El texto (una entrada por frase) y la voz. Si no cambian, se aprovecha lo ya generado. */
  load(texts: string[], voice: string) {
    if (voice === this.voice && texts.length === this.texts.length && texts.every((t, i) => t === this.texts[i]))
      return;
    this.forgetAll();
    this.texts = texts;
    this.voice = voice;
    this.chunks = [];
  }

  /**
   * Desde un toque: deja el audio listo para sonar. Safari solo deja reproducir si la primera vez
   * es dentro de un toque; luego se cambia el archivo sin problema. Suena silencio mientras llega
   * el primer tramo (y la pantalla bloqueada ya muestra los controles).
   */
  unlock() {
    const a = this.audio;
    this.at = -1;
    a.src = silentUrl();
    this.selfPlay = a.paused;
    void a.play().catch(() => {
      this.selfPlay = false;
    });
  }

  setRate(rate: number) {
    this.rate = rate;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
  }

  /** Suena desde la frase `index`. */
  async play(index: number) {
    const token = ++this.token;
    this.want = true;
    let k = this.chunks.findIndex((c) => index >= c.from && index < c.to);
    if (k < 0) {
      this.plan(index);
      k = 0;
    }
    if (!this.chunks.length) return this.on.end();
    await this.playChunk(k, index, token);
  }

  pause() {
    this.want = false;
    const a = this.audio;
    if (!a.paused) {
      this.selfPause = true;
      a.pause();
    }
  }

  resume() {
    this.want = true;
    const a = this.audio;
    if (this.at >= 0 && a.paused) {
      this.selfPlay = true;
      void a.play().catch((e: Error) => {
        this.selfPlay = false;
        this.on.error(e);
      });
    }
  }

  /** La frase siguiente (1) o la anterior (-1). Saltar también reanuda si estaba en pausa. */
  skip(delta: number) {
    const target = Math.min(Math.max(0, this.current + delta), this.texts.length - 1);
    const c = this.chunks[this.at];
    if (c && target >= c.from && target < c.to && this.starts.length) {
      this.audio.currentTime = this.starts[target - c.from] ?? 0;
      this.current = -1;
      this.tick();
      if (this.audio.paused) this.resume();
      else this.want = true;
      return;
    }
    void this.play(target);
  }

  /** Se detiene (lo generado se guarda por si vuelves a darle a escuchar). */
  stop() {
    this.token++;
    this.want = false;
    this.at = -1;
    this.current = -1;
    const a = this.audio;
    if (!a.paused) {
      this.selfPause = true;
      a.pause();
    }
    a.removeAttribute("src");
    a.load();
    this.on.waiting(false);
  }

  /** Al salir del artículo: se suelta todo. */
  dispose() {
    this.stop();
    this.forgetAll();
    this.chunks = [];
  }

  private plan(from: number) {
    this.forgetAll();
    const gemini = this.voice.startsWith("gemini:");
    const sizes = gemini ? GEMINI_SIZES : SIZES;
    const most = gemini ? 110 : 50;
    const chunks: Chunk[] = [];
    let i = from;
    while (i < this.texts.length) {
      const limit = sizes[Math.min(chunks.length, sizes.length - 1)];
      let n = 0;
      let j = i;
      while (
        j < this.texts.length &&
        (j === i || n + this.texts[j].length <= limit) &&
        j - i < most
      ) {
        n += this.texts[j].length;
        j++;
      }
      chunks.push({ from: i, to: j });
      i = j;
    }
    this.chunks = chunks;
  }

  private clipOf(k: number) {
    const c = this.chunks[k];
    if (!c) return null;
    c.clip ??= synthesize(this.voice, this.texts.slice(c.from, c.to)).then(
      (clip) => {
        this.urls.add(clip.url);
        return clip;
      },
      (e) => {
        // Se puede volver a pedir (p. ej. al volver la conexión).
        c.clip = undefined;
        throw e;
      },
    );
    return c.clip;
  }

  private async playChunk(k: number, index: number, token: number) {
    const chunk = this.chunks[k];
    this.on.waiting(true);
    let clip: Clip;
    try {
      clip = await this.clipOf(k)!;
    } catch (e) {
      if (token === this.token) this.on.error(e as Error);
      return;
    }
    if (token !== this.token) return;
    const a = this.audio;
    this.at = k;
    this.starts = [];
    this.current = -1;
    // Cambiar de archivo no avisa «pausa»: la marca evita tomar como del sistema la que llegue.
    a.src = clip.url;
    a.defaultPlaybackRate = this.rate;
    a.playbackRate = this.rate;
    try {
      await metadata(a);
    } catch (e) {
      if (token === this.token) this.on.error(e as Error);
      return;
    }
    if (token !== this.token) return;
    const texts = this.texts.slice(chunk.from, chunk.to);
    this.starts = clip.marks ?? estimate(texts, a.duration);
    const offset = index - chunk.from;
    if (offset > 0) a.currentTime = this.starts[offset] ?? 0;
    // El siguiente se pide ya: así no hay silencio entre tramos (también con la pantalla apagada).
    void this.clipOf(k + 1)?.catch(() => {});
    this.release(k);
    if (!this.want) {
      this.on.waiting(false);
      this.tick();
      return;
    }
    this.selfPlay = a.paused;
    try {
      await a.play();
    } catch (e) {
      this.selfPlay = false;
      if (token === this.token) this.on.error(e as Error);
      return;
    }
    if (token !== this.token) return;
    this.on.waiting(false);
    this.tick();
  }

  private next() {
    if (this.at < 0) return;
    const k = this.at + 1;
    if (k >= this.chunks.length) {
      this.at = -1;
      this.on.end();
      return;
    }
    void this.playChunk(k, this.chunks[k].from, this.token);
  }

  private tick() {
    const c = this.chunks[this.at];
    if (!c || !this.starts.length) return;
    const t = this.audio.currentTime + 0.05;
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1] <= t) i++;
    const index = c.from + i;
    if (index !== this.current) {
      this.current = index;
      this.on.sentence(index);
    }
  }

  /** Los tramos ya escuchados (dos atrás) se sueltan de la memoria. */
  private release(k: number) {
    for (let i = 0; i < k - 1; i++) {
      const c = this.chunks[i];
      if (!c.clip) continue;
      const clip = c.clip;
      c.clip = undefined;
      void clip.then((x) => {
        URL.revokeObjectURL(x.url);
        this.urls.delete(x.url);
      }, () => {});
    }
  }

  private forgetAll() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const c of this.chunks) c.clip = undefined;
  }
}

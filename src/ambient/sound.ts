/**
 * Sonido del mezclador, sintetizado en el navegador (sin archivos): lluvia, bosque y viento a
 * partir de ruido filtrado, más algún trino suelto en el bosque. Solo nace cuando tocas el botón
 * de sonido (los navegadores tampoco permiten otra cosa) y se apaga al salir de Mi espacio.
 */

export type Layer = 'lluvia' | 'bosque' | 'viento';
export type Levels = Record<Layer, number>;

const SCALE: Levels = { lluvia: 0.32, bosque: 0.2, viento: 0.5 };
const curve = (v: number, layer: Layer) =>
  Math.pow(Math.max(0, Math.min(1, v)), 1.6) * SCALE[layer];

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: Partial<Record<Layer, GainNode>> = {};
  private chirps = 0;
  private levels: Levels = { lluvia: 0, bosque: 0, viento: 0 };
  private on = false;

  private build() {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const len = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Ruido algo «rosado» (más suave que el blanco).
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const noise = (offset: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start(0, offset);
      return s;
    };
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp).connect(ctx.destination);

    const layer = (name: Layer) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      this.gains[name] = g;
      return g;
    };

    // Lluvia: siseo alto y parejo.
    const rain = layer('lluvia');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 8000;
    noise(0).connect(hp).connect(lp).connect(rain);

    // Bosque: rumor grave de hojas (los trinos se programan aparte).
    const forest = layer('bosque');
    const rustle = ctx.createBiquadFilter();
    rustle.type = 'bandpass';
    rustle.frequency.value = 650;
    rustle.Q.value = 0.6;
    noise(1).connect(rustle).connect(forest);

    // Viento: banda que sube y baja despacio, con ráfagas.
    const wind = layer('viento');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.8;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.07;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 240;
    sweep.connect(sweepDepth).connect(band.frequency);
    const swell = ctx.createGain();
    swell.gain.value = 0.7;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.11;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.3;
    gust.connect(gustDepth).connect(swell.gain);
    sweep.start();
    gust.start();
    noise(2).connect(band).connect(swell).connect(wind);

    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Un trino corto y lejano; más frecuentes cuanto más bosque hay. */
  private chirp() {
    const ctx = this.ctx;
    const out = this.gains.bosque;
    if (!ctx || !out || !this.on) return;
    const lvl = this.levels.bosque;
    if (lvl > 0.12) {
      const t = ctx.currentTime;
      const f = 2600 + Math.random() * 1400;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.14);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    }
    const wait = (6500 - 4800 * lvl) * (0.6 + Math.random() * 0.8);
    this.chirps = window.setTimeout(() => this.chirp(), wait);
  }

  async start(levels: Levels, volume: number) {
    const ctx = this.ctx ?? this.build();
    if (!ctx || !this.master) return false;
    await ctx.resume();
    this.on = true;
    this.setLevels(levels);
    this.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.4);
    clearTimeout(this.chirps);
    this.chirp();
    return true;
  }

  stop() {
    const ctx = this.ctx;
    this.on = false;
    clearTimeout(this.chirps);
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    window.setTimeout(() => {
      if (!this.on) void ctx.suspend();
    }, 700);
  }

  /** Mientras la pestaña no se ve, se calla (y vuelve al regresar si seguía encendido). */
  hold(hidden: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    if (hidden) void ctx.suspend();
    else void ctx.resume();
  }

  setLevels(levels: Levels) {
    this.levels = { ...levels };
    const ctx = this.ctx;
    if (!ctx) return;
    for (const k of Object.keys(levels) as Layer[])
      this.gains[k]?.gain.setTargetAtTime(curve(levels[k], k), ctx.currentTime, 0.3);
  }

  setVolume(v: number) {
    if (this.ctx && this.master && this.on)
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  dispose() {
    this.on = false;
    clearTimeout(this.chirps);
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }
}

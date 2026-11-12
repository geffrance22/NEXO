import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Soundscape } from './sound';
import type { Mixer } from './variants/mixer';

/**
 * Controles del mezclador: el sonido solo se enciende al tocar este botón (que también lo
 * silencia) y el volumen general tiene su propio deslizador. Aparecen al pasar o enfocar la
 * escena, y se quedan visibles mientras suena.
 */
export function MixControls({
  scene,
  volume,
  remember,
  onAudio,
}: {
  scene: Mixer;
  volume: number;
  remember: (key: string, value: unknown) => void;
  onAudio: (on: boolean) => void;
}) {
  const sound = useRef<Soundscape | null>(null);
  const [on, setOn] = useState(false);
  const [vol, setVol] = useState(volume);
  const [failed, setFailed] = useState(false);
  const audio = useRef(onAudio);
  audio.current = onAudio;

  useEffect(() => {
    scene.onChange = (l) => sound.current?.setLevels(l);
    return () => {
      scene.onChange = null;
    };
  }, [scene]);

  useEffect(() => {
    const vis = () => sound.current?.hold(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      sound.current?.dispose();
      sound.current = null;
      audio.current(false);
    };
  }, []);

  const toggle = async () => {
    if (on) {
      sound.current?.stop();
      setOn(false);
      scene.sound = false;
      audio.current(false);
      return;
    }
    sound.current ??= new Soundscape();
    const ok = await sound.current.start(scene.levels, vol).catch(() => false);
    if (!ok) {
      setFailed(true);
      return;
    }
    setOn(true);
    scene.sound = true;
    audio.current(true);
  };

  return (
    <div className={'amb-mix' + (on ? ' on' : '')}>
      <button
        type="button"
        className="amb-snd"
        aria-pressed={on}
        aria-label={
          failed
            ? 'Este navegador no permite el sonido'
            : on
              ? 'Silenciar el ambiente'
              : 'Activar el sonido del ambiente'
        }
        title={
          failed ? 'Este navegador no permite el sonido' : on ? 'Silenciar' : 'Activar el sonido'
        }
        disabled={failed}
        onClick={() => void toggle()}
      >
        {on ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </button>
      <input
        type="range"
        className="amb-vol"
        min={0}
        max={1}
        step={0.05}
        value={vol}
        aria-label="Volumen del ambiente"
        aria-valuetext={`${Math.round(vol * 100)} %`}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVol(v);
          sound.current?.setVolume(v);
          remember('volume', v);
        }}
      />
    </div>
  );
}

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ArrowRight, X } from 'lucide-react';
import { clamp, nearest, type Pointer, type Reveal, type Scene, type Spot } from './scene';

type Opened = { id: string; data: Reveal; x: number; y: number };

/**
 * El escenario común de las cinco variantes: un lienzo transparente sobre el fondo de la página,
 * con el bucle de animación (que se pausa si no se ve), el puntero, el teclado, la pista al pasar
 * y la explicación breve al tocar. La explicación flota encima: no mueve nada de la página.
 */
export function Stage({
  scene,
  label,
  help,
  reduced,
  onBusy,
  onTouch,
  children,
}: {
  scene: Scene;
  label: string;
  help: string;
  reduced: boolean;
  /** Si estás interactuando ahora (puntero dentro, arrastrando, una explicación abierta, foco). */
  onBusy: (busy: boolean) => void;
  /** Cualquier gesto: sirve para no cambiar de variante justo después. */
  onTouch: () => void;
  children?: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hintBox = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [live, setLive] = useState('');
  const helpId = useId();
  const titleId = useId();

  const ptr = useRef<Pointer>({
    x: -999,
    y: -999,
    vx: 0,
    vy: 0,
    inside: false,
    down: false,
    touch: false,
  });
  const size = useRef({ w: 0, h: 0 });
  const gesture = useRef<{
    spot: Spot | null;
    x0: number;
    y0: number;
    t0: number;
    moved: boolean;
    grabbed: boolean;
  } | null>(null);
  const lastMove = useRef({ x: 0, y: 0, t: 0 });
  const keyboard = useRef(false);
  const lastEvent = useRef(0);
  const kick = useRef<() => void>(() => {});
  const hintId = useRef<string | null>(null);
  const openedRef = useRef<Opened | null>(null);
  const busy = useRef(false);
  const focusWithin = useRef(false);
  const callbacks = useRef({ onBusy, onTouch });
  callbacks.current = { onBusy, onTouch };

  const syncBusy = () => {
    const p = ptr.current;
    const next = p.inside || p.down || !!openedRef.current || focusWithin.current;
    if (next !== busy.current) {
      busy.current = next;
      callbacks.current.onBusy(next);
    }
  };
  const touched = () => {
    lastEvent.current = performance.now();
    callbacks.current.onTouch();
    kick.current();
  };

  // Bucle de dibujo: solo mientras la escena se ve y la pestaña está activa.
  useEffect(() => {
    const c = canvas.current;
    const box = wrap.current;
    const g = c?.getContext('2d');
    if (!c || !box || !g) return;
    let dpr = 1;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let t = 0;
    let visible = true;

    const fit = () => {
      const r = box.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w, h };
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      scene.resize(w, h);
      wake();
    };
    const running = () => visible && document.visibilityState === 'visible';

    const trackHint = () => {
      const p = ptr.current;
      let spot: Spot | null = null;
      if (!openedRef.current) {
        if (p.inside && !p.touch && !(gesture.current?.grabbed && gesture.current.moved))
          spot = scene.hit ? scene.hit(p.x, p.y, false) : nearest(scene.spots(), p.x, p.y, false);
        else if (keyboard.current && scene.focus)
          spot = scene.spots().find((s) => s.id === scene.focus) ?? null;
      }
      scene.hover = spot?.id ?? null;
      const key = spot ? spot.id + '|' + spot.hint : null;
      if (key !== hintId.current) {
        hintId.current = key;
        setHint(spot?.hint ?? null);
      }
      const el = hintBox.current;
      if (spot && el) {
        const { w } = size.current;
        const hw = el.offsetWidth;
        const x = clamp(spot.x - hw / 2, 2, Math.max(2, w - hw - 2));
        const y = Math.max(2, spot.y - spot.r - 30);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!running()) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      t += dt;
      const p = ptr.current;
      if (!p.down) {
        const k = Math.exp(-dt * 5);
        p.vx *= k;
        p.vy *= k;
      }
      scene.update(dt, t, p);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.current.w, size.current.h);
      scene.draw(g, t);
      trackHint();
      schedule();
    };
    // Con movimiento reducido, en reposo basta un cuadro cada 250 ms; al interactuar, fluido.
    const schedule = () => {
      if (raf || timer || !running()) return;
      const lively =
        !reduced ||
        scene.live ||
        ptr.current.down ||
        performance.now() - lastEvent.current < 2500;
      if (lively) raf = requestAnimationFrame(frame);
      else
        timer = window.setTimeout(() => {
          timer = 0;
          raf = requestAnimationFrame(frame);
        }, 250);
    };
    const wake = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      schedule();
    };
    kick.current = wake;

    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      wake();
    });
    io.observe(box);
    document.addEventListener('visibilitychange', wake);
    fit();
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', wake);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      kick.current = () => {};
    };
  }, [scene, reduced]);

  const close = () => {
    openedRef.current = null;
    scene.selected = null;
    setOpened(null);
    syncBusy();
    kick.current();
  };
  const open = (spot: Spot) => {
    const data = scene.explain(spot.id);
    if (!data) return close();
    const o = { id: spot.id, data, x: spot.x, y: spot.y + spot.r };
    openedRef.current = o;
    scene.selected = spot.id;
    setOpened(o);
    setLive(`${data.title}. ${data.text}`);
    syncBusy();
  };

  // Un toque fuera de la escena y de la explicación la cierra.
  useEffect(() => {
    if (!opened) return;
    const out = (e: globalThis.PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [opened]);

  // Al cambiar de escena, nada queda abierto.
  useEffect(
    () => () => {
      if (busy.current) callbacks.current.onBusy(false);
      busy.current = false;
    },
    [scene],
  );

  const place = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const p = ptr.current;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const now = e.timeStamp;
    const lm = lastMove.current;
    if (p.inside && lm.t && now > lm.t) {
      const dt = Math.max(8, now - lm.t) / 1000;
      p.vx = p.vx * 0.4 + clamp((x - lm.x) / dt, -2500, 2500) * 0.6;
      p.vy = p.vy * 0.4 + clamp((y - lm.y) / dt, -2500, 2500) * 0.6;
    }
    lastMove.current = { x, y, t: now };
    p.x = x;
    p.y = y;
    p.inside = true;
    p.touch = e.pointerType !== 'mouse';
    return { x, y, now };
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    keyboard.current = false;
    const prev = { x: ptr.current.x, y: ptr.current.y };
    const { x, y } = place(e);
    const g = gesture.current;
    if (g) {
      if (!g.moved && Math.hypot(x - g.x0, y - g.y0) > 6) g.moved = true;
      if (g.grabbed && g.moved) scene.drag?.(ptr.current, x - prev.x, y - prev.y);
    }
    syncBusy();
    touched();
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    keyboard.current = false;
    const { x, y, now } = place(e);
    const p = ptr.current;
    p.down = true;
    p.vx = 0;
    p.vy = 0;
    const spot = scene.hit ? scene.hit(x, y, p.touch) : nearest(scene.spots(), x, y, p.touch);
    const grabbed = scene.grab?.(spot?.id ?? null, p) ?? false;
    gesture.current = { spot, x0: x, y0: y, t0: now, moved: false, grabbed };
    if (grabbed) e.currentTarget.setPointerCapture(e.pointerId);
    syncBusy();
    touched();
  };
  const finish = (e: PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gesture.current;
    const p = ptr.current;
    if (!g) return;
    place(e);
    gesture.current = null;
    p.down = false;
    if (g.grabbed) scene.release?.(p);
    if (!cancelled && !g.moved && e.timeStamp - g.t0 < 650) {
      if (g.spot && openedRef.current?.id !== g.spot.id) open(g.spot);
      else close();
    }
    if (p.touch) p.inside = false;
    syncBusy();
    touched();
  };
  const onLeave = () => {
    if (ptr.current.down) return;
    ptr.current.inside = false;
    syncBusy();
    kick.current();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== wrap.current) {
      if (e.key === 'Escape' && openedRef.current) {
        e.preventDefault();
        close();
        wrap.current?.focus();
      }
      return;
    }
    keyboard.current = true;
    const spots = scene.spots();
    const at = spots.findIndex((s) => s.id === scene.focus);
    const say = (id: string | null) => {
      const s = spots.find((x) => x.id === id) ?? scene.spots().find((x) => x.id === id);
      if (s) setLive(s.hint);
    };
    if (scene.key?.((e.shiftKey ? 'Shift+' : '') + e.key, scene.focus)) {
      e.preventDefault();
      say(scene.focus);
      // Si había una explicación abierta, se actualiza con lo nuevo (otra intensidad, otro mensaje).
      const o = openedRef.current;
      if (o) {
        const s = scene.spots().find((x) => x.id === o.id);
        if (s) open(s);
      }
      touched();
      return;
    }
    const move = (to: number) => {
      if (!spots.length) return;
      const s = spots[(to + spots.length) % spots.length];
      scene.focus = s.id;
      if (openedRef.current) close();
      say(s.id);
    };
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(at + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(at < 0 ? spots.length - 1 : at - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(spots.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const s = spots[at] ?? spots[0];
        if (!s) break;
        scene.focus = s.id;
        if (openedRef.current?.id === s.id) close();
        else open(s);
        break;
      }
      case 'Escape':
        if (openedRef.current) {
          e.preventDefault();
          close();
        } else if (scene.focus) {
          scene.focus = null;
        }
        break;
      default:
        return;
    }
    touched();
  };

  const onFocus = () => {
    focusWithin.current = true;
    const el = wrap.current;
    if (el && document.activeElement === el && el.matches(':focus-visible')) {
      keyboard.current = true;
      if (!scene.focus) {
        const first = scene.spots()[0];
        if (first) {
          scene.focus = first.id;
          setLive(first.hint);
        }
      }
    }
    syncBusy();
    touched();
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
    focusWithin.current = false;
    keyboard.current = false;
    scene.focus = null;
    syncBusy();
    kick.current();
  };

  const { w, h } = size.current;
  const rw = Math.min(268, Math.max(180, w - 8));
  const left = opened ? clamp(opened.x - rw / 2, 4, Math.max(4, w - rw - 4)) : 0;
  const top = opened ? Math.min(opened.y + 10, Math.max(0, h - 24)) : 0;

  return (
    <div
      ref={wrap}
      className="amb-stage"
      data-hint={hint ? '' : undefined}
      tabIndex={0}
      role="group"
      aria-roledescription="escena interactiva"
      aria-label={label}
      aria-describedby={helpId}
      onKeyDown={onKey}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <canvas
        ref={canvas}
        className="amb-canvas"
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={onLeave}
      />
      <div ref={hintBox} className={'amb-hint' + (hint ? ' on' : '')} aria-hidden="true">
        {hint}
      </div>
      {opened && (
        <div
          className="amb-reveal"
          role="dialog"
          aria-labelledby={titleId}
          style={{ left, top, width: rw }}
          key={opened.id}
        >
          <button type="button" className="amb-x" aria-label="Cerrar" onClick={close}>
            <X size={13} />
          </button>
          <strong id={titleId}>{opened.data.title}</strong>
          <p>{opened.data.text}</p>
          {opened.data.context && <small>{opened.data.context}</small>}
          {opened.data.legend && opened.data.legend.length > 0 && (
            <ul className="amb-legend" aria-label="Cómo se lee">
              {opened.data.legend.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {opened.data.action && (
            <button
              type="button"
              className="amb-go"
              onClick={() => {
                const run = opened.data.action!.run;
                close();
                run();
              }}
            >
              {opened.data.action.label} <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}
      {children}
      <p id={helpId} className="amb-sr">
        {help}
      </p>
      <p className="amb-sr" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, LoaderCircle, Minus, Plus, RotateCcw } from "lucide-react";

/** Lado del círculo en pantalla y de la foto que se guarda (px). */
const VIEW = 260;
const OUT = 640;
const MAX_ZOOM = 4;

type Frame = { x: number; y: number; zoom: number };

/**
 * Acomoda tu foto dentro del círculo antes de subirla: arrastra para moverla y usa el control (o
 * la rueda del ratón) para acercarla. Devuelve un cuadrado ya recortado, listo para subir.
 */
export function PhotoCropper({
  file,
  busy,
  onCancel,
  onDone,
}: {
  file: File;
  busy: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const [src, setSrc] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, zoom: 1 });
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: Frame } | null>(
    null,
  );
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Esc cancela el encuadre (la ficha cede el Esc mientras esto está abierto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancel.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Escala para que el lado corto llene el círculo, por el zoom elegido. */
  const scaleOf = (zoom: number) =>
    size ? (VIEW / Math.min(size.w, size.h)) * zoom : 1;
  /** Mantiene la foto cubriendo todo el círculo. */
  const clamp = (f: Frame): Frame => {
    if (!size) return f;
    const s = scaleOf(f.zoom);
    const mx = Math.max(0, (size.w * s - VIEW) / 2);
    const my = Math.max(0, (size.h * s - VIEW) / 2);
    return {
      zoom: f.zoom,
      x: Math.min(mx, Math.max(-mx, f.x)),
      y: Math.min(my, Math.max(-my, f.y)),
    };
  };
  const zoomTo = (zoom: number) =>
    setFrame((f) =>
      clamp({ ...f, zoom: Math.min(MAX_ZOOM, Math.max(1, zoom)) }),
    );

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!size || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: frame };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setFrame(
      clamp({
        ...d.from,
        x: d.from.x + e.clientX - d.x,
        y: d.from.y + e.clientY - d.y,
      }),
    );
  };
  const onUp = () => {
    drag.current = null;
  };

  function finish() {
    const el = img.current;
    if (!el || !size) return;
    const s = scaleOf(frame.zoom);
    const side = VIEW / s;
    const sx = size.w / 2 - frame.x / s - side / 2;
    const sy = size.h / 2 - frame.y / s - side / 2;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, sx, sy, side, side, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => blob && onDone(blob), "image/jpeg", 0.9);
  }

  const s = scaleOf(frame.zoom);
  return (
    <div
      className="mf-crop"
      role="dialog"
      aria-modal="true"
      aria-label="Acomodar tu foto"
    >
      <div className="mf-crop-card">
        <header>
          <strong>Acomoda tu foto</strong>
          <small>
            Arrastra para moverla y acércala hasta que se vea bien en el
            círculo.
          </small>
        </header>
        <div
          className={"mf-crop-stage" + (size ? "" : " loading")}
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          aria-label="Encuadre. Usa las flechas para mover y + o − para acercar."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={(e) => zoomTo(frame.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 20 : 6;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [step, 0],
              ArrowRight: [-step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            if (moves[e.key]) {
              e.preventDefault();
              const [dx, dy] = moves[e.key];
              setFrame((f) => clamp({ ...f, x: f.x + dx, y: f.y + dy }));
            } else if (e.key === "+" || e.key === "=")
              zoomTo(frame.zoom + 0.15);
            else if (e.key === "-") zoomTo(frame.zoom - 0.15);
            else if (e.key === "Enter") finish();
          }}
        >
          {src && !failed && (
            <img
              ref={img}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setSize({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              onError={() => setFailed(true)}
              style={
                size
                  ? {
                      width: size.w * s,
                      height: size.h * s,
                      transform: `translate(calc(-50% + ${frame.x}px), calc(-50% + ${frame.y}px))`,
                    }
                  : { opacity: 0 }
              }
            />
          )}
          <span className="mf-crop-ring" aria-hidden="true" />
          {!size && !failed && (
            <LoaderCircle className="spin mf-crop-wait" size={20} />
          )}
          {failed && (
            <p className="mf-crop-fail">
              No se pudo abrir esta imagen. Prueba con un JPG o PNG.
            </p>
          )}
        </div>
        <div className="mf-crop-zoom">
          <button
            type="button"
            aria-label="Alejar"
            disabled={!size || frame.zoom <= 1}
            onClick={() => zoomTo(frame.zoom - 0.2)}
          >
            <Minus size={15} />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={frame.zoom}
            disabled={!size}
            aria-label="Acercar"
            onChange={(e) => zoomTo(Number(e.target.value))}
          />
          <button
            type="button"
            aria-label="Acercar"
            disabled={!size || frame.zoom >= MAX_ZOOM}
            onClick={() => zoomTo(frame.zoom + 0.2)}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            title="Centrar"
            aria-label="Centrar"
            disabled={!size}
            onClick={() => setFrame({ x: 0, y: 0, zoom: 1 })}
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <footer>
          <button
            type="button"
            className="cp-btn ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="cp-btn cta"
            disabled={!size || busy}
            onClick={finish}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            {busy ? "Subiendo…" : "Usar esta foto"}
          </button>
        </footer>
      </div>
    </div>
  );
}

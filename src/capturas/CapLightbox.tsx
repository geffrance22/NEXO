import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  Minus,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { cleanTags, formatBytes, type Shot } from "./model";
import { downloadShot } from "./download";
import { updateShot } from "./useCapturas";

const MAX_ZOOM = 6;
const INFO_KEY = "nexo-cap-info";

// ───────── Imágenes ya decodificadas ─────────
// Las últimas que se vieron o se precargaron, listas para pintarse sin esperar ni parpadear.
const WARM_MAX = 14;
const warmed = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<void>>();

function warm(url: string): Promise<void> {
  const hit = warmed.get(url);
  if (hit) {
    warmed.delete(url);
    warmed.set(url, hit);
    return Promise.resolve();
  }
  const going = pending.get(url);
  if (going) return going;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  const job = img
    .decode()
    .then(() => {
      warmed.set(url, img);
      while (warmed.size > WARM_MAX)
        warmed.delete(warmed.keys().next().value as string);
    })
    .catch(() => {})
    .finally(() => pending.delete(url));
  pending.set(url, job);
  return job;
}
const isWarm = (url: string) => warmed.has(url);
const naturalOf = (url: string) => {
  const img = warmed.get(url);
  return img?.naturalWidth
    ? { w: img.naturalWidth, h: img.naturalHeight }
    : null;
};

type Zoom = { id: string; s: number; x: number; y: number };
type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };

/**
 * Visor de CAPTURAS: la imagen a pantalla completa, flechas y tira de miniaturas, zoom con la
 * rueda o con doble clic (y arrastrar para moverse), y un panel con descripción y etiquetas.
 *
 * Lleva su propia posición: pasar de una foto a otra no vuelve a pintar la pestaña de debajo.
 * Cada foto ocupa desde el primer fotograma el marco de su tamaño final (sale de su ancho y alto),
 * con la miniatura dentro mientras llega la grande: así no hay saltos de tamaño al pasar.
 */
export function CapLightbox({
  shots,
  startId,
  onClose,
  onDelete,
  onFavorite,
  folderName,
}: {
  shots: Shot[];
  startId: string;
  /** Recibe la foto en la que se cerró (para dejarla a la vista en la pestaña). */
  onClose: (lastId: string | null) => void;
  onDelete: (shot: Shot) => void;
  onFavorite: (shot: Shot) => void;
  folderName: (shot: Shot) => string;
}) {
  const { notify } = useApp();
  const [currentId, setCurrentId] = useState(startId);
  const lastIndex = useRef(0);
  let index = shots.findIndex((s) => s.id === currentId);
  // La que se veía ya no está (se borró): la que ocupaba su lugar.
  if (index < 0) index = Math.min(lastIndex.current, shots.length - 1);
  const shot: Shot | undefined = shots[index];
  const shotId = shot?.id ?? null;
  const idRef = useRef(shotId);
  idRef.current = shotId;

  const [zoomState, setZoomState] = useState<Zoom>({ id: "", ...FIT });
  // El zoom es de una foto: al pasar a otra arranca ajustada desde el primer fotograma.
  const zoom: View = zoomState.id === shotId ? zoomState : FIT;
  const setZoom = (next: View | ((z: View) => View)) =>
    setZoomState((prev) => {
      const id = idRef.current ?? "";
      const cur = prev.id === id ? prev : FIT;
      return { id, ...(typeof next === "function" ? next(cur) : next) };
    });

  const [readyId, setReadyId] = useState<string | null>(null);
  const [, bump] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [info, setInfo] = useState(() => {
    try {
      return localStorage.getItem(INFO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const stage = useRef<HTMLDivElement>(null);
  const arrival = useRef({ id: "", hot: false });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
    backdrop: boolean;
  } | null>(null);
  const many = shots.length > 1;

  const goTo = (d: number) => {
    if (!many || !shot) return;
    setCurrentId(shots[(index + d + shots.length) % shots.length].id);
  };

  useEffect(() => {
    if (!shot) return onClose(null);
    lastIndex.current = index;
    if (shot.id !== currentId) setCurrentId(shot.id);
  }, [shot?.id, index]);

  // Al dejar una foto se olvida su zoom: si se vuelve a ella, aparece ajustada y centrada.
  useEffect(() => {
    setZoomState((z) => (z.id === shotId ? z : { id: "", ...FIT }));
  }, [shotId]);

  useEffect(() => {
    try {
      localStorage.setItem(INFO_KEY, info ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
  }, [info]);

  // Primero la que se ve; después las vecinas (también al dar la vuelta del final al principio).
  useEffect(() => {
    if (!shot) return;
    let alive = true;
    void warm(shot.url).then(() => {
      if (!alive) return;
      if (!shot.width || !shot.height) bump((n) => n + 1);
      for (const d of [1, -1, 2]) {
        const n = shots[(index + d + shots.length) % shots.length];
        if (n && n.id !== shot.id) void warm(n.url);
      }
    });
    return () => {
      alive = false;
    };
  }, [shot?.id, shots]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // Tamaño del escenario: con él, cada foto sabe su marco antes de cargar.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setZoom((z) => {
      const s = Math.min(MAX_ZOOM, Math.max(1, z.s * factor));
      if (s === 1) return FIT;
      const rect = stage.current?.getBoundingClientRect();
      if (!rect || cx === undefined || cy === undefined) return { ...z, s };
      // Acerca hacia el punto del cursor.
      const px = cx - rect.left - rect.width / 2;
      const py = cy - rect.top - rect.height / 2;
      const k = s / z.s;
      return { s, x: px - (px - z.x) * k, y: py - (py - z.y) * k };
    });
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input,textarea,select,[contenteditable="true"]')) {
        if (e.key === "Escape") (t as HTMLElement).blur();
        return;
      }
      if (document.querySelector(".confirm-backdrop, .bd-pop")) return;
      if (!shot) return;
      // El visor manda: ningún atajo de la app (p. ej. «N») actúa debajo.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (zoom.s > 1) setZoom(FIT);
        else onClose(shot.id);
      } else if (e.key === "ArrowRight") goTo(1);
      else if (e.key === "ArrowLeft") goTo(-1);
      else if (e.key === "Home") setCurrentId(shots[0].id);
      else if (e.key === "End") setCurrentId(shots[shots.length - 1].id);
      else if (e.key === "+" || e.key === "=") zoomAt(1.4);
      else if (e.key === "-") zoomAt(1 / 1.4);
      else if (e.key === "0") setZoom(FIT);
      else if (e.key.toLowerCase() === "i") setInfo((v) => !v);
      else if (e.key.toLowerCase() === "d") void downloadShot(shot);
      else if (e.key.toLowerCase() === "f") onFavorite(shot);
      else if (e.key === "Delete") onDelete(shot);
      else return;
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  if (!shot) return null;

  const onDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      ox: zoom.x,
      oy: zoom.y,
      moved: false,
      backdrop: e.target === e.currentTarget,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (zoom.s > 1) setZoom((z) => ({ ...z, x: d.ox + dx, y: d.oy + dy }));
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    // Deslizar para pasar (sin zoom).
    if (
      zoom.s === 1 &&
      Math.abs(dx) > 60 &&
      Math.abs(dx) > Math.abs(e.clientY - d.y)
    )
      goTo(dx < 0 ? 1 : -1);
    else if (!d.moved && d.backdrop && zoom.s === 1) onClose(shot.id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shot.src);
      notify("Enlace copiado.");
    } catch {
      notify("No se pudo copiar el enlace.");
    }
  };

  // Marco final de la foto: lo que quepa (sin agrandar las pequeñas), con sitio para las flechas.
  const dims =
    shot.width && shot.height
      ? { w: shot.width, h: shot.height }
      : naturalOf(shot.url);
  const narrow = typeof window !== "undefined" && window.innerWidth <= 760;
  const padX = narrow ? 16 : 128;
  const padY = 20;
  let frame: CSSProperties | null = null;
  if (dims && box.w > padX && box.h > padY) {
    const k = Math.min(1, (box.w - padX) / dims.w, (box.h - padY) / dims.h);
    frame = {
      width: Math.max(1, Math.round(dims.w * k)),
      height: Math.max(1, Math.round(dims.h * k)),
    };
  }
  // ¿Ya estaba lista al llegar a ella? Se decide una vez por foto: así un fundido empezado no
  // se corta a medias.
  if (arrival.current.id !== shot.id)
    arrival.current = { id: shot.id, hot: isWarm(shot.url) };
  const hot = arrival.current.hot;
  const ready = hot || readyId === shot.id;

  return (
    <div
      className={"cap-lb" + (info ? " with-info" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={shot.name}
    >
      <header className="cap-lb-top">
        <div className="cap-lb-title">
          <strong title={shot.name}>{shot.name}</strong>
          <small>
            {many && `${index + 1} de ${shots.length} · `}
            {folderName(shot)}
          </small>
        </div>
        <div className="cap-lb-tools">
          <button
            type="button"
            title="Alejar (−)"
            aria-label="Alejar"
            disabled={zoom.s <= 1}
            onClick={() => zoomAt(1 / 1.5)}
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            className="cap-lb-zoom"
            title="Ajustar a la pantalla (0)"
            onClick={() => setZoom(FIT)}
          >
            {Math.round(zoom.s * 100)} %
          </button>
          <button
            type="button"
            title="Acercar (+)"
            aria-label="Acercar"
            disabled={zoom.s >= MAX_ZOOM}
            onClick={() => zoomAt(1.5)}
          >
            <Plus size={17} />
          </button>
          <span className="cap-lb-sep" />
          <button
            type="button"
            title={
              shot.favorite ? "Quitar de favoritas (F)" : "Añadir a favoritas (F)"
            }
            aria-label="Favorita"
            aria-pressed={shot.favorite}
            className={shot.favorite ? "on star" : ""}
            onClick={() => onFavorite(shot)}
          >
            <Star size={17} fill={shot.favorite ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            title="Copiar enlace"
            aria-label="Copiar enlace"
            onClick={() => void copy()}
          >
            <Link2 size={17} />
          </button>
          <button
            type="button"
            title="Descargar (D)"
            aria-label="Descargar"
            onClick={() => void downloadShot(shot)}
          >
            <Download size={17} />
          </button>
          <a
            href={shot.src}
            target="_blank"
            rel="noreferrer noopener"
            title="Abrir original"
            aria-label="Abrir original"
          >
            <ExternalLink size={17} />
          </a>
          <button
            type="button"
            title="Detalles (I)"
            aria-label="Detalles"
            aria-pressed={info}
            className={info ? "on" : ""}
            onClick={() => setInfo((v) => !v)}
          >
            <Info size={17} />
          </button>
          <button
            type="button"
            title="Eliminar (Supr)"
            aria-label="Eliminar"
            className="danger"
            onClick={() => onDelete(shot)}
          >
            <Trash2 size={17} />
          </button>
          <span className="cap-lb-sep" />
          <button
            type="button"
            title="Cerrar (Esc)"
            aria-label="Cerrar"
            onClick={() => onClose(shot.id)}
          >
            <X size={19} />
          </button>
        </div>
      </header>

      <div
        ref={stage}
        className={"cap-lb-stage" + (zoom.s > 1 ? " zoomed" : "")}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={(e) => {
          // Dos clics rápidos en las flechas son pasar dos veces, no acercar hacia el borde.
          if ((e.target as HTMLElement).closest("button")) return;
          if (zoom.s > 1) setZoom(FIT);
          else zoomAt(2.5, e.clientX, e.clientY);
        }}
      >
        <div
          key={shot.id}
          className={
            "cap-lb-frame" + (frame ? "" : " auto") + (ready ? " ready" : "")
          }
          style={{
            ...frame,
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`,
          }}
        >
          {!hot && shot.thumb && (
            <img
              className="cap-lb-ph"
              src={shot.thumb}
              alt=""
              draggable={false}
            />
          )}
          <img
            className={
              "cap-lb-img" + (ready ? " ready" : "") + (hot ? " instant" : "")
            }
            src={shot.url}
            alt={shot.note || shot.name}
            draggable={false}
            decoding={hot ? "sync" : "async"}
            onLoad={() => {
              setReadyId(shot.id);
              void warm(shot.url);
            }}
            onError={() => setReadyId(shot.id)}
          />
        </div>
        {!ready && (
          <span className="cap-lb-loading">
            <Loader2 size={22} className="cap-spin" />
          </span>
        )}
        {many && (
          <>
            <button
              type="button"
              className="cap-lb-nav prev"
              aria-label="Anterior"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => goTo(-1)}
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              className="cap-lb-nav next"
              aria-label="Siguiente"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => goTo(1)}
            >
              <ChevronRight size={26} />
            </button>
          </>
        )}
      </div>

      {many && <Strip shots={shots} index={index} onPick={setCurrentId} />}

      {info && (
        <InfoPanel key={shot.id} shot={shot} folder={folderName(shot)} />
      )}
    </div>
  );
}

// ───────── Tira de miniaturas ─────────
// Solo pinta las que caben (y unas pocas a cada lado): con cientos de capturas sigue ligera.
const THUMB_W = 58;
const THUMB_GAP = 6;
const STEP = THUMB_W + THUMB_GAP;
const STRIP_PAD = 16;
const OVERSCAN = 10;

const Strip = memo(function Strip({
  shots,
  index,
  onPick,
}: {
  shots: Shot[];
  index: number;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ left: 0, width: 0 });
  const first = useRef(true);
  const frame = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      frame.current = 0;
      setWin((w) =>
        w.left === el.scrollLeft && w.width === el.clientWidth
          ? w
          : { left: el.scrollLeft, width: el.clientWidth },
      );
    };
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  // Centra la actual. Si el salto es largo (del final al principio), va directo, sin recorrer
  // cientos de miniaturas en una animación.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target =
      STRIP_PAD + index * STEP + THUMB_W / 2 - el.clientWidth / 2;
    const far = Math.abs(target - el.scrollLeft) > el.clientWidth * 1.5;
    el.scrollTo({
      left: Math.max(0, target),
      behavior: first.current || far ? "auto" : "smooth",
    });
    first.current = false;
  }, [index]);

  const n = shots.length;
  const total = n * STEP - THUMB_GAP;
  const width = win.width || 1200;
  const from = Math.max(
    0,
    Math.floor((win.left - STRIP_PAD) / STEP) - OVERSCAN,
  );
  const to = Math.min(
    n,
    Math.ceil((win.left + width - STRIP_PAD) / STEP) + OVERSCAN,
  );
  const items = [];
  for (let i = from; i < to; i++) {
    const s = shots[i];
    items.push(
      <button
        type="button"
        key={s.id}
        className={i === index ? "on" : ""}
        aria-label={s.name}
        aria-current={i === index || undefined}
        style={{ left: i * STEP }}
        onClick={() => onPick(s.id)}
      >
        <img src={s.thumb ?? s.url} alt="" decoding="async" draggable={false} />
      </button>,
    );
  }
  return (
    <div className="cap-lb-strip" ref={ref}>
      <div className="cap-lb-strip-in" style={{ width: total }}>
        {items}
      </div>
    </div>
  );
});

function InfoPanel({ shot, folder }: { shot: Shot; folder: string }) {
  const { notify } = useApp();
  const [name, setName] = useState(shot.name);
  const [note, setNote] = useState(shot.note);
  const [draft, setDraft] = useState("");
  const save = async (changes: Parameters<typeof updateShot>[1]) => {
    const ok = await updateShot(shot.id, changes);
    if (ok !== true) notify(ok);
  };
  const addTags = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setDraft("");
    if (parts.length) void save({ tags: cleanTags([...shot.tags, ...parts]) });
  };
  return (
    <aside className="cap-lb-info" aria-label="Detalles">
      <label className="cap-lb-field">
        <span>Nombre</span>
        <input
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== shot.name && void save({ name })}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
        />
      </label>
      <label className="cap-lb-field">
        <span>Descripción</span>
        <textarea
          value={note}
          rows={4}
          maxLength={4000}
          placeholder="Añade una descripción…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== shot.note && void save({ note })}
        />
      </label>
      <div className="cap-lb-field">
        <span>Etiquetas</span>
        <div className="cap-lb-tags">
          {shot.tags.map((t) => (
            <span key={t} className="cap-tag">
              #{t}
              <button
                type="button"
                aria-label={`Quitar ${t}`}
                onClick={() =>
                  void save({ tags: shot.tags.filter((x) => x !== t) })
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            placeholder="Añadir…"
            value={draft}
            onChange={(e) =>
              e.target.value.includes(",")
                ? addTags(e.target.value)
                : setDraft(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTags(draft);
              }
            }}
            onBlur={() => draft.trim() && addTags(draft)}
          />
        </div>
      </div>
      <dl className="cap-lb-facts">
        {shot.width && shot.height ? (
          <>
            <dt>Tamaño</dt>
            <dd>
              {shot.width} × {shot.height} px
            </dd>
          </>
        ) : null}
        <dt>Peso</dt>
        <dd>{formatBytes(shot.size)}</dd>
        <dt>Carpeta</dt>
        <dd>{folder}</dd>
        <dt>Subida</dt>
        <dd>
          {new Date(shot.created_at).toLocaleString("es-CO", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </dd>
      </dl>
    </aside>
  );
}

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CircleCheck,
  EllipsisVertical,
  Folder,
  FolderInput,
  Heart,
  Highlighter,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { touchFirst } from "../hooks/useMobile";
import { ActionMenu } from "./ActionMenu";
import type { Card } from "./library";
import { preview } from "./media";

/** Cuánto hay que mantener el dedo sobre una tarjeta para seleccionarla. */
const HOLD_MS = 450;
/** Si el dedo se mueve más que esto, es un desplazamiento y no una pulsación larga. */
const HOLD_SLOP = 10;

/** Lo que se puede hacer con una tarjeta. Debe ser estable (no cambiar entre renders). */
export type RowActions = {
  open: (card: Card) => void;
  pin: (card: Card) => void;
  refetch: (card: Card) => void;
  /** Marca o desmarca la tarjeta para una acción en lote. `range`: hasta la última marcada. */
  pick: (card: Card, range: boolean) => void;
  favorite: (card: Card) => void;
  /** Abre (o cierra) el menú de destino junto a `button`: cuaderno, carpeta o archivo. */
  destination: (card: Card, button: HTMLElement) => void;
  /**
   * Lo que pide un deslizamiento con el dedo. Responde `true` si la tarjeta sale de la lista
   * (archivada o eliminada): entonces se va con su animación.
   */
  swipe: (card: Card, kind: SwipeKind) => Promise<boolean>;
};

/** A la derecha: archivar y, más lejos, eliminar. A la izquierda: fijar y, más lejos, mover. */
export type SwipeKind = "archive" | "delete" | "pin" | "folder";

/**
 * Hasta dónde hay que deslizar, según el ancho de la tarjeta: `armed` arma la primera acción,
 * `far` empieza la segunda y `full` la arma (su ícono termina de llenarse).
 */
const zones = (w: number) => ({
  armed: Math.min(120, Math.max(72, w * 0.24)),
  far: w * 0.46,
  full: w * 0.74,
});

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * Lo que aparece detrás de la tarjeta al deslizarla: el ícono se llena desde abajo (`--fill`)
 * y, al llenarse, la acción queda armada (cambia el color y da un pequeño salto).
 */
function SwipeAction({ kind, icon: Icon, label }: { kind: SwipeKind; icon: LucideIcon; label: string }) {
  return (
    <span className="rd-sw-act" data-kind={kind}>
      <span className="rd-sw-ico">
        <Icon size={22} strokeWidth={2} className="rd-sw-base" />
        <Icon size={22} strokeWidth={2} fill="currentColor" className="rd-sw-fill" />
      </span>
      <b>{label}</b>
    </span>
  );
}

/**
 * Una tarjeta de la lista de Lecturas. Solo se vuelve a pintar si cambia algo suyo: escribir,
 * seleccionar texto o desplazarte en el lector no toca la lista.
 *
 * Al pasar el cursor asoma a la izquierda un círculo para seleccionarla. Con una ya marcada, un
 * clic en cualquier parte de otra tarjeta la marca también (Mayús marca el tramo entero).
 */
export const ReadingRow = memo(function ReadingRow({
  card: a,
  current,
  pct,
  lastPinned,
  reloading,
  selecting,
  picked,
  destOpen = false,
  actions,
}: {
  card: Card;
  current: boolean;
  /** Porcentaje leído (0 si no lo has empezado). */
  pct: number;
  /** El último de los fijados: lo separa del resto. */
  lastPinned: boolean;
  reloading: boolean;
  /** Hay tarjetas marcadas: un clic marca en lugar de abrir. */
  selecting: boolean;
  picked: boolean;
  /** Su menú de destino está abierto. */
  destOpen?: boolean;
  actions: RowActions;
}) {
  // Portada que no cargó: se oculta (y vuelve a intentarse si cambia, p. ej. al volver a descargar).
  const [broken, setBroken] = useState("");
  const thumb = Boolean(a.cover) && a.cover !== broken;
  const excerpt = useMemo(
    () => preview(a.excerpt || "").slice(0, 160),
    [a.excerpt],
  );
  const domain = useMemo(() => host(a.url), [a.url]);
  const done = Boolean(a.read_at);
  const full = done || pct >= 95;
  // Menú de los tres puntos (en el celular reemplaza a los íconos que asoman con el cursor).
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const kebab = useRef<HTMLButtonElement>(null);
  /*
   * Pulsación larga con el dedo: marca la tarjeta (y entra en modo selección) en lugar de abrirla.
   * El menú del navegador (copiar, abrir en otra pestaña…) no aparece: aquí manda el de Nexo.
   */
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  useEffect(() => cancelHold, []);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") return;
    cancelHold();
    const at = { x: e.clientX, y: e.clientY };
    hold.current = {
      ...at,
      fired: false,
      timer: window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.fired = true;
        navigator.vibrate?.(12);
        actions.pick(a, false);
      }, HOLD_MS),
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const h = hold.current;
    if (!h || h.fired) return;
    if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) {
      cancelHold();
      hold.current = null;
    }
  };
  const endHold = () => {
    // Se suelta antes de tiempo: es un toque normal (abre o marca con el clic).
    if (hold.current && !hold.current.fired) {
      cancelHold();
      hold.current = null;
    }
  };
  /*
   * Deslizar con el dedo. A la derecha: el ícono de archivar se llena y, si sigues, aparece la
   * caneca que se llena hasta eliminar (pide confirmación). A la izquierda: fijar y, más lejos,
   * mover a una carpeta. Solo se hace la acción cuyo ícono quedó lleno al soltar; si no, la
   * tarjeta vuelve a su sitio. Todo se pinta directo en el DOM: deslizar no vuelve a pintar React.
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const [swiping, setSwiping] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    w: number;
    mode: "wait" | "swipe" | "scroll";
    kind: SwipeKind;
    armed: boolean;
    at: number;
  } | null>(null);
  const swiped = useRef(false);
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const moveTo = (x: number, animate: boolean) => {
    const row = rowRef.current;
    if (!row) return;
    if (animate) row.dataset.settle = "";
    else delete row.dataset.settle;
    row.style.setProperty("--sx", `${x}px`);
  };
  /** Pinta la posición `dx`: qué acción toca, cuánto se llenó su ícono y si ya está armada. */
  const paint = (dx: number) => {
    const s = drag.current;
    const row = rowRef.current;
    if (!s || !row) return;
    const z = zones(s.w);
    const right = dx > 0;
    let far = Math.abs(dx);
    // Más allá del final cuesta más (como una goma) y nunca sale entera.
    if (far > z.full) far = z.full + (far - z.full) * 0.3;
    far = Math.min(far, s.w * 0.92);
    const second = far >= z.far;
    const kind: SwipeKind = right ? (second ? "delete" : "archive") : second ? "folder" : "pin";
    const fill = second
      ? (far - z.far) / (z.full - z.far)
      : Math.min(1, far / z.armed);
    const armed = second ? far >= z.full : far >= z.armed;
    if (armed && !(s.armed && s.kind === kind)) navigator.vibrate?.(9);
    s.kind = kind;
    s.armed = armed;
    s.at = right ? far : -far;
    row.dataset.side = right ? "right" : "left";
    row.dataset.zone = kind;
    row.dataset.armed = armed ? "1" : "0";
    row.style.setProperty("--fill", String(Math.round(Math.min(1, fill) * 100)));
    moveTo(s.at, false);
  };
  /** Todo vuelve a como estaba (y se quita la capa de colores). */
  const reset = () => {
    // Ya empezaste a deslizarla otra vez: no se toca.
    if (drag.current?.mode === "swipe") return;
    const row = rowRef.current;
    if (row) {
      delete row.dataset.side;
      delete row.dataset.zone;
      delete row.dataset.armed;
      delete row.dataset.settle;
      row.removeAttribute("style");
    }
    setSwiping(false);
  };
  const springBack = () => {
    moveTo(0, true);
    later(300, reset);
  };
  /** Se va por el lado al que la llevaste (luego se cierra el hueco). */
  const leave = (dir: number, w: number) => moveTo(dir * (w + 24), true);
  const collapse = () => {
    const row = rowRef.current;
    if (!row) return;
    row.style.height = row.offsetHeight + "px";
    void row.offsetHeight;
    row.style.transition = "height 0.24s ease, margin 0.24s ease, opacity 0.2s ease";
    row.style.height = "0px";
    row.style.marginBottom = "0px";
    row.style.opacity = "0";
    // Si sigue en la lista (en esta colección no sale), vuelve a aparecer.
    later(2600, () => rowRef.current?.isConnected && reset());
  };
  const release = () => {
    const s = drag.current;
    drag.current = null;
    if (!s || s.mode !== "swipe") return;
    swiped.current = true;
    if (!s.armed) return springBack();
    const { kind, w } = s;
    const dir = s.at > 0 ? 1 : -1;
    if (kind === "pin" || kind === "folder") {
      springBack();
      void actions.swipe(a, kind);
      return;
    }
    if (kind === "archive") {
      leave(dir, w);
      void actions.swipe(a, kind).then((ok) => (ok ? collapse() : springBack()));
      return;
    }
    // Eliminar: la caneca llena queda a la vista mientras confirmas.
    moveTo(dir * zones(w).full, true);
    void actions.swipe(a, kind).then((ok) => {
      if (!ok) return springBack();
      leave(dir, w);
      later(230, collapse);
    });
  };

  const onDown = (e: ReactPointerEvent) => {
    onPointerDown(e);
    swiped.current = false;
    const row = rowRef.current;
    if (e.pointerType !== "touch" || selecting || !row || drag.current) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      w: row.offsetWidth,
      mode: "wait",
      kind: "archive",
      armed: false,
      at: 0,
    };
  };
  const onMove = (e: ReactPointerEvent) => {
    onPointerMove(e);
    const s = drag.current;
    if (!s || s.id !== e.pointerId || s.mode === "scroll") return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.mode === "wait") {
      // Hacia arriba o abajo es desplazar la lista; de lado, deslizar la tarjeta.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      s.mode = "swipe";
      cancelHold();
      hold.current = null;
      rowRef.current?.setPointerCapture(e.pointerId);
      setSwiping(true);
    }
    paint(dx);
  };
  const onUp = () => {
    if (drag.current?.mode === "swipe") release();
    else {
      drag.current = null;
      endHold();
    }
  };
  const onCancel = () => {
    const s = drag.current;
    drag.current = null;
    endHold();
    // El sistema se llevó el gesto: la tarjeta vuelve, sin hacer nada.
    if (s?.mode === "swipe") springBack();
  };

  const click = (e: MouseEvent) => {
    // El clic que sigue a una pulsación larga no abre la tarjeta: ya quedó marcada.
    if (hold.current?.fired) {
      hold.current = null;
      e.preventDefault();
      return;
    }
    // Ni el que sigue a un deslizamiento.
    if (swiped.current) {
      swiped.current = false;
      e.preventDefault();
      return;
    }
    // Ctrl/⌘ o Mayús también marcan, sin entrar en modo selección a propósito.
    if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      actions.pick(a, e.shiftKey);
    } else actions.open(a);
  };
  return (
    <div
      className={
        "rd-row" +
        (a.pinned_at ? " pinned" : "") +
        (lastPinned ? " last-pinned" : "") +
        (thumb ? " has-thumb" : "") +
        (reloading ? " refetching" : "") +
        (selecting ? " selecting" : "") +
        (picked ? " picked" : "") +
        (a.favorite ? " favorite" : "") +
        (destOpen ? " dest-open" : "") +
        (menu ? " menu-open" : "") +
        (swiping ? " swiping" : "")
      }
      ref={rowRef}
      aria-busy={reloading || undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onContextMenu={(e) => {
        // Con el dedo, la pulsación larga es de Nexo (seleccionar), no del navegador.
        if (hold.current || touchFirst()) e.preventDefault();
      }}
    >
      {swiping && (
        <div className="rd-swipe" aria-hidden="true">
          <span className="rd-sw-side right">
            <SwipeAction
              kind="archive"
              icon={a.archived ? ArchiveRestore : Archive}
              label={a.archived ? "Desarchivar" : "Archivar"}
            />
            <SwipeAction kind="delete" icon={Trash2} label="Eliminar" />
          </span>
          <span className="rd-sw-side left">
            <SwipeAction
              kind="pin"
              icon={a.pinned_at ? PinOff : Pin}
              label={a.pinned_at ? "Desfijar" : "Fijar arriba"}
            />
            <SwipeAction kind="folder" icon={Folder} label="Mover a carpeta" />
          </span>
        </div>
      )}
      <button
        type="button"
        className="rd-check"
        role="checkbox"
        aria-checked={picked}
        title={picked ? "Quitar de la selección" : "Seleccionar"}
        aria-label={
          (picked ? "Quitar de la selección «" : "Seleccionar «") +
          a.title +
          "»"
        }
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={(e) => actions.pick(a, e.shiftKey)}
      >
        <Check size={11} strokeWidth={3.2} />
      </button>
      <button
        className={
          "read-row" +
          (current ? " current" : "") +
          (done ? " read" : "") +
          // Sin la migración `opened_at` no viene: la tarjeta se ve como siempre.
          (a.opened_at === null ? " unopened" : a.opened_at ? " opened" : "")
        }
        aria-pressed={selecting ? picked : undefined}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={click}
      >
        {pct > 0 && (
          <i
            className={"rd-progress" + (full ? " done" : "")}
            style={{ "--p": Math.max(4, pct) } as CSSProperties}
            title={done ? "Completado" : full ? "Leído" : `Llevas el ${pct}%`}
            aria-label={
              done ? "Completado" : full ? "Leído" : `Leído al ${pct}%`
            }
          />
        )}
        {thumb && (
          <img
            className="rd-thumb"
            alt=""
            width={66}
            height={72}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(a.cover ?? "")}
            src={a.cover!}
          />
        )}
        <strong>{a.title}</strong>
        <small className="rd-cardmeta">
          <span className="rd-domain">{domain}</span>
          <span className="rd-minutes" title="Tiempo estimado de lectura">
            {a.minutes} min
          </span>
          {a.mark_count > 0 && (
            <span className="rd-count" title="Resaltados">
              <Highlighter size={12} /> {a.mark_count}
            </span>
          )}
          {done && (
            <span className="rd-readmark" title="Completado">
              <Check size={12} strokeWidth={2.6} />
            </span>
          )}
          {/* En el celular, favorito y fijado se ven aquí (sus botones van en el menú). */}
          {a.favorite && (
            <span className="rd-favmark" title="Favorito">
              <Heart size={12} fill="currentColor" />
            </span>
          )}
          {a.pinned_at && (
            <span className="rd-pinmark" title="Fijado arriba">
              <Pin size={12} fill="currentColor" />
            </span>
          )}
        </small>
        <span className="rd-preview">{excerpt}</span>
      </button>
      {!selecting && (
        <div className="rd-acts">
          <button
            type="button"
            className="rd-act rd-refetch"
            disabled={reloading}
            title={reloading ? "Descargando de nuevo…" : "Volver a descargar"}
            aria-label={
              reloading
                ? `Descargando de nuevo «${a.title}»`
                : `Volver a descargar «${a.title}»`
            }
            onClick={() => actions.refetch(a)}
          >
            <RefreshCw size={13} className={reloading ? "spin" : undefined} />
          </button>
          <button
            type="button"
            className="rd-act rd-dest-btn"
            aria-haspopup="dialog"
            aria-expanded={destOpen}
            title="Destino: cuaderno, carpeta o archivo"
            aria-label={`Decidir el destino de «${a.title}»`}
            onClick={(e) => actions.destination(a, e.currentTarget)}
          >
            <FolderInput size={14} />
          </button>
          <button
            type="button"
            className="rd-act rd-fav"
            aria-pressed={a.favorite}
            title={a.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            aria-label={
              a.favorite
                ? `Quitar «${a.title}» de favoritos`
                : `Añadir «${a.title}» a favoritos`
            }
            onClick={() => actions.favorite(a)}
          >
            <Heart size={14} fill={a.favorite ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className="rd-act rd-pin"
            aria-pressed={Boolean(a.pinned_at)}
            title={a.pinned_at ? "Desfijar" : "Fijar arriba"}
            aria-label={
              a.pinned_at
                ? `Desfijar «${a.title}»`
                : `Fijar «${a.title}» arriba`
            }
            onClick={() => actions.pin(a)}
          >
            <Pin size={14} fill={a.pinned_at ? "currentColor" : "none"} />
          </button>
        </div>
      )}
      {!selecting && (
        <button
          ref={kebab}
          type="button"
          className="rd-kebab"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          aria-label={`Más opciones de «${a.title}»`}
          title="Más opciones"
          onClick={(e) => {
            const el = e.currentTarget;
            setMenu((m) => (m ? null : el));
          }}
        >
          <EllipsisVertical size={18} />
        </button>
      )}
      {menu && (
        <ActionMenu
          anchor={menu}
          label={`Opciones de «${a.title}»`}
          onClose={() => setMenu(null)}
          items={[
            {
              key: "fav",
              label: a.favorite ? "Quitar de favoritos" : "Añadir a favoritos",
              icon: Heart,
              on: a.favorite,
              run: () => actions.favorite(a),
            },
            {
              key: "pin",
              label: a.pinned_at ? "Desfijar" : "Fijar arriba",
              icon: Pin,
              on: Boolean(a.pinned_at),
              run: () => actions.pin(a),
            },
            {
              key: "dest",
              label: "Enviar a…",
              hint: "Un cuaderno, una carpeta o el archivo",
              icon: FolderInput,
              // El menú de destino se ancla a los tres puntos (que siguen en su sitio).
              run: () => kebab.current && actions.destination(a, kebab.current),
            },
            {
              key: "refetch",
              label: reloading ? "Descargando de nuevo…" : "Volver a descargar",
              hint: "Si se guardó incompleto",
              icon: RefreshCw,
              disabled: reloading,
              run: () => actions.refetch(a),
            },
            {
              key: "pick",
              label: "Seleccionar",
              hint: "También manteniéndola pulsada",
              icon: CircleCheck,
              run: () => actions.pick(a, false),
            },
          ]}
        />
      )}
    </div>
  );
});

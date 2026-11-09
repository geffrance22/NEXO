import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignJustify,
  AlignLeft,
  ALargeSmall,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";

/** Cómo se ve el texto del lector. Se recuerda en este navegador. */
export type ReaderPrefs = {
  /** Tamaño de letra en px. */
  size: number;
  font: "serif" | "sans" | "classic";
  leading: "tight" | "normal" | "loose";
  width: "narrow" | "normal" | "wide";
  align: "left" | "justify";
  paper: "white" | "sepia" | "gray";
};

const KEY = "nexo-reader-prefs";
const DEFAULTS: ReaderPrefs = {
  size: 18,
  font: "serif",
  leading: "normal",
  width: "normal",
  align: "left",
  paper: "white",
};
const SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26];

const FONTS: Record<ReaderPrefs["font"], { label: string; stack: string }> = {
  serif: {
    label: "Serif",
    stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  },
  sans: {
    label: "Sans",
    stack:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  classic: {
    label: "Clásica",
    stack:
      "'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', serif",
  },
};
const LEADING: Record<ReaderPrefs["leading"], number> = {
  tight: 1.55,
  normal: 1.83,
  loose: 2.1,
};
const WIDTH: Record<ReaderPrefs["width"], string> = {
  narrow: "600px",
  normal: "740px",
  wide: "920px",
};
const PAPER: Record<
  ReaderPrefs["paper"],
  { label: string; bg: string; ink: string }
> = {
  white: { label: "Claro", bg: "", ink: "" },
  sepia: { label: "Sepia", bg: "#f6efe0", ink: "#3b3227" },
  gray: { label: "Gris", bg: "#eef0ef", ink: "#262b29" },
};

function load(): ReaderPrefs {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as Partial<ReaderPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const pick = <K extends keyof ReaderPrefs>(
      k: K,
      ok: readonly ReaderPrefs[K][],
    ) =>
      ok.includes(raw[k] as ReaderPrefs[K])
        ? (raw[k] as ReaderPrefs[K])
        : DEFAULTS[k];
    return {
      size: pick("size", SIZES),
      font: pick("font", ["serif", "sans", "classic"]),
      leading: pick("leading", ["tight", "normal", "loose"]),
      width: pick("width", ["narrow", "normal", "wide"]),
      align: pick("align", ["left", "justify"]),
      paper: pick("paper", ["white", "sepia", "gray"]),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Preferencias del lector y las variables CSS que las aplican. */
export function useReaderPrefs() {
  const [prefs, setPrefs] = useState(load);
  const change = useCallback((next: Partial<ReaderPrefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        /* Sin almacenamiento: vale para esta sesión. */
      }
      return merged;
    });
  }, []);
  const paper = PAPER[prefs.paper];
  const style = {
    "--rd-font": FONTS[prefs.font].stack,
    "--rd-size": prefs.size + "px",
    "--rd-leading": LEADING[prefs.leading],
    "--rd-width": WIDTH[prefs.width],
    "--rd-align": prefs.align,
    ...(paper.bg ? { "--rd-paper": paper.bg, "--rd-ink": paper.ink } : {}),
  } as CSSProperties;
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Nada que borrar. */
    }
    setPrefs(DEFAULTS);
  }, []);
  return { prefs, change, reset, style, paper: prefs.paper };
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: {
    id: T;
    title: string;
    content: ReactNode;
    style?: CSSProperties;
  }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="rd-rs-row">
      <span className="rd-rs-label">{label}</span>
      <div className="rd-rs-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            title={o.title}
            style={o.style}
            className={value === o.id ? "on" : ""}
            onClick={() => onChange(o.id)}
          >
            {o.content}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tres rayas con más o menos aire: el interlineado de un vistazo. */
const Lines = ({ gap }: { gap: number }) => (
  <span className="rd-rs-lines" style={{ gap }} aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);
/** Una columna más o menos ancha. */
const Column = ({ w }: { w: number }) => (
  <span className="rd-rs-col" aria-hidden="true">
    <i style={{ width: w }} />
  </span>
);

/** Botón «Aa» de la barra del artículo con el panel de ajustes del lector. */
export function ReaderSettings({
  api,
}: {
  api: ReturnType<typeof useReaderPrefs>;
}) {
  const { prefs, change, reset } = api;
  const [open, setOpen] = useState(false);
  // La barra del artículo se desplaza en horizontal y recortaría el panel: va en un portal,
  // anclado bajo el botón.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (r)
        setAt({
          top: r.bottom + 8,
          right: Math.max(8, window.innerWidth - r.right),
        });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      close();
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close]);
  const index = SIZES.indexOf(prefs.size);
  const step = (d: number) =>
    change({ size: SIZES[Math.max(0, Math.min(SIZES.length - 1, index + d))] });
  const custom = JSON.stringify(prefs) !== JSON.stringify(DEFAULTS);

  // Atajos mientras el panel está abierto: + y − cambian el tamaño.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea"))
        return;
      if (e.key === "+" || e.key === "=") step(1);
      else if (e.key === "-") step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        className="rd-rs-btn"
        title="Ajustes de lectura"
        aria-label="Ajustes de lectura"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <ALargeSmall size={17} />
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={pop}
            className="rd-rs-pop"
            role="dialog"
            aria-label="Ajustes de lectura"
            style={{ top: at.top, right: at.right }}
          >
            <div className="rd-rs-row">
              <span className="rd-rs-label">Tamaño</span>
              <div className="rd-rs-size">
                <button
                  type="button"
                  aria-label="Letra más pequeña"
                  title="Más pequeña (−)"
                  disabled={index <= 0}
                  onClick={() => step(-1)}
                >
                  <Minus size={14} />
                </button>
                <output aria-live="polite">{prefs.size}</output>
                <button
                  type="button"
                  aria-label="Letra más grande"
                  title="Más grande (+)"
                  disabled={index >= SIZES.length - 1}
                  onClick={() => step(1)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <Segmented
              label="Fuente"
              value={prefs.font}
              onChange={(font) => change({ font })}
              options={(Object.keys(FONTS) as ReaderPrefs["font"][]).map(
                (id) => ({
                  id,
                  title: FONTS[id].label,
                  style: { fontFamily: FONTS[id].stack },
                  content: FONTS[id].label,
                }),
              )}
            />
            <Segmented
              label="Interlineado"
              value={prefs.leading}
              onChange={(leading) => change({ leading })}
              options={[
                { id: "tight", title: "Compacto", content: <Lines gap={2} /> },
                { id: "normal", title: "Normal", content: <Lines gap={3.5} /> },
                { id: "loose", title: "Amplio", content: <Lines gap={5} /> },
              ]}
            />
            <Segmented
              label="Ancho"
              value={prefs.width}
              onChange={(width) => change({ width })}
              options={[
                { id: "narrow", title: "Estrecho", content: <Column w={8} /> },
                { id: "normal", title: "Normal", content: <Column w={13} /> },
                { id: "wide", title: "Ancho", content: <Column w={18} /> },
              ]}
            />
            <Segmented
              label="Alineación"
              value={prefs.align}
              onChange={(align) => change({ align })}
              options={[
                {
                  id: "left",
                  title: "A la izquierda",
                  content: <AlignLeft size={15} />,
                },
                {
                  id: "justify",
                  title: "Justificado",
                  content: <AlignJustify size={15} />,
                },
              ]}
            />
            <div className="rd-rs-row">
              <span className="rd-rs-label">Fondo</span>
              <div className="rd-rs-paper" role="radiogroup" aria-label="Fondo">
                {(Object.keys(PAPER) as ReaderPrefs["paper"][]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={prefs.paper === id}
                    aria-label={PAPER[id].label}
                    title={PAPER[id].label}
                    className={
                      "rd-rs-swatch " + id + (prefs.paper === id ? " on" : "")
                    }
                    onClick={() => change({ paper: id })}
                  />
                ))}
              </div>
            </div>
            {custom && (
              <button type="button" className="rd-rs-reset" onClick={reset}>
                <RotateCcw size={12} /> Restablecer
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

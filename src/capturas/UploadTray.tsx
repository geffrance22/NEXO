import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  FileArchive,
  FolderOpen,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { goLibroteca } from "../library/shelf";
import { CaptureDock, DockForm } from "./CaptureDock";
import { formatBytes } from "./model";
import { openCapturasFolder } from "./nav";
import {
  cancelAll,
  cancelItem,
  cancelZip,
  clearFinished,
  dismissZip,
  retryFailed,
  retryItem,
  setMinimized,
  useUploads,
  type UpItem,
  type ZipJob,
} from "./uploads";

/**
 * Esquina inferior derecha: la ventanita de «Guardar captura» minimizada y, debajo, la ventana
 * flotante de subidas y descargas.
 */
export function UploadTray() {
  return (
    <>
      <div className="cap-corner">
        <CaptureDock />
        <Tray />
      </div>
      <DockForm />
    </>
  );
}

/**
 * Ventana flotante abajo a la derecha (como un chat): las subidas de varias capturas y las
 * descargas en ZIP, con su progreso. Se puede minimizar y sigue aunque cambies de página.
 */
function Tray() {
  const { go, confirm } = useApp();
  const { items: all, batches, zips, waitUntil, minimized } = useUploads();
  const trayBatches = new Set(
    batches.filter((b) => b.mode === "tray").map((b) => b.id),
  );
  const items = all.filter((i) => trayBatches.has(i.batch));
  const [now, setNow] = useState(Date.now());
  const waiting = items.some((i) => i.status === "waiting") && waitUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [waiting]);
  useEffect(() => {
    if (waitUntil > Date.now()) setNow(Date.now());
  }, [waitUntil]);

  if (!items.length && !zips.length) return null;

  const counted = items.filter((i) => i.status !== "canceled");
  const done = counted.filter((i) => i.status === "done").length;
  const failed = counted.filter((i) => i.status === "error").length;
  const busy = counted.some(
    (i) =>
      i.status === "queued" ||
      i.status === "waiting" ||
      i.status === "uploading",
  );
  const zipBusy = zips.some(
    (z) => z.status === "working" || z.status === "packing",
  );
  const progress = counted.length
    ? counted.reduce(
        (n, i) =>
          n +
          (i.status === "done"
            ? 1
            : i.status === "uploading"
              ? i.progress * 0.92
              : 0),
        0,
      ) / counted.length
    : 0;
  const secs = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  let title: string;
  let sub: string;
  if (items.length) {
    title = busy
      ? `Subiendo ${Math.min(done + 1, counted.length)} de ${counted.length}`
      : failed
        ? `${done} de ${counted.length} subidas`
        : counted.length
          ? `${done} ${done === 1 ? "captura guardada" : "capturas guardadas"}`
          : "Subida cancelada";
    sub = waiting
      ? `YourImageShare permite 20 por minuto · sigue en ${secs} s`
      : busy
        ? `${Math.round(progress * 100)} % · puedes seguir usando NEXO`
        : failed
          ? `${failed} ${failed === 1 ? "no se pudo subir" : "no se pudieron subir"}`
          : "Todo listo en CAPTURAS";
  } else {
    const z = zips[zips.length - 1];
    title =
      z.status === "done"
        ? "ZIP descargado"
        : z.status === "packing"
          ? "Empaquetando ZIP…"
          : "Preparando ZIP";
    sub = z.label;
  }
  const state = busy || zipBusy ? "busy" : failed ? "error" : "done";
  const folderOfLast =
    batches.find((b) => trayBatches.has(b.id))?.folder_id ?? null;

  async function close() {
    if (busy) {
      const ok = await confirm({
        title: "¿Cancelar las subidas pendientes?",
        message: "Las que ya terminaron se quedan en CAPTURAS.",
        confirmLabel: "Cancelar subidas",
        cancelLabel: "Seguir subiendo",
        danger: true,
        icon: "warning",
      });
      if (!ok) return;
      cancelAll();
    }
    for (const z of zips)
      if (z.status === "working" || z.status === "packing") cancelZip(z.id);
    clearFinished();
    for (const z of zips) dismissZip(z.id);
  }

  return (
    <aside
      className={"cap-tray " + state + (minimized ? " min" : "")}
      aria-live="polite"
      aria-label="Subidas de capturas"
    >
      <header onClick={() => minimized && setMinimized(false)}>
        <span className="cap-tray-ico" aria-hidden="true">
          {state === "busy" ? (
            <Ring value={items.length ? progress : 0} spin={!items.length} />
          ) : state === "error" ? (
            <AlertCircle size={18} />
          ) : (
            <Check size={18} />
          )}
        </span>
        <div className="cap-tray-title">
          <strong>{title}</strong>
          <small>{sub}</small>
        </div>
        <button
          type="button"
          aria-label={minimized ? "Mostrar" : "Minimizar"}
          onClick={(e) => {
            e.stopPropagation();
            setMinimized(!minimized);
          }}
        >
          {minimized ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={(e) => {
            e.stopPropagation();
            void close();
          }}
        >
          <X size={17} />
        </button>
      </header>
      {items.length > 0 && (
        <div className="cap-tray-bar" aria-hidden="true">
          <i
            style={{
              width: `${Math.round((busy ? progress : done / Math.max(1, counted.length)) * 100)}%`,
            }}
          />
        </div>
      )}
      {!minimized && (
        <>
          <ul className="cap-tray-list">
            {zips.map((z) => (
              <ZipRow key={z.id} job={z} />
            ))}
            {items.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
          {items.length > 0 && !busy && (
            <footer>
              {failed > 0 && (
                <button type="button" onClick={retryFailed}>
                  <RotateCcw size={14} /> Reintentar{" "}
                  {failed === 1 ? "la fallida" : `las ${failed}`}
                </button>
              )}
              {done > 0 && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    openCapturasFolder(folderOfLast);
                    goLibroteca(go, "capturas");
                    clearFinished();
                  }}
                >
                  <FolderOpen size={14} /> Ver en CAPTURAS
                </button>
              )}
            </footer>
          )}
        </>
      )}
    </aside>
  );
}

function Ring({ value, spin }: { value: number; spin?: boolean }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      className={spin ? "cap-spin" : ""}
    >
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2.4"
      />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={spin ? c * 0.7 : c * (1 - Math.max(0.04, value))}
        transform="rotate(-90 11 11)"
        style={{ transition: "stroke-dashoffset .3s ease" }}
      />
    </svg>
  );
}

function Row({ item }: { item: UpItem }) {
  const pct = Math.round(item.progress * 100);
  const saving = item.status === "uploading" && item.progress >= 1;
  const label =
    item.status === "queued"
      ? "En cola"
      : item.status === "waiting"
        ? "Esperando turno"
        : item.status === "uploading"
          ? item.compressing
            ? "Comprimiendo a WebP…"
            : saving
              ? "Guardando…"
              : `${pct} % · ${formatBytes(item.size)}`
          : item.status === "done"
            ? `Lista · ${formatBytes(item.size)}${item.original ? ` (era ${formatBytes(item.original)})` : ""}`
            : item.status === "canceled"
              ? "Cancelada"
              : item.error;
  return (
    <li className={"cap-tray-row " + item.status}>
      <span className="cap-tray-thumb">
        <img src={item.preview} alt="" loading="lazy" decoding="async" />
        {item.status === "done" && (
          <i className="ok">
            <Check size={11} strokeWidth={3} />
          </i>
        )}
      </span>
      <span className="cap-tray-text">
        <strong title={item.name}>{item.name}</strong>
        <small title={item.status === "error" ? item.error : undefined}>
          {label}
        </small>
        {(item.status === "uploading" ||
          item.status === "queued" ||
          item.status === "waiting") && (
          <span className="cap-tray-mini">
            <i
              className={saving ? "saving" : ""}
              style={{
                width: `${item.status === "uploading" ? (saving ? 100 : pct) : 0}%`,
              }}
            />
          </span>
        )}
      </span>
      {item.status === "error" || item.status === "canceled" ? (
        <button
          type="button"
          aria-label="Reintentar"
          title="Reintentar"
          onClick={() => retryItem(item.id)}
        >
          <RotateCcw size={14} />
        </button>
      ) : item.status !== "done" ? (
        <button
          type="button"
          aria-label="Cancelar"
          title="Cancelar"
          onClick={() => cancelItem(item.id)}
        >
          <X size={14} />
        </button>
      ) : null}
    </li>
  );
}

function ZipRow({ job }: { job: ZipJob }) {
  const working = job.status === "working" || job.status === "packing";
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 100;
  const label =
    job.status === "working"
      ? `${job.done} de ${job.total} imágenes`
      : job.status === "packing"
        ? "Empaquetando…"
        : job.status === "done"
          ? job.failed
            ? `Descargado · faltaron ${job.failed}`
            : `Descargado · ${job.total} ${job.total === 1 ? "imagen" : "imágenes"}`
          : job.status === "canceled"
            ? "Cancelado"
            : job.error;
  return (
    <li className={"cap-tray-row zip " + job.status}>
      <span className="cap-tray-thumb zip">
        {working ? (
          <Loader2 size={16} className="cap-spin" />
        ) : (
          <FileArchive size={17} />
        )}
      </span>
      <span className="cap-tray-text">
        <strong title={job.label}>{job.label}</strong>
        <small>{label}</small>
        {working && (
          <span className="cap-tray-mini">
            <i
              className={job.status === "packing" ? "saving" : ""}
              style={{ width: `${job.status === "packing" ? 100 : pct}%` }}
            />
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={working ? "Cancelar" : "Quitar"}
        onClick={() => (working ? cancelZip(job.id) : dismissZip(job.id))}
      >
        <X size={14} />
      </button>
    </li>
  );
}

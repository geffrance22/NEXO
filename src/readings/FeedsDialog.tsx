import { useEffect, useState } from "react";
import { LoaderCircle, Plus, RefreshCw, Rss, Trash2 } from "lucide-react";
import { useApp } from "../AppContext";
import { ReaderDialog } from "./ReaderDialog";
import {
  addFeed,
  FEEDS_SQL,
  listFeeds,
  missingTable,
  removeFeed,
  syncFeed,
  syncFeeds,
  type Feed,
} from "./feeds";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const ago = (iso: string | null) => {
  if (!iso) return "Sin revisar";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "Revisado ahora";
  if (min < 60) return `Revisado hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Revisado hace ${h} h`;
  return (
    "Revisado el " +
    new Date(iso).toLocaleDateString("es-CO", {
      day: "numeric",
      month: "short",
    })
  );
};
const plural = (n: number) =>
  n === 1 ? "1 artículo nuevo" : `${n} artículos nuevos`;
const messageOf = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  if (missingTable(err))
    return `Para usar feeds RSS ejecuta ${FEEDS_SQL} en el SQL Editor de Supabase.`;
  return err?.message || "Algo falló. Inténtalo de nuevo.";
};

/**
 * Tus newsletters y blogs por RSS: añadir uno (el feed o la página del sitio), ver los que
 * tienes, quitarlos y revisarlos ahora. Lo nuevo entra solo a «Por leer».
 */
export function FeedsDialog({
  close,
  imported,
}: {
  close: () => void;
  /** Entraron artículos nuevos: la lista se refresca. */
  imported: (n: number) => void;
}) {
  const { notify } = useApp();
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"" | "add" | "sync">("");
  const [removing, setRemoving] = useState("");
  // El feed que se está revisando solo (su botón gira).
  const [checking, setChecking] = useState("");
  const [error, setError] = useState("");

  const reload = () =>
    listFeeds()
      .then(setFeeds)
      .catch((e) => {
        setFeeds([]);
        setError(messageOf(e));
      });
  useEffect(() => {
    void reload();
  }, []);

  async function add() {
    if (!link.trim() || busy) return;
    setBusy("add");
    setError("");
    try {
      const { feed, added } = await addFeed(link.trim());
      setLink("");
      await reload();
      if (added) imported(added);
      notify(
        `Feed añadido: ${feed.title || host(feed.url)}` +
          (added ? ` · ${plural(added)} en «Por leer».` : "."),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  }

  async function sync() {
    setBusy("sync");
    setError("");
    try {
      const added = await syncFeeds(true);
      await reload();
      if (added) imported(added);
      notify(
        added ? `${plural(added)} en «Por leer».` : "No hay artículos nuevos.",
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  }

  async function check(feed: Feed) {
    setChecking(feed.id);
    setError("");
    const name = feed.title || host(feed.url);
    try {
      const added = await syncFeed(feed);
      await reload();
      if (added) imported(added);
      notify(
        added
          ? `${name}: ${plural(added)} en «Por leer».`
          : `${name}: no hay artículos nuevos.`,
      );
    } catch (e) {
      setError(`${name}: ${messageOf(e)}`);
    } finally {
      setChecking("");
    }
  }

  async function remove(feed: Feed) {
    setRemoving(feed.id);
    setError("");
    try {
      await removeFeed(feed.id);
      setFeeds((v) => v?.filter((f) => f.id !== feed.id) ?? v);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setRemoving("");
    }
  }

  return (
    <ReaderDialog
      title="Newsletters (RSS)"
      close={close}
      busy={busy === "add"}
      className="rd-feeds"
    >
      <form
        className="rd-feeds-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          data-initial-focus
          type="text"
          inputMode="url"
          aria-label="Enlace del feed o del sitio"
          placeholder="Feed RSS o sitio (p. ej. ejemplo.substack.com)"
          value={link}
          disabled={busy === "add"}
          onChange={(e) => setLink(e.target.value)}
        />
        <button
          type="submit"
          className="rd-dlg-btn primary"
          disabled={!link.trim() || busy !== ""}
        >
          {busy === "add" ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Plus size={15} />
          )}
          {busy === "add" ? "Añadiendo…" : "Añadir"}
        </button>
      </form>
      <small className="rd-feeds-hint">
        Sus artículos nuevos entran solos a «Por leer» cada vez que abres
        Lecturas (como mucho cada 30 minutos).
      </small>

      {feeds === null ? (
        <p className="rd-feeds-empty">
          <LoaderCircle size={15} className="spin" /> Cargando…
        </p>
      ) : feeds.length === 0 ? (
        <p className="rd-feeds-empty">Aún no tienes feeds.</p>
      ) : (
        <>
          <p className="rd-feeds-count">
            {feeds.length === 1 ? "1 feed" : `${feeds.length} feeds`}
          </p>
          <ul className="rd-feeds-list">
            {feeds.map((f) => (
              <li key={f.id}>
                <Rss size={15} className="rd-feeds-ico" aria-hidden="true" />
                <span className="rd-feeds-text">
                  <strong title={f.url}>{f.title || host(f.url)}</strong>
                  <small>
                    {host(f.site || f.url)} · {ago(f.checked_at)}
                  </small>
                </span>
                <button
                  type="button"
                  className="rd-feeds-act"
                  title="Revisar este feed ahora"
                  aria-label={`Revisar «${f.title || host(f.url)}»`}
                  disabled={busy !== "" || checking !== "" || removing === f.id}
                  onClick={() => void check(f)}
                >
                  <RefreshCw
                    size={14}
                    className={checking === f.id ? "spin" : undefined}
                  />
                </button>
                <button
                  type="button"
                  className="rd-feeds-act rd-feeds-del"
                  title="Quitar feed (los artículos que ya entraron se quedan)"
                  aria-label={`Quitar «${f.title || host(f.url)}»`}
                  disabled={removing === f.id || checking === f.id}
                  onClick={() => void remove(f)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p role="alert">{error}</p>}
      {feeds && feeds.length > 0 && (
        <div className="rd-dlg-foot">
          <button
            type="button"
            className="rd-dlg-btn ghost"
            disabled={busy !== "" || checking !== ""}
            onClick={() => void sync()}
          >
            <RefreshCw
              size={14}
              className={busy === "sync" ? "spin" : undefined}
            />
            {busy === "sync" ? "Revisando…" : "Revisar ahora"}
          </button>
        </div>
      )}
    </ReaderDialog>
  );
}

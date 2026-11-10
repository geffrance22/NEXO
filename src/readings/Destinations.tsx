import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Folder,
  LoaderCircle,
  NotebookPen,
  Plus,
  Search,
} from "lucide-react";
import { supabase } from "../backend";
import { errorMessage, normalizeText } from "../lib/format";
import type { Card } from "./library";

/** Un cuaderno de Lecturas, tal como lo muestra el menú. */
export type Shelf = { id: string; name: string; created_at?: string };

/** Cuadernos visibles a la vez (los demás se encuentran con el buscador). */
const SHOWN = 3;
const WIDTH = 300;
const NEW_FOLDER = "\u0000nueva";

/** Última lista de cuadernos: el menú se abre ya con ella y se refresca de fondo. */
let cache: Shelf[] | null = null;

/** Los cuadernos, del más reciente al más antiguo (sin la migración 202611100005, por nombre). */
async function loadShelves(): Promise<Shelf[]> {
  const fresh = await supabase
    .from("reading_books")
    .select("id,name,created_at")
    .order("created_at", { ascending: false });
  if (!fresh.error) return fresh.data as Shelf[];
  const old = await supabase.from("reading_books").select("id,name").order("name");
  if (old.error) throw old.error;
  return old.data as Shelf[];
}

/**
 * Menú «Decidir destino» de una tarjeta: enviarla a un cuaderno (los 3 más recientes, un
 * buscador y crear uno con lo que escribes), moverla de carpeta o archivarla. Va en un portal
 * junto al botón que lo abrió y se cierra al tocar fuera, con Esc o al desplazar la lista.
 */
export function Destinations({
  card,
  anchor,
  folders,
  onClose,
  onFolder,
  onArchive,
  onNotebook,
}: {
  card: Card;
  anchor: DOMRect;
  folders: string[];
  onClose: () => void;
  /** Mover a otra carpeta ("" la saca de su carpeta). */
  onFolder: (folder: string) => void;
  onArchive: () => void;
  /** Entró (`added`) o salió de un cuaderno. */
  onNotebook: (book: Shelf, added: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const [books, setBooks] = useState<Shelf[] | null>(cache);
  const [member, setMember] = useState<ReadonlySet<string> | null>(null);
  const [q, setQ] = useState("");
  /** El cuaderno que se está guardando («new»: uno que se crea). */
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const search = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  // Con ratón, el buscador queda listo para escribir en cuanto el menú se ve (oculto no admite
  // el foco); en el móvil no se abre el teclado solo.
  useEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    if (window.matchMedia("(pointer: fine)").matches)
      search.current?.focus({ preventScroll: true });
  }, [pos]);

  // Cuadernos y en cuáles está ya este artículo.
  useEffect(() => {
    let live = true;
    Promise.all([
      loadShelves(),
      supabase.from("reading_book_articles").select("book_id").eq("reading_id", card.id),
    ])
      .then(([list, m]) => {
        if (!live) return;
        cache = list;
        setBooks(list);
        if (m.error) throw m.error;
        setMember(new Set((m.data ?? []).map((r) => r.book_id as string)));
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [card.id]);

  // Junto al botón, alineado a su borde derecho; arriba si abajo no cabe.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.min(Math.max(8, anchor.right - WIDTH), vw - WIDTH - 8);
      const below = anchor.bottom + 6;
      const up = below + h > vh - 8 && anchor.top - h - 6 >= 8;
      const y = up ? anchor.top - h - 6 : Math.max(8, Math.min(below, vh - h - 8));
      setPos((p) => (p && p.x === x && p.y === y && p.up === up ? p : { x, y, up }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      // El mismo botón lo cierra con su clic (si no, se volvería a abrir).
      if (t.closest?.('.rd-dest-btn[aria-expanded="true"]')) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // En el nombre de una carpeta nueva, Esc solo cancela esa carpeta.
      if ((e.target as HTMLElement | null)?.closest?.(".rd-dest-folder")) return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    const scroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const resize = () => close.current();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const needle = normalizeText(q.trim());
  const matches = (books ?? []).filter(
    (b) => !needle || normalizeText(b.name).includes(needle),
  );
  const shown = matches.slice(0, SHOWN);
  const hidden = matches.length - shown.length;
  const exact = (books ?? []).find((b) => normalizeText(b.name.trim()) === needle);
  const canCreate = Boolean(needle) && !exact && books !== null;
  // Los cuadernos donde ya está, aunque no salgan entre los 3 de la lista.
  const inside = (books ?? []).filter((b) => member?.has(b.id));

  async function toggle(b: Shelf) {
    if (busy || !member) return;
    const had = member.has(b.id);
    const flip = (s: ReadonlySet<string> | null, on: boolean) => {
      const next = new Set(s);
      if (on) next.add(b.id);
      else next.delete(b.id);
      return next;
    };
    setBusy(b.id);
    setError("");
    setMember((s) => flip(s, !had));
    const { error } = had
      ? await supabase
          .from("reading_book_articles")
          .delete()
          .eq("book_id", b.id)
          .eq("reading_id", card.id)
      : await supabase
          .from("reading_book_articles")
          .insert({ book_id: b.id, reading_id: card.id });
    setBusy("");
    // Ya estaba (p. ej. lo añadiste desde el panel): cuenta como hecho.
    if (error && error.code !== "23505") {
      setMember((s) => flip(s, had));
      setError(errorMessage(error));
      return;
    }
    onNotebook(b, !had);
  }

  async function create() {
    const name = q.trim().slice(0, 100);
    if (!name || busy) return;
    setBusy("new");
    setError("");
    try {
      const { data, error } = await supabase
        .from("reading_books")
        .insert({ name })
        .select("id,name")
        .single();
      if (error) throw error;
      const book: Shelf = { id: data.id, name: data.name, created_at: new Date().toISOString() };
      const list = [book, ...(books ?? [])];
      cache = list;
      setBooks(list);
      const link = await supabase
        .from("reading_book_articles")
        .insert({ book_id: book.id, reading_id: card.id });
      if (link.error) throw link.error;
      setMember((s) => new Set(s).add(book.id));
      setQ("");
      onNotebook(book, true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  const allFolders =
    card.folder && !folders.includes(card.folder) ? [card.folder, ...folders] : folders;
  const moveTo = (value: string) => {
    const v = value.trim().slice(0, 80);
    if (v === card.folder) return setNewFolder(null);
    onFolder(v);
  };

  return createPortal(
    <div
      ref={ref}
      className={"rd-dest" + (pos?.up ? " up" : "")}
      role="dialog"
      aria-label={`Destino de «${card.title}»`}
      style={{
        width: WIDTH,
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <header className="rd-dest-head">
        <small>Enviar a</small>
        <strong title={card.title}>{card.title}</strong>
      </header>

      <section className="rd-dest-sec" aria-label="Cuadernos">
        <div className="rd-dest-label">
          <NotebookPen size={13} aria-hidden="true" />
          <span>Cuaderno</span>
          {inside.length > 0 && (
            <em title={inside.map((b) => b.name).join(" · ")}>
              {inside.length === 1
                ? `En «${inside[0].name.slice(0, 22)}»`
                : `En ${inside.length} cuadernos`}
            </em>
          )}
        </div>
        <form
          className="rd-dest-search"
          onSubmit={(e) => {
            e.preventDefault();
            // Enter: el que se llama así o el primero que coincide; si ninguno, se crea.
            if (!needle) return;
            const target = exact ?? matches[0];
            if (target) void toggle(target);
            else if (canCreate) void create();
          }}
        >
          <Search size={14} aria-hidden="true" />
          <input
            ref={search}
            value={q}
            maxLength={100}
            placeholder="Buscar o crear un cuaderno…"
            aria-label="Buscar o crear un cuaderno"
            onChange={(e) => setQ(e.target.value)}
          />
          {busy === "new" && <LoaderCircle size={14} className="spin" />}
        </form>
        {books === null ? (
          <div className="rd-dest-skel" aria-hidden="true">
            <i />
            <i />
          </div>
        ) : (
          <ul className="rd-dest-books">
            {shown.map((b) => {
              const on = Boolean(member?.has(b.id));
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={on ? "on" : ""}
                    aria-pressed={on}
                    disabled={!member || Boolean(busy)}
                    onClick={() => void toggle(b)}
                  >
                    <span className="rd-dest-box" aria-hidden="true">
                      {busy === b.id ? (
                        <LoaderCircle size={12} className="spin" />
                      ) : (
                        on && <Check size={12} strokeWidth={3} />
                      )}
                    </span>
                    <span className="rd-dest-name">{b.name}</span>
                    <small>{on ? "Quitar" : "Añadir"}</small>
                  </button>
                </li>
              );
            })}
            {canCreate && (
              <li>
                <button
                  type="button"
                  className="rd-dest-new"
                  disabled={Boolean(busy)}
                  onClick={() => void create()}
                >
                  <span className="rd-dest-box" aria-hidden="true">
                    <Plus size={12} strokeWidth={3} />
                  </span>
                  <span className="rd-dest-name">
                    Crear «{q.trim().slice(0, 40)}»
                  </span>
                </button>
              </li>
            )}
            {!shown.length && !canCreate && (
              <li className="rd-dest-empty">
                {books.length
                  ? "Nada coincide."
                  : "Aún no tienes cuadernos: escribe un nombre para crear el primero."}
              </li>
            )}
            {hidden > 0 && (
              <li className="rd-dest-more">
                {needle
                  ? `+${hidden} más · afina la búsqueda`
                  : `+${hidden} más · búscalos por nombre`}
              </li>
            )}
          </ul>
        )}
        {error && (
          <p className="rd-dest-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="rd-dest-sec" aria-label="Carpeta">
        <div className="rd-dest-label">
          <Folder size={13} aria-hidden="true" />
          <span>Carpeta</span>
        </div>
        {newFolder === null ? (
          <label className="rd-dest-select">
            <select
              aria-label="Mover a carpeta"
              value={card.folder}
              onChange={(e) =>
                e.target.value === NEW_FOLDER ? setNewFolder("") : moveTo(e.target.value)
              }
            >
              <option value="">Sin carpeta</option>
              {allFolders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value={NEW_FOLDER}>＋ Nueva carpeta…</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        ) : (
          <form
            className="rd-dest-folder"
            onSubmit={(e) => {
              e.preventDefault();
              if (newFolder.trim()) moveTo(newFolder);
            }}
          >
            <input
              autoFocus
              value={newFolder}
              maxLength={80}
              placeholder="Nombre de la carpeta"
              aria-label="Nombre de la carpeta nueva"
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopPropagation();
                setNewFolder(null);
              }}
            />
            <button type="submit" disabled={!newFolder.trim()}>
              Mover
            </button>
          </form>
        )}
      </section>

      <button type="button" className="rd-dest-archive" onClick={onArchive}>
        {card.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        <span>{card.archived ? "Desarchivar" : "Archivar"}</span>
        <small>{card.archived ? "Vuelve a tu lista" : "Sale de tu lista"}</small>
      </button>
    </div>,
    document.body,
  );
}

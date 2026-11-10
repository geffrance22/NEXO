import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as RKeyboardEvent,
  type MouseEvent as RMouseEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ImagePlus,
  LayoutDashboard,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Star,
  Tag,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../AppContext";
import { Sheet } from "../components/Sheet";
import { LoadMore, useInfinite } from "../components/LoadMore";
import { normalizeText } from "../lib/format";
import { SortMenu } from "../library/Collection";
import { MenuItem, Popover } from "../planner/BoardPopover";
import { CapLightbox } from "./CapLightbox";
import { CaptureForm } from "./CaptureForm";
import { downloadShot, downloadZip } from "./download";
import {
  capSortLabels,
  childrenMap,
  flatTree,
  formatBytes,
  imageFiles,
  pathOf,
  shotDate,
  sortShots,
  subtree,
  type CapFolder,
  type CapScope,
  type CapSort,
  type CapView,
  type Shot,
} from "./model";
import { rememberFolder, savedFolder, takeShotToOpen } from "./nav";
import {
  CAPTURAS_MIGRATION,
  createFolder,
  locationsOf,
  moveItems,
  removeItems,
  renameFolder,
  restoreLocations,
  setArchived,
  setFavorite,
  updateShot,
  useCapturas,
} from "./useCapturas";
import { quickUpload, uploadsState } from "./uploads";
import "./capturas.css";

// Clave nueva: el mosaico pasa a ser la vista por defecto (también para quien ya había elegido otra).
const VIEW_KEY = "nexo-cap-vista";
const SORT_KEY = "nexo-cap-sort";
const DRAG_MIME = "application/x-nexo-capturas";
const SORTS: CapSort[] = ["reciente", "antiguo", "nombre", "peso"];
const VIEWS: { id: CapView; label: string; icon: LucideIcon }[] = [
  { id: "cuadricula", label: "Cuadrícula", icon: LayoutGrid },
  { id: "mosaico", label: "Mosaico", icon: LayoutDashboard },
  { id: "lista", label: "Lista", icon: List },
];
const fk = (id: string) => "f:" + id;
const sk = (id: string) => "s:" + id;
const split = (keys: Iterable<string>) => {
  const folders: string[] = [];
  const shots: string[] = [];
  for (const k of keys) (k.startsWith("f:") ? folders : shots).push(k.slice(2));
  return { folders, shots };
};
const read = <T extends string>(key: string, allowed: T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* sin almacenamiento */
  }
};
const overlayOpen = () =>
  Boolean(
    document.querySelector(
      ".sheet-backdrop, .cap-lb, .confirm-backdrop, .bd-pop, .lightbox",
    ),
  );
const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || Boolean(t.closest("input,textarea,select")));
/** «Guardar captura» está minimizado: lo pegado o soltado se sube directo. */
const docked = () => {
  const d = uploadsState().draft;
  return Boolean(d && !d.open);
};
const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type MenuState = { anchor: DOMRect; key: string | null };

/**
 * CAPTURAS (Libroteca): un Drive de imágenes. Carpetas dentro de carpetas, tres vistas, arrastrar
 * para mover, Ctrl+V para subir, selección múltiple, descargas en ZIP y un visor a pantalla completa.
 */
export function Capturas({
  query,
  uploadTick,
  onUploadHandled,
}: {
  query: string;
  uploadTick: number;
  onUploadHandled: () => void;
}) {
  const { confirm, notify } = useApp();
  const store = useCapturas();
  const folders = store.folders ?? [];
  const shots = store.shots ?? [];
  const ready = store.shots !== null && store.folders !== null;

  const [folder, setFolderState] = useState<string | null>(savedFolder);
  const [view, setViewState] = useState<CapView>(() =>
    read(
      VIEW_KEY,
      VIEWS.map((v) => v.id),
      "mosaico",
    ),
  );
  const [sort, setSortState] = useState<CapSort>(() =>
    read(SORT_KEY, SORTS, "reciente"),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorKey = useRef<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [viewerSolo, setViewerSolo] = useState(false);
  const [form, setForm] = useState<{
    files: File[];
    folder: string | null;
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [scope, setScopeState] = useState<CapScope>("todo");
  const [tag, setTagState] = useState<string | null>(null);

  const setFolder = useCallback((id: string | null) => {
    setFolderState(id);
    rememberFolder(id);
    setSelected(new Set());
    setCreating(false);
    setRenaming(null);
  }, []);
  const setScope = (s: CapScope) => {
    setScopeState(s);
    setSelected(new Set());
    setCreating(false);
    setRenaming(null);
  };
  const setTag = (t: string | null) => {
    setTagState(t);
    setSelected(new Set());
  };
  const setView = (v: CapView) => {
    setViewState(v);
    write(VIEW_KEY, v);
  };
  const setSort = (v: CapSort) => {
    setSortState(v);
    write(SORT_KEY, v);
  };

  // Una carpeta que ya no existe (borrada en otra pestaña): de vuelta a la raíz.
  useEffect(() => {
    if (ready && folder && !folders.some((f) => f.id === folder))
      setFolder(null);
  }, [ready, folder, folders, setFolder]);
  // «Ver en CAPTURAS» desde la ventana flotante.
  useEffect(() => {
    const open = (e: Event) =>
      setFolder((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener("nexo:capturas-folder", open);
    return () => window.removeEventListener("nexo:capturas-folder", open);
  }, [setFolder]);
  // «Subir capturas» del encabezado de Libroteca.
  useEffect(() => {
    if (!uploadTick) return;
    setForm({ files: [], folder });
    onUploadHandled();
  }, [uploadTick]);
  // Una captura elegida en el buscador global: se abre en su carpeta (o en «Archivadas»).
  const [toOpen, setToOpen] = useState<string | null>(null);
  useEffect(() => {
    const first = takeShotToOpen();
    if (first) setToOpen(first);
    const open = (e: Event) =>
      setToOpen(takeShotToOpen() ?? (e as CustomEvent<string>).detail);
    window.addEventListener("nexo:capturas-shot", open);
    return () => window.removeEventListener("nexo:capturas-shot", open);
  }, []);
  useEffect(() => {
    if (!toOpen || !ready) return;
    setToOpen(null);
    const s = shots.find((x) => x.id === toOpen);
    if (!s) return notify("Esa captura ya no existe.");
    setScope(s.archived_at ? "archivadas" : "todo");
    setTagState(null);
    setFolder(s.archived_at ? null : s.folder_id);
    // Si la búsqueda de Libroteca la deja fuera, el visor la muestra sola.
    setViewerSolo(
      searching &&
        !normalizeText([s.name, s.note, s.tags.join(" ")].join(" ")).includes(
          needle,
        ),
    );
    setViewer(s.id);
  }, [toOpen, ready, shots]);

  const kids = useMemo(() => childrenMap(folders), [folders]);
  /** Las archivadas no están en sus carpetas: solo en «Archivadas». */
  const activeShots = useMemo(
    () => shots.filter((s) => !s.archived_at),
    [shots],
  );
  const archivedCount = shots.length - activeShots.length;
  const byFolder = useMemo(() => {
    const m = new Map<string | null, Shot[]>();
    for (const s of activeShots) {
      const list = m.get(s.folder_id) ?? [];
      list.push(s);
      m.set(s.folder_id, list);
    }
    return m;
  }, [activeShots]);
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  );
  const folderLabel = useCallback(
    (s: Shot) =>
      s.folder_id && folderById.has(s.folder_id)
        ? ["CAPTURAS", ...pathOf(folders, s.folder_id).map((f) => f.name)].join(
            " › ",
          )
        : "CAPTURAS",
    [folders, folderById],
  );

  const needle = normalizeText(query.trim());
  const searching = needle !== "";
  /** Sin carpetas: búsqueda, filtro por etiqueta, favoritas o archivadas (todo de una vez). */
  const flat = searching || tag !== null || scope !== "todo";
  const scopeShots = useMemo(
    () =>
      scope === "favoritas"
        ? activeShots.filter((s) => s.favorite)
        : scope === "archivadas"
          ? shots.filter((s) => s.archived_at)
          : activeShots,
    [scope, shots, activeShots],
  );
  /** Etiquetas de lo que se ve (sin importar mayúsculas), de la más usada a la menos. */
  const tagCounts = useMemo(() => {
    const m = new Map<string, [string, number]>();
    for (const s of scopeShots)
      for (const t of s.tags) {
        const k = t.toLowerCase();
        const cur = m.get(k);
        if (cur) cur[1]++;
        else m.set(k, [t, 1]);
      }
    return [...m.values()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"),
    );
  }, [scopeShots]);
  const shownFolders = useMemo(() => {
    if (scope !== "todo" || tag !== null) return [];
    if (searching)
      return folders.filter((f) => normalizeText(f.name).includes(needle));
    return kids.get(folder) ?? [];
  }, [scope, tag, searching, needle, folders, kids, folder]);
  const shownShots = useMemo(() => {
    let base = flat ? scopeShots : (byFolder.get(folder) ?? []);
    if (tag !== null)
      base = base.filter((s) => s.tags.some((t) => sameTag(t, tag)));
    if (searching)
      base = base.filter((s) =>
        normalizeText([s.name, s.note, s.tags.join(" ")].join(" ")).includes(
          needle,
        ),
      );
    return sortShots(base, sort);
  }, [flat, scopeShots, byFolder, folder, tag, searching, needle, sort]);
  const pager = useInfinite(
    shownShots,
    view === "lista" ? 120 : 90,
    [folder, needle, sort, view, scope, tag].join("|"),
  );
  const order = useMemo(
    () => [
      ...shownFolders.map((f) => fk(f.id)),
      ...pager.visible.map((s) => sk(s.id)),
    ],
    [shownFolders, pager.visible],
  );
  const path = useMemo(() => pathOf(folders, folder), [folders, folder]);
  const here = folder ? folderById.get(folder) : undefined;
  const totalSize = useMemo(
    () => activeShots.reduce((n, s) => n + s.size, 0),
    [activeShots],
  );

  // ───────── Selección ─────────
  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (e: RMouseEvent, key: string, open: () => void) => {
    if (e.shiftKey && anchorKey.current) {
      const a = order.indexOf(anchorKey.current);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(
          (s) =>
            new Set([
              ...(e.ctrlKey || e.metaKey ? s : []),
              ...order.slice(from, to + 1),
            ]),
        );
        return;
      }
    }
    anchorKey.current = key;
    if (e.ctrlKey || e.metaKey || selected.size) toggle(key);
    else open();
  };
  const clear = () => setSelected(new Set());
  const openShot = (id: string) => setViewer(id);
  // Al cerrar el visor, la última foto vista queda a la vista en la pestaña (aunque estuviera
  // más abajo de lo cargado).
  const [reveal, setReveal] = useState<string | null>(null);
  const closeViewer = (lastId: string | null) => {
    setViewer(null);
    setViewerSolo(false);
    if (!lastId) return;
    const i = shownShots.findIndex((s) => s.id === lastId);
    if (i < 0) return;
    pager.reach(i + 1);
    setReveal(lastId);
  };
  useEffect(() => {
    if (!reveal) return;
    const el = document.querySelector<HTMLElement>(
      `[data-shot="${CSS.escape(reveal)}"]`,
    );
    if (!el) return;
    setReveal(null);
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
  }, [reveal, pager.visible]);

  // ───────── Acciones ─────────
  const openForm = (files: File[], target: string | null = folder) =>
    setForm({ files, folder: target });
  /** Lo soltado: con «Guardar captura» minimizado se sube directo; si no, abre el formulario. */
  const dropFiles = (files: File[], target: string | null = folder) => {
    if (!docked()) return openForm(files, target);
    const warn = quickUpload(files, target);
    if (warn) notify(warn);
  };

  async function askDelete(keys: string[]) {
    const { folders: fIds, shots: sIds } = split(keys);
    const inside = subtree(folders, fIds);
    const shotCount = new Set([
      ...sIds,
      ...shots
        .filter((s) => s.folder_id && inside.has(s.folder_id))
        .map((s) => s.id),
    ]).size;
    const what =
      fIds.length && sIds.length
        ? `${keys.length} elementos`
        : fIds.length === 1
          ? `la carpeta «${folderById.get(fIds[0])?.name ?? ""}»`
          : fIds.length
            ? `${fIds.length} carpetas`
            : sIds.length === 1
              ? "esta captura"
              : `${sIds.length} capturas`;
    const ok = await confirm({
      title: `¿Eliminar ${what}?`,
      message:
        (fIds.length && shotCount
          ? `Incluye ${shotCount} ${shotCount === 1 ? "captura" : "capturas"} de dentro. `
          : "") + "También se borran de YourImageShare. No se puede deshacer.",
      confirmLabel: "Eliminar",
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    if (folder && inside.has(folder))
      setFolder(
        here?.parent_id && !inside.has(here.parent_id) ? here.parent_id : null,
      );
    const res = await removeItems({ folders: fIds, shots: sIds });
    if (typeof res === "string") return notify(res);
    setSelected((s) => new Set([...s].filter((k) => !keys.includes(k))));
    notify(
      fIds.length
        ? fIds.length === 1
          ? "Carpeta eliminada."
          : `${fIds.length} carpetas eliminadas.`
        : res === 1
          ? "Captura eliminada."
          : `${res} capturas eliminadas.`,
    );
  }

  async function moveTo(keys: string[], target: string | null) {
    const { folders: fIds, shots: sIds } = split(keys);
    if (target && subtree(folders, fIds).has(target)) {
      return notify("Una carpeta no puede ir dentro de sí misma.");
    }
    const before = locationsOf(fIds, sIds);
    const res = await moveItems({ folders: fIds, shots: sIds }, target);
    if (typeof res === "string") return notify(res);
    if (!res) return;
    clear();
    const name = target ? folderById.get(target)?.name : "CAPTURAS";
    notify(
      `${res === 1 ? "1 elemento movido" : `${res} elementos movidos`} a «${name}».`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () =>
          void restoreLocations(before).then((r) =>
            notify(typeof r === "string" ? r : "Movimiento deshecho."),
          ),
      },
    );
  }

  async function favorite(ids: string[], value: boolean) {
    const res = await setFavorite(ids, value);
    if (typeof res === "string") notify(res);
  }

  async function archive(ids: string[], value: boolean) {
    const res = await setArchived(ids, value);
    if (typeof res === "string") return notify(res);
    if (!res.length) return;
    const gone = new Set(res.map(sk));
    setSelected((s) => new Set([...s].filter((k) => !gone.has(k))));
    const n = res.length;
    notify(
      value
        ? n === 1
          ? "Captura archivada."
          : `${n} capturas archivadas.`
        : n === 1
          ? "Captura devuelta a su carpeta."
          : `${n} capturas devueltas a sus carpetas.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () =>
          void setArchived(res, !value).then(
            (r) => typeof r === "string" && notify(r),
          ),
      },
    );
  }

  function zip(keys: string[] | "here") {
    if (keys === "here") {
      if (!folder)
        return void downloadZip({
          name: "CAPTURAS",
          folders: "root",
          allFolders: folders,
          allShots: shots,
        });
      return void downloadZip({
        name: here?.name ?? "Carpeta",
        folders: [folder],
        allFolders: folders,
        allShots: shots,
      });
    }
    const { folders: fIds, shots: sIds } = split(keys);
    const name =
      fIds.length === 1 && !sIds.length
        ? (folderById.get(fIds[0])?.name ?? "Carpeta")
        : `CAPTURAS (${keys.length})`;
    void downloadZip({
      name,
      folders: fIds,
      shots: sIds,
      allFolders: folders,
      allShots: shots,
    });
  }

  async function copyLink(shot: Shot) {
    try {
      await navigator.clipboard.writeText(shot.src);
      notify("Enlace copiado.");
    } catch {
      notify("No se pudo copiar el enlace.");
    }
  }

  async function finishRename(key: string, value: string | null) {
    setRenaming(null);
    if (value === null) return;
    const id = key.slice(2);
    const res = key.startsWith("f:")
      ? folderById.get(id)?.name !== value.trim() &&
        (await renameFolder(id, value))
      : shots.find((s) => s.id === id)?.name !== value.trim() &&
        (await updateShot(id, { name: value }));
    if (typeof res === "string") notify(res);
  }

  async function finishCreate(value: string | null) {
    setCreating(false);
    if (value === null || !value.trim()) return;
    const res = await createFolder(value, folder);
    if (typeof res === "string") notify(res);
  }

  // ───────── Teclado y portapapeles ─────────
  const keysRef = useRef({ order, selected, renaming, creating });
  keysRef.current = { order, selected, renaming, creating };
  const actions = useRef({ askDelete, clear, openForm });
  actions.current = { askDelete, clear, openForm };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (overlayOpen() || docked()) return;
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      actions.current.openForm(files);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlayOpen() || editable(e.target)) return;
      const { order, selected, renaming, creating } = keysRef.current;
      if (renaming || creating) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(order));
      } else if (e.key === "Escape" && selected.size) {
        e.preventDefault();
        actions.current.clear();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selected.size
      ) {
        e.preventDefault();
        void actions.current.askDelete([...selected]);
      } else if (e.key === "F2" && selected.size === 1) {
        e.preventDefault();
        setRenaming([...selected][0]);
      }
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // ───────── Arrastrar ─────────
  const ghost = useRef<HTMLElement | null>(null);
  const onDragStart = (e: DragEvent, key: string) => {
    const keys = selected.has(key) ? [...selected] : [key];
    if (!selected.has(key)) setSelected(new Set([key]));
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys));
    e.dataTransfer.effectAllowed = "move";
    if (keys.length > 1) {
      const el = document.createElement("div");
      el.className = "cap-ghost";
      el.textContent = `${keys.length} elementos`;
      document.body.append(el);
      e.dataTransfer.setDragImage(el, 18, 18);
      ghost.current = el;
    }
  };
  const onDragEnd = () => {
    ghost.current?.remove();
    ghost.current = null;
    setOver(null);
  };
  const isOurs = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes(DRAG_MIME);
  const isFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");
  /** Props para algo donde se puede soltar (una carpeta o un tramo de la ruta). */
  const dropTarget = (target: string | null) => {
    const id = "t:" + (target ?? "root");
    return {
      "data-over": over === id || undefined,
      onDragOver: (e: DragEvent) => {
        if (!isOurs(e) && !isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = isOurs(e) ? "move" : "copy";
        if (over !== id) setOver(id);
        if (isFiles(e)) setFileDrag(false);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver((o) => (o === id ? null : o));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        setFileDrag(false);
        if (isOurs(e)) {
          try {
            const keys = JSON.parse(
              e.dataTransfer.getData(DRAG_MIME),
            ) as string[];
            if (keys.includes(fk(target ?? ""))) return;
            void moveTo(keys, target);
          } catch {
            /* nada que mover */
          }
        } else {
          const files = imageFiles(e.dataTransfer.files);
          if (files.length) dropFiles(files, target);
        }
      },
    };
  };

  // ───────── Menú contextual ─────────
  const openMenu = (e: RMouseEvent, key: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (key && !selected.has(key)) setSelected(new Set([key]));
    const rect =
      e.type === "contextmenu"
        ? new DOMRect(e.clientX, e.clientY, 0, 0)
        : (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ anchor: rect, key });
  };
  const menuKeys = menu?.key
    ? selected.has(menu.key) && selected.size > 1
      ? [...selected]
      : [menu.key]
    : [];
  const runMenu = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  let menuBody: ReactNode = null;
  if (menu) {
    if (!menu.key) {
      menuBody = (
        <>
          <MenuItem
            icon={<FolderPlus size={15} />}
            onClick={runMenu(() => setCreating(true))}
          >
            Nueva carpeta
          </MenuItem>
          <MenuItem
            icon={<UploadCloud size={15} />}
            onClick={runMenu(() => openForm([]))}
          >
            Subir capturas
          </MenuItem>
          <MenuItem
            icon={<Download size={15} />}
            onClick={runMenu(() => zip("here"))}
          >
            Descargar {folder ? "esta carpeta" : "todo"} (ZIP)
          </MenuItem>
        </>
      );
    } else if (menuKeys.length > 1) {
      const multiShots = split(menuKeys).shots;
      const allFav =
        multiShots.length > 0 &&
        multiShots.every((id) => shots.find((s) => s.id === id)?.favorite);
      menuBody = (
        <>
          <div className="bd-pop-title">{menuKeys.length} seleccionados</div>
          <MenuItem
            icon={<FolderInput size={15} />}
            onClick={runMenu(() => setMoving(menuKeys))}
          >
            Mover a…
          </MenuItem>
          {multiShots.length > 0 && (
            <MenuItem
              icon={<Star size={15} />}
              onClick={runMenu(() => void favorite(multiShots, !allFav))}
            >
              {allFav ? "Quitar de favoritas" : "Añadir a favoritas"}
            </MenuItem>
          )}
          {multiShots.length > 0 && (
            <MenuItem
              icon={
                scope === "archivadas" ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Archive size={15} />
                )
              }
              onClick={runMenu(
                () => void archive(multiShots, scope !== "archivadas"),
              )}
            >
              {scope === "archivadas" ? "Desarchivar" : "Archivar"}
            </MenuItem>
          )}
          <MenuItem
            icon={<Download size={15} />}
            onClick={runMenu(() => zip(menuKeys))}
          >
            Descargar ZIP
          </MenuItem>
          <div className="bd-pop-sep" />
          <MenuItem
            danger
            icon={<Trash2 size={15} />}
            onClick={runMenu(() => void askDelete(menuKeys))}
          >
            Eliminar
          </MenuItem>
        </>
      );
    } else {
      const key = menu.key;
      const id = key.slice(2);
      const isFolder = key.startsWith("f:");
      const shot = isFolder ? undefined : shots.find((s) => s.id === id);
      menuBody = (
        <>
          <MenuItem
            icon={isFolder ? <FolderOpen size={15} /> : <ImagePlus size={15} />}
            onClick={runMenu(() => (isFolder ? setFolder(id) : openShot(id)))}
          >
            Abrir
          </MenuItem>
          <MenuItem
            icon={<Pencil size={15} />}
            hint="F2"
            onClick={runMenu(() => setRenaming(key))}
          >
            Cambiar nombre
          </MenuItem>
          <MenuItem
            icon={<FolderInput size={15} />}
            onClick={runMenu(() => setMoving([key]))}
          >
            Mover a…
          </MenuItem>
          {shot && (
            <MenuItem
              icon={<Copy size={15} />}
              onClick={runMenu(() => void copyLink(shot))}
            >
              Copiar enlace
            </MenuItem>
          )}
          <MenuItem
            icon={<Download size={15} />}
            onClick={runMenu(() =>
              shot ? void downloadShot(shot) : zip([key]),
            )}
          >
            {shot ? "Descargar" : "Descargar ZIP"}
          </MenuItem>
          {shot && (
            <MenuItem
              icon={
                shot.archived_at ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Archive size={15} />
                )
              }
              onClick={runMenu(
                () => void archive([shot.id], !shot.archived_at),
              )}
            >
              {shot.archived_at ? "Desarchivar" : "Archivar"}
            </MenuItem>
          )}
          <div className="bd-pop-sep" />
          <MenuItem
            danger
            icon={<Trash2 size={15} />}
            hint="Supr"
            onClick={runMenu(() => void askDelete([key]))}
          >
            Eliminar
          </MenuItem>
        </>
      );
    }
  }

  // Manejadores fijos por elemento (leen lo actual a través de `live`): así las tarjetas
  // memorizadas no se vuelven a pintar todas cada vez que cambia algo en la pestaña.
  const toggleStar = (id: string) => {
    const s = shots.find((x) => x.id === id);
    if (s) void favorite([id], !s.favorite);
  };
  const live = useRef({
    pick,
    toggle,
    openMenu,
    onDragStart,
    onDragEnd,
    finishRename,
    setFolder,
    openShot,
    toggleStar,
  });
  live.current = {
    pick,
    toggle,
    openMenu,
    onDragStart,
    onDragEnd,
    finishRename,
    setFolder,
    openShot,
    toggleStar,
  };
  const handlers = useRef(new Map<string, ItemHandlers>());
  const handlersFor = (key: string): ItemHandlers => {
    let h = handlers.current.get(key);
    if (!h) {
      const id = key.slice(2);
      const open = () =>
        key.startsWith("f:")
          ? live.current.setFolder(id)
          : live.current.openShot(id);
      h = {
        onPick: (e) => live.current.pick(e, key, open),
        onToggle: () => {
          anchorKey.current = key;
          live.current.toggle(key);
        },
        onMenu: (e) => live.current.openMenu(e, key),
        onDragStart: (e) => live.current.onDragStart(e, key),
        onDragEnd: () => live.current.onDragEnd(),
        onRename: (v) => void live.current.finishRename(key, v),
        onStar: () => live.current.toggleStar(id),
      };
      handlers.current.set(key, h);
    }
    return h;
  };

  // ───────── Pintar ─────────
  if (store.missing)
    return (
      <div className="cap-missing">
        <HardDrive size={20} />
        <strong>CAPTURAS necesita sus tablas.</strong>
        <span>
          Ejecuta <code>{CAPTURAS_MIGRATION}</code> en Supabase y despliega la
          función <code>screenshots</code>.
        </span>
      </div>
    );
  if (!ready) return <CapSkeleton view={view} />;

  const selCount = selected.size;
  const selShots = split(selected).shots;
  const counts = (id: string) => ({
    shots: byFolder.get(id)?.length ?? 0,
    folders: kids.get(id)?.length ?? 0,
  });
  const itemProps = (key: string) => ({
    selected: selected.has(key),
    selecting: selCount > 0,
    renaming: renaming === key,
    ...handlersFor(key),
  });
  const empty = !shownFolders.length && !shownShots.length && !creating;

  return (
    <>
      <div
        className={"cap cap-" + view + (fileDrag ? " file-drag" : "")}
        onContextMenu={(e) => {
          if (
            (e.target as HTMLElement).closest(
              ".cap-item, .cap-bar, input, textarea",
            )
          )
            return;
          openMenu(e, null);
        }}
        onClick={(e) => {
          if (selCount && e.target === e.currentTarget) clear();
        }}
        onDragOver={(e) => {
          if (!isFiles(e)) return;
          e.preventDefault();
          setFileDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setFileDrag(false);
        }}
        onDrop={(e) => {
          if (!isFiles(e)) return;
          e.preventDefault();
          setFileDrag(false);
          const files = imageFiles(e.dataTransfer.files);
          if (files.length) dropFiles(files);
        }}
      >
        <div className={"cap-bar" + (selCount ? " selecting" : "")}>
          {selCount ? (
            <>
              <button
                type="button"
                className="cap-bar-x"
                aria-label="Quitar selección"
                onClick={clear}
              >
                <X size={16} />
              </button>
              <strong className="cap-sel-count">
                {selCount} {selCount === 1 ? "seleccionado" : "seleccionados"}
              </strong>
              <button
                type="button"
                className="cap-link"
                onClick={() => setSelected(new Set(order))}
                disabled={selCount === order.length}
              >
                Seleccionar todo
              </button>
              <div className="cap-bar-end">
                <button
                  type="button"
                  className="lt-tool"
                  onClick={() => setMoving([...selected])}
                >
                  <FolderInput size={14} /> <span>Mover</span>
                </button>
                <button
                  type="button"
                  className="lt-tool"
                  onClick={() => zip([...selected])}
                >
                  <Download size={14} /> <span>ZIP</span>
                </button>
                {selShots.length > 0 && (
                  <button
                    type="button"
                    className="lt-tool"
                    onClick={() =>
                      void archive(selShots, scope !== "archivadas")
                    }
                  >
                    {scope === "archivadas" ? (
                      <ArchiveRestore size={14} />
                    ) : (
                      <Archive size={14} />
                    )}{" "}
                    <span>
                      {scope === "archivadas" ? "Desarchivar" : "Archivar"}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="lt-tool danger"
                  onClick={() => void askDelete([...selected])}
                >
                  <Trash2 size={14} /> <span>Eliminar</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {searching ? (
                <p className="cap-found">
                  {shownShots.length + shownFolders.length}{" "}
                  {shownShots.length + shownFolders.length === 1
                    ? "resultado"
                    : "resultados"}{" "}
                  en{" "}
                  {scope === "favoritas"
                    ? "Favoritas"
                    : scope === "archivadas"
                      ? "Archivadas"
                      : "CAPTURAS"}
                </p>
              ) : scope !== "todo" || tag !== null ? (
                <nav className="cap-crumbs" aria-label="Ruta">
                  <button
                    type="button"
                    onClick={() => {
                      setScope("todo");
                      setTag(null);
                    }}
                  >
                    <HardDrive size={14} /> CAPTURAS
                  </button>
                  {scope !== "todo" && (
                    <span className="cap-crumb">
                      <ChevronRight size={13} aria-hidden="true" />
                      <button
                        type="button"
                        className={tag === null ? "here" : ""}
                        onClick={() => setTag(null)}
                      >
                        {scope === "favoritas" ? "Favoritas" : "Archivadas"}
                      </button>
                    </span>
                  )}
                  {tag !== null && (
                    <span className="cap-crumb">
                      <ChevronRight size={13} aria-hidden="true" />
                      <button type="button" className="here">
                        #{tag}
                      </button>
                    </span>
                  )}
                </nav>
              ) : (
                <nav className="cap-crumbs" aria-label="Ruta">
                  <button
                    type="button"
                    className={!folder ? "here" : ""}
                    onClick={() => setFolder(null)}
                    {...dropTarget(null)}
                  >
                    <HardDrive size={14} /> CAPTURAS
                  </button>
                  {path.map((f) => (
                    <span key={f.id} className="cap-crumb">
                      <ChevronRight size={13} aria-hidden="true" />
                      <button
                        type="button"
                        className={f.id === folder ? "here" : ""}
                        onClick={() => setFolder(f.id)}
                        {...dropTarget(f.id)}
                      >
                        {f.name}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
              <div className="cap-bar-end">
                {store.purging > 0 && (
                  <span
                    className="cap-purging"
                    title="Borrando de YourImageShare"
                  >
                    <Loader2 size={13} className="cap-spin" /> Borrando{" "}
                    {store.purging}
                  </span>
                )}
                <button
                  type="button"
                  className={
                    "lt-tool cap-scope" + (scope === "favoritas" ? " on" : "")
                  }
                  aria-pressed={scope === "favoritas"}
                  title="Tus capturas con estrella"
                  onClick={() =>
                    setScope(scope === "favoritas" ? "todo" : "favoritas")
                  }
                >
                  <Star
                    size={14}
                    fill={scope === "favoritas" ? "currentColor" : "none"}
                  />{" "}
                  <span>Favoritas</span>
                </button>
                {(archivedCount > 0 || scope === "archivadas") && (
                  <button
                    type="button"
                    className={
                      "lt-tool cap-scope" +
                      (scope === "archivadas" ? " on" : "")
                    }
                    aria-pressed={scope === "archivadas"}
                    title={`${archivedCount} ${archivedCount === 1 ? "archivada" : "archivadas"}`}
                    onClick={() =>
                      setScope(scope === "archivadas" ? "todo" : "archivadas")
                    }
                  >
                    <Archive size={14} /> <span>Archivadas</span>
                  </button>
                )}
                <TagFilter tags={tagCounts} value={tag} onChange={setTag} />
                {!flat && (
                  <>
                    <button
                      type="button"
                      className="lt-tool"
                      onClick={() => setCreating(true)}
                    >
                      <FolderPlus size={14} /> <span>Nueva carpeta</span>
                    </button>
                    <button
                      type="button"
                      className="lt-tool"
                      title={
                        folder
                          ? "Descargar esta carpeta en ZIP"
                          : "Descargar todo CAPTURAS en ZIP"
                      }
                      disabled={
                        folder
                          ? !subtreeHasItems(folder, folders, shots)
                          : !shots.length && !folders.length
                      }
                      onClick={() => zip("here")}
                    >
                      <Download size={14} /> <span>ZIP</span>
                    </button>
                  </>
                )}
                <SortMenu<CapSort>
                  options={SORTS}
                  value={sort}
                  onChange={setSort}
                  labels={capSortLabels}
                />
                <div className="lt-views" role="radiogroup" aria-label="Vista">
                  {VIEWS.map(({ id, label, icon: Icon }) => (
                    <button
                      type="button"
                      role="radio"
                      key={id}
                      aria-checked={view === id}
                      aria-label={label}
                      title={label}
                      className={view === id ? "on" : ""}
                      onClick={() => setView(id)}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {store.error && <p className="cap-error">{store.error}</p>}

        {empty ? (
          searching ? (
            <p className="lt-none">Nada coincide con «{query.trim()}».</p>
          ) : tag !== null ? (
            <p className="lt-none">
              Nada con #{tag}
              {scope === "favoritas"
                ? " en Favoritas"
                : scope === "archivadas"
                  ? " en Archivadas"
                  : ""}
              .
            </p>
          ) : scope === "favoritas" ? (
            <p className="lt-none">
              Aún no tienes favoritas. Pasa el cursor sobre una captura y toca
              la estrella.
            </p>
          ) : scope === "archivadas" ? (
            <p className="lt-none">No hay capturas archivadas.</p>
          ) : (
            <button
              type="button"
              className="cap-empty"
              onClick={() => openForm([])}
            >
              <span className="cap-drop-ico">
                <UploadCloud size={26} strokeWidth={1.6} />
              </span>
              <strong>
                {folder ? "Esta carpeta está vacía" : "Aún no tienes capturas"}
              </strong>
              <span>
                Pega con <kbd>Ctrl</kbd> + <kbd>V</kbd>, arrastra imágenes aquí
                o <u>elige archivos</u>
              </span>
            </button>
          )
        ) : (
          <>
            {(shownFolders.length > 0 || creating) && view !== "lista" && (
              <section className="cap-section">
                <h3>Carpetas</h3>
                <div className="cap-folders">
                  {creating && (
                    <NewFolderTile onDone={(v) => void finishCreate(v)} />
                  )}
                  {shownFolders.map((f) => (
                    <FolderTile
                      key={f.id}
                      {...itemProps(fk(f.id))}
                      folder={f}
                      counts={counts(f.id)}
                      where={searching ? folderLabelOf(folders, f) : ""}
                      drop={dropTarget(f.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {view === "lista" ? (
              <div className="cap-table" role="table">
                <div className="cap-tr head" role="row">
                  <span />
                  <button
                    type="button"
                    onClick={() => setSort("nombre")}
                    className={sort === "nombre" ? "on" : ""}
                  >
                    Nombre
                  </button>
                  <span className="cap-col-tags">Etiquetas</span>
                  <button
                    type="button"
                    onClick={() => setSort("peso")}
                    className={"num" + (sort === "peso" ? " on" : "")}
                  >
                    Tamaño
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSort(sort === "reciente" ? "antiguo" : "reciente")
                    }
                    className={
                      sort === "reciente" || sort === "antiguo" ? "on" : ""
                    }
                  >
                    Fecha
                  </button>
                  <span />
                </div>
                {creating && (
                  <NewFolderTile row onDone={(v) => void finishCreate(v)} />
                )}
                {shownFolders.map((f) => (
                  <FolderRow
                    key={f.id}
                    {...itemProps(fk(f.id))}
                    folder={f}
                    counts={counts(f.id)}
                    where={searching ? folderLabelOf(folders, f) : ""}
                    drop={dropTarget(f.id)}
                  />
                ))}
                {pager.visible.map((s) => (
                  <ShotRow
                    key={s.id}
                    {...itemProps(sk(s.id))}
                    shot={s}
                    where={flat ? folderLabel(s) : ""}
                  />
                ))}
              </div>
            ) : (
              shownShots.length > 0 && (
                <section className="cap-section">
                  {(shownFolders.length > 0 || creating) && <h3>Capturas</h3>}
                  <div
                    className={view === "mosaico" ? "cap-justify" : "cap-grid"}
                  >
                    {pager.visible.map((s) => (
                      <ShotCard
                        key={s.id}
                        {...itemProps(sk(s.id))}
                        shot={s}
                        mosaic={view === "mosaico"}
                        where={flat ? folderLabel(s) : ""}
                      />
                    ))}
                  </div>
                </section>
              )
            )}
            <LoadMore
              rest={pager.rest}
              onMore={pager.loadMore}
              shown={pager.visible.length}
            />
            {!searching && (
              <p className="cap-foot">
                {folder || flat
                  ? `${shownShots.length} ${shownShots.length === 1 ? "captura" : "capturas"} · ${formatBytes(shownShots.reduce((n, s) => n + s.size, 0))}`
                  : `${activeShots.length} ${activeShots.length === 1 ? "captura" : "capturas"} · ${folders.length} ${folders.length === 1 ? "carpeta" : "carpetas"} · ${formatBytes(totalSize)}`}
                <span>
                  {" "}
                  · Ctrl+V para pegar · arrastra para mover · clic derecho para
                  más
                </span>
              </p>
            )}
          </>
        )}

        {fileDrag && (
          <div className="cap-file-drop" aria-hidden="true">
            <UploadCloud size={32} strokeWidth={1.6} />
            <strong>Suelta para subir a {here?.name ?? "CAPTURAS"}</strong>
          </div>
        )}
      </div>

      {/* Fuera de la pestaña: así sus clics, arrastres y menús no le llegan a ella. */}
      {menu && (
        <Popover
          anchor={menu.anchor}
          align="start"
          width={220}
          label="Acciones"
          onClose={() => setMenu(null)}
        >
          {menuBody}
        </Popover>
      )}
      {moving && (
        <MoveDialog
          keys={moving}
          folders={folders}
          current={folder}
          onClose={() => setMoving(null)}
          onMove={(target) => {
            const keys = moving;
            setMoving(null);
            void moveTo(keys, target);
          }}
        />
      )}
      {form && (
        <CaptureForm
          initialFiles={form.files}
          folderId={form.folder}
          onClose={() => setForm(null)}
        />
      )}
      {viewer && (
        <CapLightbox
          shots={
            viewerSolo
              ? shots.filter((s) => s.id === viewer)
              : shownShots
          }
          startId={viewer}
          onClose={closeViewer}
          onDelete={(s) => void askDelete([sk(s.id)])}
          onFavorite={(s) => void favorite([s.id], !s.favorite)}
          folderName={folderLabel}
        />
      )}
    </>
  );
}

function subtreeHasItems(id: string, folders: CapFolder[], shots: Shot[]) {
  const inside = subtree(folders, [id]);
  return (
    inside.size > 1 || shots.some((s) => s.folder_id && inside.has(s.folder_id))
  );
}
const folderLabelOf = (folders: CapFolder[], f: CapFolder) =>
  ["CAPTURAS", ...pathOf(folders, f.parent_id).map((p) => p.name)].join(" › ");

// ───────── Elementos ─────────
type ItemHandlers = {
  onPick: (e: RMouseEvent) => void;
  onToggle: () => void;
  onMenu: (e: RMouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onRename: (v: string | null) => void;
  onStar: () => void;
};
type ItemProps = ItemHandlers & {
  selected: boolean;
  selecting: boolean;
  renaming: boolean;
};
type DropProps = Record<string, unknown>;

function common(p: ItemProps, extra = "") {
  return {
    className:
      "cap-item " +
      extra +
      (p.selected ? " sel" : "") +
      (p.selecting ? " selecting" : ""),
    tabIndex: 0,
    draggable: !p.renaming,
    "aria-selected": p.selected,
    onClick: (e: RMouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input")) return;
      p.onPick(e);
    },
    onKeyDown: (e: RKeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter") p.onPick(e as unknown as RMouseEvent);
      else if (e.key === " ") {
        e.preventDefault();
        p.onToggle();
      }
    },
    onContextMenu: p.onMenu,
    onDragStart: p.onDragStart,
    onDragEnd: p.onDragEnd,
  };
}

function Check_({ p }: { p: ItemProps }) {
  return (
    <button
      type="button"
      className="cap-check"
      role="checkbox"
      aria-checked={p.selected}
      aria-label="Seleccionar"
      onClick={(e) => {
        e.stopPropagation();
        p.onToggle();
      }}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}
function MoreBtn({ p }: { p: ItemProps }) {
  return (
    <button
      type="button"
      className="cap-more"
      aria-label="Más acciones"
      onClick={(e) => p.onMenu(e)}
    >
      <MoreHorizontal size={16} />
    </button>
  );
}

function StarBtn({ p, on }: { p: ItemProps; on: boolean }) {
  return (
    <button
      type="button"
      className={"cap-star" + (on ? " on" : "")}
      aria-pressed={on}
      aria-label={on ? "Quitar de favoritas" : "Añadir a favoritas"}
      title={on ? "Quitar de favoritas" : "Añadir a favoritas"}
      onClick={(e) => {
        e.stopPropagation();
        p.onStar();
      }}
    >
      <Star size={15} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** Un solo botón que abre la lista de etiquetas (con cuántas tiene cada una). */
function TagFilter({
  tags,
  value,
  onChange,
}: {
  tags: [string, number][];
  value: string | null;
  onChange: (t: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [q, setQ] = useState("");
  if (!tags.length && value === null) return null;
  const all: [string, number][] =
    value !== null && !tags.some(([t]) => sameTag(t, value))
      ? [[value, 0], ...tags]
      : tags;
  const needle = normalizeText(q.trim());
  const list = needle
    ? all.filter(([t]) => normalizeText(t).includes(needle))
    : all;
  const pick = (t: string | null) => {
    onChange(t);
    setAnchor(null);
  };
  return (
    <>
      <button
        type="button"
        className={"lt-tool cap-scope" + (value !== null ? " on" : "")}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        title="Filtrar por etiqueta"
        onClick={(e) => {
          setQ("");
          setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect());
        }}
      >
        <Tag size={14} />{" "}
        <span>{value !== null ? "#" + value : "Etiqueta"}</span>
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label="Filtrar por etiqueta"
          width={240}
          onClose={() => setAnchor(null)}
        >
          {all.length > 8 && (
            <input
              className="cap-pop-search"
              autoFocus
              placeholder="Buscar etiqueta"
              aria-label="Buscar etiqueta"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && list.length) {
                  e.preventDefault();
                  pick(list[0][0]);
                }
              }}
            />
          )}
          <div className="cap-pop-list">
            {!needle && (
              <MenuItem
                icon={
                  <Check size={14} style={{ opacity: value === null ? 1 : 0 }} />
                }
                onClick={() => pick(null)}
              >
                Todas las etiquetas
              </MenuItem>
            )}
            {list.map(([t, n]) => (
              <MenuItem
                key={t}
                icon={
                  <Check
                    size={14}
                    style={{
                      opacity: value !== null && sameTag(t, value) ? 1 : 0,
                    }}
                  />
                }
                hint={String(n)}
                onClick={() => pick(t)}
              >
                #{t}
              </MenuItem>
            ))}
            {!list.length && <p className="cap-pop-none">Sin coincidencias</p>}
          </div>
        </Popover>
      )}
    </>
  );
}

function InlineName({
  value,
  onDone,
  className = "",
}: {
  value: string;
  onDone: (v: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = value.lastIndexOf(".");
    el.setSelectionRange(
      0,
      dot > 0 && value.length - dot <= 5 ? dot : value.length,
    );
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className={"cap-rename " + className}
      defaultValue={value}
      maxLength={200}
      aria-label="Nombre"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function NewFolderTile({
  onDone,
  row,
}: {
  onDone: (v: string | null) => void;
  row?: boolean;
}) {
  return (
    <div
      className={row ? "cap-tr cap-item folder new" : "cap-folder cap-item new"}
    >
      {row && <span />}
      <span className="cap-folder-name">
        <span className="cap-folder-ico">
          <FolderPlus size={18} />
        </span>
        <InlineName value="Carpeta nueva" onDone={onDone} />
      </span>
    </div>
  );
}

const FolderTile = memo(function FolderTile(
  p: ItemProps & {
    folder: CapFolder;
    counts: { shots: number; folders: number };
    where: string;
    drop: DropProps;
  },
) {
  const { folder, counts, where, drop } = p;
  return (
    <div {...common(p, "cap-folder")} {...drop} title={folder.name}>
      <Check_ p={p} />
      <span className="cap-folder-ico">
        <Folder size={18} />
      </span>
      <span className="cap-folder-text">
        {p.renaming ? (
          <InlineName value={folder.name} onDone={p.onRename} />
        ) : (
          <strong>{folder.name}</strong>
        )}
        <small>{where || countLabel(counts)}</small>
      </span>
      <MoreBtn p={p} />
    </div>
  );
});

const countLabel = ({ shots, folders }: { shots: number; folders: number }) =>
  [
    folders ? `${folders} ${folders === 1 ? "carpeta" : "carpetas"}` : "",
    shots ? `${shots} ${shots === 1 ? "captura" : "capturas"}` : "",
  ]
    .filter(Boolean)
    .join(" · ") || "Vacía";

const ratioOf = (s: Shot) =>
  s.width && s.height ? Math.min(3, Math.max(0.45, s.width / s.height)) : 1.6;

const ShotCard = memo(function ShotCard(
  p: ItemProps & { shot: Shot; mosaic: boolean; where: string },
) {
  const { shot, mosaic, where } = p;
  const [loaded, setLoaded] = useState(false);
  const r = ratioOf(shot);
  const style = mosaic
    ? ({ flexGrow: r, flexBasis: `${r * 210}px`, "--r": r } as CSSProperties)
    : undefined;
  return (
    <div
      {...common(p, "cap-card")}
      data-shot={shot.id}
      style={style}
      title={shot.note || shot.name}
    >
      <div className={"cap-card-img" + (loaded ? " loaded" : "")}>
        {mosaic && <i style={{ paddingBottom: `${100 / r}%` }} />}
        <img
          src={mosaic ? shot.url : (shot.thumb ?? shot.url)}
          srcSet={
            mosaic && shot.thumb
              ? `${shot.thumb} 280w, ${shot.url} ${shot.width ?? 1600}w`
              : undefined
          }
          sizes={mosaic ? `${Math.round(r * 210)}px` : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
        <Check_ p={p} />
        <StarBtn p={p} on={shot.favorite} />
        <MoreBtn p={p} />
        {mosaic && !p.renaming && (
          <span className="cap-card-cap">
            <strong>{shot.name}</strong>
          </span>
        )}
      </div>
      {(!mosaic || p.renaming) && (
        <div className="cap-card-text">
          {p.renaming ? (
            <InlineName value={shot.name} onDone={p.onRename} />
          ) : (
            <strong>{shot.name}</strong>
          )}
          <small>
            {where ||
              `${formatBytes(shot.size)} · ${shotDate(shot.created_at)}`}
            {shot.tags.length > 0 && !where && (
              <em>
                {" "}
                · #{shot.tags[0]}
                {shot.tags.length > 1 ? ` +${shot.tags.length - 1}` : ""}
              </em>
            )}
          </small>
        </div>
      )}
    </div>
  );
});

const FolderRow = memo(function FolderRow(
  p: ItemProps & {
    folder: CapFolder;
    counts: { shots: number; folders: number };
    where: string;
    drop: DropProps;
  },
) {
  const { folder, counts, where, drop } = p;
  return (
    <div {...common(p, "cap-tr folder")} {...drop} role="row">
      <Check_ p={p} />
      <span className="cap-folder-name">
        <span className="cap-folder-ico">
          <Folder size={16} />
        </span>
        {p.renaming ? (
          <InlineName value={folder.name} onDone={p.onRename} />
        ) : (
          <strong>{folder.name}</strong>
        )}
      </span>
      <span className="cap-col-tags muted">{where || countLabel(counts)}</span>
      <span className="num muted">—</span>
      <span className="muted">{shotDate(folder.created_at)}</span>
      <MoreBtn p={p} />
    </div>
  );
});

const ShotRow = memo(function ShotRow(
  p: ItemProps & { shot: Shot; where: string },
) {
  const { shot, where } = p;
  return (
    <div {...common(p, "cap-tr")} data-shot={shot.id} role="row">
      <Check_ p={p} />
      <span className="cap-folder-name">
        <span className="cap-row-thumb">
          <img
            src={shot.thumb ?? shot.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </span>
        <span className="cap-row-text">
          {p.renaming ? (
            <InlineName value={shot.name} onDone={p.onRename} />
          ) : (
            <strong>{shot.name}</strong>
          )}
          {(where || shot.note) && <small>{where || shot.note}</small>}
        </span>
        <StarBtn p={p} on={shot.favorite} />
      </span>
      <span className="cap-col-tags">
        {shot.tags.slice(0, 3).map((t) => (
          <span key={t} className="cap-tag">
            #{t}
          </span>
        ))}
        {shot.tags.length > 3 && (
          <span className="muted">+{shot.tags.length - 3}</span>
        )}
      </span>
      <span className="num muted">{formatBytes(shot.size)}</span>
      <span className="muted">{shotDate(shot.created_at)}</span>
      <MoreBtn p={p} />
    </div>
  );
});

// ───────── Mover a… ─────────
function MoveDialog({
  keys,
  folders,
  current,
  onClose,
  onMove,
}: {
  keys: string[];
  folders: CapFolder[];
  current: string | null;
  onClose: () => void;
  onMove: (target: string | null) => void;
}) {
  const { folders: fIds } = split(keys);
  const blocked = subtree(folders, fIds);
  const tree = flatTree(folders);
  const [target, setTarget] = useState<string | null>(current);
  const [making, setMaking] = useState(false);
  return (
    <Sheet label="Mover a" className="cap-move" onRequestClose={onClose}>
      <header className="cap-form-head">
        <div>
          <h2>Mover a…</h2>
          <p>
            {keys.length} {keys.length === 1 ? "elemento" : "elementos"}
          </p>
        </div>
        <button
          type="button"
          className="cap-x"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <ul className="cap-tree" role="listbox" aria-label="Carpetas">
        <li>
          <button
            type="button"
            role="option"
            aria-selected={target === null}
            className={target === null ? "on" : ""}
            onClick={() => setTarget(null)}
          >
            <HardDrive size={15} /> CAPTURAS
          </button>
        </li>
        {tree.map(({ folder: f, depth }) => (
          <li key={f.id}>
            <button
              type="button"
              role="option"
              aria-selected={target === f.id}
              disabled={blocked.has(f.id)}
              className={target === f.id ? "on" : ""}
              style={{ paddingLeft: 14 + (depth + 1) * 18 }}
              onClick={() => setTarget(f.id)}
              onDoubleClick={() => onMove(f.id)}
            >
              <Folder size={15} /> {f.name}
            </button>
          </li>
        ))}
        {making && (
          <li className="cap-tree-new">
            <FolderPlus size={15} />
            <InlineName
              value="Carpeta nueva"
              onDone={async (v) => {
                setMaking(false);
                if (!v?.trim()) return;
                const made = await createFolder(v, target);
                if (typeof made !== "string") setTarget(made.id);
              }}
            />
          </li>
        )}
      </ul>
      <footer className="cap-form-foot">
        <button
          type="button"
          className="cap-btn ghost left"
          onClick={() => setMaking(true)}
        >
          <FolderPlus size={15} /> Nueva carpeta
        </button>
        <button type="button" className="cap-btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="cap-btn primary"
          onClick={() => onMove(target)}
        >
          Mover aquí
        </button>
      </footer>
    </Sheet>
  );
}

function CapSkeleton({ view }: { view: CapView }) {
  return (
    <div className={"cap cap-" + view} aria-hidden="true">
      <div className="cap-bar">
        <span className="cap-sk" style={{ width: 140, height: 26 }} />
      </div>
      <div className="cap-grid">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="cap-card sk">
            <div className="cap-card-img cap-sk" />
            <div className="cap-card-text">
              <span className="cap-sk" style={{ width: "70%", height: 11 }} />
              <span className="cap-sk" style={{ width: "45%", height: 9 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

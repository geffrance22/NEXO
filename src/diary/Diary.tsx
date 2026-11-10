import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  BedDouble,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  CloudLightning,
  CloudRain,
  Dumbbell,
  FileDown,
  FilePen,
  Feather,
  Flame,
  Folder,
  FolderOpen,
  GitCommitVertical,
  Hash,
  History,
  Image as ImageIcon,
  LayoutGrid,
  List,
  LocateFixed,
  Lock,
  MapPin,
  Moon,
  Pencil,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { MoodIcon, moods } from "../composer/controls";
import { moodOf as moodFor } from "../composer/moods";
import { feelingsOf } from "../composer/MoodTrio";
import { plainText } from "../components/RichText";
import { Sheet } from "../components/Sheet";
import { LoadMore, useInfinite } from "../components/LoadMore";
import type { DiaryFolder, Entry, EntryDetails, Person } from "../data";
import { addDays, friendlyDate, todayInputValue } from "../lib/format";
import { touchVault } from "../notes/vault";
import { Avatar } from "../people/Avatar";
import { removeDraft, useDrafts, type DiaryDraft } from "./drafts";
import {
  DiaryVaultGate,
  DiaryVaultSheet,
  EntryMenu,
  FolderBar,
  FolderSheet,
  useEntryDrag,
  type FolderCounts,
} from "./Folders";
import {
  folderOf,
  useDiaryFolders,
  type FolderTarget,
  type FolderView,
} from "./folderStore";
import { isVaulted } from "./vault";
import { Capsules } from "./Capsules";
import { lightLabel, skyKind, skyLabel, type SkyKind } from "./context";
import { exportDiaryPdf } from "./exportPdf";
import { analyze, careSignal } from "./insights";
import {
  CareNote,
  careHidden,
  MoodMapSheet,
  NEEDED as MOOD_NEEDED,
} from "./MoodInsights";
import { ExportMenu, SelectBar, TagSheet } from "./Tools";
import { normalizeText } from "../lib/format";
import {
  agoLabel,
  buildDays,
  commonMood,
  dayOf,
  dayOfYear,
  levelOf,
  longDay,
  monthShort,
  monthTitle,
  onThisDay,
  streaks,
  weekdayIndex,
  weekdayShort,
  weeksBetween,
  wordsOf,
  type DayStat,
} from "./model";
import "./diary.css";

const moodOf = (n?: number | null) => moodFor(n);
/** ¿La entrada tiene este ánimo (entre los hasta tres que puede tener)? */
const hasMood = (e: Entry, value: number) =>
  feelingsOf(e.details).some((f) => f.mood === value);
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];

type Filter = "todas" | "personas" | "fotos" | `m:${number}`;
type MapMode = "constancia" | "animo";

/** Cómo se ven las entradas: línea de tiempo (la de siempre), tarjetas o lista compacta. */
type Layout = "linea" | "tarjetas" | "lista";
const LAYOUTS: { id: Layout; label: string; Icon: typeof Sun }[] = [
  { id: "linea", label: "Línea de tiempo", Icon: GitCommitVertical },
  { id: "tarjetas", label: "Tarjetas", Icon: LayoutGrid },
  { id: "lista", label: "Lista compacta", Icon: List },
];
const LAYOUT_KEY = "nexo:diary-layout";
const readLayout = (): Layout => {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.some((l) => l.id === v) ? (v as Layout) : "linea";
  } catch {
    return "linea";
  }
};

/**
 * El diario: la entrada de hoy, la constancia del año (al estilo de las contribuciones de
 * GitHub, pero por días escritos y por ánimo), lo que escribiste un día como hoy y todas las
 * entradas en una línea de tiempo por meses y días.
 */
export function Diary({
  entries,
  matches,
  query,
}: {
  /** Todas las entradas del diario (recuerdos de tipo «Nota»). */
  entries: Entry[];
  /** El buscador de la página. */
  matches: (e: Entry) => boolean;
  query: string;
}) {
  const {
    openEntry,
    workspace,
    user,
    notify,
    confirm,
    patchEntry,
    diaryVault: vault,
  } = useApp();
  const today = todayInputValue();
  const days = useMemo(() => buildDays(entries), [entries]);
  const searching = query.trim() !== "";
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todas");
  const [tag, setTag] = useState<string | null>(null);
  const [yearOpen, setYearOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [photos, setPhotos] = useState(true);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [exporting, setExporting] = useState(false);

  /* ── Carpetas ── */
  const drafts = useDrafts(user.id);
  const {
    folders,
    create: createFolder,
    update: updateFolder,
    remove: removeFolder,
    reorder: reorderFolders,
  } = useDiaryFolders();
  const [layout, setLayoutRaw] = useState<Layout>(readLayout);
  const setLayout = (l: Layout) => {
    setLayoutRaw(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* Sin almacenamiento: dura mientras sigas aquí. */
    }
  };
  const [view, setViewRaw] = useState<FolderView>("todas");
  // Nueva carpeta (y la entrada que irá en ella) o la carpeta que estás editando.
  const [folderForm, setFolderForm] = useState<{
    folder?: DiaryFolder;
    entry?: Entry;
  } | null>(null);
  // Entrada por guardar en la bóveda en cuanto se abra (estaba cerrada o sin crear).
  const [toVault, setToVault] = useState<Entry | null>(null);
  const inVault = view === "vault";
  const vaultOpen = vault.status === "open";
  const folderId = view.startsWith("f:") ? view.slice(2) : null;
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const setView = (v: FolderView) => {
    setViewRaw(v);
    setFilter("todas");
    setTag(null);
    setPicked(null);
  };
  // La carpeta que mirabas ya no existe (la borraste en otro dispositivo).
  useEffect(() => {
    if (folderId && !folder) setViewRaw("todas");
  }, [folderId, folder]);

  const live = useMemo(
    () => entries.filter((e) => !e.details.archived),
    [entries],
  );
  const archived = useMemo(
    () => entries.filter((e) => e.details.archived),
    [entries],
  );
  // «Diario» es la carpeta general: solo lo que no está en ninguna de tus carpetas.
  const loose = useMemo(() => {
    const known = new Set(folders.map((f) => f.id));
    return live.filter(
      (e) => !e.details.folder || !known.has(e.details.folder),
    );
  }, [live, folders]);
  const counts: FolderCounts = useMemo(() => {
    const known = new Set(folders.map((f) => f.id));
    const byFolder = new Map<string, number>();
    for (const e of live) {
      const f = e.details.folder;
      if (f && known.has(f)) byFolder.set(f, (byFolder.get(f) ?? 0) + 1);
    }
    return {
      todas: loose.length,
      drafts: drafts.length,
      archive: archived.length,
      vault: vault.count,
      byFolder,
    };
  }, [live, loose, archived, folders, drafts.length, vault.count]);
  /**
   * Las entradas de la carpeta que miras. Al buscar desde «Diario» se busca en todo (también
   * en tus carpetas y en el archivo) y cada tarjeta dice en qué carpeta está.
   */
  const base = useMemo(() => {
    if (view === "vault") return vault.entries ?? [];
    if (view === "archive") return archived;
    if (view === "drafts") return [];
    if (folderId) return live.filter((e) => e.details.folder === folderId);
    return searching ? entries : loose;
  }, [
    view,
    vault.entries,
    archived,
    folderId,
    live,
    loose,
    entries,
    searching,
  ]);

  const analysis = useMemo(
    () => analyze(entries, workspace.people, workspace.places, today),
    [entries, workspace.people, workspace.places, today],
  );
  const [careTick, setCareTick] = useState(0);
  const care = useMemo(() => {
    void careTick;
    const s = careSignal(days, entries, today);
    return s && !careHidden(user.id, s, today) ? s : null;
  }, [days, entries, today, user.id, careTick]);

  // El índice de búsqueda de la página no conoce las entradas de la bóveda: se buscan aquí.
  const needle = normalizeText(query.trim());
  const found = useMemo(
    () =>
      base.filter((e) =>
        isVaulted(e)
          ? !needle ||
            normalizeText(
              `${e.title} ${plainText(e.body)} ${e.tags.join(" ")}`,
            ).includes(needle)
          : matches(e),
      ),
    [base, matches, needle],
  );
  const hasTags = useMemo(() => found.some((e) => e.tags.length), [found]);
  const moodChips = useMemo(
    () => moods.filter((m) => found.some((e) => hasMood(e, m.value))),
    [found],
  );
  const list = useMemo(() => {
    const test: (e: Entry) => boolean =
      filter === "personas"
        ? (e) => e.person_ids.length > 0
        : filter === "fotos"
          ? (e) => e.images.length > 0
          : filter.startsWith("m:")
            ? (e) => hasMood(e, Number(filter.slice(2)))
            : () => true;
    const t = tag && normalizeText(tag);
    return found
      .filter(
        (e) =>
          (!day || dayOf(e) === day) &&
          test(e) &&
          (!t || e.tags.some((x) => normalizeText(x) === t)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [found, day, filter, tag]);
  const pager = useInfinite(
    list,
    20,
    [view, day, filter, tag, query].join("|"),
  );
  const listHead = useRef<HTMLDivElement>(null);

  /* ── Mover entradas entre carpetas ── */
  const folderName = (id: string) =>
    folders.find((f) => f.id === id)?.name ?? "la carpeta";
  const sendToVault = async (e: Entry) => {
    const ok = await vault.adopt(e);
    if (ok)
      notify("Entrada guardada en la bóveda.", {
        label: "Deshacer",
        icon: "undo",
        run: () =>
          void vault.release(e, {
            folder: e.details.folder,
            archived: e.details.archived,
          }),
      });
  };
  const moveTo = async (e: Entry, to: FolderTarget) => {
    const d = e.details;
    if (to === "vault") {
      if (isVaulted(e)) return;
      if (d.capsule)
        return notify(
          "Las cápsulas del tiempo no se pueden guardar en la bóveda.",
        );
      if (vault.status === "open") return sendToVault(e);
      if (vault.status === "missing")
        return notify(
          "Para usar la bóveda, ejecuta la migración 202611090007_notes_extras.sql.",
        );
      setToVault(e);
      return;
    }
    const target = to.startsWith("f:") ? to.slice(2) : null;
    if (isVaulted(e)) {
      const ok = await vault.release(e, {
        folder: target ?? undefined,
        archived: to === "archive" || undefined,
      });
      if (ok)
        notify(
          to === "archive"
            ? "Entrada fuera de la bóveda y archivada."
            : target
              ? `Entrada fuera de la bóveda, en «${folderName(target)}».`
              : "Entrada fuera de la bóveda.",
        );
      return;
    }
    const details: EntryDetails = { ...d };
    let message: string;
    if (to === "archive") {
      if (d.archived) return;
      details.archived = true;
      message = "Entrada archivada.";
    } else if (to === "todas") {
      if (!d.archived && !d.folder) return;
      delete details.archived;
      // Al sacarla del archivo vuelve a su carpeta; si no estaba archivada, sale de la carpeta.
      if (!d.archived) delete details.folder;
      message = d.archived
        ? "Entrada de vuelta en el diario."
        : "Entrada sin carpeta.";
    } else {
      if (d.folder === target && !d.archived) return;
      delete details.archived;
      details.folder = target!;
      message = `Entrada movida a «${folderName(target!)}».`;
    }
    const ok = await patchEntry(e, { details });
    if (ok)
      notify(message, {
        label: "Deshacer",
        icon: "undo",
        run: () => void patchEntry({ ...e, details }, { details: d }),
      });
  };
  const moveRef = useRef(moveTo);
  moveRef.current = moveTo;
  const drag = useEntryDrag((e, to) => void moveRef.current(e, to));
  const tools = useMemo<CardTools>(
    () => ({
      move: (e, to) => void moveRef.current(e, to),
      newFolder: (e) => setFolderForm({ entry: e }),
      drag: drag.start,
    }),
    [drag.start],
  );
  // La bóveda acaba de abrirse con una entrada esperando entrar.
  useEffect(() => {
    if (!toVault || vault.status !== "open") return;
    const e = toVault;
    setToVault(null);
    void sendToVault(e);
  }, [toVault, vault.status]);

  const resetVault = () => {
    void confirm({
      title: "¿Restablecer la bóveda?",
      message:
        "Sin el PIN no se puede abrir lo que guardaste. Se eliminarán las entradas del diario y las notas de la bóveda, y podrás crear un PIN nuevo. Esta acción es permanente.",
      confirmLabel: "Eliminar y restablecer",
      danger: true,
      icon: "warning",
    }).then(async (yes) => {
      if (!yes) return;
      setToVault(null);
      notify(
        (await vault.reset())
          ? "Bóveda restablecida."
          : "No se pudo restablecer la bóveda.",
      );
    });
  };

  const saveFolder = async (name: string, color: string) => {
    const editing = folderForm?.folder;
    if (editing) return updateFolder(editing.id, { name, color });
    const made = await createFolder(name, color);
    if (!made) return false;
    const entry = folderForm?.entry;
    if (entry) void moveTo(entry, `f:${made.id}`);
    else setView(`f:${made.id}`);
    return true;
  };
  const deleteFolder = async (f: DiaryFolder) => {
    const inside = entries.filter((e) => e.details.folder === f.id);
    const yes = await confirm({
      title: `¿Eliminar la carpeta «${f.name}»?`,
      message: inside.length
        ? `${plural(inside.length, "entrada se queda", "entradas se quedan")} en el diario, solo que sin carpeta.`
        : "Está vacía.",
      confirmLabel: "Eliminar carpeta",
      danger: true,
      icon: "trash",
    });
    if (!yes) return;
    if (!(await removeFolder(f.id))) return;
    setFolderForm(null);
    if (view === `f:${f.id}`) setView("todas");
    for (const e of inside) {
      const { folder: _gone, ...details } = e.details;
      void patchEntry(e, { details });
    }
    notify(`Carpeta «${f.name}» eliminada.`);
  };

  const runExport = async (chosen: Entry[]) => {
    if (!chosen.length || exporting) return;
    setExporting(true);
    try {
      await exportDiaryPdf(chosen, { people: workspace.people, photos });
      setPicked(null);
    } catch {
      notify("No se pudo preparar el PDF.");
    } finally {
      setExporting(false);
    }
  };
  const togglePick = useCallback(
    (id: string) =>
      setPicked((prev) => {
        if (!prev) return prev;
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const exportOne = useCallback(
    (e: Entry) =>
      void exportDiaryPdf([e], { people: workspace.people, photos }).catch(() =>
        notify("No se pudo preparar el PDF."),
      ),
    [workspace.people, photos, notify],
  );

  const write = () => openEntry("Nota", []);
  // Al elegir un día en el mapa del año, se cierra la ventana y se va a las entradas de ese día.
  const pickDay = (date: string | null) => {
    setDay(date);
    if (!date) return;
    setYearOpen(false);
    window.requestAnimationFrame(() =>
      listHead.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <div className={"dy" + (picked ? " picking" : "")}>
      {!searching && (
        <TodayCard
          days={days}
          today={today}
          onWrite={write}
          onYear={entries.length ? () => setYearOpen(true) : undefined}
          onMood={
            analysis.n >= MOOD_NEEDED ? () => setMapOpen(true) : undefined
          }
        />
      )}
      {!searching && view === "todas" && entries.length > 0 && (
        <Recall days={days} today={today} />
      )}
      {!searching && care && (
        <CareNote
          signal={care}
          analysis={analysis}
          today={today}
          onDone={() => setCareTick((n) => n + 1)}
        />
      )}
      {!searching && <Capsules />}
      {mapOpen && (
        <MoodMapSheet analysis={analysis} onClose={() => setMapOpen(false)} />
      )}
      {tagsOpen && (
        <TagSheet
          entries={found}
          value={tag}
          onPick={setTag}
          onClose={() => setTagsOpen(false)}
        />
      )}
      {picked && (
        <SelectBar
          count={picked.size}
          busy={exporting}
          onAllVisible={() => setPicked(new Set(list.map((e) => e.id)))}
          onExport={() => void runExport(list.filter((e) => picked.has(e.id)))}
          onCancel={() => setPicked(null)}
        />
      )}
      {yearOpen &&
        createPortal(
          <Sheet
            label="Tu año en el diario"
            className="dyy"
            onRequestClose={() => setYearOpen(false)}
          >
            <DiaryMap
              days={days}
              today={today}
              selected={day}
              onSelect={pickDay}
              onClose={() => setYearOpen(false)}
            />
          </Sheet>,
          document.body,
        )}

      <FolderBar
        view={view}
        onView={setView}
        folders={folders}
        counts={counts}
        vaultOpen={vaultOpen}
        dragging={drag.dragging !== null}
        over={drag.over}
        overMore={drag.overMore}
        onNew={() => setFolderForm({})}
        onEdit={(f) => setFolderForm({ folder: f })}
        onReorder={(ids) => void reorderFolders(ids)}
      />
      {folderForm &&
        (() => {
          const f = folderForm.folder;
          return (
            <FolderSheet
              folder={f}
              onSave={saveFolder}
              onDelete={f ? () => void deleteFolder(f) : undefined}
              onClose={() => setFolderForm(null)}
            />
          );
        })()}
      {toVault && vault.status !== "open" && (
        <DiaryVaultSheet
          status={vault.status}
          count={vault.count}
          onCreate={vault.create}
          onUnlock={vault.unlock}
          onReset={resetVault}
          onClose={() => setToVault(null)}
        />
      )}

      <div className="dy-list-head" ref={listHead}>
        {base.length > 0 && (
          <>
            <div className="dy-tools">
              <div
                className="dy-seg dy-layouts"
                role="radiogroup"
                aria-label="Modo de vista"
              >
                {LAYOUTS.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={layout === id}
                    aria-label={label}
                    title={label}
                    className={layout === id ? "on" : ""}
                    onClick={() => setLayout(id)}
                  >
                    <Icon size={13} />
                  </button>
                ))}
              </div>
              {hasTags && (
                <div className="dy-seg dy-tagseg">
                  <button
                    type="button"
                    className={tag ? "on" : ""}
                    aria-haspopup="dialog"
                    aria-label={
                      tag ? `Etiqueta #${tag}` : "Filtrar por etiqueta"
                    }
                    title={tag ? `#${tag}` : "Filtrar por etiqueta"}
                    onClick={() => setTagsOpen(true)}
                  >
                    <Hash size={13} />
                    {tag && <span>{tag}</span>}
                  </button>
                </div>
              )}
              <ExportMenu
                total={base.length}
                visible={list.length}
                filtered={Boolean(
                  day || tag || searching || filter !== "todas",
                )}
                photos={photos}
                setPhotos={setPhotos}
                onAll={() => void runExport(base)}
                onVisible={() => void runExport(list)}
                onChoose={() => setPicked(new Set())}
              />
            </div>
            <div className="dy-toolbar">
              <div
                className="dy-filters"
                role="radiogroup"
                aria-label="Filtrar el diario"
              >
                {(
                  [
                    [
                      "personas",
                      "Con personas",
                      found.filter((e) => e.person_ids.length).length,
                    ],
                    [
                      "fotos",
                      "Con fotos",
                      found.filter((e) => e.images.length).length,
                    ],
                  ] as const
                ).map(([id, label, n]) =>
                  !n ? null : (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={filter === id}
                      className={filter === id ? "on" : ""}
                      onClick={() => setFilter(filter === id ? "todas" : id)}
                    >
                      {label} <i>{n}</i>
                    </button>
                  ),
                )}
                {moodChips.length > 0 &&
                  found.some((e) => e.person_ids.length || e.images.length) && (
                    <span className="dy-filters-div" aria-hidden="true" />
                  )}
                {moodChips.map((m) => {
                  const id: Filter = `m:${m.value}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={filter === id}
                      aria-label={m.label}
                      title={m.label}
                      className={"mood" + (filter === id ? " on" : "")}
                      onClick={() => setFilter(filter === id ? "todas" : id)}
                    >
                      <MoodIcon mood={m} solid={filter === id} size={18} />
                    </button>
                  );
                })}
              </div>
              {(day || tag) && (
                <span className="dy-active">
                  {day && (
                    <button
                      type="button"
                      className="dy-day-chip"
                      onClick={() => setDay(null)}
                    >
                      <CalendarDays size={13} /> {longDay(day)}
                      <X size={13} aria-label="Ver todos los días" />
                    </button>
                  )}
                  {tag && (
                    <button
                      type="button"
                      className="dy-day-chip"
                      onClick={() => setTag(null)}
                    >
                      <Hash size={13} /> {tag} · {list.length}
                      <X size={13} aria-label="Quitar la etiqueta" />
                    </button>
                  )}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      {picked && (
        <p className="dy-pick-hint">
          <Check size={14} /> Toca las entradas que quieres en el PDF.
        </p>
      )}

      {inVault && vaultOpen && (
        <div className="dy-vault-bar" role="status">
          <span>
            <ShieldCheck size={15} />
            <span>
              <strong>Bóveda abierta</strong>
              <small>
                Cifrada con tu PIN · se cierra sola tras 5 min sin uso
              </small>
            </span>
          </span>
          <button type="button" onClick={vault.lock}>
            <Lock size={14} /> Bloquear
          </button>
        </div>
      )}

      {searching && view !== "drafts" && !(inVault && !vaultOpen) && (
        <p className="dy-found">
          {list.length
            ? `${plural(list.length, "entrada coincide", "entradas coinciden")} con «${query.trim()}»`
            : `Nada en ${view === "todas" ? "tu diario" : "esta carpeta"} coincide con «${query.trim()}».`}
        </p>
      )}

      {view === "drafts" ? (
        drafts.length ? (
          <Drafts full />
        ) : (
          <FolderEmpty
            icon={<FilePen size={22} />}
            title="No tienes borradores"
          >
            Si cierras una entrada nueva sin publicarla, queda aquí para
            seguirla después.
          </FolderEmpty>
        )
      ) : inVault && !vaultOpen ? (
        <DiaryVaultGate
          status={vault.status}
          count={vault.count}
          onCreate={vault.create}
          onUnlock={vault.unlock}
          onReset={resetVault}
        />
      ) : inVault && vault.opening && !base.length ? (
        <div className="dy-vault-opening">
          <span className="spin-dot" /> Descifrando tus entradas…
        </div>
      ) : !entries.length && view === "todas" ? (
        <div className="dy-blank">
          <Feather size={22} />
          <strong>Tu diario empieza hoy</strong>
          <p>
            Escribe unas líneas sobre tu día. Cada entrada queda aquí, en su
            fecha, y va llenando tu año.
          </p>
          <button type="button" className="dy-cta" onClick={write}>
            <Pencil size={15} /> Escribir la primera entrada
          </button>
        </div>
      ) : !base.length && !searching ? (
        inVault ? (
          <FolderEmpty
            icon={<ShieldCheck size={22} />}
            title="Tu bóveda está vacía"
          >
            En cualquier entrada, abre «Más opciones» (⋯) y elige «Guardar en la
            bóveda», o arrástrala hasta aquí.
          </FolderEmpty>
        ) : view === "archive" ? (
          <FolderEmpty icon={<Archive size={22} />} title="Nada archivado">
            Las entradas que archives salen de la línea de tiempo y quedan aquí.
          </FolderEmpty>
        ) : view === "todas" ? (
          <FolderEmpty
            icon={<BookOpen size={22} />}
            title="Todo está en carpetas"
          >
            Aquí ves las entradas que no están en ninguna carpeta. Las nuevas
            llegan aquí; arrastra una hasta «Diario» para sacarla de su carpeta.
          </FolderEmpty>
        ) : (
          <FolderEmpty
            icon={<FolderOpen size={22} />}
            title={
              folder ? `«${folder.name}» está vacía` : "No hay entradas aquí"
            }
            color={folder?.color}
          >
            Arrastra entradas hasta esta carpeta o usa «Más opciones» (⋯) ›
            Mover a.
          </FolderEmpty>
        )
      ) : (
        !searching &&
        !list.length && <p className="dy-found">Nada con este filtro.</p>
      )}

      {view !== "drafts" && !(inVault && !vaultOpen) && (
        <div
          className="dy-list-body"
          onPointerDown={inVault ? touchVault : undefined}
          onKeyDown={inVault ? touchVault : undefined}
        >
          <Timeline
            entries={pager.visible}
            layout={layout}
            today={today}
            picked={picked}
            onPick={togglePick}
            onExport={exportOne}
            folders={folders}
            showFolder={view === "todas" && searching}
            tools={tools}
          />
          <LoadMore
            rest={pager.rest}
            onMore={pager.loadMore}
            shown={pager.visible.length}
            auto={searching}
          />
        </div>
      )}
    </div>
  );
}

/** Una carpeta sin nada todavía. */
function FolderEmpty({
  icon,
  title,
  color,
  children,
}: {
  icon: ReactNode;
  title: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="dy-folder-empty"
      style={color ? ({ "--f": color } as CSSProperties) : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

/* ───────── Hoy ───────── */

function TodayCard({
  days,
  today,
  onWrite,
  onYear,
  onMood,
}: {
  days: Map<string, DayStat>;
  today: string;
  onWrite: () => void;
  /** Abre la ventana con el mapa del año (sin entradas no aparece). */
  onYear?: () => void;
  /** Abre el mapa de ánimo (aparece cuando hay suficientes entradas con ánimo). */
  onMood?: () => void;
}) {
  const { current, best, alive } = useMemo(
    () => streaks(days, today),
    [days, today],
  );
  const year = today.slice(0, 4);
  const yearDays = useMemo(
    () =>
      [...days.keys()].filter((d) => d.startsWith(year) && d <= today).length,
    [days, year, today],
  );
  const words = useMemo(
    () => [...days.values()].reduce((sum, d) => sum + d.words, 0),
    [days],
  );
  const written = days.get(today);
  const monday = addDays(today, -weekdayIndex(today));
  const week = WEEK.map((label, i) => {
    const date = addDays(monday, i);
    return { label, date, stat: days.get(date) };
  });
  const elapsed = dayOfYear(today);
  const pct = Math.round((yearDays / elapsed) * 100);

  return (
    <section className="dy-today" aria-label="Hoy">
      <div className="dy-today-main">
        <span className="dy-eyebrow">
          <i className={written ? "done" : ""} aria-hidden="true" />
          {written
            ? `Hoy · ${plural(written.entries.length, "entrada", "entradas")} · ${plural(written.words, "palabra", "palabras")}`
            : "Hoy · aún sin escribir"}
        </span>
        <h2>{longDay(today)}</h2>
      </div>

      <ol className="dy-week" aria-label="Esta semana">
        {week.map(({ label, date, stat }) => {
          const mood = moodOf(stat?.mood);
          const state =
            date === today ? " today" : date > today ? " future" : "";
          return (
            <li
              key={date}
              className={(stat ? "on" : "") + state}
              title={`${longDay(date)}${stat ? " · " + plural(stat.entries.length, "entrada", "entradas") + (mood ? ` · ${mood.label}` : "") : ""}`}
            >
              <small>{label}</small>
              <span className="dy-week-dot" />
            </li>
          );
        })}
      </ol>

      <button type="button" className="dy-cta" onClick={onWrite}>
        <Pencil size={14} />
        {written ? "Añadir entrada" : "Escribir hoy"}
      </button>

      <div className="dy-today-foot">
        <dl className="dy-stats">
          <Stat
            icon={Flame}
            value={current}
            unit={current === 1 ? "día" : "días"}
            label="Racha"
            hint={
              current && !alive
                ? "Escribe hoy para no perder la racha"
                : current
                  ? "Días seguidos escribiendo"
                  : "Empieza una racha hoy"
            }
            hot={current > 0}
          />
          <Stat
            value={best}
            unit={best === 1 ? "día" : "días"}
            label="Récord"
            hint="Tu racha más larga"
          />
          <Stat
            value={yearDays}
            unit={`· ${pct}%`}
            label={`Días en ${year}`}
            hint={`${plural(yearDays, "día escrito", "días escritos")} de los ${elapsed} que van del año`}
          />
          <Stat
            value={words}
            label="Palabras"
            hint={
              words
                ? `≈ ${Math.max(1, Math.round(words / 250)).toLocaleString("es-CO")} páginas escritas`
                : "Aún sin palabras"
            }
          />
        </dl>
        {onMood && (
          <button
            type="button"
            className="dy-year-btn dy-mood-btn"
            onClick={onMood}
            aria-haspopup="dialog"
            title="Con quién, dónde y en qué días te sientes mejor"
          >
            <span className="dy-mood-ic" aria-hidden="true">
              <Sparkles size={15} />
            </span>
            <span className="dy-year-txt">
              <small>Tu ánimo</small>
              <strong>Mapa de ánimo</strong>
            </span>
            <ArrowUpRight
              size={15}
              className="dy-year-arrow"
              aria-hidden="true"
            />
          </button>
        )}
        {onYear && <YearButton days={days} today={today} onClick={onYear} />}
      </div>
    </section>
  );
}

const MINI_WEEKS = 12;

/** Botón para abrir el mapa del año, con una vista previa de las últimas semanas. */
function YearButton({
  days,
  today,
  onClick,
}: {
  days: Map<string, DayStat>;
  today: string;
  onClick: () => void;
}) {
  const weeks = useMemo(
    () => weeksBetween(addDays(today, -(MINI_WEEKS * 7 - 1)), today),
    [today],
  );
  return (
    <button
      type="button"
      className="dy-year-btn"
      onClick={onClick}
      aria-haspopup="dialog"
      title="Ver tu constancia y tu ánimo durante el año"
    >
      <span
        className="dy-year-mini"
        style={{ "--weeks": weeks.length } as CSSProperties}
        aria-hidden="true"
      >
        {weeks.flatMap((w) =>
          w.map((c) => (
            <i
              key={c.date}
              className={
                !c.inRange || c.date > today
                  ? "out"
                  : "l" + levelOf(days.get(c.date))
              }
            />
          )),
        )}
      </span>
      <span className="dy-year-txt">
        <small>Tu año</small>
        <strong>Ver seguimiento</strong>
      </span>
      <ArrowUpRight size={15} className="dy-year-arrow" aria-hidden="true" />
    </button>
  );
}

function Stat({
  icon: Icon,
  value,
  unit,
  label,
  hint,
  hot,
}: {
  icon?: typeof Flame;
  value: number;
  unit?: string;
  label: string;
  hint: string;
  hot?: boolean;
}) {
  return (
    <div className={"dy-stat" + (hot ? " hot" : "")} title={hint}>
      <dt>{label}</dt>
      <dd>
        {Icon && <Icon size={13} aria-hidden="true" />}
        <strong>{value.toLocaleString("es-CO")}</strong>
        {unit && <span>{unit}</span>}
      </dd>
    </div>
  );
}

/* ───────── Mapa del año ───────── */

const toneNames = ["", "Difícil", "Tenso", "Normal", "Bien", "Genial"];

function DiaryMap({
  days,
  today,
  selected,
  onSelect,
  onClose,
}: {
  days: Map<string, DayStat>;
  today: string;
  selected: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<MapMode>("constancia");
  const [range, setRange] = useState<string>("12m");
  const [hover, setHover] = useState<string | null>(null);
  const years = useMemo(() => {
    const set = new Set([
      today.slice(0, 4),
      ...[...days.keys()].map((d) => d.slice(0, 4)),
    ]);
    return [...set].sort().reverse();
  }, [days, today]);

  const [from, to] =
    range === "12m"
      ? [addDays(today, -364), today]
      : [`${range}-01-01`, `${range}-12-31`];
  const weeks = useMemo(() => weeksBetween(from, to), [from, to]);
  const inRange = useMemo(
    () => [...days.values()].filter((d) => d.date >= from && d.date <= to),
    [days, from, to],
  );
  const words = inRange.reduce((s, d) => s + d.words, 0);
  const mood = commonMood(inRange.flatMap((d) => d.entries));
  const months = weeks.map((w, i) => {
    const first = w.find((c) => c.inRange && c.date.endsWith("-01"));
    return first ? { col: i, label: monthShort(first.date) } : null;
  });

  const focus = hover ?? selected;
  const focusStat = focus ? days.get(focus) : undefined;
  const focusMood = moodOf(focusStat?.mood);

  return (
    <section className="dy-map-card" aria-label="Tu año en el diario">
      <button
        type="button"
        className="dy-map-close"
        aria-label="Cerrar"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <header className="dy-map-head">
        <div>
          <span className="dy-map-eyebrow">Seguimiento del diario</span>
          <h3>{range === "12m" ? "Tus últimos 12 meses" : `Tu ${range}`}</h3>
          <p>
            {plural(inRange.length, "día escrito", "días escritos")} ·{" "}
            {plural(words, "palabra", "palabras")}
            {mood ? ` · casi siempre ${moodOf(mood)?.emoji}` : ""}
          </p>
        </div>
        <div className="dy-map-controls">
          <div
            className="dy-seg"
            role="radiogroup"
            aria-label="Qué muestra el mapa"
          >
            {(
              [
                ["constancia", "Constancia"],
                ["animo", "Ánimo"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                className={mode === id ? "on" : ""}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="dy-seg" role="radiogroup" aria-label="Periodo">
            {["12m", ...years].map((y) => (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={range === y}
                className={range === y ? "on" : ""}
                onClick={() => setRange(y)}
              >
                {y === "12m" ? "12 meses" : y}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="dy-map-scroll">
        <div
          className={"dy-map " + mode}
          style={{ "--weeks": weeks.length } as CSSProperties}
          onMouseLeave={() => setHover(null)}
        >
          {months.map(
            (m) =>
              m && (
                <span
                  key={"m" + m.col}
                  className="dy-map-month"
                  style={{ gridColumn: m.col + 2, gridRow: 1 }}
                >
                  {m.label}
                </span>
              ),
          )}
          {["lun", "mié", "vie"].map((d, i) => (
            <span
              key={d}
              className="dy-map-wd"
              style={{ gridColumn: 1, gridRow: i * 2 + 2 }}
            >
              {d}
            </span>
          ))}
          {weeks.flatMap((w, col) =>
            w.map((c, row) => {
              const style = { gridColumn: col + 2, gridRow: row + 2 };
              if (!c.inRange)
                return (
                  <span key={c.date} className="dy-cell out" style={style} />
                );
              const stat = days.get(c.date);
              const cls =
                "dy-cell" +
                (mode === "constancia"
                  ? ` l${levelOf(stat)}`
                  : stat
                    ? ` t${stat.tone ?? 0}`
                    : " l0") +
                (c.date > today ? " future" : "") +
                (c.date === today ? " today" : "") +
                (c.date === selected ? " sel" : "");
              if (!stat)
                return (
                  <span
                    key={c.date}
                    className={cls}
                    style={style}
                    onMouseEnter={() => setHover(c.date)}
                  />
                );
              return (
                <button
                  key={c.date}
                  type="button"
                  className={cls}
                  style={style}
                  aria-pressed={c.date === selected}
                  aria-label={`${longDay(c.date)}: ${plural(stat.entries.length, "entrada", "entradas")}`}
                  onMouseEnter={() => setHover(c.date)}
                  onFocus={() => setHover(c.date)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(c.date === selected ? null : c.date)}
                />
              );
            }),
          )}
        </div>
      </div>

      <footer className="dy-map-foot">
        <p className="dy-map-focus" aria-live="polite">
          {focus ? (
            <>
              <strong>{longDay(focus)}</strong>
              {focusStat ? (
                <>
                  {" · "}
                  {plural(
                    focusStat.entries.length,
                    "entrada",
                    "entradas",
                  )} · {plural(focusStat.words, "palabra", "palabras")}
                  {focusMood && ` · ${focusMood.emoji} ${focusMood.label}`}
                </>
              ) : (
                focus <= today && " · sin escribir"
              )}
            </>
          ) : (
            "Pasa por un día para verlo; tócalo para leer solo ese día."
          )}
        </p>
        {mode === "constancia" ? (
          <span className="dy-legend" aria-hidden="true">
            Menos
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} className={"dy-cell l" + l} />
            ))}
            Más
          </span>
        ) : (
          <span className="dy-legend animo" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((t) => (
              <span key={t}>
                <i className={"dy-cell t" + t} />
                {toneNames[t]}
              </span>
            ))}
            <span>
              <i className="dy-cell t0" />
              Sin ánimo
            </span>
          </span>
        )}
      </footer>
    </section>
  );
}

/* ───────── Borradores ───────── */

const draftAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return friendlyDate(todayInputValue(new Date(iso))).toLowerCase();
};

const DRAFTS_SHOWN = 3;

/**
 * Entradas a medio escribir. No cuentan para la racha ni se vinculan a nadie: solo al
 * publicarlas pasan a ser entradas del diario. Se ven como una lista corta (sin desplazarse de
 * lado); si hay muchas, el resto se despliega.
 */
function Drafts({ full = false }: { full?: boolean }) {
  const { user, openDraft, confirm } = useApp();
  const drafts = useDrafts(user.id);
  const [all, setAll] = useState(full);
  if (!drafts.length) return null;
  const drop = async (d: DiaryDraft) => {
    const ok = await confirm({
      title: "¿Eliminar este borrador?",
      message: "Lo que escribiste en él se perderá.",
      confirmLabel: "Eliminar",
      cancelLabel: "Conservar",
      danger: true,
      icon: "warning",
    });
    if (ok) removeDraft(user.id, d.id);
  };
  const shown = all ? drafts : drafts.slice(0, DRAFTS_SHOWN);
  return (
    <section className="dy-drafts2" aria-label="Borradores">
      <header>
        <span className="dy-drafts2-ic" aria-hidden="true">
          <FilePen size={15} />
        </span>
        <div>
          <strong>
            {drafts.length === 1
              ? "Tienes un borrador"
              : `Tienes ${drafts.length} borradores`}
          </strong>
          <small>Solo en este dispositivo · no cuentan hasta publicarlos</small>
        </div>
      </header>
      <ul>
        {shown.map((d) => {
          const text = plainText(d.body).replace(/\s+/g, " ").trim();
          const title = d.title.trim() || text.slice(0, 70) || "Sin título";
          const rest = d.title.trim() ? text : text.slice(70);
          const words = text ? text.split(" ").length : 0;
          const feelings = feelingsOf(d.details);
          return (
            <li key={d.id}>
              <button
                type="button"
                className="dy-drafts2-open"
                onClick={() => openDraft(d)}
                title="Seguir escribiendo"
              >
                <span className="dy-drafts2-moods" aria-hidden="true">
                  {feelings.length ? (
                    feelings.slice(0, 3).map((f) => {
                      const m = moodOf(f.mood);
                      return m ? (
                        <MoodIcon key={f.mood} mood={m} size={20} />
                      ) : null;
                    })
                  ) : (
                    <Feather size={14} />
                  )}
                </span>
                <span className="dy-drafts2-txt">
                  <strong>{title}</strong>
                  <small>
                    {friendlyDate(d.date)} · editado {draftAgo(d.updated_at)}
                    {words > 0 && ` · ${plural(words, "palabra", "palabras")}`}
                    {rest && <em> — {rest}</em>}
                  </small>
                </span>
                <span className="dy-drafts2-go" aria-hidden="true">
                  Seguir <ArrowRight size={13} />
                </span>
              </button>
              <button
                type="button"
                className="dy-drafts2-x"
                aria-label="Eliminar borrador"
                title="Eliminar"
                onClick={() => void drop(d)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      {drafts.length > DRAFTS_SHOWN && !full && (
        <button
          type="button"
          className="dy-drafts2-more"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Ver menos" : `Ver los ${drafts.length}`}
          <ChevronDown size={14} className={all ? "flip" : ""} />
        </button>
      )}
    </section>
  );
}

/* ───────── Un día como hoy ───────── */

function Recall({
  days,
  today,
}: {
  days: Map<string, DayStat>;
  today: string;
}) {
  const { viewEntry } = useApp();
  const hits = useMemo(() => onThisDayList(days, today), [days, today]);
  if (!hits.length) return null;
  return (
    <section className="dy-recall" aria-label="Un día como hoy">
      <h3>
        <History size={15} /> Un día como hoy
      </h3>
      <div className="dy-recall-list">
        {hits.map(({ d, e }) => (
          <button
            key={e.id}
            type="button"
            className="dy-recall-card"
            onClick={() => viewEntry(e)}
          >
            <small>
              {agoLabel(d.date, today)} · {friendlyDate(d.date, today)}
            </small>
            <strong>{e.title || "Entrada"}</strong>
            <span>{excerpt(e).text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const onThisDayList = (days: Map<string, DayStat>, today: string) =>
  onThisDay(days, today)
    .flatMap((d) => d.entries.map((e) => ({ d, e })))
    .slice(0, 4);

/* ───────── Línea de tiempo ───────── */

/** El título y el texto sin repetir: si el título salió de la primera línea, no se repite. */
function excerpt(e: Entry) {
  const text = plainText(e.body).replace(/\s+/g, " ").trim();
  const head = e.title.replace(/…$/, "").trim();
  if (head && text.startsWith(head)) {
    const rest = text.slice(head.length).replace(/^[\s.,;:—-]+/, "");
    return { title: e.title, text: rest };
  }
  return { title: e.title, text };
}

type MonthGroup = {
  month: string;
  days: { date: string; entries: Entry[] }[];
  count: number;
};

/** Lo que cada tarjeta puede hacer para cambiar de carpeta (estable entre pintadas). */
type CardTools = {
  move: (e: Entry, to: FolderTarget) => void;
  newFolder: (e: Entry) => void;
  drag: (ev: ReactPointerEvent<HTMLElement>, e: Entry, label: string) => void;
};

function Timeline({
  entries,
  layout,
  today,
  picked,
  onPick,
  onExport,
  folders,
  showFolder,
  tools,
}: {
  entries: Entry[];
  layout: Layout;
  today: string;
  /** Mientras eliges qué exportar: las entradas elegidas. */
  picked: Set<string> | null;
  onPick: (id: string) => void;
  onExport: (e: Entry) => void;
  folders: DiaryFolder[];
  /** Mostrar en cada tarjeta su carpeta (en la vista de todo el diario). */
  showFolder: boolean;
  tools: CardTools;
}) {
  const groups = useMemo(() => {
    const out: MonthGroup[] = [];
    for (const e of entries) {
      const date = dayOf(e);
      const month = date.slice(0, 7);
      let m = out[out.length - 1];
      if (!m || m.month !== month)
        out.push((m = { month, days: [], count: 0 }));
      let d = m.days[m.days.length - 1];
      if (!d || d.date !== date) m.days.push((d = { date, entries: [] }));
      d.entries.push(e);
      m.count++;
    }
    return out;
  }, [entries]);
  if (!groups.length) return null;
  const cardProps = (e: Entry) => ({
    entry: e,
    picking: picked !== null,
    picked: picked?.has(e.id) ?? false,
    onPick,
    onExport,
    folders,
    showFolder,
    tools,
  });
  return (
    <div className={"dy-timeline " + layout}>
      {groups.map((m) => {
        const mood = moodOf(commonMood(m.days.flatMap((d) => d.entries)));
        return (
          <section key={m.month} className="dy-month">
            <h3 className="dy-month-head">
              {monthTitle(m.month)}
              <small>
                {plural(m.count, "entrada", "entradas")}
                {mood && ` · ${mood.emoji}`}
              </small>
            </h3>
            {layout === "tarjetas" ? (
              <div className="dy-grid">
                {m.days.flatMap((d) =>
                  d.entries.map((e) => (
                    <DiaryCard
                      key={e.id}
                      {...cardProps(e)}
                      stamp={d.date === today ? "Hoy" : stampOf(d.date)}
                    />
                  )),
                )}
              </div>
            ) : layout === "lista" ? (
              <div className="dy-rows">
                {m.days.flatMap((d) =>
                  d.entries.map((e) => (
                    <DiaryRow
                      key={e.id}
                      {...cardProps(e)}
                      date={d.date}
                      today={d.date === today}
                    />
                  )),
                )}
              </div>
            ) : (
              m.days.map((d) => (
                <div
                  key={d.date}
                  className={"dy-day" + (d.date === today ? " today" : "")}
                >
                  <div className="dy-date" aria-label={longDay(d.date)}>
                    <b>{Number(d.date.slice(8))}</b>
                    <span>
                      {d.date === today ? "hoy" : weekdayShort(d.date)}
                    </span>
                  </div>
                  <div className="dy-day-entries">
                    {d.entries.map((e) => (
                      <DiaryCard key={e.id} {...cardProps(e)} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

/** «lun 10». */
const stampOf = (date: string) =>
  `${weekdayShort(date)} ${Number(date.slice(8))}`;

const MAX_FACES = 3;

const skyIcon: Record<SkyKind, typeof Sun> = {
  despejado: Sun,
  nublado: Cloud,
  lluvia: CloudRain,
  tormenta: CloudLightning,
  nieve: Snowflake,
};
const lightIcon = {
  amanecer: Sunrise,
  dia: Sun,
  atardecer: Sunset,
  noche: Moon,
};

/** Lo que se guardó solo: hora, luz y clima; y cómo dormiste o si te moviste. */
function ContextBits({ entry }: { entry: Entry }) {
  const c = entry.details.ctx;
  const sky = skyKind(c?.weather);
  const Light = c?.light ? lightIcon[c.light] : null;
  const Sky = sky ? skyIcon[sky] : null;
  const bits = [];
  if (Sky && sky)
    bits.push(
      <span
        key="sky"
        title={`${skyLabel[sky]}${typeof c?.temp === "number" ? ` · ${c.temp} °C` : ""}`}
      >
        <Sky size={12} />
        {typeof c?.temp === "number" ? `${c.temp}°` : skyLabel[sky]}
      </span>,
    );
  if (Light && c?.light)
    bits.push(
      <span key="light" title={lightLabel[c.light]}>
        <Light size={12} />
        {typeof c.hour === "number"
          ? `${String(c.hour).padStart(2, "0")}h`
          : ""}
      </span>,
    );
  if (entry.details.sleep)
    bits.push(
      <span key="sleep" title={`Dormiste ${entry.details.sleep}`}>
        <BedDouble size={12} /> {entry.details.sleep}
      </span>,
    );
  if (entry.details.exercise)
    bits.push(
      <span key="move" title="Hiciste ejercicio">
        <Dumbbell size={12} />
      </span>,
    );
  if (!bits.length) return null;
  return <span className="dy-card-ctx">{bits}</span>;
}

const DiaryCard = memo(function DiaryCard({
  entry,
  picking,
  picked,
  onPick,
  onExport,
  folders,
  showFolder,
  tools,
  stamp,
}: {
  entry: Entry;
  picking: boolean;
  picked: boolean;
  onPick: (id: string) => void;
  onExport: (e: Entry) => void;
  folders: DiaryFolder[];
  showFolder: boolean;
  tools: CardTools;
  /** En la vista de tarjetas: el día, porque no hay columna de fechas. */
  stamp?: string;
}) {
  const { workspace, viewEntry, openImages } = useApp();
  const { title, text } = excerpt(entry);
  const inFolder = showFolder ? folderOf(entry, folders) : undefined;
  const feelings = feelingsOf(entry.details)
    .map((f) => ({ mood: moodOf(f.mood), why: f.why }))
    .filter((f) => f.mood);
  const people = entry.person_ids
    .map((id) => workspace.people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const words = wordsOf(entry);
  const minutes = Math.max(1, Math.round(words / 200));
  const photos = entry.images;
  return (
    <article
      className={
        "dy-card" + (picking ? " picking" : "") + (picked ? " picked" : "")
      }
      onPointerDown={
        picking
          ? undefined
          : (ev) =>
              tools.drag(ev, entry, title || text.slice(0, 60) || "Entrada")
      }
    >
      <button
        type="button"
        className="dy-card-open"
        aria-pressed={picking ? picked : undefined}
        onClick={() => (picking ? onPick(entry.id) : viewEntry(entry))}
      >
        {picking && (
          <span className="dy-card-check" aria-hidden="true">
            {picked && <Check size={13} strokeWidth={3} />}
          </span>
        )}
        <span className="dy-card-meta">
          {stamp && <span className="dy-card-stamp">{stamp}</span>}
          {inFolder && (
            <span
              className="dy-card-folder"
              style={{ "--f": inFolder.color } as CSSProperties}
              title={`En la carpeta «${inFolder.name}»`}
            >
              <Folder size={11} fill="currentColor" fillOpacity={0.25} />
              {inFolder.name}
            </span>
          )}
          {feelings.length > 0 && (
            <span
              className="dy-mood"
              title={feelings
                .map((f) => f.mood!.label + (f.why ? ` · ${f.why}` : ""))
                .join("\n")}
            >
              {feelings.map((f) => (
                <MoodIcon key={f.mood!.value} mood={f.mood!} size={18} solid />
              ))}
              {feelings.length === 1 ? (
                <>
                  {feelings[0].mood!.label}
                  {feelings[0].why && <em> · {feelings[0].why}</em>}
                </>
              ) : (
                feelings.map((f) => f.mood!.label).join(", ")
              )}
            </span>
          )}
          {entry.details.placeId && entry.details.place && (
            <span title="Lugar del que hablas">
              <MapPin size={12} /> {entry.details.place}
            </span>
          )}
          {entry.details.where && (
            <span title="Escrito desde">
              <LocateFixed size={12} /> {entry.details.where}
            </span>
          )}
          <ContextBits entry={entry} />
          <span className="dy-card-len">
            {plural(words, "palabra", "palabras")} · {minutes} min
          </span>
        </span>
        {title && <strong className="dy-card-title">{title}</strong>}
        {text && <span className="dy-card-text">{text}</span>}
      </button>
      {photos.length > 0 && (
        <div className="dy-card-photos">
          {photos.slice(0, 4).map((img, i) => (
            <button
              key={img.url}
              type="button"
              aria-label={`Ver foto ${i + 1}`}
              onClick={() => openImages(photos, i)}
            >
              <img
                src={img.thumb ?? img.medium ?? img.url}
                alt=""
                loading="lazy"
              />
              {i === 3 && photos.length > 4 && (
                <span>+{photos.length - 4}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {(people.length > 0 || entry.tags.length > 0) && (
        <footer className="dy-card-foot">
          {people.length > 0 && (
            <span
              className="dy-faces"
              title={people.map((p) => p.name).join(", ")}
            >
              {people.slice(0, MAX_FACES).map((p) => (
                <Avatar key={p.id} person={p} size={22} />
              ))}
              <em>
                {people
                  .slice(0, 2)
                  .map((p) => p.name.split(" ")[0])
                  .join(", ")}
                {people.length > 2 ? ` y ${people.length - 2} más` : ""}
              </em>
            </span>
          )}
          {entry.tags.length > 0 && (
            <span className="dy-tags">
              {entry.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </span>
          )}
        </footer>
      )}
      {!picking && (
        <CardActs
          entry={entry}
          folders={folders}
          onExport={onExport}
          tools={tools}
        />
      )}
    </article>
  );
});

/** Exportar, editar y «Más opciones» de una entrada. */
function CardActs({
  entry,
  folders,
  onExport,
  tools,
}: {
  entry: Entry;
  folders: DiaryFolder[];
  onExport: (e: Entry) => void;
  tools: CardTools;
}) {
  const { editEntry } = useApp();
  return (
    <span className="dy-card-acts">
      <button
        type="button"
        aria-label="Exportar esta entrada a PDF"
        title="Exportar a PDF"
        onClick={() => onExport(entry)}
      >
        <FileDown size={13} />
      </button>
      <button
        type="button"
        aria-label="Editar entrada"
        title="Editar"
        onClick={() => editEntry(entry)}
      >
        <Pencil size={13} />
      </button>
      <EntryMenu
        entry={entry}
        folders={folders}
        onMove={tools.move}
        onNewFolder={tools.newFolder}
      />
    </span>
  );
}

/** Una entrada en la lista compacta: una línea por entrada. */
const DiaryRow = memo(function DiaryRow({
  entry,
  picking,
  picked,
  onPick,
  onExport,
  folders,
  showFolder,
  tools,
  date,
  today,
}: {
  entry: Entry;
  picking: boolean;
  picked: boolean;
  onPick: (id: string) => void;
  onExport: (e: Entry) => void;
  folders: DiaryFolder[];
  showFolder: boolean;
  tools: CardTools;
  date: string;
  today: boolean;
}) {
  const { viewEntry } = useApp();
  const { title, text } = excerpt(entry);
  const inFolder = showFolder ? folderOf(entry, folders) : undefined;
  const feelings = feelingsOf(entry.details)
    .map((f) => moodOf(f.mood))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const words = wordsOf(entry);
  const label = title || text.slice(0, 60) || "Entrada";
  return (
    <article
      className={
        "dy-row" + (picking ? " picking" : "") + (picked ? " picked" : "")
      }
      onPointerDown={picking ? undefined : (ev) => tools.drag(ev, entry, label)}
    >
      <button
        type="button"
        className="dy-row-open"
        aria-pressed={picking ? picked : undefined}
        onClick={() => (picking ? onPick(entry.id) : viewEntry(entry))}
      >
        {picking && (
          <span className="dy-card-check" aria-hidden="true">
            {picked && <Check size={13} strokeWidth={3} />}
          </span>
        )}
        <span
          className={"dy-row-date" + (today ? " today" : "")}
          aria-label={longDay(date)}
        >
          <b>{Number(date.slice(8))}</b>
          <small>{today ? "hoy" : weekdayShort(date)}</small>
        </span>
        <span
          className="dy-row-moods"
          title={feelings.map((m) => m.label).join(", ") || undefined}
        >
          {feelings.length ? (
            feelings
              .slice(0, 3)
              .map((m) => <MoodIcon key={m.value} mood={m} size={20} solid />)
          ) : (
            <Feather size={14} aria-hidden="true" />
          )}
        </span>
        <span className="dy-row-txt">
          <strong>{title || text.slice(0, 80) || "Entrada"}</strong>
          {title && text && <span> — {text}</span>}
        </span>
        <span className="dy-row-side">
          {inFolder && (
            <span
              className="dy-card-folder"
              style={{ "--f": inFolder.color } as CSSProperties}
              title={`En la carpeta «${inFolder.name}»`}
            >
              <Folder size={11} fill="currentColor" fillOpacity={0.25} />
              {inFolder.name}
            </span>
          )}
          {entry.images.length > 0 && (
            <span title={plural(entry.images.length, "foto", "fotos")}>
              <ImageIcon size={12} /> {entry.images.length}
            </span>
          )}
          {entry.person_ids.length > 0 && (
            <span
              title={plural(entry.person_ids.length, "persona", "personas")}
            >
              <Users size={12} /> {entry.person_ids.length}
            </span>
          )}
          <span className="dy-row-len">
            {plural(words, "palabra", "palabras")}
          </span>
        </span>
      </button>
      {!picking && (
        <CardActs
          entry={entry}
          folders={folders}
          onExport={onExport}
          tools={tools}
        />
      )}
    </article>
  );
});

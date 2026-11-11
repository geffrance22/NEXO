import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  FilePen,
  Hourglass,
  ImagePlus,
  LoaderCircle,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { readDiaryWithAssistant } from "../assistant";
import { Sheet } from "../components/Sheet";
import {
  draftHasContent,
  removeDraft,
  saveDraft,
  useDrafts,
  type DiaryDraft,
} from "../diary/drafts";
import { piecesFromAi, readingInput } from "../diary/reader/pieces";
import { capsuleDay, countdown } from "../diary/capsule";
import { contextFor, prefetchSky } from "../diary/context";
import { CapsuleDialog } from "./CapsuleDialog";
import { useDismiss } from "../hooks/useDismiss";
import { plainText } from "../components/RichText";
import { CollectionsPicker } from "../cuadernos/AddToNotebook";
import { hasRef, type Notebook } from "../cuadernos/model";
import {
  addToNotebook,
  updateNotebook,
  useCuadernos,
} from "../cuadernos/useCuadernos";
import type {
  Entry,
  EntryDetails,
  EntryInput,
  Kind,
  Person,
  PersonUpdate,
  TimeCapsule,
} from "../data";
import { todayInputValue } from "../lib/format";
import { KindPicker } from "./KindPicker";
import { incomeColors, kindMeta, seriesColors } from "./kinds";
import { useComposer, type ComposerPrefill } from "./useComposer";
import { afterMoneySaved, prepareMoney } from "../finance/afterSave";
import { BookView } from "./views/BookView";
import { LearningView } from "./views/LearningView";
import { MeetingView } from "./views/MeetingView";
import { MoneyView } from "./views/MoneyView";
import { MovieView } from "./views/MovieView";
import { NoteView } from "./views/NoteView";
import { TaskView } from "./views/TaskView";
import type { ViewProps } from "./views/shared";
import { WorkView } from "./views/WorkView";
import { NoteEditor, fresh } from "../planner/NoteEditor";
import { SaveLink } from "../readings/SaveLink";
import { CaptureForm } from "../capturas/CaptureForm";
import { movieInfo, exactMovie, lookup, normal } from "../lib/moviePosters";
import { isSeries } from "../lib/entries";
import "./composer.css";

const views: Record<Kind, (props: ViewProps) => React.JSX.Element> = {
  Nota: NoteView,
  Encuentro: MeetingView,
  Película: MovieView,
  Libro: BookView,
  Trabajo: WorkView,
  Aprendizaje: LearningView,
  Movimiento: MoneyView,
  Pendiente: TaskView,
};

export type ComposeInit = {
  /** Si se indica, se edita ese recuerdo. */
  entry?: Entry;
  /** Si se indica, se salta el selector y se abre directo ese tipo. */
  kind?: Kind;
  /** Personas que arrancan vinculadas. */
  links: string[];
  /** Detalles con los que arranca (p. ej. el lugar, si se abre desde su ficha). */
  details?: EntryDetails;
  /** Episodio en el que arranca (p. ej. si se abre desde su ficha). */
  episodeId?: string;
  /** Borrador del diario que se retoma. */
  draft?: DiaryDraft;
  /** Título, fecha, monto… con los que arranca (p. ej. un gasto sugerido desde Finanzas). */
  prefill?: ComposerPrefill;
  /** Cambia para abrir un formulario nuevo aunque ya hubiera uno igual («Guardar y otro»). */
  nonce?: number;
};

type ComposeModalProps = {
  init: ComposeInit;
  /**
   * Guarda y devuelve el id del recuerdo (null si falló). `into`: un libro de tu estantería que
   * se actualiza en lugar de crear otro.
   */
  onSave: (input: EntryInput, into?: Entry) => Promise<string | null>;
  onClose: () => void;
  /** «Guardar y otro»: deja listo un movimiento nuevo en lugar de cerrar. */
  onAgain?: () => void;
};

/** Ventana para crear o editar un recuerdo: primero eliges el tipo, luego escribes. */
export function ComposeModal({
  init,
  onSave,
  onClose,
  onAgain,
}: ComposeModalProps) {
  const {
    user,
    workspace,
    confirm,
    openPerson,
    notify,
    createPerson,
    patchPerson,
    readDiary,
  } = useApp();
  const c = useComposer(
    {
      entry: init.entry,
      kind: init.kind ?? "Nota",
      links: init.links,
      details: init.details,
      episodeId: init.episodeId,
      draft: init.draft,
      prefill: init.prefill,
    },
    workspace.people,
    workspace.ties,
  );
  // Entrada nueva del diario: se guarda sola como borrador mientras escribes (si cierras la
  // ventana, queda en «Borradores») y al guardarla la IA la lee en segundo plano.
  const diary = c.kind === "Nota" && !c.editing;
  // El cielo de ahora (clima, salida y puesta del sol) se busca en cuanto abres el diario, para
  // que al publicar ya esté listo y quede como contexto de la entrada.
  const sky = useRef<ReturnType<typeof prefetchSky> | null>(null);
  useEffect(() => {
    if (diary && !sky.current) sky.current = prefetchSky();
  }, [diary]);
  const [draftId] = useState(() => init.draft?.id ?? crypto.randomUUID());
  const drafts = useDrafts(user.id);
  const storedDraft = drafts.some((d) => d.id === draftId);
  const snap = diary ? c.snapshot() : null;
  const snapKey = snap ? JSON.stringify(snap) : "";
  const hasDraftContent = Boolean(snap && draftHasContent(snap));
  const latestSnap = useRef(snap);
  latestSnap.current = snap;
  const draftTimer = useRef<number | undefined>(undefined);
  // Al publicar o descartar, el autoguardado ya no debe volver a crear el borrador.
  const draftDone = useRef(false);
  const flushDraft = useCallback(() => {
    window.clearTimeout(draftTimer.current);
    const s = latestSnap.current;
    if (draftDone.current || !s) return false;
    if (!draftHasContent(s)) {
      removeDraft(user.id, draftId);
      return false;
    }
    saveDraft(user.id, {
      ...s,
      id: draftId,
      updated_at: new Date().toISOString(),
    });
    return true;
  }, [user.id, draftId]);
  useEffect(() => {
    // Solo si cambiaste algo: abrir un borrador sin tocarlo no lo reordena.
    if (!snapKey || !c.dirty) return;
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(flushDraft, 700);
    return () => window.clearTimeout(draftTimer.current);
  }, [snapKey, c.dirty, flushDraft]);
  // Si la pestaña se cierra con la ventana abierta, lo escrito queda en el borrador.
  useEffect(() => {
    if (!diary) return;
    const onHide = () => {
      if (latestSnap.current && c.dirty) flushDraft();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [diary, c.dirty, flushDraft]);
  const [saveMenu, setSaveMenu] = useState(false);
  const saveMenuRef = useRef<HTMLSpanElement>(null);
  const closeSaveMenu = useCallback(() => setSaveMenu(false), []);
  useDismiss(saveMenu, saveMenuRef, closeSaveMenu);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  // Cuadernos elegidos en el pie: se aplican al guardar (null = no los tocaste).
  const { list: notebooks } = useCuadernos();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const entryId = init.entry?.id;
  const savedIn = (nb: Notebook) =>
    Boolean(entryId && hasRef(nb, "entry", entryId));
  const inNotebook = (nb: Notebook) =>
    picked ? picked.has(nb.id) : savedIn(nb);
  const toggleNotebook = (nb: Notebook) =>
    setPicked((prev) => {
      const next = new Set(
        prev ?? (notebooks ?? []).filter(savedIn).map((n) => n.id),
      );
      if (next.has(nb.id)) next.delete(nb.id);
      else next.add(nb.id);
      return next;
    });
  const [stage, setStage] = useState<"pick" | "write">(
    init.kind || init.entry ? "write" : "pick",
  );
  const [shortcut, setShortcut] = useState<"idea" | "link" | "capture" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Al volver al selector desde un formulario, se marca el tipo que estabas usando.
  const [hasChosen, setHasChosen] = useState(Boolean(init.kind || init.entry));
  const form = useRef<HTMLFormElement>(null);

  const meta = kindMeta[c.kind];
  const series = isSeries({ kind: c.kind, tags: c.tags, details: c.details });
  const colors =
    c.kind === "Movimiento" && c.direction === "ingreso"
      ? incomeColors
      : series
        ? seriesColors
        : meta;
  const Icon = series ? Tv : meta.icon;
  const View = views[c.kind];

  // Al pasar a escribir, el cursor va al campo principal.
  useEffect(() => {
    if (stage !== "write") return;
    const timer = window.setTimeout(() => {
      form.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [stage, c.kind]);

  /** Descarta lo que escribiste: el borrador que retomabas vuelve a como estaba; uno nuevo se borra. */
  const discardChanges = () => {
    draftDone.current = true;
    window.clearTimeout(draftTimer.current);
    if (init.draft) saveDraft(user.id, init.draft);
    else removeDraft(user.id, draftId);
  };

  const requestClose = async () => {
    // Diario: se pregunta si dejarlo en borradores, descartarlo o seguir editando.
    if (diary && c.dirty && hasDraftContent) {
      const choice = await confirm({
        title: "¿Guardar como borrador?",
        message: "Podrás retomar esta entrada desde los borradores del diario.",
        confirmLabel: "Guardar borrador",
        altLabel: "Descartar",
        cancelLabel: "Seguir editando",
        icon: "question",
      });
      if (choice === true) {
        flushDraft();
        draftDone.current = true;
        notify("Guardado en borradores del diario.");
        onClose();
      } else if (choice === "alt") {
        discardChanges();
        onClose();
      }
      return;
    }
    if (c.dirty || picked) {
      const discard = await confirm({
        title: "¿Descartar lo que escribiste?",
        message: "Los cambios que no hayas guardado se perderán.",
        confirmLabel: "Descartar",
        cancelLabel: "Seguir editando",
        danger: true,
        icon: "warning",
      });
      if (!discard) return;
      if (diary) discardChanges();
    }
    onClose();
  };

  async function submit(
    e?: FormEvent,
    capsule?: TimeCapsule,
    again = false,
  ) {
    e?.preventDefault();
    if (c.problem || busy) return;
    setBusy(true);
    const input = c.toInput();
    // Movimientos: el fijo que nace de «se repite» lleva su id desde ya.
    if (input.kind === "Movimiento") prepareMoney(input);
    // Cápsula del tiempo: queda sellada (ni la IA la lee ni se vincula a cuadernos hasta abrirla).
    if (capsule) input.details = { ...input.details, capsule };
    // Diario: la hora, la luz y el clima de cuando escribiste (sin esperar más de un par de segundos).
    if (diary && input.kind === "Nota" && !input.details.ctx) {
      const now = await Promise.race([
        sky.current ?? Promise.resolve(null),
        new Promise<null>((r) => window.setTimeout(() => r(null), 2500)),
      ]);
      const ctx = await contextFor(input.date, now, input.details.where);
      if (ctx) input.details = { ...input.details, ctx };
    }
    if (input.kind === "Película") {
      const poster = input.details.tmdbPoster,
        year = input.details.year || "",
        key = normal(input.title) + "|" + year;
      // Si elegiste película o serie, se busca solo en eso; si no, en las dos.
      const want =
        input.details.series === undefined
          ? undefined
          : input.details.series
            ? "tv"
            : "movie";
      const otherType = Boolean(
        want && poster?.id && (poster.type ?? "movie") !== want,
      );
      if (!poster?.manual && (poster?.key !== key || otherType)) {
        delete input.details.tmdbPoster;
        if (input.title.trim().length >= 2)
          try {
            const movie = exactMovie(
              await lookup(input.title, year, want),
              input.title,
              year,
            );
            if (movie)
              input.details.tmdbPoster = {
                id: movie.id,
                type: movie.type,
                path: movie.path || undefined,
                key,
              };
          } catch {
            /* The movie can still be saved without a poster. */
          }
      }
      const selected = input.details.tmdbPoster;
      const info = input.details.movieInfo;
      if (
        selected?.id &&
        (info?.id !== selected.id ||
          (info.type ?? "movie") !== (selected.type ?? "movie"))
      )
        try {
          input.details.movieInfo = await movieInfo(selected.id, selected.type);
        } catch {
          delete input.details.movieInfo;
        }
      if (input.details.movieInfo?.year)
        input.details.year = input.details.movieInfo.year;
      if (selected && !selected.manual)
        selected.key = normal(input.title) + "|" + (input.details.year || "");
    }
    const into = c.shelfBook ?? undefined;
    // Quién te prestó el libro: si no está en tus personas, se pregunta si crear su ficha.
    let lender: Person | null = null;
    const lentName = input.details.lentBy?.trim();
    if (input.kind === "Libro" && lentName) {
      lender = input.details.lentById
        ? (workspace.people.find((p) => p.id === input.details.lentById) ??
          null)
        : null;
      if (!lender) {
        delete input.details.lentById;
        const create = await confirm({
          title: `¿Agregar a ${lentName} a tus personas?`,
          message: `Se crea su ficha y queda como novedad que te prestó «${input.title}».`,
          confirmLabel: "Crear persona",
          cancelLabel: "Solo guardar el nombre",
          icon: "question",
        });
        if (create) {
          lender = await createPerson(lentName.slice(0, 120));
          if (lender) {
            input.details.lentById = lender.id;
            input.details.lentBy = lender.name;
          }
        }
      }
    }
    const savedId = await onSave(input, into);
    setBusy(false);
    if (!savedId) return;
    if (diary) {
      // Ya es una entrada oficial: el borrador se va y la IA la lee en segundo plano.
      draftDone.current = true;
      window.clearTimeout(draftTimer.current);
      removeDraft(user.id, draftId);
      if (capsule)
        notify(
          `Cápsula sellada · se abre el ${capsuleDay(capsule.opensOn)} (${countdown(capsule.opensOn)}).`,
        );
      else startReading(savedId, input);
    }
    // En su ficha queda la novedad del préstamo (solo si es nuevo: al editar no se repite).
    const before = init.entry ?? into;
    if (lender && before?.details.lentById !== lender.id)
      void noteLoan(lender, input, savedId);
    if (picked && !capsule) void fileInNotebooks(savedId, picked);
    // Deudas del reparto o del préstamo y el fijo de «se repite».
    if (input.kind === "Movimiento")
      void afterMoneySaved(input, savedId, workspace.people).then(
        (msg) => msg && notify(msg),
      );
    if (again && onAgain) onAgain();
    else onClose();
  }

  /** Guarda lo escrito en borradores del diario y cierra (no cuenta ni se vincula a nadie). */
  function saveAsDraft() {
    setSaveMenu(false);
    if (!hasDraftContent || !snap) return;
    window.clearTimeout(draftTimer.current);
    saveDraft(user.id, {
      ...snap,
      id: draftId,
      updated_at: new Date().toISOString(),
    });
    draftDone.current = true;
    notify("Guardado en borradores del diario.");
    onClose();
  }

  async function discardDraft() {
    setSaveMenu(false);
    const ok = await confirm({
      title: "¿Eliminar este borrador?",
      message: "Lo que escribiste en él se perderá.",
      confirmLabel: "Eliminar",
      cancelLabel: "Seguir escribiendo",
      danger: true,
      icon: "warning",
    });
    if (!ok) return;
    draftDone.current = true;
    window.clearTimeout(draftTimer.current);
    removeDraft(user.id, draftId);
    onClose();
  }

  /**
   * La IA lee la entrada recién guardada y propone piezas (pendientes cumplidos, planes,
   * novedades de tu gente…). Corre aparte: la ventana ya se cerró y la entrada ya está guardada.
   */
  function startReading(entryId: string, input: EntryInput) {
    const text = plainText(input.body).trim();
    if (text.split(/\s+/).length < 4) return;
    const ws = workspace;
    const reading = readDiaryWithAssistant(readingInput(input, ws)).then(
      (r) => ({
        summary: r.summary,
        pieces: piecesFromAi(
          r.pieces,
          {
            personIds: input.personIds,
            date: input.date,
            placeId: input.details.placeId,
            hasMood: Boolean(
              input.details.feelings?.length || input.details.mood,
            ),
          },
          ws,
        ),
      }),
    );
    readDiary({
      entryId,
      title: input.title.trim() || text.slice(0, 48) || "Tu entrada",
      reading,
    });
  }

  /** «Me prestó el libro «Dune»» en las novedades de quien te lo prestó. */
  async function noteLoan(person: Person, input: EntryInput, entryId: string) {
    const now = new Date().toISOString();
    const author = input.details.author ? ` de ${input.details.author}` : "";
    const update: PersonUpdate = {
      id: crypto.randomUUID(),
      date: input.date || todayInputValue(),
      kind: "otro",
      text: `Me prestó el libro «${input.title}»${author}.`,
      created_at: now,
      entryId,
    };
    await patchPerson(
      person,
      {
        profile: {
          ...person.profile,
          updates: [update, ...(person.profile.updates ?? [])],
        },
      },
      true,
    );
  }

  /** Pone o quita el recuerdo de los cuadernos según lo que marcaste en el pie. */
  async function fileInNotebooks(id: string, want: Set<string>) {
    for (const nb of notebooks ?? []) {
      const has = hasRef(nb, "entry", id);
      if (want.has(nb.id) === has) continue;
      const result = has
        ? await updateNotebook(nb.id, {
            items: nb.items.filter((i) => !(i.type === "entry" && i.id === id)),
          })
        : await addToNotebook(nb.id, [{ type: "entry", id }]);
      if (typeof result === "string") {
        notify(result);
        return;
      }
    }
  }

  const addFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    if (meta.cover) c.uploads.add(images.slice(0, 1), true);
    else c.uploads.add(images);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void submit();
      return;
    }
    // Enter en un campo de una línea no debe guardar a medias. Solo guarda en los campos
    // marcados (el pendiente y el monto); en nota y aprendizaje salta al texto.
    const target = e.target as HTMLElement;
    if (
      !(target instanceof HTMLInputElement) ||
      target.closest("[data-enter-saves]")
    )
      return;
    e.preventDefault();
    if (
      target.classList.contains("cp-title-input") &&
      (c.kind === "Nota" || c.kind === "Aprendizaje")
    ) {
      form.current
        ?.querySelector<HTMLElement>("textarea.cp-writing, .cp-idea textarea")
        ?.focus();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    if (addFiles(Array.from(e.clipboardData.files))) e.preventDefault();
  };
  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  function saved(type: "idea" | "link") {
    window.dispatchEvent(new Event("nexo:" + type + "-saved"));
    notify(
      type === "idea"
        ? "Nota guardada en Libroteca."
        : "Enlace disponible en Lecturas.",
    );
    onClose();
  }
  if (shortcut === "idea")
    return (
      <NoteEditor
        initial={fresh(null)}
        close={onClose}
        saved={() => saved("idea")}
      />
    );
  if (shortcut === "capture") return <CaptureForm onClose={onClose} />;
  if (shortcut === "link")
    return (
      <SaveLink
        close={onClose}
        saved={() => saved("link")}
        savedMany={(n) => {
          window.dispatchEvent(new Event("nexo:link-saved"));
          notify(
            n === 1
              ? "Enlace disponible en Lecturas."
              : `${n} enlaces disponibles en Lecturas.`,
          );
          onClose();
        }}
      />
    );
  return (
    <Sheet
      yieldTo=".mp-picker[open],.reader-dialog[open],.sheet.cz-form-sheet"
      label={c.editing ? "Editar recuerdo" : "Nuevo recuerdo"}
      size={stage === "pick" ? "md" : "lg"}
      onRequestClose={requestClose}
    >
      {stage === "pick" ? (
        <KindPicker
          onShortcut={(key) => {
            if (key === "person") openPerson();
            else setShortcut(key);
          }}
          current={hasChosen ? c.kind : undefined}
          onClose={requestClose}
          onPick={(kind) => {
            c.setKind(kind);
            setHasChosen(true);
            setStage("write");
          }}
        />
      ) : (
        <form
          ref={form}
          className="cp-composer"
          data-kind={c.kind}
          style={
            {
              "--accent": colors.accent,
              "--soft": colors.soft,
              "--ink": colors.ink,
            } as CSSProperties
          }
          onSubmit={submit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <header className="cp-head">
            <button
              type="button"
              className="cp-kind-chip"
              title="Cambiar el tipo"
              onClick={() => setStage("pick")}
            >
              <ChevronLeft size={16} />
              <Icon size={17} />
              <strong>{series ? "Serie" : meta.label}</strong>
            </button>
            {c.editing && <span className="cp-editing">Editando</span>}
            {diary && storedDraft && (
              <span
                className="cp-editing cp-draft-tag"
                title="Se guarda solo mientras escribes"
              >
                <FilePen size={12} /> Borrador
              </span>
            )}
            <button
              type="button"
              className="cp-close"
              aria-label="Cerrar"
              onClick={requestClose}
            >
              <X size={20} />
            </button>
          </header>

          <div className="cp-scroll">
            <View key={c.kind} c={c} />
          </div>

          <footer className="cp-foot">
            <CollectionsPicker
              className="cp-btn ghost cp-collect"
              inNotebook={inNotebook}
              onToggleNotebook={toggleNotebook}
              episodeId={c.episodeId}
              onEpisode={c.setEpisodeId}
            />
            <span
              className={"cp-status" + (c.problem ? " problem" : "")}
              role="status"
            >
              {c.problem ??
                (diary && storedDraft
                  ? "Borrador guardado · Ctrl + Enter para publicar"
                  : "Ctrl + Enter para guardar")}
            </span>
            <button
              type="button"
              className="cp-btn ghost"
              onClick={requestClose}
            >
              Cancelar
            </button>
            {c.kind === "Movimiento" && !c.editing && onAgain && (
              <button
                type="button"
                className="cp-btn ghost cp-again"
                title="Guarda y deja listo el siguiente (para registrar varios seguidos)"
                disabled={Boolean(c.problem) || busy}
                onClick={() => void submit(undefined, undefined, true)}
              >
                Guardar y otro
              </button>
            )}
            <span
              className={"cp-split" + (diary ? " on" : "")}
              ref={saveMenuRef}
            >
              <button
                className="cp-btn cta"
                disabled={Boolean(c.problem) || busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                {c.editing
                  ? "Guardar cambios"
                  : series
                    ? "Guardar serie"
                    : meta.saveLabel}
              </button>
              {diary && (
                <button
                  type="button"
                  className="cp-btn cta cp-split-more"
                  aria-label="Más formas de guardar"
                  aria-haspopup="menu"
                  aria-expanded={saveMenu && !c.problem}
                  disabled={Boolean(c.problem) || busy}
                  onClick={() => setSaveMenu((v) => !v)}
                >
                  <ChevronDown size={16} />
                </button>
              )}
              {diary && saveMenu && !c.problem && (
                <span className="cp-split-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!hasDraftContent}
                    onClick={saveAsDraft}
                  >
                    <FilePen size={16} />
                    <span>
                      <b>Guardar como borrador</b>
                      <small>
                        {hasDraftContent
                          ? "No cuenta ni se vincula a nadie hasta publicarlo"
                          : "Escribe algo primero"}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!hasDraftContent}
                    onClick={() => {
                      setSaveMenu(false);
                      setCapsuleOpen(true);
                    }}
                  >
                    <Hourglass size={16} />
                    <span>
                      <b>Cápsula del tiempo</b>
                      <small>
                        {hasDraftContent
                          ? "Se sella y se abre en una fecha futura"
                          : "Escribe algo primero"}
                      </small>
                    </span>
                  </button>
                  {storedDraft && (
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => void discardDraft()}
                    >
                      <Trash2 size={16} />
                      <span>
                        <b>Eliminar borrador</b>
                      </span>
                    </button>
                  )}
                </span>
              )}
            </span>
          </footer>

          {capsuleOpen && (
            <CapsuleDialog
              onClose={() => setCapsuleOpen(false)}
              onSeal={(capsule) => {
                setCapsuleOpen(false);
                void submit(undefined, capsule);
              }}
            />
          )}

          {dragging && (
            <div className="cp-drop" aria-hidden="true">
              <ImagePlus size={34} />
              <strong>Suelta tu foto aquí</strong>
              <span>Se sube a ImgBB y queda en este recuerdo</span>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
}

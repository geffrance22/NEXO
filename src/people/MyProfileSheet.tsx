import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cake,
  Camera,
  Check,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import { Sheet } from "../components/Sheet";
import type { Person } from "../data";
import { MY_PROFILE_SQL } from "../hooks/useMyProfile";
import { useDismiss } from "../hooks/useDismiss";
import {
  errorMessage,
  initials,
  normalizeText,
  todayInputValue,
} from "../lib/format";
import { MAX_INPUT_BYTES, uploadToImgbb } from "../lib/imgbb";
import { ageOf, daysToBirthday } from "../lib/people";
import type { ReadingLite } from "../lib/selfDigest";
import { checklist, pickDraft, toPatch, type Draft } from "./myDraft";
import { photoSrc } from "./MyFace";
import { FORM_SECTIONS, MyProfileForm } from "./MyProfileForm";
import { MyProfileView } from "./MyProfileView";
import { MyReading, useTraits } from "./MyReading";
import { PhotoCropper } from "./PhotoCropper";
import "./myprofile.css";

/** Tus lecturas recientes (títulos y temas). Sin la migración 012 no hay «terminadas». */
async function loadReadings(): Promise<ReadingLite[]> {
  const recent = (columns: string) =>
    supabase
      .from("readings")
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(60);
  const full = await recent("title,tags,read_at");
  if (!full.error) return full.data as unknown as ReadingLite[];
  const basic = await recent("title,tags");
  return basic.error
    ? []
    : (basic.data as unknown as Omit<ReadingLite, "read_at">[]).map((r) => ({
        ...r,
        read_at: null,
      }));
}

/** Las etiquetas que ya usas (recuerdos y lecturas), las más usadas primero. */
function usedTags(tagLists: (string[] | null | undefined)[]) {
  const count = new Map<string, { label: string; n: number }>();
  for (const list of tagLists)
    for (const raw of list ?? []) {
      const t = raw.trim();
      if (!t || t.length > 40) continue;
      const k = normalizeText(t);
      const x = count.get(k);
      if (x) x.n++;
      else count.set(k, { label: t, n: 1 });
    }
  return [...count.values()]
    .sort((a, b) => b.n - a.n)
    .map((x) => x.label)
    .slice(0, 80);
}

const birthdayLine = (days: number | null) =>
  days === null
    ? ""
    : days === 0
      ? "¡Hoy es tu cumpleaños!"
      : days === 1
        ? "Tu cumpleaños es mañana"
        : `Cumpleaños en ${days} días`;

type FormSection = (typeof FORM_SECTIONS)[number]["id"];

/**
 * «Mi ficha»: se abre como una ficha para leer (lo esencial de ti, tu gente y la lectura de Nexo)
 * y pasa a formulario solo al pulsar «Editar».
 */
export function MyProfileSheet({ onClose }: { onClose: () => void }) {
  const {
    user,
    workspace,
    me,
    meLoaded,
    meMissing,
    meFailed,
    patchMe,
    confirm,
    notify,
  } = useApp();
  const [mode, setMode] = useState<"ver" | "editar">("ver");
  const [d, setD] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readings, setReadings] = useState<ReadingLite[] | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [tab, setTab] = useState<FormSection>("basico");
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const closeCheck = useCallback(() => setCheckOpen(false), []);
  useDismiss(checkOpen, meter, closeCheck);
  const { traits } = useTraits();

  const editing = mode === "editar" && d !== null;
  const canSave = !meMissing && !meFailed;
  const photo = me.profile.photo;

  // Tus lecturas: alimentan las sugerencias de etiquetas y la lectura de la IA.
  useEffect(() => {
    let live = true;
    void loadReadings().then((r) => live && setReadings(r));
    return () => {
      live = false;
    };
  }, []);
  const tagSuggestions = useMemo(
    () =>
      usedTags([
        ...workspace.entries.map((e) => e.tags),
        ...(readings ?? []).map((r) => r.tags),
      ]),
    [workspace.entries, readings],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDirty(true);
    setD((x) => ({ ...x, [key]: value }));
  };

  /** Lleva a un campo del formulario, lo enfoca y lo resalta un momento. */
  const focusField = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    const box = el.closest(".mf-field, .mf-tagrow, .mf-rows, .mf-grid") ?? el;
    box.classList.remove("mf-flash");
    void (box as HTMLElement).offsetWidth;
    box.classList.add("mf-flash");
    window.setTimeout(() => box.classList.remove("mf-flash"), 1400);
  };
  useEffect(() => {
    if (!pendingJump || !editing) return;
    const t = window.setTimeout(() => {
      focusField(pendingJump);
      setPendingJump(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [pendingJump, editing]);

  const startEdit = (field?: string) => {
    if (!canSave)
      return notify(
        meMissing
          ? `Ejecuta ${MY_PROFILE_SQL} para poder editar tu ficha.`
          : "Recarga la página antes de editar tu ficha.",
      );
    setCheckOpen(false);
    if (!editing) {
      setD(pickDraft(me.profile));
      setDirty(false);
      setMode("editar");
      setTab("basico");
      scroller.current?.scrollTo({ top: 0 });
    }
    if (field) setPendingJump(field);
  };
  const jump = (id: string) => {
    setCheckOpen(false);
    if (id === "mf-photo") return photoInput.current?.click();
    startEdit(id);
  };

  const confirmDiscard = () =>
    confirm({
      title: "¿Descartar los cambios?",
      message: "Lo que no hayas guardado de tu ficha se perderá.",
      confirmLabel: "Descartar",
      cancelLabel: "Seguir editando",
      danger: true,
      icon: "warning",
    });

  const backToView = async () => {
    if (dirty && !(await confirmDiscard())) return;
    setMode("ver");
    setD(null);
    setDirty(false);
    scroller.current?.scrollTo({ top: 0 });
  };

  async function save() {
    if (saving || !d) return;
    setSaving(true);
    const ok = await patchMe(toPatch(d, me.profile));
    setSaving(false);
    if (!ok) return;
    notify("Ficha guardada.");
    setDirty(false);
    setMode("ver");
    setD(null);
    scroller.current?.scrollTo({ top: 0 });
  }

  const requestClose = async () => {
    if (uploading) return;
    if (editing && dirty && !(await confirmDiscard())) return;
    onClose();
  };

  // ── Foto: eliges, la acomodas en el círculo y se sube al momento ──
  const pickPhoto = (file: File) => {
    if (!file.type.startsWith("image/")) return notify("Elige una imagen.");
    if (file.size > MAX_INPUT_BYTES)
      return notify("La foto pesa demasiado (máximo 32 MB).");
    setCropFile(file);
  };
  async function uploadCropped(blob: Blob) {
    setUploading(true);
    try {
      const image = await uploadToImgbb(blob, "yo.jpg");
      if (await patchMe({ photo: image })) notify("Foto actualizada.");
      setCropFile(null);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }
  async function removePhoto() {
    const ok = await confirm({
      title: "¿Quitar tu foto?",
      message:
        "Volverán a verse tus iniciales. Para recuperarla tendrás que subirla de nuevo.",
      confirmLabel: "Quitar",
      danger: true,
      icon: "trash",
    });
    if (ok && (await patchMe({ photo: undefined }))) notify("Foto quitada.");
  }

  // ── Secciones del formulario ──
  const onScroll = () => {
    const box = scroller.current;
    if (!box || !editing) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4)
      return setTab(FORM_SECTIONS[FORM_SECTIONS.length - 1].id);
    let current: FormSection = "basico";
    for (const s of FORM_SECTIONS) {
      const el = document.getElementById("mf-s-" + s.id);
      if (el && el.offsetTop - 24 <= box.scrollTop) current = s.id;
    }
    setTab(current);
  };
  const goTo = (id: FormSection) => {
    const el = document.getElementById("mf-s-" + id);
    if (!el || !scroller.current) return;
    scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
    setTab(id);
  };

  // ── Mientras carga: un esqueleto ──
  if (!meLoaded)
    return (
      <Sheet label="Mi ficha" size="md" className="mf" onRequestClose={onClose}>
        <header className="mf-head">
          <span className="mf-avatar skel" aria-hidden="true" />
          <div className="mf-id">
            <i className="mf-skel-line" style={{ width: "42%", height: 16 }} />
            <i
              className="mf-skel-line"
              style={{ width: "64%", marginTop: 8 }}
            />
          </div>
          <button
            type="button"
            className="cp-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="mf-scroll" aria-busy="true">
          <p className="mf-loading" role="status">
            <LoaderCircle className="spin" size={15} /> Cargando tu ficha…
          </p>
          {[78, 92, 60, 85, 70].map((w, i) => (
            <i key={i} className="mf-skel-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Sheet>
    );

  // Lo que se muestra arriba: lo que escribes mientras editas, o lo guardado.
  const shown = editing ? d : pickDraft(me.profile);
  const { percent, missing } = checklist(shown, Boolean(photo));
  const today = todayInputValue();
  const asPerson = {
    profile: { birthday: shown.birthday, birthYear: shown.birthYear },
  } as Person;
  const age = ageOf(asPerson, today);
  const bdayIn = daysToBirthday(asPerson, today);
  const src = photoSrc(photo, 120);
  const displayName = shown.name?.trim() || "Tu ficha";

  return (
    <Sheet
      label="Mi ficha"
      size="md"
      className={"mf" + (editing ? " editing" : "")}
      yieldTo=".nx-peek, .mf-crop"
      onRequestClose={() => void requestClose()}
    >
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pickPhoto(file);
        }}
      />

      <header className="mf-head">
        <button
          type="button"
          className="mf-avatar"
          title={photo ? "Cambiar tu foto" : "Subir una foto tuya"}
          aria-label={photo ? "Cambiar tu foto" : "Subir una foto tuya"}
          disabled={!canSave || uploading}
          onClick={() => photoInput.current?.click()}
        >
          {src ? (
            <img src={src} alt="" />
          ) : (
            initials(shown.name?.trim() || user.email || "Yo").toUpperCase()
          )}
          <span className="mf-avatar-cam" aria-hidden="true">
            {uploading ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Camera size={13} />
            )}
          </span>
        </button>
        <div className="mf-id">
          <h2>
            {displayName}
            {shown.alias?.trim() && (
              <span className="mf-alias">«{shown.alias.trim()}»</span>
            )}
          </h2>
          <p>
            {[
              shown.occupation?.trim(),
              shown.company?.trim(),
              shown.city?.trim(),
            ]
              .filter(Boolean)
              .join(" · ") || user.email}
          </p>
          {(age !== null || bdayIn !== null) && (
            <p className="mf-id-when">
              {age !== null && <span>{age} años</span>}
              {bdayIn !== null && (
                <span className={bdayIn <= 7 ? "soon" : ""}>
                  <Cake size={12} /> {birthdayLine(bdayIn)}
                </span>
              )}
            </p>
          )}
          {editing && photo ? (
            <button
              type="button"
              className="mf-photo-off"
              disabled={!canSave || uploading}
              onClick={() => void removePhoto()}
            >
              <Trash2 size={12} /> Quitar foto
            </button>
          ) : (
            !editing &&
            traits.length > 0 && (
              <div className="mf-id-traits">
                {traits.slice(0, 3).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )
          )}
        </div>
        <div className="mf-head-side">
          <div className="mf-meter-wrap" ref={meter}>
            <button
              type="button"
              className="mf-meter"
              aria-expanded={checkOpen}
              aria-haspopup="dialog"
              title="Qué tanto has contado de ti. Toca para ver qué falta."
              onClick={() => setCheckOpen((v) => !v)}
            >
              <b>
                <i style={{ width: `${percent}%` }} />
              </b>
              {percent}%
            </button>
            {checkOpen && (
              <div
                className="mf-check"
                role="dialog"
                aria-label="Lo que falta en tu ficha"
              >
                {missing.length ? (
                  <>
                    <strong>Te falta contar</strong>
                    <ul>
                      {missing.map((m) => (
                        <li key={m.id}>
                          <button type="button" onClick={() => jump(m.id)}>
                            {m.todo} <ChevronRight size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mf-check-done">
                    <Check size={15} /> Tu ficha está completa.
                  </p>
                )}
              </div>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              className="mf-edit"
              disabled={!canSave}
              onClick={() => startEdit()}
            >
              <Pencil size={13} /> Editar
            </button>
          )}
        </div>
        <button
          type="button"
          className="cp-close"
          aria-label="Cerrar"
          onClick={() => void requestClose()}
        >
          <X size={18} />
        </button>
      </header>

      {editing && (
        <nav className="mf-tabs" aria-label="Secciones de tu ficha">
          {FORM_SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={tab === s.id ? "on" : ""}
              aria-current={tab === s.id ? "true" : undefined}
              onClick={() => goTo(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      )}

      <div className="mf-scroll" ref={scroller} onScroll={onScroll}>
        {meMissing && (
          <p className="mf-notice" role="status">
            Para guardar tu ficha ejecuta <code>{MY_PROFILE_SQL}</code> en el
            SQL Editor de Supabase.
          </p>
        )}
        {meFailed && (
          <p className="mf-notice" role="alert">
            Tu ficha no terminó de cargar. Recarga la página antes de editarla:
            si guardas ahora, podrías perder lo que ya tenías.
          </p>
        )}

        {editing ? (
          <MyProfileForm d={d} set={set} tagSuggestions={tagSuggestions} />
        ) : (
          <>
            <MyReading
              readings={readings}
              loadReadings={loadReadings}
              canSave={canSave}
            />
            {missing.length > 0 && (
              <div className="mf-todo">
                <span>
                  Tu ficha va al <b>{percent}%</b>. Te falta:
                </span>
                <div>
                  {missing.slice(0, 4).map((m) => (
                    <button type="button" key={m.id} onClick={() => jump(m.id)}>
                      {m.todo}
                    </button>
                  ))}
                  {missing.length > 4 && (
                    <button
                      type="button"
                      className="more"
                      onClick={() => setCheckOpen(true)}
                    >
                      +{missing.length - 4} más
                    </button>
                  )}
                </div>
              </div>
            )}
            <MyProfileView
              profile={me.profile}
              onEdit={startEdit}
              onClose={onClose}
            />
          </>
        )}
      </div>

      {editing && (
        <footer className="mf-foot">
          <small>
            {dirty
              ? "Tienes cambios sin guardar."
              : "Tu foto se guarda al momento."}
          </small>
          <button
            type="button"
            className="cp-btn ghost"
            onClick={() => void backToView()}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="cp-btn cta"
            disabled={!dirty || saving || !canSave}
            onClick={() => void save()}
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Guardar
          </button>
        </footer>
      )}

      {cropFile && (
        <PhotoCropper
          file={cropFile}
          busy={uploading}
          onCancel={() => !uploading && setCropFile(null)}
          onDone={(blob) => void uploadCropped(blob)}
        />
      )}
    </Sheet>
  );
}

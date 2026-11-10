import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Handshake,
  Library,
  Minus,
  Plus,
  Quote,
  RotateCcw,
  Tablet,
  UserPlus,
  X,
} from "lucide-react";
import { useApp } from "../../AppContext";
import type { Entry, EntryDetails } from "../../data";
import { normalizeText } from "../../lib/format";
import { entryImages } from "../../lib/moviePosters";
import { ordinal, readsBefore } from "../../library/rereads";
import { inMyShelf } from "../../library/shelf";
import { Avatar } from "../../people/Avatar";
import {
  AutoTextarea,
  ChoiceChips,
  Label,
  Segmented,
  Stars,
} from "../controls";
import { DateChips } from "../DateChips";
import { shelfOnly } from "../logic";
import { PeoplePicker } from "../PeoplePicker";
import { CoverDrop, MiniPhotos } from "../PhotoBlocks";
import type { ComposerApi } from "../useComposer";
import type { ViewProps } from "./shared";

const toCount = (v: string) =>
  v ? Math.min(Number(v.replace(/\D/g, "")) || 0, 99999) : undefined;
const key = (s: string) => normalizeText(s.trim()).replace(/\s+/g, " ");

/** Libro: portada, progreso de lectura y frases que te marcaron. */
export function BookView({ c }: ViewProps) {
  const read = c.details.read ?? "leyendo";
  const format = c.details.bookFormat;
  const owner = c.details.bookOwner ?? "mio";
  const { pagesRead = 0, pagesTotal = 0 } = c.details;
  const percent =
    pagesTotal > 0
      ? Math.min(100, Math.round((pagesRead / pagesTotal) * 100))
      : 0;
  const quotes = c.details.quotes ?? [];
  const setQuote = (i: number, text: string) =>
    c.setDetail(
      "quotes",
      quotes.map((q, j) => (j === i ? text : q)),
    );
  const shelf = useShelfMatch(c);
  const reread = useReread(c, read);
  const shelfCover = shelf.match ? entryImages(shelf.match)[0] : undefined;
  // «Estantería» solo tiene sentido para un libro en papel que es tuyo.
  const canShelve = format !== "digital" && owner !== "prestado";

  return (
    <div className="cp-media">
      <div className="cp-media-side">
        <CoverDrop
          uploads={c.uploads}
          icon={BookMarked}
          title="Portada"
          hint="Toca para subirla"
          external={
            c.details.bookEdition?.image ||
            (shelf.linked ? (shelfCover?.medium ?? shelfCover?.url) : undefined)
          }
          clearExternal={() => {
            if (c.details.bookEdition)
              c.setDetail("bookEdition", {
                ...c.details.bookEdition,
                image: "",
              });
          }}
        />
      </div>
      <div className="cp-media-main">
        <div className="cp-shelf-title">
          <input
            className="cp-title-input"
            placeholder="¿Qué libro?"
            maxLength={180}
            value={c.title}
            onChange={(e) => c.setTitle(e.target.value)}
            onFocus={() => shelf.setFocused(true)}
            onBlur={() => shelf.setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && shelf.hits.length) {
                e.stopPropagation();
                shelf.setFocused(false);
              }
            }}
            aria-label="Título del libro"
            aria-autocomplete="list"
            data-autofocus
          />
          {shelf.hits.length > 0 && (
            <div
              className="cp-results cp-shelf-hits"
              role="listbox"
              aria-label="En tu estantería"
            >
              <span className="cp-shelf-hits-head">
                <Library size={13} /> En tu estantería
              </span>
              {shelf.hits.map((e) => {
                const img = entryImages(e)[0];
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    key={e.id}
                    // Que el campo no pierda el foco antes de elegir.
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => shelf.pick(e)}
                  >
                    <span className="cp-shelf-cover">
                      {img ? (
                        <img src={img.thumb ?? img.medium ?? img.url} alt="" />
                      ) : (
                        <BookMarked size={14} />
                      )}
                    </span>
                    <span className="cp-shelf-name">
                      {e.title}
                      {e.details.author && <small>{e.details.author}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {shelf.match && (
          <p className="cp-shelf-note">
            <Library size={14} />
            <span>
              {read === "estante"
                ? "Ya está en tu estantería: al guardar se actualiza esa ficha."
                : shelf.linked
                  ? "Es de tu estantería: al guardar se actualiza esa ficha."
                  : "Lo tienes en tu estantería: se guarda como una lectura nueva."}
            </span>
            <button type="button" onClick={shelf.decline}>
              No es este
            </button>
          </p>
        )}
        <input
          className="cp-author"
          placeholder="Autor"
          maxLength={120}
          value={c.details.author ?? ""}
          onChange={(e) => c.setDetail("author", e.target.value)}
          aria-label="Autor"
        />

        <Segmented
          label="Estado de lectura"
          value={read}
          onChange={(v) => c.setDetail("read", v)}
          options={[
            ...(canShelve || read === "estante"
              ? [{ value: "estante" as const, label: "Estantería" }]
              : []),
            { value: "quiero", label: "Por leer" },
            { value: "leyendo", label: "Leyendo" },
            { value: "terminado", label: "Terminado" },
          ]}
        />

        {reread.active &&
          (reread.no >= 2 ? (
            <div className="cp-reread">
              <RotateCcw size={14} aria-hidden="true" />
              <span>
                Es tu <b>{ordinal(reread.no)} lectura</b>
                {reread.prior > 0 && (
                  <small>
                    {reread.prior === 1
                      ? " · ya lo habías terminado una vez"
                      : ` · ya lo terminaste ${reread.prior} veces`}
                  </small>
                )}
              </span>
              <span className="cp-reread-step">
                <button
                  type="button"
                  aria-label="Una lectura menos"
                  onClick={() => reread.set(reread.no - 1)}
                >
                  <Minus size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Una lectura más"
                  disabled={reread.no >= 99}
                  onClick={() => reread.set(reread.no + 1)}
                >
                  <Plus size={13} />
                </button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="cp-reread-add"
              onClick={() => reread.set(Math.max(2, reread.prior + 1))}
            >
              <RotateCcw size={13} /> Ya lo había leído antes
            </button>
          ))}

        {read === "estante" ? (
          <p className="cp-hint">
            <Library size={13} />
            Solo lo guardas en tu estantería, sin decir si lo leerás. Cámbialo
            cuando lo empieces.
          </p>
        ) : (
          <>
            <Label hint="Opcional">¿En qué lo lees?</Label>
            <ChoiceChips
              label="Formato"
              clearable
              value={format}
              onChange={(v) => {
                c.setDetail("bookFormat", v);
                if (v === "fisico" && !c.details.bookOwner)
                  c.setDetail("bookOwner", "mio");
              }}
              options={[
                {
                  value: "fisico",
                  label: "Libro físico",
                  icon: <BookOpen size={14} />,
                },
                {
                  value: "digital",
                  label: "PDF / digital",
                  icon: <Tablet size={14} />,
                },
              ]}
            />
            {format === "fisico" && (
              <div className="cp-copy">
                <ChoiceChips
                  label="De quién es"
                  value={owner}
                  onChange={(v) => c.setDetail("bookOwner", v ?? "mio")}
                  options={[
                    {
                      value: "mio",
                      label: "De mi estantería",
                      icon: <Library size={14} />,
                    },
                    {
                      value: "prestado",
                      label: "De alguien más",
                      icon: <Handshake size={14} />,
                    },
                  ]}
                />
                {owner === "prestado" && <LenderField c={c} />}
              </div>
            )}
          </>
        )}

        {read === "leyendo" && (
          <div className="cp-progress-card">
            <div className="cp-pages">
              <label>
                <span>Página</span>
                <input
                  inputMode="numeric"
                  value={pagesRead || ""}
                  placeholder="0"
                  onChange={(e) =>
                    c.setDetail("pagesRead", toCount(e.target.value))
                  }
                  aria-label="Página actual"
                />
              </label>
              <span className="cp-pages-of">de</span>
              <label>
                <span>Total</span>
                <input
                  inputMode="numeric"
                  value={pagesTotal || ""}
                  placeholder="0"
                  onChange={(e) =>
                    c.setDetail("pagesTotal", toCount(e.target.value))
                  }
                  aria-label="Total de páginas"
                />
              </label>
              <strong>{pagesTotal > 0 ? `${percent}%` : ""}</strong>
            </div>
            <div className="cp-bar" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {read === "terminado" && (
          <>
            <Label>Tu calificación</Label>
            <Stars
              label="Calificación"
              value={c.details.rating}
              onChange={(v) => c.setDetail("rating", v)}
            />
            <Label>¿Cuándo lo terminaste?</Label>
            <DateChips
              label="Fecha"
              options={["today", "yesterday"]}
              value={c.date}
              onChange={c.setDate}
            />
          </>
        )}

        <Label hint="Opcional · aparte de la portada">Fotos</Label>
        <MiniPhotos
          uploads={c.photos}
          label="Añadir fotos"
          hint="Tu ejemplar, una página, una dedicatoria…"
          className="roomy"
        />

        {read !== "estante" && (
          <>
            <Label hint="Las que quieras guardar">Frases que te marcaron</Label>
            <div className="cp-quotes">
              {quotes.map((q, i) => (
                <div className="cp-quote" key={i}>
                  <Quote size={15} />
                  <AutoTextarea
                    minRows={1}
                    value={q}
                    placeholder="Escribe la frase…"
                    onChange={(e) => setQuote(i, e.target.value)}
                    aria-label={`Frase ${i + 1}`}
                  />
                  <button
                    type="button"
                    aria-label="Quitar frase"
                    onClick={() =>
                      c.setDetail(
                        "quotes",
                        quotes.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="cp-add-line"
                onClick={() => c.setDetail("quotes", [...quotes, ""])}
              >
                <Plus size={15} /> Añadir una frase
              </button>
            </div>

            <Label>Con quién lo comentas</Label>
            <PeoplePicker api={c.people} variant="compact" />
          </>
        )}

        <Label>{read === "estante" ? "Notas" : "Lo que pienso"}</Label>
        <AutoTextarea
          className="cp-soft-area"
          minRows={3}
          placeholder={
            read === "estante"
              ? "Dónde lo compraste, quién te lo regaló…"
              : "Ideas, dudas, lo que te dejó…"
          }
          value={c.body}
          onChange={(e) => c.setBody(e.target.value)}
          aria-label={read === "estante" ? "Notas" : "Reflexión"}
        />
      </div>
    </div>
  );
}

/**
 * Libros de tu estantería mientras escribes el título. Si el título coincide con uno, se marca
 * «Libro físico · De mi estantería» y, si aún no lo empezabas, al guardar se actualiza esa ficha.
 */
function useShelfMatch(c: ComposerApi) {
  const { workspace } = useApp();
  const [focused, setFocused] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
  // Cómo estaba el ejemplar antes de que la coincidencia lo marcara (para devolverlo si deja de coincidir).
  const before = useRef<Pick<EntryDetails, "bookFormat" | "bookOwner"> | null>(
    null,
  );
  const owned = useMemo(
    () => workspace.entries.filter((e) => inMyShelf(e) && e.id !== c.entry?.id),
    [workspace.entries, c.entry?.id],
  );
  const needle = key(c.title);
  const exact =
    !c.editing && needle
      ? owned.find((e) => key(e.title) === needle)
      : undefined;
  const match = exact && exact.id !== declined ? exact : undefined;

  useEffect(() => {
    if (c.editing) return;
    if (match) {
      if (!before.current)
        before.current = {
          bookFormat: c.details.bookFormat,
          bookOwner: c.details.bookOwner,
        };
      c.setShelfBook(shelfOnly(match) ? match : null);
      c.setDetail("bookFormat", "fisico");
      c.setDetail("bookOwner", "mio");
      if (!c.details.author?.trim() && match.details.author)
        c.setDetail("author", match.details.author);
      if (!c.details.pagesTotal && match.details.pagesTotal)
        c.setDetail("pagesTotal", match.details.pagesTotal);
    } else if (before.current) {
      // Dejó de coincidir: el ejemplar vuelve a como estaba.
      c.setShelfBook(null);
      c.setDetail("bookFormat", before.current.bookFormat);
      c.setDetail("bookOwner", before.current.bookOwner);
      before.current = null;
    }
    // Solo cuando cambia la coincidencia.
  }, [match?.id, c.editing]);

  const hits =
    focused && !c.editing && needle.length >= 2 && !exact
      ? owned.filter((e) => key(e.title).includes(needle)).slice(0, 5)
      : [];

  return {
    match,
    linked: Boolean(match && c.shelfBook?.id === match.id),
    hits,
    setFocused,
    pick: (e: Entry) => {
      setDeclined(null);
      c.setTitle(e.title);
      setFocused(false);
    },
    decline: () => setDeclined(match?.id ?? null),
  };
}

/**
 * Releer: cuenta las veces que ya terminaste este libro (antes de la fecha de esta lectura) y, al
 * registrarlo, lo marca solo como la siguiente («2.ª lectura»). Se corrige a mano con − y +.
 */
function useReread(c: ComposerApi, read: string) {
  const { workspace } = useApp();
  const active = read === "leyendo" || read === "terminado";
  const author = c.details.author;
  const prior = useMemo(
    () =>
      c.title.trim()
        ? readsBefore(
            { title: c.title, author },
            workspace.entries,
            c.date,
            c.entry?.id,
          )
        : 0,
    [c.title, author, c.date, c.entry?.id, workspace.entries],
  );
  // Lo que puso la detección (para actualizarlo si cambia el título) y si lo tocaste tú.
  const auto = useRef<number | undefined>(undefined);
  const touched = useRef(false);
  const current = c.details.readNo;

  useEffect(() => {
    // Al editar no se cambia solo: lo que ya estaba guardado manda.
    if (c.editing || !active || touched.current) return;
    if (current !== undefined && current !== auto.current) return;
    const want = prior > 0 ? prior + 1 : undefined;
    if (current === want) return;
    auto.current = want;
    c.setDetail("readNo", want);
  }, [active, prior, c.editing]);

  return {
    active,
    prior,
    no: current ?? 1,
    set: (n: number) => {
      touched.current = true;
      c.setDetail("readNo", n >= 2 ? Math.min(n, 99) : undefined);
    },
  };
}

/**
 * «¿Quién te lo prestó?»: sugiere tus personas mientras escribes. Si no está, al guardar se
 * pregunta si crear su ficha; en ella queda la novedad del préstamo.
 */
function LenderField({ c }: { c: ComposerApi }) {
  const [focused, setFocused] = useState(false);
  const name = c.details.lentBy ?? "";
  const people = c.people.all;
  const chosen = c.details.lentById
    ? people.find((p) => p.id === c.details.lentById)
    : undefined;
  const needle = key(name);
  const hits =
    focused && needle && !chosen
      ? people.filter((p) => key(p.name).includes(needle)).slice(0, 6)
      : [];

  const choose = (id: string | undefined, text: string) => {
    c.setDetail("lentBy", text);
    c.setDetail("lentById", id);
  };

  if (chosen)
    return (
      <div className="cp-tokens cp-lender">
        <span className="cp-token">
          <Avatar person={chosen} size={24} />
          {chosen.name}
          <button
            type="button"
            aria-label={`Quitar a ${chosen.name}`}
            onClick={() => choose(undefined, "")}
          >
            <X size={13} />
          </button>
        </span>
        <span className="cp-lender-note">
          Te lo prestó · queda como novedad en su ficha
        </span>
      </div>
    );

  return (
    <div className="cp-lender">
      <input
        className="cp-ghost-input"
        placeholder="¿Quién te lo prestó?"
        maxLength={80}
        value={name}
        onChange={(e) => {
          const text = e.target.value;
          // Si escribes el nombre completo de alguien, queda vinculado.
          const same = people.filter((p) => key(p.name) === key(text));
          choose(same.length === 1 ? same[0].id : undefined, text);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            choose(hits[0].id, hits[0].name);
          }
        }}
        aria-label="Quién te lo prestó"
        aria-autocomplete="list"
      />
      {hits.length > 0 && (
        <div className="cp-results" role="listbox" aria-label="Personas">
          {hits.map((p) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={p.id}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => choose(p.id, p.name)}
            >
              <Avatar person={p} size={24} />
              {p.name}
              <small>{p.role}</small>
            </button>
          ))}
        </div>
      )}
      {needle && !hits.length && (
        <p className="cp-hint">
          <UserPlus size={13} />
          {name.trim()} no está en tus personas. Al guardar te pregunto si
          quieres crear su ficha.
        </p>
      )}
    </div>
  );
}

import { entryImages } from "../lib/moviePosters";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BookMarked,
  Brain,
  Check,
  Clapperboard,
  ClipboardCheck,
  GraduationCap,
  Layers,
  MapPin,
  Newspaper,
  Paperclip,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  TrendingUp,
  Tv,
  X,
} from "lucide-react";
import { useMediaEnrich } from "../library/enrich";
import { isActive } from "../library/progress";
import { isFinished } from "../ritual/learning";
import "../ritual/ritual.css";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import type { Entry } from "../data";
import { incomeColors, kindMeta, seriesColors } from "../composer/kinds";
import { MISSED_ONE, outcomeHint } from "../lib/commitments";
import {
  entryFacts,
  isSeries,
  longDate,
  mediaSpecs,
  signedAmount,
} from "../lib/entries";
import { friendlyDate, shortDate, todayInputValue } from "../lib/format";
import { daysBetween } from "../lib/people";
import { placeOf } from "../lib/places";
import { Avatar } from "../people/Avatar";
import { AddToNotebook } from "../cuadernos/AddToNotebook";
import { RichText } from "./RichText";
import { Sheet } from "./Sheet";
import "./entry-viewer.css";

/**
 * Ficha de un recuerdo: se lee cómodo, con sus fotos, personas, lugar y episodio. Desde aquí se
 * edita, se completa o se borra. Si navegas a otra sección (una persona, un lugar), se cierra.
 */
export function EntryViewer({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const app = useApp();
  const { workspace } = app;
  // Películas y series sin póster o sin sinopsis: se completan con TMDB al abrir la ficha.
  useMediaEnrich(entry);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onNavigate = () => close.current();
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);
  /** Cierra la ficha y luego navega (también si ya estabas en esa sección). */
  const navigate = (to: () => void) => {
    onClose();
    to();
  };

  const meta = kindMeta[entry.kind];
  const series = isSeries(entry);
  const colors =
    entry.kind === "Movimiento" && entry.direction === "ingreso"
      ? incomeColors
      : series
        ? seriesColors
        : meta;
  const Icon = series ? Tv : meta.icon;
  const d = entry.details;
  const specs = mediaSpecs(entry);
  const people = workspace.people.filter((p) =>
    entry.person_ids.includes(p.id),
  );
  const episode = entry.episode_id
    ? workspace.episodes.find((ep) => ep.id === entry.episode_id)
    : undefined;
  const place = d.place ? placeOf(entry, workspace.places) : null;
  // Lo que ya se cuenta aparte (el lugar, la actividad, por qué no se hizo) no se repite arriba.
  const missedFact = entry.status === "no_realizado" ? d.missed?.why : undefined;
  const facts = entryFacts(entry, workspace).filter(
    (f) =>
      f.text !== (place?.name ?? d.place) &&
      f.text !== d.activity &&
      f.text !== missedFact,
  );

  // La portada (o el póster) va aparte; las fotos de un libro se suman después y también se
  // abren en grande, en el mismo visor.
  const base = entryImages(entry);
  const cover =
    (entry.kind === "Película" || entry.kind === "Libro") && base[0];
  const images =
    entry.kind === "Libro" ? [...base, ...(d.bookPhotos ?? [])] : base;
  const photos = cover ? images.slice(1) : images;
  const firstPhoto = cover ? 1 : 0;
  const quotes = entry.kind === "Libro" ? (d.quotes ?? []).filter(Boolean) : [];
  const names = people.flatMap((p) => [p.name, p.name.split(" ")[0]]);
  const done = entry.status === "completado";
  // Ritual de cierre (libros y películas terminados) y el aprendizaje que dejó.
  const finished = isFinished(entry);
  const ritual = finished ? d.ritual : undefined;
  const ritualLearning = ritual?.learningId
    ? workspace.entries.find((e) => e.id === ritual.learningId)
    : undefined;
  const recommended = (ritual?.recommendTo ?? []).flatMap(
    (id) => workspace.people.find((p) => p.id === id) ?? [],
  );
  // Un aprendizaje que nació de un libro o una película.
  const origin =
    entry.kind === "Aprendizaje" && d.sourceId
      ? workspace.entries.find((e) => e.id === d.sourceId)
      : undefined;
  // O de un artículo de Lecturas: enlaza solo mientras el artículo siga guardado.
  const readingId = entry.kind === "Aprendizaje" ? d.readingId : undefined;
  const [readingAlive, setReadingAlive] = useState(false);
  useEffect(() => {
    setReadingAlive(false);
    if (!readingId) return;
    let live = true;
    void supabase
      .from("readings")
      .select("id")
      .eq("id", readingId)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setReadingAlive(Boolean(data));
      });
    return () => {
      live = false;
    };
  }, [readingId]);

  // Si lo anotaste días después de que pasó, se indica.
  const happened = todayInputValue(new Date(entry.created_at));
  const noted = entry.recorded_at
    ? todayInputValue(new Date(entry.recorded_at))
    : null;
  const notedLater = noted && daysBetween(happened, noted) >= 2;

  const wide = photos.length >= 2 || Boolean(cover);

  return (
    <Sheet
      label={entry.title || (entry.kind === "Nota" ? "Entrada" : entry.kind)}
      className={"ev" + (wide ? " wide" : "")}
      yieldTo=".nx-peek, .sheet.pg, .sheet.cr, .sheet.cz-form-sheet"
      onRequestClose={onClose}
    >
      <div
        className="ev-wrap"
        style={
          {
            "--c": colors.accent,
            "--s": colors.soft,
            "--k": colors.ink,
          } as CSSProperties
        }
      >
        <header className="ev-head">
          <span className="ev-kind">
            <Icon size={14} /> {series ? "Serie" : meta.label}
          </span>
          <span className="ev-date">{longDate(entry.created_at)}</span>
          <button
            type="button"
            className="ev-x"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="ev-scroll">
          <div className={"ev-hero" + (cover ? " with-cover" : "")}>
            {cover && (
              <button
                type="button"
                className="ev-cover"
                aria-label="Ver la imagen"
                onClick={() => app.openImages(images, 0)}
              >
                <img src={cover.medium ?? cover.url} alt="" />
              </button>
            )}
            <div className="ev-title">
              {(entry.title || entry.kind !== "Nota") && (
                <h2
                  className={entry.kind === "Pendiente" && done ? "done" : ""}
                >
                  {entry.title || entry.kind}
                </h2>
              )}
              {entry.kind === "Movimiento" && (
                <strong className={"ev-amount " + entry.direction}>
                  {signedAmount(entry)}
                </strong>
              )}
              {(d.activity || d.place) && (
                <div className="ev-where">
                  {d.activity && <span>{d.activity}</span>}
                  {d.place &&
                    (place ? (
                      <button
                        type="button"
                        onClick={() => navigate(() => app.go("Lugares", place))}
                      >
                        <MapPin size={13} /> {place.name}
                      </button>
                    ) : (
                      <span>
                        <MapPin size={13} /> {d.place}
                      </span>
                    ))}
                </div>
              )}
              {facts.length > 0 && (
                <div className="ev-facts">
                  {facts.map((f) => (
                    <span key={f.text} className={f.tone}>
                      {f.text}
                    </span>
                  ))}
                </div>
              )}
              {specs.progress !== null && (
                <div className="ev-progress">
                  <b>
                    <i style={{ width: specs.progress + "%" }} />
                  </b>
                  <span>
                    Página {d.pagesRead ?? 0} de {d.pagesTotal} ·{" "}
                    {specs.progress}%
                  </span>
                </div>
              )}
              {specs.rows.length > 0 && (
                <dl className="ev-specs">
                  {specs.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>

          {specs.overview && (
            <p className="ev-synopsis">
              <b>Sinopsis</b> {specs.overview}
            </p>
          )}
          {entry.body && (
            <div className="ev-body">
              <RichText text={entry.body} names={names} />
            </div>
          )}
          {entry.kind === "Pendiente" && entry.status === "no_realizado" && (
            <p className="ev-note">
              <b>
                {MISSED_ONE}
                {d.missed?.at && ` ${friendlyDate(d.missed.at).toLowerCase()}`}
              </b>{" "}
              {d.missed?.why || "Sin razón anotada."}
            </p>
          )}
          {entry.kind === "Trabajo" && d.nextStep && (
            <p className="ev-note">
              <b>Siguiente paso</b> {d.nextStep}
            </p>
          )}
          {entry.kind === "Aprendizaje" && d.readingSummary && (
            <p className="ev-note">
              <b>Resumen del artículo</b> {d.readingSummary}
            </p>
          )}
          {entry.kind === "Aprendizaje" && d.apply && (
            <p className="ev-note">
              <b>Lo aplicaré</b> {d.apply}
            </p>
          )}
          {entry.kind === "Aprendizaje" && d.review && (
            <p className="ev-note">
              <b>Repaso espaciado</b>{" "}
              {d.review.step < 0 || !d.review.due
                ? "Ya no se repasa."
                : `Próximo repaso: ${friendlyDate(d.review.due).toLowerCase()}.`}
            </p>
          )}
          {quotes.map((q, i) => (
            <blockquote className="ev-quote" key={i}>
              “{q}”
            </blockquote>
          ))}

          {ritual && (
            <section className="ev-ritual" aria-label="Ritual de cierre">
              <div className="ev-ritual-head">
                <strong>
                  <Sparkles size={13} /> Tu cierre
                </strong>
                <span>{friendlyDate(ritual.at)}</span>
                <button type="button" onClick={() => app.openRitual(entry)}>
                  Rehacer
                </button>
              </div>
              {ritual.answers.length > 0 && (
                <dl>
                  {ritual.answers.map((a) => (
                    <div key={a.id}>
                      <dt>{a.q}</dt>
                      <dd>{a.a}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {(ritual.quiz || recommended.length > 0 || ritualLearning) && (
                <div className="ev-ritual-foot">
                  {ritual.quiz && (
                    <span>
                      <GraduationCap size={13} /> Test: {ritual.quiz.score} de{" "}
                      {ritual.quiz.total}
                    </span>
                  )}
                  {recommended.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      title={`Se lo recomendarías a ${p.name}`}
                      onClick={() => app.peekPerson(p)}
                    >
                      <Avatar person={p} size={18} /> {p.name.split(" ")[0]}
                    </button>
                  ))}
                  {ritualLearning && (
                    <button
                      type="button"
                      onClick={() => app.viewEntry(ritualLearning)}
                    >
                      <Brain size={13} /> Ver aprendizaje
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {photos.length > 0 && (
            <div className={"ev-photos n" + Math.min(photos.length, 3)}>
              {photos.slice(0, 6).map((img, i) => (
                <button
                  type="button"
                  key={img.url}
                  aria-label={`Ver foto ${i + 1}`}
                  onClick={() => app.openImages(images, firstPhoto + i)}
                >
                  <img src={img.medium ?? img.url} alt="" loading="lazy" />
                  {i === 5 && photos.length > 6 && (
                    <span>+{photos.length - 6}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {(people.length > 0 ||
            episode ||
            origin ||
            readingId ||
            entry.tags.length > 0 ||
            entry.file_path) && (
            <div className="ev-links">
              {readingId && !origin && (
                <div className="ev-row">
                  <span className="ev-label">Viene de</span>
                  {readingAlive ? (
                    <button
                      type="button"
                      className="ev-episode"
                      title="Abrir el artículo en Lecturas"
                      onClick={() =>
                        navigate(() => app.go("Lecturas", { id: readingId }))
                      }
                    >
                      <Newspaper size={13} /> {d.sourceName || "Artículo"}
                    </button>
                  ) : (
                    <span
                      className="ev-episode ev-gone"
                      title="El artículo ya no está en Lecturas"
                    >
                      <Newspaper size={13} /> {d.sourceName || "Artículo"}
                    </span>
                  )}
                </div>
              )}
              {origin && (
                <div className="ev-row">
                  <span className="ev-label">Viene de</span>
                  <button
                    type="button"
                    className="ev-episode"
                    onClick={() => app.viewEntry(origin)}
                  >
                    {origin.kind === "Libro" ? (
                      <BookMarked size={13} />
                    ) : (
                      <Clapperboard size={13} />
                    )}{" "}
                    {origin.title}
                  </button>
                </div>
              )}
              {people.length > 0 && (
                <div className="ev-row">
                  <span className="ev-label">Con</span>
                  <div className="ev-people">
                    {people.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        title={`Ver la ficha de ${p.name}`}
                        onClick={() => app.peekPerson(p)}
                      >
                        <Avatar person={p} size={24} /> {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {episode && (
                <div className="ev-row">
                  <span className="ev-label">Parte de</span>
                  <button
                    type="button"
                    className="ev-episode"
                    onClick={() => navigate(() => app.go("Episodios", episode))}
                  >
                    <Layers size={13} /> {episode.title}
                  </button>
                </div>
              )}
              {entry.tags.length > 0 && (
                <div className="ev-row">
                  <span className="ev-label">Etiquetas</span>
                  <div className="ev-tags">
                    {entry.tags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {entry.file_path && (
                <div className="ev-row">
                  <span className="ev-label">Adjunto</span>
                  <button
                    type="button"
                    className="ev-episode"
                    onClick={() => app.openAttachment(entry)}
                  >
                    <Paperclip size={13} /> Abrir documento
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="ev-foot">
          <button
            type="button"
            className="ev-btn danger"
            aria-label="Eliminar recuerdo"
            title="Eliminar"
            onClick={() => app.removeEntry(entry)}
          >
            <Trash2 size={15} />
          </button>
          <span className="ev-noted">
            {notedLater && `Anotado el ${shortDate(entry.recorded_at!)}`}
          </span>
          {entry.kind === "Encuentro" && people.length > 0 && (
            <button
              type="button"
              className="ev-btn"
              onClick={() => app.openBrief(people[0], "despues", entry)}
            >
              <ClipboardCheck size={15} /> Cierre rápido
            </button>
          )}
          {isActive(entry) && (
            <button
              type="button"
              className="ev-btn"
              onClick={() => app.openProgress(entry)}
            >
              <TrendingUp size={15} /> Actualizar progreso
            </button>
          )}
          {finished && !ritual && (
            <button
              type="button"
              className="ev-btn"
              onClick={() => app.openRitual(entry)}
            >
              <Sparkles size={15} /> Ritual de cierre
            </button>
          )}
          {entry.kind === "Pendiente" &&
            (entry.status === "pendiente" ? (
              // Un solo botón: ofrece «Hecho» o «No lo hice» (y luego la razón).
              <button
                type="button"
                className="ev-btn"
                aria-haspopup="menu"
                title={outcomeHint(entry)}
                onClick={(e) => app.askOutcome(entry, e.currentTarget)}
              >
                <Check size={15} /> Marcar como…
              </button>
            ) : (
              <button
                type="button"
                className="ev-btn"
                onClick={() => app.toggleEntry(entry)}
              >
                <RotateCcw size={15} /> Reabrir
              </button>
            ))}
          <AddToNotebook entry={entry} />
          <button
            type="button"
            className="ev-btn main"
            onClick={() => app.editEntry(entry)}
          >
            <Pencil size={15} /> Editar
          </button>
        </footer>
      </div>
    </Sheet>
  );
}

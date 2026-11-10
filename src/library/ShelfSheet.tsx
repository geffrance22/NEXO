import { useMemo, useState } from "react";
import { Library, X } from "lucide-react";
import { useApp } from "../AppContext";
import type { Entry } from "../data";
import { Sheet } from "../components/Sheet";
import { entryImages } from "../lib/moviePosters";
import { ReadMark, toneVars } from "./Collection";
import { timesRead } from "./rereads";
import { toneOf } from "./shelf";

/** Libro en papel que está en tu casa: tuyo o prestado por alguien. */
export const onMyShelf = (e: Entry) =>
  e.kind === "Libro" && e.details.bookFormat === "fisico";

const lent = (e: Entry) => e.details.bookOwner === "prestado";

/** Nombre corto de quien te lo prestó: como mucho dos palabras («Ana María», no el nombre completo). */
const shortName = (name?: string) =>
  name?.trim().split(/\s+/).slice(0, 2).join(" ") || "Prestado";

/** Portada del libro o, si no tiene (o no carga), su título centrado como si fuera la tapa. */
function ShelfCover({ entry }: { entry: Entry }) {
  const img = entryImages(entry)[0];
  const src = img ? (img.medium ?? img.url) : "";
  const [broken, setBroken] = useState("");
  if (src && broken !== src)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(src)}
      />
    );
  return (
    <span className="lt-shelf-ph">
      <b>{entry.title || "Sin título"}</b>
    </span>
  );
}

/** La estantería: los libros en papel que tienes en casa, con el nombre de quien te prestó cada uno. */
export function ShelfSheet({
  books,
  onClose,
}: {
  books: Entry[];
  onClose: () => void;
}) {
  const { viewEntry, workspace } = useApp();
  const list = useMemo(
    () =>
      books
        .filter(onMyShelf)
        .sort((a, b) =>
          a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
        ),
    [books],
  );
  const borrowed = list.filter(lent).length;
  const mine = list.length - borrowed;

  return (
    <Sheet label="Tu estantería" className="lt-shelf" onRequestClose={onClose}>
      <header className="lt-qs-head">
        <h2>
          <Library size={17} /> Tu estantería
        </h2>
        <button type="button" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="lt-shelf-sum">
        {[
          mine && `${mine} ${mine === 1 ? "tuyo" : "tuyos"}`,
          borrowed &&
            `${borrowed} ${borrowed === 1 ? "prestado" : "prestados"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="lt-shelf-grid">
        {list.map((e) => {
          const owner = lent(e) ? shortName(e.details.lentBy) : "";
          const reads = timesRead(e, workspace.entries);
          const label = [
            e.title,
            e.details.author,
            owner && `de ${owner}`,
            reads === 1 ? "leído" : reads > 1 && `leído ${reads} veces`,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              type="button"
              key={e.id}
              className="lt-cover"
              style={toneVars(toneOf(e))}
              title={label}
              aria-label={label}
              onClick={() => {
                onClose();
                viewEntry(e);
              }}
            >
              <span className="lt-art">
                <ShelfCover entry={e} />
                <ReadMark count={reads} className="soft" />
                {owner && <span className="lt-shelf-owner">{owner}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

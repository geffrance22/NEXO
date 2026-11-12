import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  BookOpen,
  Columns3,
  Feather,
  Highlighter,
  Images,
  Link2,
  Search,
  SquareCheck,
  StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../AppContext";
import { kindMeta } from "../composer/kinds";
import { useDismiss } from "../hooks/useDismiss";
import { kindLabel, signedAmount } from "../lib/entries";
import { episodeKindOf } from "../lib/episodes";
import { friendlyDate, shortDate } from "../lib/format";
import { relationMeta, relationOf } from "../lib/people";
import { placeKinds } from "../lib/places";
import { ME, groupKinds, tieCategories, tieKinds } from "../lib/relations";
import { searchWorkspace, type SearchHit } from "../lib/search";
import { plainOf } from "../notes/links";
import { useNoteSearch, type NoteHit } from "../notes/search";
import { Avatar } from "../people/Avatar";
import { ensureFresh, useBoardFeed } from "../planner/boardFeed";
import { aimBoard } from "../planner/boardView";
import {
  JUMP_KEY,
  useReadingSearch,
  type ReadingHit,
} from "../readings/search";
import { useCaptureSearch, type ShotHit } from "../capturas/search";
import { peekShot } from "../capturas/nav";
import {
  agoLabel,
  excerpt,
  linkCount,
  searchInstants,
  type Instant,
} from "../instants/model";
import { useInstants } from "../instants/store";

type Look = { icon: LucideIcon; color: string; soft: string };
type InstantHit = { type: "instant"; instant: Instant };
type Hit = SearchHit | ReadingHit | NoteHit | ShotHit | InstantHit;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;

/** Ícono, colores y textos de una fila de resultado. */
function describe(hit: Hit): { title: string; sub: string; look: Look | null } {
  switch (hit.type) {
    case "instant": {
      const { instant } = hit;
      const n = linkCount(instant);
      return {
        title:
          excerpt(instant.body, 90) ||
          (instant.images.length ? "Instante con fotos" : "Instante"),
        sub: [
          "Instante · " + agoLabel(instant.created_at),
          n ? `${n} ${n === 1 ? "vínculo" : "vínculos"}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        look: { icon: Feather, color: "#5b52a8", soft: "#efedfb" },
      };
    }
    case "shot": {
      const { shot } = hit;
      const note = shot.note.replace(/\s+/g, " ").trim();
      return {
        title: shot.name,
        sub: [
          shot.archived_at ? "Captura archivada" : "Captura",
          note ? clip(note, 70) : shortDate(shot.created_at),
        ].join(" · "),
        look: { icon: Images, color: "#4f6b3d", soft: "#e8f0df" },
      };
    }
    case "note": {
      const text = plainOf(hit.body).replace(/\s+/g, " ").trim();
      return {
        title: hit.title || clip(text, 80) || "Nota",
        sub: [
          hit.archived ? "Nota archivada" : "Nota",
          hit.title && text ? clip(text, 70) : shortDate(hit.created_at),
        ]
          .filter(Boolean)
          .join(" · "),
        look: { icon: StickyNote, color: "#8a6d1f", soft: "#fbf1c2" },
      };
    }
    case "reading":
      return {
        title: hit.title,
        sub: "Lectura · " + hostOf(hit.url),
        look: { icon: BookOpen, color: "#365c52", soft: "#e4efe8" },
      };
    case "mark":
      return {
        title: "«" + clip(hit.quote || hit.note, 90) + "»",
        sub: [hit.title && "De " + clip(hit.title, 60), hit.note && "con nota"]
          .filter(Boolean)
          .join(" · "),
        look: { icon: Highlighter, color: "#9a6b00", soft: "#fff1c2" },
      };
    case "person":
      return {
        title: hit.person.name,
        sub: relationMeta[relationOf(hit.person)].label,
        look: null,
      };
    case "entry": {
      const { entry } = hit;
      const meta = kindMeta[entry.kind];
      return {
        title: entry.title || entry.kind,
        sub:
          entry.kind === "Movimiento"
            ? `${signedAmount(entry)} · ${shortDate(entry.created_at)}`
            : `${kindLabel(entry)} · ${shortDate(entry.created_at)}`,
        look: { icon: meta.icon, color: meta.ink, soft: meta.soft },
      };
    }
    case "place": {
      const { place } = hit;
      const kind = placeKinds[place.kind] ?? placeKinds.otro;
      return {
        title: place.name,
        sub: [kind.label, place.city].filter(Boolean).join(" · "),
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
    case "tie": {
      const { tie, a, b } = hit;
      const info = tieKinds[tie.kind];
      const category = tieCategories[info?.category ?? "otro"];
      return {
        title: `${a?.name ?? "Tú"} → ${b.name}`,
        sub: [info?.label, tie.note].filter(Boolean).join(" · "),
        look: { icon: Link2, color: category.color, soft: category.soft },
      };
    }
    case "group": {
      const { group } = hit;
      const kind = groupKinds[group.kind] ?? groupKinds.otro;
      const n = group.member_ids.length;
      return {
        title: group.name,
        sub: `${kind.label} · ${n} ${n === 1 ? "persona" : "personas"}`,
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
    case "episode": {
      const { episode } = hit;
      const kind = episodeKindOf(episode.kind);
      const when = episode.starts_on ?? episode.created_at;
      return {
        title: episode.title,
        sub: [kind.label, shortDate(when)].filter(Boolean).join(" · "),
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
    case "card": {
      const { card } = hit;
      return {
        title: card.title,
        sub: [
          `${card.board_name} › ${card.list_name}`,
          card.done
            ? "Completada"
            : card.due
              ? "Para " + friendlyDate(card.due).toLowerCase()
              : "",
        ]
          .filter(Boolean)
          .join(" · "),
        look: card.done
          ? { icon: SquareCheck, color: "#2f9a5c", soft: "#e0f3e8" }
          : { icon: Columns3, color: "#2f6b55", soft: "#e3f0ea" },
      };
    }
  }
}

/** Campo de búsqueda del encabezado: personas, recuerdos, instantes, notas, tarjetas, lugares, vínculos, grupos, lecturas y capturas. */
export function GlobalSearch() {
  const { workspace, go, viewEntry, openTie, openGroup, openInstant } =
    useApp();
  const { list: instants } = useInstants();
  const feed = useBoardFeed();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const reading = useReadingSearch(open ? query : "");
  const notes = useNoteSearch(open ? query : "");
  const captures = useCaptureSearch(open ? query : "");

  const local = useMemo(
    () => searchWorkspace(workspace, query, feed.cards),
    [workspace, query, feed.cards],
  );
  // Lo que escribiste tal cual: va junto a lo de tu espacio (también es local).
  const said = useMemo<InstantHit[]>(
    () =>
      searchInstants(instants, query, 5).map((instant) => ({
        type: "instant",
        instant,
      })),
    [instants, query],
  );
  // Notas, lecturas y capturas llegan un instante después: van al final para no mover lo que ya ves.
  const groups = useMemo<{ label: string; hits: Hit[] }[]>(
    () =>
      [
        ...local,
        { label: "Instantes", hits: said },
        { label: "Notas", hits: notes },
        { label: "Lecturas", hits: reading.readings },
        { label: "Resaltados", hits: reading.marks },
        { label: "Capturas", hits: captures },
      ].filter((g) => g.hits.length > 0),
    [local, said, notes, reading.readings, reading.marks, captures],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const shown = open && query.trim() !== "";
  const current = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (i: number) => `${listId}-${i}`;

  const close = useCallback(() => setOpen(false), []);
  useDismiss(shown, root, close);

  const pick = (hit: Hit) => {
    setOpen(false);
    setQuery("");
    switch (hit.type) {
      case "instant":
        return openInstant(hit.instant.id);
      case "shot":
        return peekShot(hit.shot.id);
      case "note":
        return go("Libroteca", { id: hit.id });
      case "reading":
        return go("Lecturas", { id: hit.id });
      case "mark":
        try {
          sessionStorage.setItem(
            JUMP_KEY,
            JSON.stringify({ id: hit.reading_id, at: hit.start }),
          );
        } catch {
          /* Sin almacenamiento: se abre el artículo sin ir al resaltado. */
        }
        return go("Lecturas", { id: hit.reading_id });
      case "person":
        return go("Personas", hit.person);
      case "place":
        return go("Lugares", hit.place);
      case "entry":
        return viewEntry(hit.entry);
      case "tie":
        return openTie(hit.b, [hit.a?.id ?? ME]);
      case "group":
        return openGroup(hit.group);
      case "episode":
        return go("Episodios", hit.episode);
      case "card":
        aimBoard(hit.card.board_id, hit.card.list_id, hit.card.id);
        return go("Tableros");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) return setOpen(query.trim() !== "");
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === "Enter" && shown && current >= 0) {
      e.preventDefault();
      pick(flat[current]);
    }
  };

  let index = 0;
  return (
    <div className="gsearch" ref={root}>
      <label className="gs-field">
        <Search size={15} aria-hidden="true" />
        <input
          className="gs-input"
          role="combobox"
          aria-label="Buscar en todo el espacio"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            shown && current >= 0 ? optionId(current) : undefined
          }
          placeholder="Buscar…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            ensureFresh();
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {shown && (
        <div className="pp-dropdown gs-panel" role="listbox" id={listId}>
          {groups.length === 0 && (
            <div
              className="gs-empty"
              role="option"
              aria-selected="false"
              aria-disabled="true"
            >
              {reading.loading
                ? "Buscando…"
                : `Sin resultados para «${query.trim()}»`}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <span className="pp-dropdown-label" aria-hidden="true">
                {group.label}
              </span>
              {group.hits.map((hit) => {
                const i = index++;
                const { title, sub, look } = describe(hit);
                return (
                  <div
                    key={i}
                    id={optionId(i)}
                    className={"gs-row" + (i === current ? " active" : "")}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={() => pick(hit)}
                  >
                    {hit.type === "person" ? (
                      <Avatar person={hit.person} size={28} />
                    ) : hit.type === "shot" ? (
                      <span className="gs-ico gs-thumb" aria-hidden="true">
                        <img
                          src={hit.shot.thumb ?? hit.shot.url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    ) : (
                      look && (
                        <span
                          className="gs-ico"
                          style={{ background: look.soft, color: look.color }}
                        >
                          <look.icon size={15} />
                        </span>
                      )
                    )}
                    <span className="gs-text">
                      <span className="gs-title">{title}</span>
                      {sub && <span className="gs-sub">{sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

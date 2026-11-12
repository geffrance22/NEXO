import { useEffect, useId, useMemo, useState } from "react";
import { Hash, X } from "lucide-react";
import { normalizeText } from "../lib/format";

const MAX_TAGS = 12;
/** Cuántas sugerencias se muestran a la vez. */
const SHOWN = 6;

/** Etiquetas como fichas: escribe y pulsa Enter o coma. Con `suggestions`, propone mientras escribes. */
export function TagInput({
  tags,
  onChange,
  placeholder = "Añadir etiqueta…",
  max = MAX_TAGS,
  suggestions,
  id,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  max?: number;
  /** Etiquetas que ya usas en otras partes, las más usadas primero. */
  suggestions?: string[];
  /** Para saltar a este campo desde fuera. */
  id?: string;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const full = tags.length >= max;
  // Al llenarse se descarta lo que quedara a medio escribir.
  useEffect(() => {
    if (full) setText("");
  }, [full]);

  /** Agrega varias a la vez, sin repetidas ni vacías. */
  const addMany = (parts: string[]) => {
    const next = [...tags];
    for (const raw of parts) {
      const clean = raw.replace(/^#+/, "").trim().slice(0, 40);
      if (!clean || next.length >= max) continue;
      if (next.some((t) => t.toLowerCase() === clean.toLowerCase())) continue;
      next.push(clean);
    }
    if (next.length !== tags.length) onChange(next);
  };

  // Sin escribir: las más usadas. Escribiendo: las que empiezan así primero, luego las que lo contienen.
  const options = useMemo(() => {
    if (!suggestions?.length || full) return [];
    const have = new Set(tags.map((t) => normalizeText(t)));
    const q = normalizeText(text.replace(/^#+/, "").trim());
    const free = suggestions.filter((s) => !have.has(normalizeText(s)));
    if (!q) return free.slice(0, SHOWN);
    const starts = free.filter((s) => normalizeText(s).startsWith(q));
    const contains = free.filter(
      (s) => !starts.includes(s) && normalizeText(s).includes(q),
    );
    return [...starts, ...contains]
      .filter((s) => normalizeText(s) !== q)
      .slice(0, SHOWN);
  }, [suggestions, tags, text, full]);
  const open = focused && options.length > 0;

  useEffect(() => setActive(-1), [text]);

  const pick = (s: string) => {
    addMany([s]);
    setText("");
  };

  return (
    <div className={"cp-tokens tags" + (suggestions ? " with-sug" : "")}>
      {tags.map((t) => (
        <span className="cp-token tag" key={t}>
          #{t}
          <button
            type="button"
            aria-label={`Quitar etiqueta ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <label className={"cp-token-input" + (full ? " full" : "")}>
        <Hash size={14} />
        <input
          id={id}
          value={full ? "" : text}
          disabled={full}
          placeholder={full ? `Máximo ${max} etiquetas` : placeholder}
          aria-label={
            full ? `Llegaste al máximo de ${max} etiquetas` : "Añadir etiqueta"
          }
          title={full ? "Quita una etiqueta para añadir otra" : undefined}
          role={suggestions ? "combobox" : undefined}
          aria-expanded={suggestions ? open : undefined}
          aria-controls={suggestions ? listId : undefined}
          aria-autocomplete={suggestions ? "list" : undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            const parts = e.target.value.split(",");
            if (parts.length > 1) addMany(parts.slice(0, -1));
            setText(parts[parts.length - 1]);
          }}
          onKeyDown={(e) => {
            if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              const n = options.length;
              setActive((i) =>
                e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              // Enter elige la sugerencia marcada con las flechas; si no hay, guarda lo escrito.
              if (open && active >= 0) pick(options[active]);
              else {
                addMany([text]);
                setText("");
              }
            } else if (e.key === "Tab" && open && text.trim()) {
              e.preventDefault();
              pick(options[Math.max(0, active)]);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setFocused(false);
            } else if (e.key === "Backspace" && !text && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            setFocused(false);
            addMany([text]);
            setText("");
          }}
        />
      </label>
      {open && (
        <ul
          className="cp-tag-sug"
          id={listId}
          role="listbox"
          aria-label="Sugerencias"
        >
          {options.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              // Sin perder el foco del campo (si no, el blur guardaría lo escrito a medias).
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              #{s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

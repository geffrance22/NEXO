import { useEffect, useState } from 'react';
import { Hash, X } from 'lucide-react';

const MAX_TAGS = 12;

/** Etiquetas como fichas: escribe y pulsa Enter o coma. */
export function TagInput({
  tags,
  onChange,
  placeholder = 'Añadir etiqueta…',
  max = MAX_TAGS,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [text, setText] = useState('');
  const full = tags.length >= max;
  // Al llenarse se descarta lo que quedara a medio escribir.
  useEffect(() => {
    if (full) setText('');
  }, [full]);

  /** Agrega varias a la vez, sin repetidas ni vacías. */
  const addMany = (parts: string[]) => {
    const next = [...tags];
    for (const raw of parts) {
      const clean = raw.replace(/^#+/, '').trim().slice(0, 40);
      if (!clean || next.length >= max) continue;
      if (next.some((t) => t.toLowerCase() === clean.toLowerCase())) continue;
      next.push(clean);
    }
    if (next.length !== tags.length) onChange(next);
  };

  return (
    <div className="cp-tokens tags">
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
      <label className={'cp-token-input' + (full ? ' full' : '')}>
        <Hash size={14} />
        <input
          value={full ? '' : text}
          disabled={full}
          placeholder={full ? `Máximo ${max} etiquetas` : placeholder}
          aria-label={full ? `Llegaste al máximo de ${max} etiquetas` : 'Añadir etiqueta'}
          title={full ? 'Quita una etiqueta para añadir otra' : undefined}
          onChange={(e) => {
            const parts = e.target.value.split(',');
            if (parts.length > 1) addMany(parts.slice(0, -1));
            setText(parts[parts.length - 1]);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addMany([text]);
              setText('');
            } else if (e.key === 'Backspace' && !text && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            addMany([text]);
            setText('');
          }}
        />
      </label>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { notebookColors, type Notebook, type NotebookColor } from './model';
import { createNotebook, updateNotebook } from './useCuadernos';

/** Crear o editar un cuaderno: nombre, para qué es y su color. */
export function NotebookForm({
  notebook,
  onClose,
  onCreated,
}: {
  notebook?: Notebook;
  onClose: () => void;
  onCreated?: (nb: Notebook) => void;
}) {
  const { notify } = useApp();
  const [name, setName] = useState(notebook?.name ?? '');
  const [description, setDescription] = useState(notebook?.description ?? '');
  const [color, setColor] = useState<NotebookColor>(notebook?.color ?? 'salvia');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const input = { name: name.trim(), description: description.trim(), color };
    if (notebook) {
      const ok = await updateNotebook(notebook.id, input);
      setBusy(false);
      if (ok !== true) return notify(ok);
      onClose();
      return;
    }
    const nb = await createNotebook(input);
    setBusy(false);
    if (typeof nb === 'string') return notify(nb);
    onClose();
    onCreated?.(nb);
  }

  return (
    <Sheet
      label={notebook ? 'Editar cuaderno' : 'Nuevo cuaderno'}
      className="cz-form-sheet"
      onRequestClose={onClose}
    >
      <form className="cz-form" onSubmit={submit}>
        <header>
          <h2>{notebook ? 'Editar cuaderno' : 'Nuevo cuaderno'}</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label>
          <span>Nombre</span>
          <input
            autoFocus
            value={name}
            maxLength={100}
            placeholder="Viaje a Japón, Ideas para el cumpleaños de mamá…"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>
            Para qué es <small>opcional; también orienta a la IA</small>
          </span>
          <textarea
            value={description}
            maxLength={2000}
            rows={3}
            placeholder="Reúno aquí todo lo que me sirva para…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Color</legend>
          <div className="cz-swatches">
            {(Object.keys(notebookColors) as NotebookColor[]).map((c) => (
              <button
                type="button"
                key={c}
                className={c === color ? 'on' : ''}
                style={{ background: notebookColors[c].accent }}
                aria-label={notebookColors[c].label}
                aria-pressed={c === color}
                title={notebookColors[c].label}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={14} />}
              </button>
            ))}
          </div>
        </fieldset>
        <footer>
          <button type="button" className="lt-add soft" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="lt-add" disabled={!name.trim() || busy}>
            {notebook ? 'Guardar' : 'Crear cuaderno'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}

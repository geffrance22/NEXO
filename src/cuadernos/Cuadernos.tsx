import { useMemo, useState, type CSSProperties } from 'react';
import { Database, MoreHorizontal, NotebookTabs, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { EmptyState } from '../library/Collection';
import { MenuItem, Popover } from '../planner/BoardPopover';
import { notebookColors, type Notebook, type NotebookItemType } from './model';
import { NotebookForm } from './NotebookForm';
import { resolveItem, typeMeta } from './resolve';
import { NOTEBOOKS_MIGRATION, removeNotebook, useCuadernos } from './useCuadernos';
import './cuadernos.css';

const TYPE_ORDER: NotebookItemType[] = [
  'entry',
  'person',
  'episode',
  'place',
  'reading',
  'note',
  'text',
];

export const notebookVars = (nb: Pick<Notebook, 'color'>) => {
  const c = notebookColors[nb.color];
  return { '--c': c.accent, '--s': c.soft, '--k': c.ink } as CSSProperties;
};

/** Aviso cuando falta la tabla de cuadernos (migración sin ejecutar). */
export function NotebooksMissing() {
  return (
    <div className="cz-missing" role="status">
      <Database size={18} />
      <p>
        Para usar los cuadernos, ejecuta la migración <code>{NOTEBOOKS_MIGRATION}</code> en tu
        proyecto de Supabase y recarga la página.
      </p>
    </div>
  );
}

/** Pestaña «Cuadernos» de Agenda: tus colecciones, cada una con su lienzo. */
export function Cuadernos({
  query,
  creating,
  setCreating,
}: {
  query: string;
  creating: boolean;
  setCreating: (v: boolean) => void;
}) {
  const { go } = useApp();
  const { list, missing, error } = useCuadernos();
  const [editing, setEditing] = useState<Notebook | null>(null);

  const needle = normalizeText(query.trim());
  const shown = useMemo(
    () =>
      (list ?? []).filter(
        (nb) => !needle || normalizeText(nb.name + ' ' + nb.description).includes(needle),
      ),
    [list, needle],
  );

  let body;
  if (missing) body = <NotebooksMissing />;
  else if (!list)
    body = (
      <div className="cz-grid" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="cz-nb skeleton" />
        ))}
      </div>
    );
  else if (!list.length)
    body = (
      <EmptyState
        icon={NotebookTabs}
        title="Un cuaderno reúne lo que quieras (encuentros, libros, personas, lecturas, pendientes…) en un lienzo libre, y la IA responde solo con lo que hay dentro."
        action={{ label: 'Crear el primero', run: () => setCreating(true) }}
      />
    );
  else
    body = (
      <>
        {error && <p className="lt-none">{error}</p>}
        {shown.length ? (
          <div className="cz-grid">
            {shown.map((nb) => (
              <NotebookCard key={nb.id} nb={nb} onEdit={() => setEditing(nb)} />
            ))}
          </div>
        ) : (
          <p className="lt-none">Ningún cuaderno coincide con «{query.trim()}».</p>
        )}
      </>
    );

  return (
    <>
      {body}
      {(creating || editing) && (
        <NotebookForm
          notebook={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onCreated={(nb) => go('Agenda', nb)}
        />
      )}
    </>
  );
}

function NotebookCard({ nb, onEdit }: { nb: Notebook; onEdit: () => void }) {
  const { workspace, go, confirm, notify } = useApp();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const today = todayInputValue();

  const counts = new Map<NotebookItemType, number>();
  for (const it of nb.items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
  // Lo primero con imagen (portadas, fotos, caras) hace de vista previa.
  const previews = nb.items
    .map((it) => resolveItem(it, workspace, null))
    .filter((m) => !m.missing && (m.cover || m.person))
    .slice(0, 4);

  async function remove() {
    setAnchor(null);
    const ok = await confirm({
      title: `¿Eliminar el cuaderno «${nb.name.slice(0, 60)}»?`,
      message:
        'Solo se borra el cuaderno y sus fichas de texto. Los recuerdos, personas y lecturas que reunía siguen donde estaban.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const done = await removeNotebook(nb.id);
    notify(done === true ? 'Cuaderno eliminado.' : done);
  }

  return (
    <div className="cz-nb" style={notebookVars(nb)}>
      <button
        type="button"
        className="cz-nb-open"
        aria-label={`Abrir ${nb.name}`}
        onClick={() => go('Agenda', nb)}
      />
      <span className="cz-nb-band" aria-hidden="true">
        {previews.length > 0 ? (
          previews.map((p, i) =>
            p.person && !p.cover ? (
              <span key={i} className="cz-nb-face">
                {p.person.profile.photo ? (
                  <img src={p.person.profile.photo.thumb ?? p.person.profile.photo.url} alt="" />
                ) : (
                  p.person.name.slice(0, 1)
                )}
              </span>
            ) : (
              <img key={i} src={p.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ),
          )
        ) : (
          <NotebookTabs size={22} />
        )}
      </span>
      <span className="cz-nb-main">
        <strong>{nb.name}</strong>
        {nb.description && <small>{nb.description}</small>}
        <span className="cz-nb-types">
          {nb.items.length === 0 && <em>Vacío</em>}
          {TYPE_ORDER.filter((t) => counts.get(t)).map((t) => {
            const Icon = typeMeta[t].icon;
            return (
              <span key={t} title={typeMeta[t].plural}>
                <Icon size={12} /> {counts.get(t)}
              </span>
            );
          })}
        </span>
        <span className="cz-nb-foot">
          <Sparkles size={12} /> IA solo con este cuaderno ·{' '}
          {friendlyDate(todayInputValue(new Date(nb.updated_at)), today).toLowerCase()}
        </span>
      </span>
      <button
        type="button"
        className="cz-nb-menu"
        aria-label={`Opciones de ${nb.name}`}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <MoreHorizontal size={16} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label="Opciones del cuaderno"
          width={200}
          onClose={() => setAnchor(null)}
        >
          <MenuItem
            icon={<Pencil size={14} />}
            onClick={() => {
              setAnchor(null);
              onEdit();
            }}
          >
            Editar
          </MenuItem>
          <MenuItem icon={<Trash2 size={14} />} danger onClick={() => void remove()}>
            Eliminar
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

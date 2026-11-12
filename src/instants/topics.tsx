import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { BookMarked, Tv } from 'lucide-react';
import { useApp } from '../AppContext';
import { kindMeta, seriesColors } from '../composer/kinds';
import { notebookColors, type Notebook } from '../cuadernos/model';
import { useCuadernos } from '../cuadernos/useCuadernos';
import type { Entry, Episode, Workspace } from '../data';
import { entrySummary, isSeries } from '../lib/entries';
import { episodeKindOf } from '../lib/episodes';
import { friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { QuickPick, type QuickItem } from './QuickPick';

/**
 * El «Episodio o tema» de un instante: un episodio, un cuaderno o cualquier recuerdo (encuentro,
 * diario, película, serie, libro…). Un episodio queda en `episode_ids`, un cuaderno en
 * `notebook_ids` y un recuerdo en `entry_ids`.
 */
export type TopicKind = 'episode' | 'entry' | 'notebook';
export type Topic = { kind: TopicKind; id: string };

export const topicKey = (t: Topic) => `${t.kind}:${t.id}`;
export function topicOf(key: string): Topic | null {
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  if (kind !== 'episode' && kind !== 'entry' && kind !== 'notebook') return null;
  return { kind, id: key.slice(at + 1) };
}

/** Sin buscar: cuántos episodios activos se sugieren. */
const SUGGESTED = 3;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** «Diario» para las entradas, «Serie» para las series y el nombre del tipo para lo demás. */
const entryLabel = (e: Entry) =>
  isSeries(e) ? 'Serie' : e.kind === 'Nota' ? 'Diario' : kindMeta[e.kind].label;
/** Su título; si no tiene (entradas sin título), el comienzo de lo que dice. */
const entryName = (e: Entry) => e.title.trim() || clip(entrySummary(e), 60) || entryLabel(e);

const tile = (color: string, soft: string, icon: ReactNode) => (
  <span className="qp-tile" style={{ '--c': color, '--s': soft } as CSSProperties}>
    {icon}
  </span>
);

/** Lo elegido, listo para mostrarse como etiqueta junto a tu nombre. */
export type TopicChip = { key: string; label: string; color: string; title: string };

/** Null si lo elegido ya no existe (se borró). */
export function topicChip(
  t: Topic,
  ws: Pick<Workspace, 'episodes' | 'entries'>,
  notebooks: readonly Notebook[],
): TopicChip | null {
  const key = topicKey(t);
  if (t.kind === 'episode') {
    const e = ws.episodes.find((x) => x.id === t.id);
    if (!e) return null;
    const m = episodeKindOf(e.kind);
    return { key, label: e.title, color: m.color, title: `Episodio · ${m.label}` };
  }
  if (t.kind === 'notebook') {
    const nb = notebooks.find((x) => x.id === t.id);
    if (!nb) return null;
    return { key, label: nb.name, color: notebookColors[nb.color].accent, title: 'Cuaderno' };
  }
  const e = ws.entries.find((x) => x.id === t.id);
  if (!e) return null;
  const tone = isSeries(e) ? seriesColors : kindMeta[e.kind];
  return { key, label: entryName(e), color: tone.accent, title: entryLabel(e) };
}

const when = (e: Episode) => e.starts_on ?? e.created_at;

/** Los activos primero (más recientes arriba); los cerrados solo salen al buscar. */
function episodeItems(episodes: readonly Episode[]): QuickItem[] {
  return [...episodes]
    .sort(
      (a, b) =>
        Number(b.status === 'activo') - Number(a.status === 'activo') ||
        when(b).localeCompare(when(a)),
    )
    .map((e) => {
      const m = episodeKindOf(e.kind);
      const open = e.status === 'activo';
      return {
        id: topicKey({ kind: 'episode', id: e.id }),
        name: e.title,
        sub: `${open ? 'Episodio' : 'Episodio cerrado'} · ${m.label}`,
        lead: tile(m.color, m.soft, <m.icon size={15} />),
        search: normalizeText(
          `${e.title} ${e.summary} ${m.label} episodio ${open ? 'activo' : 'cerrado'}`,
        ),
        searchOnly: !open,
      };
    });
}

function notebookItems(list: readonly Notebook[]): QuickItem[] {
  return [...list]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((nb) => {
      const c = notebookColors[nb.color];
      const n = nb.items.length;
      return {
        id: topicKey({ kind: 'notebook', id: nb.id }),
        name: nb.name,
        sub: `Cuaderno · ${n} ${n === 1 ? 'elemento' : 'elementos'}`,
        lead: tile(c.accent, c.soft, <BookMarked size={15} />),
        search: normalizeText(`${nb.name} ${nb.description} cuaderno`),
        searchOnly: true,
      };
    });
}

/** Encuentros, diario, películas, series, libros… (sin los movimientos ni lo de la bóveda). */
function entryItems(entries: readonly Entry[]): QuickItem[] {
  const today = todayInputValue();
  return entries
    .filter((e) => e.kind !== 'Movimiento' && !e.details.vault)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => {
      const series = isSeries(e);
      const tone = series ? seriesColors : kindMeta[e.kind];
      const Icon = series ? Tv : kindMeta[e.kind].icon;
      const label = entryLabel(e);
      return {
        id: topicKey({ kind: 'entry', id: e.id }),
        name: entryName(e),
        // La fecha se arma al pintar la fila: son muchos recuerdos y se ven pocos.
        sub: () => `${label} · ${friendlyDate(todayInputValue(new Date(e.created_at)), today)}`,
        lead: tile(tone.accent, tone.soft, <Icon size={15} />),
        search: normalizeText(
          [e.title, e.body.slice(0, 300), e.tags.join(' '), label, e.kind].join(' '),
        ),
        searchOnly: true,
      };
    });
}

/**
 * Buscador del «Episodio o tema». Sin escribir, solo sugiere tus episodios activos; al escribir
 * busca también en los cerrados, los cuadernos y los recuerdos. Se arma al abrirse, no antes.
 */
export function TopicPick({
  anchor,
  selected,
  withNotebooks,
  onToggle,
  onClose,
}: {
  anchor: HTMLElement;
  /** Claves (`topicKey`) de lo ya elegido. */
  selected: string[];
  /** Falta la columna de cuadernos de los instantes: no se ofrecen. */
  withNotebooks: boolean;
  onToggle: (key: string) => void;
  onClose: () => void;
}) {
  const { workspace } = useApp();
  const { list: notebooks } = useCuadernos();
  const items = useMemo<QuickItem[]>(
    () => [
      ...episodeItems(workspace.episodes),
      ...(withNotebooks ? notebookItems(notebooks ?? []) : []),
      ...entryItems(workspace.entries),
    ],
    [workspace.episodes, workspace.entries, notebooks, withNotebooks],
  );
  return (
    <QuickPick
      anchor={anchor}
      label="Episodio o tema"
      placeholder={`Busca un episodio, un encuentro${withNotebooks ? ', un cuaderno' : ''}…`}
      items={items}
      top={SUGGESTED}
      selected={selected}
      noun="temas"
      topLabel="Episodios activos"
      emptyTop="No tienes episodios activos."
      hint=""
      onPick={onToggle}
      onClose={onClose}
    />
  );
}

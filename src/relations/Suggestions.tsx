import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Brain,
  Check,
  CheckCheck,
  FileText,
  HelpCircle,
  Home,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Tie, TieKind, TieNature } from '../data';
import { ignoredSurnames, learn } from '../lib/brain';
import { normalizeText } from '../lib/format';
import { suggestGroups } from '../lib/groupSuggestions';
import {
  ME,
  explain,
  groupKinds,
  inferTies,
  tieKey,
  kindTitle,
  kindWord,
  suggestTies,
  suggestionRank,
  surnamesOf,
  tieCategories,
  tieKinds,
  type Suggestion,
} from '../lib/relations';
import { genderOf } from '../lib/gender';
import { Avatar } from '../people/Avatar';
import { dismiss, undismiss, useDismissed } from './dismissed';
import './relations.css';

/** Lo que Nexo aprendió de tus confirmaciones y descartes (por apellido). */
export function useBrain() {
  const { workspace, me } = useApp();
  const skip = useDismissed();
  const myName = me.profile.name ?? '';
  return useMemo(
    () => learn(workspace.people, workspace.ties, workspace.groups, skip, surnamesOf(myName)),
    [workspace.people, workspace.ties, workspace.groups, skip, myName],
  );
}

/** Sugerencias vigentes (todas o las de una persona). */
export function useSuggestions(personId?: string) {
  const { workspace, me } = useApp();
  const skip = useDismissed();
  const brain = useBrain();
  // Tus apellidos (de «Mi ficha») también sirven para encontrar a tu familia.
  const myName = me.profile.name ?? '';
  // Quién podría estar en cada grupo (no depende de la persona: se calcula una vez).
  const groupHints = useMemo(
    () =>
      suggestGroups(
        workspace.people,
        workspace.groups,
        workspace.ties,
        workspace.entries,
        workspace.episodes,
        skip,
      ),
    [
      workspace.people,
      workspace.groups,
      workspace.ties,
      workspace.entries,
      workspace.episodes,
      skip,
    ],
  );
  return useMemo(() => {
    const all = [
      ...suggestTies(
        workspace.people,
        workspace.ties,
        workspace.groups,
        skip,
        surnamesOf(myName),
        myName,
        brain,
      ),
      ...groupHints,
    ].sort((a, b) => suggestionRank[a.type] - suggestionRank[b.type]);
    return personId ? all.filter((s) => s.members.includes(personId)) : all;
  }, [
    workspace.people,
    workspace.ties,
    workspace.groups,
    skip,
    personId,
    myName,
    brain,
    groupHints,
  ]);
}

/** Suma a varias personas a sus grupos (una escritura por grupo). */
function useJoinGroups() {
  const { workspace, updateGroup } = useApp();
  return async (list: Suggestion[]) => {
    const byGroup = new Map<string, string[]>();
    for (const s of list) {
      if (!s.join) continue;
      byGroup.set(s.join.groupId, [...(byGroup.get(s.join.groupId) ?? []), s.members[0]]);
    }
    const done: string[] = [];
    for (const [groupId, ids] of byGroup) {
      const g = workspace.groups.find((x) => x.id === groupId);
      if (!g) continue;
      const fresh = ids.filter((id) => !g.member_ids.includes(id));
      if (
        !fresh.length ||
        (await updateGroup(g, { member_ids: [...g.member_ids, ...fresh] }, true))
      )
        done.push(...list.filter((s) => s.join?.groupId === groupId).map((s) => s.id));
    }
    if (done.length) dismiss(...done);
    return done.length;
  };
}

/** «¿Laura está en Equipo de Rappi?»: sí la suma al grupo; no, no se vuelve a preguntar. */
function GroupSuggestionCard({ s }: { s: Suggestion }) {
  const { workspace, notify, peekPerson } = useApp();
  const join = useJoinGroups();
  const [busy, setBusy] = useState(false);
  const g = workspace.groups.find((x) => x.id === s.join?.groupId);
  const p = workspace.people.find((x) => x.id === s.members[0]);
  if (!g || !p) return null;
  const m = groupKinds[g.kind] ?? groupKinds.otro;
  return (
    <div className="rl-sug" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
      <span className="rl-sug-icon">
        <m.icon size={15} />
      </span>
      <div className="rl-sug-main">
        <strong>{s.title}</strong>
        <small>{s.reason}</small>
        <div className="rl-sug-faces">
          <button
            type="button"
            className="rl-sug-face"
            title={`Ver a ${p.name}`}
            onClick={() => peekPerson(p)}
          >
            <Avatar person={p} size={24} />
          </button>
          <span className="rl-sug-group">
            <m.icon size={12} /> {g.name} · {g.member_ids.length}
          </span>
        </div>
        <div className="rl-sug-actions">
          <button
            type="button"
            className="on"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              if (await join([s])) notify(`${p.name.split(' ')[0]} ahora está en «${g.name}».`);
              setBusy(false);
            }}
          >
            {busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Sí, añadir
          </button>
          <button
            type="button"
            className="no"
            disabled={busy}
            title="No está en este grupo"
            onClick={() => {
              dismiss(s.id);
              notify('No se volverá a sugerir.', { label: 'Deshacer', run: () => undismiss(s.id) });
            }}
          >
            <X size={13} /> No
          </button>
        </div>
      </div>
    </div>
  );
}

/** Apellidos que Nexo dejó de sugerir por tus respuestas, con «Restablecer». */
function Learned() {
  const { workspace, notify } = useApp();
  const brain = useBrain();
  const ignored = ignoredSurnames(brain);
  if (!ignored.length) return null;
  const names = workspace.people.map((p) => p.name);
  const pretty = (s: string) => {
    for (const n of names)
      for (const part of n.split(/\s+/)) if (normalizeText(part) === s) return part;
    return s[0].toUpperCase() + s.slice(1);
  };
  return (
    <div className="rl-learned">
      <Brain size={14} />
      <span>Ya no sugiere: {ignored.map((x) => pretty(x.surname)).join(', ')}</span>
      <button
        type="button"
        className="pp-text-btn"
        onClick={() => {
          const keys = ignored.flatMap((x) => x.keys);
          undismiss(...keys);
          notify('Apellidos restablecidos.', { label: 'Deshacer', run: () => dismiss(...keys) });
        }}
      >
        <RotateCcw size={13} /> Restablecer
      </button>
    </div>
  );
}

/** Vínculos deducidos que aún no descartaste. */
export function useInferred() {
  const { workspace } = useApp();
  const skip = useDismissed();
  return useMemo(() => {
    // Solo entre personas que existen (un vínculo huérfano no debe dejar nada pendiente).
    const ids = new Set(workspace.people.map((p) => p.id));
    const live = (t: { a: string | null; b: string }) =>
      (t.a === null || ids.has(t.a)) && ids.has(t.b);
    return inferTies(workspace.ties.filter(live), skip).filter(live);
  }, [workspace.people, workspace.ties, skip]);
}

/** Un parentesco deducido, con su motivo y «Confirmar» / «No es así». */
function InferredRow({ tie }: { tie: Tie }) {
  const { workspace, saveTie, notify } = useApp();
  const name = (id: string | null) =>
    id === null || id === ME
      ? 'Tú'
      : (workspace.people.find((p) => p.id === id)?.name.split(' ')[0] ?? '?');
  const g = (id: string | null) =>
    id && id !== ME ? genderOf(workspace.people.find((p) => p.id === id)) : null;
  const cat = tieCategories[tieKinds[tie.kind].category];
  const k = tieKey(tie.a, tie.b, tie.kind);
  return (
    <div className="rl-inf" style={{ '--c': cat.color, '--s': cat.soft } as CSSProperties}>
      <div>
        <strong>
          {tie.a === null
            ? `${name(tie.b)} es tu ${kindWord(tieKinds[tie.kind].inverse, g(tie.b))}`
            : `${name(tie.a)} es ${kindWord(tie.kind, g(tie.a))} de ${name(tie.b)}`}
        </strong>
        <small>{explain(tie, (id) => name(id))}</small>
      </div>
      <button
        type="button"
        className="on"
        title="Confirmar"
        onClick={() => void saveTie({ a: tie.a, b: tie.b, kind: tie.kind }, true)}
      >
        <Check size={13} />
      </button>
      <button
        type="button"
        title="No es así"
        onClick={() => {
          dismiss(k);
          notify('No se volverá a deducir.', { label: 'Deshacer', run: () => undismiss(k) });
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

const plural: Partial<Record<TieKind, string>> = {
  hermano: 'Hermanos',
  primo: 'Primos',
  familiar: 'Familiares',
};

function SuggestionCard({ s }: { s: Suggestion }) {
  const { workspace, saveTies, saveGroup, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const byId = new Map(workspace.people.map((p) => [p.id, p]));
  const name = (id: string) => (id === ME ? 'ti' : (byId.get(id)?.name.split(' ')[0] ?? '?'));
  const first = s.members[0];
  const kind = s.tie?.kind ?? s.options[0];
  const cat = tieCategories[tieKinds[kind].category];
  const g = (id: string | null | undefined) => (id && id !== ME ? genderOf(byId.get(id)) : null);
  // De quién se dice el vínculo en los botones (para escribir «madre» o «padre»).
  const who = s.tie ? s.tie.a : s.pairs ? null : first;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const accept = (k: TieKind, nature?: TieNature) =>
    run(async () => {
      const inputs = s.tie
        ? [{ ...s.tie, kind: k, nature }]
        : s.pairs
          ? s.pairs.map(([a, b]) => ({ a, b, kind: k, nature }))
          : [{ a: first, b: ME, kind: k, nature }];
      if ((await saveTies(inputs)).length) dismiss(s.id);
    });
  const no = () => {
    dismiss(s.id);
    notify('Sugerencia descartada.', { label: 'Deshacer', run: () => undismiss(s.id) });
  };

  const title = s.title
    ? s.title
    : s.tie
      ? s.tie.b === ME
        ? `¿${name(s.tie.a)} es tu ${kindWord(s.tie.kind, g(s.tie.a))}?`
        : `¿${name(s.tie.a)} es ${kindWord(s.tie.kind, g(s.tie.a))} de ${name(s.tie.b)}?`
      : s.type === 'tuya'
        ? `¿${name(first)} es familia tuya?`
        : s.members.length === 2
          ? `¿${name(s.members[0])} y ${name(s.members[1])} son familia?`
          : '¿Son familia?';
  const Icon =
    s.type === 'texto'
      ? FileText
      : s.type === 'tuya'
        ? UserRound
        : s.type === 'probable'
          ? HelpCircle
          : Users;

  return (
    <div className="rl-sug" style={{ '--c': cat.color, '--s': cat.soft } as CSSProperties}>
      <span className="rl-sug-icon">
        <Icon size={15} />
      </span>
      <div className="rl-sug-main">
        <strong>{title}</strong>
        <small>{s.reason}</small>
        <div className="rl-sug-faces">
          {s.members.slice(0, 8).map((id) =>
            id === ME ? (
              <span key={id} className="rl-me sm">
                Tú
              </span>
            ) : (
              byId.get(id) && <Avatar key={id} person={byId.get(id)!} size={24} />
            ),
          )}
          {s.members.length > 8 && <i>+{s.members.length - 8}</i>}
        </div>
        <div className="rl-sug-actions">
          {s.choices ? (
            s.choices.map((c, i) => (
              <button
                type="button"
                key={c.label}
                className={i === 0 ? 'on' : ''}
                disabled={busy}
                onClick={() => void accept(c.kind, c.nature)}
              >
                {i === 0 && <Check size={13} />} {c.label}
              </button>
            ))
          ) : s.type === 'probable' && s.pairs ? (
            <button
              type="button"
              className="on"
              disabled={busy}
              onClick={() => void accept('hermano')}
            >
              <Check size={13} /> Sí, {s.members.length === 2 ? 'lo son' : 'todos'}
            </button>
          ) : s.tie ? (
            <button
              type="button"
              className="on"
              disabled={busy}
              onClick={() => void accept(s.tie!.kind)}
            >
              {busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Sí,
              vincular
            </button>
          ) : (
            s.options.map((k, i) => (
              <button
                type="button"
                key={k}
                className={i === 0 ? 'on' : ''}
                disabled={busy}
                onClick={() => void accept(k)}
              >
                {s.pairs ? (plural[k] ?? kindWord(k)) : kindTitle(k, g(who))}
              </button>
            ))
          )}
          {s.group && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const g = await saveGroup({
                    name: s.group!,
                    kind: 'familia',
                    description: '',
                    member_ids: s.members.filter((m) => m !== ME),
                  });
                  if (g) dismiss(s.id);
                })
              }
            >
              <Home size={13} /> Grupo «{s.group}»
            </button>
          )}
          <button type="button" className="no" disabled={busy} onClick={no} title="No es así">
            <X size={13} /> No
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lista de sugerencias con «Aceptar todas» para las que dicen exactamente qué vínculo es. */
export function SuggestionList({ list, max }: { list: Suggestion[]; max?: number }) {
  const { saveTies } = useApp();
  const join = useJoinGroups();
  const [all, setAll] = useState(false);
  // Solo lo que dicen sus fichas; los parentescos probables se confirman uno a uno.
  const exactTies = list.filter((s) => s.tie && (s.type === 'texto' || s.type === 'tuya'));
  const exactGroups = list.filter((s) => s.join?.exact);
  const exact = exactTies.length + exactGroups.length;
  const shown = max && !all ? list.slice(0, max) : list;
  if (!list.length) return null;
  return (
    <div className="rl-sug-list">
      {exact > 1 && (
        <button
          type="button"
          className="rl-accept-all"
          onClick={async () => {
            if (exactTies.length) {
              const rows = await saveTies(exactTies.map((s) => s.tie!));
              if (rows.length) dismiss(...exactTies.map((s) => s.id));
            }
            if (exactGroups.length) await join(exactGroups);
          }}
        >
          <CheckCheck size={14} /> Aceptar las {exact} que dicen sus fichas
        </button>
      )}
      {shown.map((s) =>
        s.type === 'grupo' ? (
          <GroupSuggestionCard key={s.id} s={s} />
        ) : (
          <SuggestionCard key={s.id} s={s} />
        ),
      )}
      {max && list.length > max && !all && (
        <button type="button" className="pp-text-btn" onClick={() => setAll(true)}>
          Ver {list.length - max} sugerencias más
        </button>
      )}
    </div>
  );
}

/** Ventana con todo lo que Nexo encontró: sugerencias y parentescos deducidos sin confirmar. */
export function SuggestionsDialog({ onClose }: { onClose: () => void }) {
  const { saveTies } = useApp();
  const list = useSuggestions();
  const inferred = useInferred();
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="pk rl-dialog rl-sug-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Vínculos y grupos sugeridos"
      >
        <header className="pk-head">
          <span className="pk-tile">
            <Sparkles size={18} />
          </span>
          <h3>
            Vínculos y grupos sugeridos
            <small>
              Nexo los encontró en tus fichas y recuerdos. Confirma o descarta con un toque.
            </small>
          </h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="rl-sug-scroll">
          {list.length ? (
            <SuggestionList list={list} />
          ) : (
            <p className="pp-empty rl-sug-empty">
              <CheckCheck size={18} /> Todo está al día. Cuando añadas personas o escribas su rol
              («Hermana de Karla», «Mi mamá») aparecerán aquí.
            </p>
          )}
          {inferred.length > 0 && (
            <details className="rl-inferred">
              <summary>
                <span>
                  <Sparkles size={14} /> {inferred.length}{' '}
                  {inferred.length === 1 ? 'parentesco deducido' : 'parentescos deducidos'}
                  <small>Ya se ven en tu red. Confírmalos si quieres dejarlos fijos.</small>
                </span>
                <button
                  type="button"
                  className="pp-text-btn"
                  disabled={busy}
                  onClick={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    await saveTies(inferred.map((t) => ({ a: t.a, b: t.b, kind: t.kind })));
                    setBusy(false);
                  }}
                >
                  {busy ? <LoaderCircle size={13} className="spin" /> : <CheckCheck size={13} />}{' '}
                  Confirmar todos
                </button>
              </summary>
              {inferred.map((t) => (
                <InferredRow key={t.id} tie={t} />
              ))}
            </details>
          )}
        </div>
        <Learned />
      </div>
    </div>,
    document.body,
  );
}

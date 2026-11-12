import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Briefcase,
  Cake,
  Check,
  ChevronDown,
  FileText,
  FileUp,
  Info,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Search,
  Sparkles,
  TriangleAlert,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import { readPeopleWithAssistant } from '../../assistant';
import { LoadMore, useInfinite } from '../../components/LoadMore';
import { Sheet } from '../../components/Sheet';
import type { Group, Person, Relation, Tie, TieKind } from '../../data';
import type { TieInput } from '../../hooks/useWorkspace';
import { errorMessage, initials } from '../../lib/format';
import { genderOf, guessGender } from '../../lib/gender';
import { relationMeta, relations } from '../../lib/people';
import {
  ME,
  guessGroupKind,
  kindTitle,
  kindWord,
  kindsByCategory,
  relationForKind,
  tieCategories,
  tieCategoryList,
  tiesOf,
} from '../../lib/relations';
import { GroupPicker } from '../../relations/GroupPicker';
import { completeWith, inputOf, matcher, relationOfRow, type Match } from './match';
import {
  MAX_ROWS,
  chunksOf,
  cleanPhone,
  cleanSocial,
  fromAi,
  isEmail,
  isFreeText,
  kindLabels,
  mergeInto,
  nz,
  parseDate,
  parsePeople,
  phoneKey,
  type BatchPerson,
  type ParseContext,
  type ParseResult,
  type Parsed,
} from './parse';
import './batch.css';

/** Hasta cuántas partes lee la IA de una vez (cada una es una consulta del día). */
const AI_PARTS = 8;
const MAX_FILE = 15 * 1024 * 1024;
const PAGE = 40;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Source = { id: string; label: string; text: string; result: ParseResult };
/** Lo que leyó la IA de una fuente (vale mientras su texto no cambie). */
type AiRead = { text: string; rows: Parsed[] };
type Row = {
  key: string;
  on: boolean;
  person: BatchPerson;
  notes: string[];
  from: string;
  match: Match | null;
  /** Con una ficha parecida: completar esa (merge) o crear otra (new). */
  action: 'merge' | 'new';
  /** Cuántas filas de la lista se unieron en esta (la misma persona dos veces). */
  joined: number;
  open: boolean;
};
type Filter = 'todas' | 'nuevas' | 'existen' | 'avisos' | 'fuera';

const PLACEHOLDER = `Una persona por línea, con lo que sepas de ella:

Laura Gómez, mi prima, 300 123 4567, cumple 12 de marzo
Carlos Ruiz · mi jefe · diseñador en Rappi · carlos@rappi.com
Mariana Díaz (amiga del colegio) vive en Medellín, le encanta el café

También sirven secciones («Familia:», «Trabajo:») o fichas «Nombre: …».`;

/** Lee un archivo de texto en su codificación (UTF-8, UTF-16 o Windows-1252 de teléfonos viejos). */
async function readText(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`;
const dayMonth = (md: string) => (md ? `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}` : '');

/**
 * Añadir varias personas a la vez: escribes o pegas una lista, o importas un archivo (TXT, CSV de
 * Google u Outlook, vCard del teléfono). Nexo reconoce sus datos (con IA si quieres), te muestra
 * cada persona y avisa si ya la tienes. Nada se guarda hasta que lo confirmas, y se puede deshacer.
 */
export function PeopleBatch({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { workspace, me, confirm, notify } = app;
  const [step, setStep] = useState<'source' | 'review'>('source');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Source[]>([]);
  const [ai, setAi] = useState<Record<string, AiRead>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'ai' | 'save' | 'files' | null>(null);
  const [progress, setProgress] = useState('');
  const [failure, setFailure] = useState('');
  const [drag, setDrag] = useState(false);
  const [bulkRelation, setBulkRelation] = useState<Relation | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [groupPick, setGroupPick] = useState(false);
  const [filter, setFilter] = useState<Filter>('todas');
  const [query, setQuery] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  const ctx = useMemo<ParseContext>(
    () => ({
      cities: [
        ...workspace.people.map((p) => p.profile.city ?? ''),
        ...workspace.places.map((p) => p.city),
        me.profile.city ?? '',
      ].filter(Boolean),
    }),
    [workspace.people, workspace.places, me.profile.city],
  );

  const deferred = useDeferredValue(text);
  const typed = useMemo<Source | null>(
    () =>
      deferred.trim()
        ? { id: 'typed', label: 'Lo que escribiste', text: deferred, result: parsePeople(deferred, ctx) }
        : null,
    [deferred, ctx],
  );
  const sources = useMemo(() => [...(typed ? [typed] : []), ...files], [typed, files]);
  const rowsOf = (s: Source) => (ai[s.id]?.text === s.text ? ai[s.id].rows : s.result.rows);
  const found = sources.reduce((n, s) => n + rowsOf(s).length, 0);
  const aiTargets = sources.filter((s) => isFreeText(s.result.kind) && ai[s.id]?.text !== s.text);
  const aiParts = aiTargets.reduce((n, s) => n + chunksOf(s.text).length, 0);
  const aiDone = sources.some((s) => ai[s.id]?.text === s.text);

  useEffect(() => {
    const t = window.setTimeout(() => area.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // ── Archivos ──
  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    setBusy('files');
    const next: Source[] = [];
    for (const file of list) {
      if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) {
        notify(`«${file.name}»: guárdalo como CSV desde Excel (Archivo → Guardar como → CSV) y súbelo de nuevo.`);
        continue;
      }
      if (file.size > MAX_FILE) {
        notify(`«${file.name}» pesa más de 15 MB.`);
        continue;
      }
      try {
        const t = await readText(file);
        const result = parsePeople(t, ctx);
        if (!result.rows.length) notify(`En «${file.name}» no encontré personas.`);
        else next.push({ id: crypto.randomUUID(), label: file.name, text: t, result });
      } catch (e) {
        notify(`No se pudo leer «${file.name}»: ${errorMessage(e)}`);
      }
    }
    setFiles((f) => [...f, ...next]);
    setBusy(null);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (step === 'source') void addFiles(Array.from(e.dataTransfer.files));
  };

  // ── Revisar: une las filas de todas las fuentes, junta repetidas y busca las que ya tienes ──
  /** Las fuentes con lo último que escribiste (la lectura en vivo va un instante detrás). */
  const liveSources = (): Source[] =>
    text.trim() && text !== deferred
      ? [
          { id: 'typed', label: 'Lo que escribiste', text, result: parsePeople(text, ctx) },
          ...files,
        ]
      : sources;

  const buildRows = (aiNow: Record<string, AiRead>) => {
    const find = matcher(workspace.people);
    const mine = nz(me.profile.name ?? '');
    const all = liveSources().flatMap((s) =>
      (aiNow[s.id]?.text === s.text ? aiNow[s.id].rows : s.result.rows).map((r) => ({ ...r, from: s.label })),
    );
    if (all.length > MAX_ROWS)
      notify(`Se toman las primeras ${MAX_ROWS} personas; agrega las demás en otro lote.`);
    const out: Row[] = [];
    const byName = new Map<string, number>();
    for (const r of all.slice(0, MAX_ROWS)) {
      const key = nz(r.person.name);
      const at = key ? byName.get(key) : undefined;
      if (at !== undefined) {
        const row = out[at];
        out[at] = {
          ...row,
          person: mergeInto(row.person, r.person),
          notes: [...new Set([...row.notes, ...r.notes])],
          joined: row.joined + 1,
        };
        continue;
      }
      if (key) byName.set(key, out.length);
      out.push({
        key: crypto.randomUUID(),
        on: true,
        person: r.person,
        notes: r.notes,
        from: r.from,
        match: null,
        action: 'new',
        joined: 0,
        open: false,
      });
    }
    // Un mismo teléfono o correo en dos personas distintas: se avisa (puede ser de la familia).
    const phones = new Map<string, string>();
    const emails = new Map<string, string>();
    for (const row of out) {
      const p = row.person;
      const ph = phoneKey(p.phone);
      if (ph) {
        const other = phones.get(ph);
        if (other) row.notes = [...row.notes, `Mismo teléfono que ${other}.`];
        else phones.set(ph, p.name || 'otra fila');
      }
      if (p.email) {
        const other = emails.get(p.email);
        if (other) row.notes = [...row.notes, `Mismo correo que ${other}.`];
        else emails.set(p.email, p.name || 'otra fila');
      }
      row.match = p.name || p.phone || p.email ? find(p) : null;
      // Casi seguro que es la misma (mismo nombre, teléfono o correo): se completa su ficha.
      row.action = row.match && row.match.strength >= 3 ? 'merge' : 'new';
      // Sin nombre queda fuera hasta que se lo escribas (entonces entra sola).
      if (mine && nz(p.name) === mine) {
        row.on = false;
        row.notes = [...row.notes, 'Parece que eres tú (está en «Mi ficha»).'];
      }
    }
    return out;
  };

  const review = async (aiNow = ai) => {
    if (touched && rows.length) {
      const ok = await confirm({
        title: '¿Volver a leer la lista?',
        message: 'Se pierden los cambios que hiciste en la revisión.',
        confirmLabel: 'Volver a leer',
        cancelLabel: 'Seguir revisando',
        icon: 'question',
      });
      if (!ok) {
        setStep('review');
        return;
      }
    }
    setRows(buildRows(aiNow));
    setTouched(false);
    setFilter('todas');
    setQuery('');
    setFailure('');
    setStep('review');
  };

  // ── La IA lee el texto libre por partes; si una parte falla, esa se lee sin IA ──
  const readWithAi = async () => {
    const targets = liveSources().filter((s) => isFreeText(s.result.kind) && ai[s.id]?.text !== s.text);
    if (!targets.length || busy) return;
    const parts = targets.reduce((n, s) => n + chunksOf(s.text).length, 0);
    if (parts > AI_PARTS) {
      notify(`La lista es muy larga para la IA (${parts} partes; hasta ${AI_PARTS}). Divídela o usa la lectura de Nexo.`);
      return;
    }
    setBusy('ai');
    const next = { ...ai };
    let done = 0;
    let failed = '';
    let dropped = 0;
    for (const s of targets) {
      const read: Parsed[] = [];
      for (const part of chunksOf(s.text)) {
        done++;
        setProgress(parts > 1 ? `Leyendo con IA · ${done} de ${parts}` : 'Leyendo con IA…');
        if (failed) {
          read.push(...parsePeople(part, ctx).rows);
          continue;
        }
        try {
          const r = fromAi(await readPeopleWithAssistant(part), part);
          dropped += r.dropped;
          read.push(...(r.rows.length ? r.rows : parsePeople(part, ctx).rows));
        } catch (e) {
          failed = errorMessage(e);
          read.push(...parsePeople(part, ctx).rows);
        }
      }
      next[s.id] = { text: s.text, rows: read };
    }
    setAi(next);
    setBusy(null);
    setProgress('');
    if (failed) notify(`${failed} Lo que faltaba se leyó sin IA.`);
    else if (dropped)
      notify(`La IA propuso ${plural(dropped, 'persona', 'personas')} que no están en tu texto: se descartaron.`);
    await review(next);
  };

  // ── Edición en la revisión ──
  const patchRow = (key: string, patch: Partial<Row>) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const patchPerson = (key: string, patch: Partial<BatchPerson>) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, person: { ...r.person, ...patch } } : r)));
  };
  const rematch = (key: string) => {
    const find = matcher(workspace.people);
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const match = r.person.name || r.person.phone || r.person.email ? find(r.person) : null;
        const same = match?.person.id === r.match?.person.id;
        return {
          ...r,
          match,
          action: same ? r.action : match && match.strength >= 3 ? 'merge' : 'new',
        };
      }),
    );
  };

  const counts = useMemo(() => {
    const on = rows.filter((r) => r.on && r.person.name.trim());
    return {
      all: rows.length,
      nuevas: rows.filter((r) => !(r.match && r.action === 'merge')).length,
      existen: rows.filter((r) => r.match).length,
      avisos: rows.filter((r) => r.notes.length || !r.person.name.trim()).length,
      fuera: rows.filter((r) => !r.on || !r.person.name.trim()).length,
      creating: on.filter((r) => !(r.match && r.action === 'merge')).length,
      completing: on.filter((r) => r.match && r.action === 'merge').length,
    };
  }, [rows]);
  const needle = nz(query);
  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === 'nuevas' && r.match && r.action === 'merge') return false;
        if (filter === 'existen' && !r.match) return false;
        if (filter === 'avisos' && !r.notes.length && r.person.name.trim()) return false;
        if (filter === 'fuera' && r.on && r.person.name.trim()) return false;
        if (!needle) return true;
        const p = r.person;
        return nz([p.name, p.alias, p.phone, p.email, p.city, p.company, p.occupation].join(' ')).includes(needle);
      }),
    [rows, filter, needle],
  );
  const { visible, rest, loadMore } = useInfinite(shown, PAGE, filter + '|' + needle);
  const allOn = shown.length > 0 && shown.every((r) => r.on || !r.person.name.trim());
  const toggleAll = () => {
    const keys = new Set(shown.filter((r) => r.person.name.trim()).map((r) => r.key));
    setTouched(true);
    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, on: !allOn } : r)));
  };

  // ── Guardar ──
  const save = async () => {
    const chosen = rows.filter((r) => r.on && r.person.name.trim());
    if (!chosen.length || busy) return;
    setBusy('save');
    setFailure('');
    const creating = chosen.filter((r) => !(r.match && r.action === 'merge'));
    const completing = chosen.filter((r) => r.match && r.action === 'merge');

    // 1. Las nuevas, de una vez (en tandas).
    const res = creating.length
      ? await app.savePeople(creating.map((r) => inputOf(r.person, bulkRelation)))
      : { people: [] as Person[], error: null };
    const handled = new Set<string>();
    const ids = new Map<string, { id: string; row: Row }>();
    creating.slice(0, res.people.length).forEach((r, i) => {
      handled.add(r.key);
      ids.set(r.key, { id: res.people[i].id, row: r });
    });

    // 2. Las que ya tenías: se completa lo vacío, sin pisar nada.
    const before: Person[] = [];
    const after: Person[] = [];
    let unchanged = 0;
    // Dos filas pueden completar a la misma persona: cada una parte de lo que dejó la anterior.
    const latest = new Map<string, Person>();
    if (!res.error)
      for (const r of completing) {
        const id = r.match!.person.id;
        const current =
          latest.get(id) ?? workspace.people.find((p) => p.id === id) ?? r.match!.person;
        handled.add(r.key);
        ids.set(r.key, { id, row: r });
        const done = completeWith(current, r.person, bulkRelation);
        if (!done) {
          unchanged++;
          continue;
        }
        const next = { ...current, ...done.changes };
        if (await app.patchPerson(current, done.changes, true)) {
          // Para deshacer: cómo estaba antes del lote (la primera vez) y cómo quedó al final.
          const at = before.findIndex((p) => p.id === id);
          if (at < 0) {
            before.push(current);
            after.push(next);
          } else after[at] = next;
          latest.set(id, next);
        }
      }

    // 3. Lo que es para ti («mi mamá»), si aún no tiene un vínculo contigo.
    const ties: TieInput[] = [];
    for (const { id, row } of ids.values()) {
      const kin = row.person.kin;
      if (kin && !tiesOf(id, workspace.ties).some((v) => v.other === ME)) ties.push({ a: id, b: ME, kind: kin });
    }
    const madeTies: Tie[] = ties.length ? await app.saveTies(ties, true) : [];

    // 4. Grupos: los que elegiste y los nuevos, con todas dentro.
    const everyone = [...new Set([...ids.values()].map((x) => x.id))];
    const groupsBefore: Group[] = [];
    const groupsAfter: Group[] = [];
    const madeGroups: Group[] = [];
    if (everyone.length) {
      for (const gid of groupIds) {
        const g = workspace.groups.find((x) => x.id === gid);
        if (!g) continue;
        const add = everyone.filter((id) => !g.member_ids.includes(id));
        if (!add.length) continue;
        const member_ids = [...g.member_ids, ...add];
        if (await app.updateGroup(g, { member_ids }, true)) {
          groupsBefore.push(g);
          groupsAfter.push({ ...g, member_ids });
        }
      }
      for (const name of newGroups) {
        const g = await app.saveGroup(
          { name, kind: guessGroupKind(name), description: '', member_ids: everyone },
          true,
        );
        if (g) madeGroups.push(g);
      }
    }
    setBusy(null);

    const made = res.people;
    const summary = [
      made.length && plural(made.length, 'persona nueva', 'personas nuevas'),
      after.length && plural(after.length, 'ficha completada', 'fichas completadas'),
      unchanged && plural(unchanged, 'ya estaba al día', 'ya estaban al día'),
    ]
      .filter(Boolean)
      .join(' · ');

    const completedIds = new Set(before.map((p) => p.id));
    const undo = async () => {
      // Los grupos que ya existían vuelven a como estaban.
      for (let i = 0; i < groupsBefore.length; i++)
        await app.updateGroup(groupsAfter[i], { member_ids: groupsBefore[i].member_ids }, true);
      // Los vínculos de las fichas completadas (los de las nuevas se van con ellas).
      const loose = madeTies.filter((t) => (t.a && completedIds.has(t.a)) || completedIds.has(t.b));
      if (loose.length) await app.removeTies(loose, true);
      const ok = await app.discardPeople(
        made.map((p) => p.id),
        madeGroups.map((g) => g.id),
      );
      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        await app.patchPerson(
          after[i],
          { role: b.role, interests: b.interests, bio: b.bio, profile: b.profile },
          true,
        );
      }
      if (ok) app.notify('Lote deshecho.');
    };
    if (made.length || after.length)
      notify(summary + '.', { label: 'Deshacer', icon: 'undo', run: () => void undo() });
    else if (unchanged) notify('Esas fichas ya tenían todo lo de la lista.');

    if (res.error) {
      // Lo que no alcanzó a guardarse sigue aquí para intentarlo otra vez.
      setRows((rs) => rs.filter((r) => !handled.has(r.key)));
      setFailure(
        (made.length ? `Se guardaron ${plural(made.length, 'persona', 'personas')}; ` : '') +
          `no se pudieron guardar las demás: ${res.error}`,
      );
      return;
    }
    onClose();
  };

  const requestClose = async () => {
    if (busy === 'save') return;
    if (text.trim() || files.length || rows.length) {
      const ok = await confirm({
        title: '¿Descartar esta lista?',
        message: 'Aún no se ha guardado ninguna persona.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir',
        danger: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };

  const groupNames = [
    ...groupIds.flatMap((id) => workspace.groups.find((g) => g.id === id)?.name ?? []),
    ...newGroups,
  ];
  const ready = counts.creating + counts.completing;

  return (
    <Sheet
      label="Añadir varias personas"
      size="lg"
      className="pb-sheet"
      onRequestClose={() => void requestClose()}
    >
      <div
        className={'pb' + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          if (step !== 'source' || !Array.from(e.dataTransfer.items).some((x) => x.kind === 'file')) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
        }}
        onDrop={onDrop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (step === 'source' && found && !busy) void review();
            else if (step === 'review') void save();
          }
        }}
      >
        <header className="pb-head">
          {step === 'review' && (
            <button
              type="button"
              className="pb-icon"
              aria-label="Volver a la lista"
              title="Volver a la lista"
              disabled={Boolean(busy)}
              onClick={() => setStep('source')}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="pb-title">
            <UsersRound size={18} />
            <span>
              <h2>{step === 'source' ? 'Añadir varias personas' : 'Revisa antes de guardar'}</h2>
              <small>
                {step === 'source'
                  ? 'Escribe o pega una lista, o importa tus contactos.'
                  : 'Corrige lo que haga falta. Nada se guarda hasta que confirmes.'}
              </small>
            </span>
          </span>
          <button type="button" className="pb-icon" aria-label="Cerrar" onClick={() => void requestClose()}>
            <X size={18} />
          </button>
        </header>

        {step === 'source' ? (
          <div className="pb-body">
            <div className="pb-write">
              <textarea
                ref={area}
                value={text}
                maxLength={60000}
                placeholder={PLACEHOLDER}
                aria-label="Lista de personas"
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="pb-write-foot">
                <label className="pb-file">
                  <input
                    type="file"
                    multiple
                    accept=".txt,.csv,.tsv,.vcf,.vcard,.xlsx,.xls,text/plain,text/csv,text/vcard,text/x-vcard"
                    className="cp-sr"
                    onChange={(e) => {
                      void addFiles(Array.from(e.target.files ?? []));
                      e.target.value = '';
                    }}
                  />
                  {busy === 'files' ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />}
                  Importar archivo
                </label>
                <span>TXT, CSV de Google, Outlook o Excel, y vCard (.vcf) del teléfono. También puedes soltarlos aquí.</span>
              </div>
            </div>

            {files.length > 0 && (
              <ul className="pb-files">
                {files.map((f) => (
                  <li key={f.id}>
                    <FileText size={15} />
                    <span>
                      <b>{f.label}</b>
                      <small>
                        {plural(rowsOf(f).length, 'persona', 'personas')}
                        {f.result.kind && ` · ${kindLabels[f.result.kind]}`}
                        {ai[f.id]?.text === f.text && ' · leído con IA'}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Quitar ${f.label}`}
                      onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className={'pb-detect' + (found ? ' on' : '')} aria-live="polite">
              {found ? (
                <>
                  <UserCheck size={16} />
                  <span>
                    <b>{plural(found, 'persona', 'personas')}</b>
                    {typed?.result.kind && ` · ${kindLabels[typed.result.kind].toLowerCase()}`}
                    {aiDone && ' · leído con IA'}
                  </span>
                </>
              ) : (
                <>
                  <Info size={16} />
                  <span>
                    Nexo reconoce teléfonos, correos, cumpleaños, parentescos («mi prima»), ciudad,
                    trabajo, gustos y redes. Lo que no encaje queda en sus notas.
                  </span>
                </>
              )}
            </div>
            {aiTargets.length > 0 && (
              <p className="pb-ai-hint">
                <Sparkles size={14} />
                {aiParts > AI_PARTS
                  ? `Para leerla con IA, divide la lista (hasta ${AI_PARTS} partes de unos 3.000 caracteres).`
                  : `Si tu lista está escrita a tu manera, la IA la entiende mejor. Usa ${plural(aiParts, 'consulta', 'consultas')} de IA de hoy.`}
              </p>
            )}
          </div>
        ) : (
          <div className="pb-body review">
            <div className="pb-bulk">
              <div className="pb-bulk-row">
                <span className="pb-bulk-label">Relación de las que no la dicen</span>
                <div className="pb-chips" role="radiogroup" aria-label="Relación para todas">
                  {relations.map((r) => (
                    <button
                      type="button"
                      key={r}
                      role="radio"
                      aria-checked={bulkRelation === r}
                      className={bulkRelation === r ? 'on' : ''}
                      style={{ '--c': relationMeta[r].color, '--s': relationMeta[r].soft } as CSSProperties}
                      onClick={() => setBulkRelation((v) => (v === r ? null : r))}
                    >
                      {relationMeta[r].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pb-bulk-row">
                <span className="pb-bulk-label">Grupo</span>
                <button type="button" className="pb-group-btn" onClick={() => setGroupPick(true)}>
                  <UsersRound size={14} />
                  {groupNames.length ? groupNames.join(', ') : 'Añadir todas a un grupo'}
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            <div className="pb-tools">
              <nav className="pb-tabs" aria-label="Filtrar">
                {(
                  [
                    ['todas', 'Todas', counts.all],
                    ['nuevas', 'Nuevas', counts.nuevas],
                    ['existen', 'Ya las tienes', counts.existen],
                    ['avisos', 'Con avisos', counts.avisos],
                    ['fuera', 'Fuera', counts.fuera],
                  ] as [Filter, string, number][]
                )
                  .filter(([k, , n]) => k === 'todas' || n > 0)
                  .map(([k, label, n]) => (
                    <button
                      type="button"
                      key={k}
                      className={filter === k ? 'on' : ''}
                      aria-pressed={filter === k}
                      onClick={() => setFilter(k)}
                    >
                      {label} <i>{n}</i>
                    </button>
                  ))}
              </nav>
              {rows.length > 8 && (
                <label className="pb-find">
                  <Search size={14} />
                  <input
                    value={query}
                    placeholder="Buscar en la lista…"
                    aria-label="Buscar en la lista"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              <label className="pb-all">
                <input type="checkbox" checked={allOn} onChange={toggleAll} />
                {allOn ? 'Quitar todas' : 'Marcar todas'}
              </label>
            </div>

            {failure && (
              <p className="pb-failure" role="alert">
                <TriangleAlert size={15} /> {failure}
              </p>
            )}

            <ul className="pb-rows">
              {visible.map((r) => (
                <BatchRow
                  key={r.key}
                  row={r}
                  bulkRelation={bulkRelation}
                  onRow={(patch) => patchRow(r.key, patch)}
                  onPerson={(patch) => patchPerson(r.key, patch)}
                  onRematch={() => rematch(r.key)}
                />
              ))}
              {!shown.length && <li className="pb-empty">Nada en esta vista.</li>}
            </ul>
            <LoadMore rest={rest} onMore={loadMore} shown={visible.length} />
          </div>
        )}

        <footer className="pb-foot">
          {step === 'source' ? (
            <>
              {aiTargets.length > 0 && (
                <button
                  type="button"
                  className="pb-ai"
                  disabled={Boolean(busy) || aiParts > AI_PARTS}
                  onClick={() => void readWithAi()}
                >
                  {busy === 'ai' ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                  {busy === 'ai' ? progress || 'Leyendo con IA…' : 'Leer con IA'}
                </button>
              )}
              <span className="pb-grow" />
              <button
                type="button"
                className="pb-go"
                disabled={!found || Boolean(busy)}
                onClick={() => void review()}
              >
                Revisar {found > 0 && <span>{found.toLocaleString('es-CO')}</span>}
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <span className="pb-sum">
                {counts.creating > 0 && <b>{plural(counts.creating, 'nueva', 'nuevas')}</b>}
                {counts.creating > 0 && counts.completing > 0 && ' · '}
                {counts.completing > 0 && <b>{plural(counts.completing, 'se completa', 'se completan')}</b>}
                {!ready && 'Marca al menos una persona.'}
              </span>
              <span className="pb-grow" />
              <button type="button" className="pb-go" disabled={!ready || Boolean(busy)} onClick={() => void save()}>
                {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                {busy === 'save'
                  ? 'Guardando…'
                  : counts.creating && counts.completing
                    ? `Guardar ${ready.toLocaleString('es-CO')}`
                    : counts.completing
                      ? `Completar ${counts.completing.toLocaleString('es-CO')}`
                      : `Añadir ${counts.creating.toLocaleString('es-CO')}`}
              </button>
            </>
          )}
        </footer>

        {drag && (
          <div className="pb-drop" aria-hidden="true">
            <FileUp size={26} />
            <strong>Suelta tus contactos</strong>
            <small>TXT, CSV o vCard</small>
          </div>
        )}
      </div>

      {groupPick && (
        <GroupPicker
          title="Añadir todas a un grupo"
          hint="Las nuevas y las que se completan quedan dentro."
          selected={groupIds}
          onToggle={(id) => setGroupIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          pending={newGroups}
          onCreate={(name) => {
            const n = name.trim().slice(0, 80);
            if (n && !newGroups.some((x) => nz(x) === nz(n))) setNewGroups((l) => [...l, n]);
          }}
          onRemovePending={(name) => setNewGroups((l) => l.filter((x) => x !== name))}
          onClose={() => setGroupPick(false)}
        />
      )}
    </Sheet>
  );
}

/** Una persona de la lista: lo que se reconoció, si ya la tienes y, al abrirla, todos sus datos. */
function BatchRow({
  row: r,
  bulkRelation,
  onRow,
  onPerson,
  onRematch,
}: {
  row: Row;
  bulkRelation: Relation | null;
  onRow: (patch: Partial<Row>) => void;
  onPerson: (patch: Partial<BatchPerson>) => void;
  onRematch: () => void;
}) {
  const p = r.person;
  const named = Boolean(p.name.trim());
  const relation = relationOfRow(p, bulkRelation);
  const meta = relation ? relationMeta[relation] : null;
  const sex = p.gender ?? guessGender(p.name, p.role);
  const merging = Boolean(r.match && r.action === 'merge');
  const extra =
    p.likes.length +
    p.dislikes.length +
    p.gifts.length +
    p.interests.length +
    p.keywords.length +
    p.facts.length +
    (p.bio ? 1 : 0) +
    (p.metHow ? 1 : 0) +
    (p.family ? 1 : 0) +
    (p.alias ? 1 : 0);

  const chips: { icon: ReactNode; text: string; title: string }[] = [];
  if (p.phone) chips.push({ icon: <Phone size={12} />, text: p.phone, title: 'Teléfono' });
  if (p.email) chips.push({ icon: <Mail size={12} />, text: p.email, title: 'Correo' });
  if (p.birthday)
    chips.push({
      icon: <Cake size={12} />,
      text: dayMonth(p.birthday) + (p.birthYear ? ` ${p.birthYear}` : ''),
      title: 'Cumpleaños',
    });
  if (p.city) chips.push({ icon: <MapPin size={12} />, text: p.city, title: 'Ciudad' });
  if (p.occupation || p.company)
    chips.push({
      icon: <Briefcase size={12} />,
      text: [p.occupation, p.company].filter(Boolean).join(' · '),
      title: 'Trabajo',
    });
  if (p.social) chips.push({ icon: <AtSign size={12} />, text: p.social.replace(/^@/, ''), title: 'Red social' });

  return (
    <li
      className={
        'pb-row' +
        (r.on && named ? '' : ' off') +
        (r.open ? ' open' : '') +
        (merging ? ' merging' : '')
      }
      style={meta ? ({ '--c': meta.color, '--s': meta.soft } as CSSProperties) : undefined}
    >
      <div className="pb-row-head">
        <label className="pb-check" title={named ? (r.on ? 'No guardar' : 'Guardar') : 'Falta el nombre'}>
          <input
            type="checkbox"
            checked={r.on && named}
            disabled={!named}
            aria-label={`Guardar a ${p.name || 'esta persona'}`}
            onChange={(e) => onRow({ on: e.target.checked })}
          />
        </label>
        <span className="pb-face" aria-hidden="true">
          {named ? initials(p.name).toUpperCase() : '?'}
        </span>
        <div className="pb-row-main">
          <div className="pb-name-line">
            <input
              className={'pb-name' + (named ? '' : ' empty')}
              value={p.name}
              maxLength={120}
              placeholder="Nombre (obligatorio)"
              aria-label="Nombre"
              onChange={(e) => onPerson({ name: e.target.value })}
              onBlur={onRematch}
            />
            {(p.kin || relation) && (
              <span className="pb-rel">
                {p.kin ? `Tu ${kindWord(p.kin, sex)}` : meta?.label}
                {!p.relation && !p.kin && bulkRelation && ' · para todas'}
              </span>
            )}
            {p.favorite && <span className="pb-fav" title="Favorita">★</span>}
          </div>
          {(chips.length > 0 || extra > 0) && (
            <div className="pb-facts">
              {chips.map((c) => (
                <span key={c.title} title={c.title}>
                  {c.icon} {c.text}
                </span>
              ))}
              {extra > 0 && (
                <button type="button" className="pb-more-chip" onClick={() => onRow({ open: true })}>
                  +{extra} más
                </button>
              )}
            </div>
          )}
          {r.match && (
            <div className="pb-match">
              <UserCheck size={14} />
              <span>
                Ya tienes a <b>{r.match.person.name}</b> ({r.match.reasons.join(', ')}).
              </span>
              <span className="pb-seg" role="radiogroup" aria-label="Qué hacer">
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.action === 'merge'}
                  className={r.action === 'merge' ? 'on' : ''}
                  onClick={() => onRow({ action: 'merge' })}
                  title="Solo se llena lo que le falta; no se cambia nada de lo que ya tiene"
                >
                  Completar su ficha
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.action === 'new'}
                  className={r.action === 'new' ? 'on' : ''}
                  onClick={() => onRow({ action: 'new' })}
                >
                  Es otra persona
                </button>
              </span>
            </div>
          )}
          {(r.notes.length > 0 || r.joined > 0) && (
            <ul className="pb-notes">
              {r.joined > 0 && (
                <li className="info">
                  Aparecía {r.joined + 1} veces en la lista: se juntó en una.
                </li>
              )}
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="pb-expand"
          aria-expanded={r.open}
          aria-label={r.open ? 'Cerrar detalles' : 'Ver y editar todos sus datos'}
          title={r.open ? 'Cerrar' : 'Editar sus datos'}
          onClick={() => onRow({ open: !r.open })}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      {r.open && <RowEditor person={p} onPerson={onPerson} from={r.from} />}
    </li>
  );
}

const KIN_GROUPS = tieCategoryList.map((c) => ({ c, kinds: kindsByCategory(c) }));

/** Todos los datos de una persona de la lista, para corregirlos antes de guardar. */
function RowEditor({
  person: p,
  onPerson,
  from,
}: {
  person: BatchPerson;
  onPerson: (patch: Partial<BatchPerson>) => void;
  from: string;
}) {
  const sex = p.gender ?? genderOf({ name: p.name, role: p.role, profile: {} });
  return (
    <div className="pb-edit">
      <div className="pb-grid">
        <Field label="Apodo">
          <input value={p.alias} maxLength={60} onChange={(e) => onPerson({ alias: e.target.value })} />
        </Field>
        <Field label="Sexo">
          <select
            value={p.gender ?? ''}
            onChange={(e) => onPerson({ gender: (e.target.value || null) as BatchPerson['gender'] })}
          >
            <option value="">
              {guessGender(p.name, p.role) === 'f' ? 'Mujer (por el nombre)' : guessGender(p.name, p.role) === 'm' ? 'Hombre (por el nombre)' : 'Sin indicar'}
            </option>
            <option value="f">Mujer</option>
            <option value="m">Hombre</option>
          </select>
        </Field>
        <Field label="Relación">
          <select
            value={p.relation ?? ''}
            onChange={(e) => {
              const relation = (e.target.value || null) as Relation | null;
              // Si el vínculo contigo ya no encaja con la relación, se quita.
              const kin = p.kin && relation && relationForKind(p.kin) !== relation ? null : p.kin;
              onPerson({ relation, kin });
            }}
          >
            <option value="">Sin indicar</option>
            {relations.map((r) => (
              <option key={r} value={r}>
                {relationMeta[r].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Qué es para ti">
          <select
            value={p.kin ?? ''}
            onChange={(e) => {
              const kin = (e.target.value || null) as TieKind | null;
              onPerson({ kin, ...(kin && { relation: relationForKind(kin) }) });
            }}
          >
            <option value="">Sin vínculo</option>
            {KIN_GROUPS.map(({ c, kinds }) => (
              <optgroup key={c} label={tieCategories[c].label}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindTitle(k, sex)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Contexto o rol" wide>
          <input
            value={p.role}
            maxLength={120}
            placeholder="Amiga del colegio, cliente, mamá de Ana…"
            onChange={(e) => onPerson({ role: e.target.value })}
          />
        </Field>
        <Field label="Teléfono" bad={Boolean(p.phone && !cleanPhone(p.phone))}>
          <input
            inputMode="tel"
            value={p.phone}
            maxLength={30}
            onChange={(e) => onPerson({ phone: e.target.value })}
            onBlur={() => onPerson({ phone: cleanPhone(p.phone) || p.phone.trim() })}
          />
        </Field>
        <Field label="Correo" bad={Boolean(p.email && !isEmail(p.email))}>
          <input
            type="email"
            value={p.email}
            maxLength={120}
            onChange={(e) => onPerson({ email: e.target.value.trim().toLowerCase() })}
          />
        </Field>
        <Field label="Red social">
          <input
            value={p.social}
            maxLength={80}
            placeholder="@usuario"
            onChange={(e) => onPerson({ social: e.target.value })}
            onBlur={() => onPerson({ social: cleanSocial(p.social) })}
          />
        </Field>
        <Field label="Ciudad">
          <input value={p.city} maxLength={80} onChange={(e) => onPerson({ city: e.target.value })} />
        </Field>
        <Field label="Ocupación">
          <input value={p.occupation} maxLength={80} onChange={(e) => onPerson({ occupation: e.target.value })} />
        </Field>
        <Field label="Empresa o lugar">
          <input value={p.company} maxLength={80} onChange={(e) => onPerson({ company: e.target.value })} />
        </Field>
        <BirthdayField person={p} onPerson={onPerson} />
        <Field label="Cómo se conocieron" wide>
          <input value={p.metHow} maxLength={200} onChange={(e) => onPerson({ metHow: e.target.value })} />
        </Field>
        <Field label="Su gente" wide>
          <input
            value={p.family}
            maxLength={200}
            placeholder="Pareja, hijos, mascotas…"
            onChange={(e) => onPerson({ family: e.target.value })}
          />
        </Field>
        <ListField label="Intereses" value={p.interests} onChange={(interests) => onPerson({ interests })} />
        <ListField label="Le encanta" value={p.likes} onChange={(likes) => onPerson({ likes })} />
        <ListField label="No le gusta" value={p.dislikes} onChange={(dislikes) => onPerson({ dislikes })} />
        <ListField label="Ideas de regalo" value={p.gifts} onChange={(gifts) => onPerson({ gifts })} />
        <ListField
          label="Palabras clave"
          value={p.keywords}
          onChange={(keywords) => onPerson({ keywords })}
          wide
        />
        {p.facts.length > 0 && (
          <div className="pb-field wide">
            <span>Datos libres</span>
            <div className="pb-fact-list">
              {p.facts.map((f, i) => (
                <span key={f.label + f.value + i}>
                  <b>{f.label}:</b> {f.value}
                  <button
                    type="button"
                    aria-label={`Quitar ${f.label}`}
                    onClick={() => onPerson({ facts: p.facts.filter((_, j) => j !== i) })}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <Field label="Notas" wide>
          <textarea
            value={p.bio}
            rows={p.bio.length > 120 ? 4 : 2}
            maxLength={4000}
            onChange={(e) => onPerson({ bio: e.target.value })}
          />
        </Field>
      </div>
      <p className="pb-from">
        De: {from}
        <label>
          <input type="checkbox" checked={p.favorite} onChange={(e) => onPerson({ favorite: e.target.checked })} />
          Favorita
        </label>
      </p>
    </div>
  );
}

function Field({
  label,
  wide = false,
  bad = false,
  children,
}: {
  label: string;
  wide?: boolean;
  bad?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={'pb-field' + (wide ? ' wide' : '') + (bad ? ' bad' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Una lista separada por comas: se escribe libre y se guarda al salir del campo. */
function ListField({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  wide?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={label} wide={wide}>
      <input
        value={draft ?? value.join(', ')}
        placeholder="Separadas por comas"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const seen = new Set<string>();
          onChange(
            draft
              .split(',')
              .map((x) => x.trim().slice(0, 80))
              .filter((x) => x && !seen.has(nz(x)) && seen.add(nz(x)))
              .slice(0, 20),
          );
          setDraft(null);
        }}
      />
    </Field>
  );
}

/** El cumpleaños: se escribe «12/03», «12 de marzo»…; si no se entiende, no se cambia. */
function BirthdayField({
  person: p,
  onPerson,
}: {
  person: BatchPerson;
  onPerson: (patch: Partial<BatchPerson>) => void;
}) {
  const shown = p.birthday ? `${p.birthday.slice(3)}/${p.birthday.slice(0, 2)}` : '';
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && draft.trim() !== '' && !parseDate(draft);
  return (
    <>
      <Field label="Cumpleaños (día/mes)" bad={bad}>
        <input
          value={draft ?? shown}
          placeholder="12/03"
          maxLength={30}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null) return;
            if (!draft.trim()) onPerson({ birthday: '', birthYear: null });
            else {
              const d = parseDate(draft);
              if (d) onPerson({ birthday: d.md, ...(d.year && { birthYear: d.year }) });
            }
            setDraft(null);
          }}
        />
      </Field>
      <Field label="Año">
        <input
          inputMode="numeric"
          value={p.birthYear ?? ''}
          placeholder="1990"
          maxLength={4}
          disabled={!p.birthday}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
            const y = Number(v);
            onPerson({ birthYear: v.length === 4 && y >= 1900 && y <= new Date().getFullYear() ? y : null });
          }}
        />
      </Field>
    </>
  );
}

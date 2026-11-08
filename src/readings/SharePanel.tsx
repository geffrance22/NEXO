import { useMemo, useState } from 'react';
import { Check, Copy, ListChecks, LoaderCircle, MessageCircle, Search, Share2 } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import { normalizeText, todayInputValue } from '../lib/format';
import { genderOf } from '../lib/gender';
import { shareText, whatsappLink, type Interested } from '../lib/interest';
import { searchText } from '../lib/people';
import { Avatar } from '../people/Avatar';

/**
 * «¿A quién le sirve esto?»: las personas a las que el fragmento parece interesarles (con el
 * motivo) y, para cualquiera, compartírselo o dejarte el pendiente «Enviarle esto». El fragmento
 * queda resaltado con una nota de para quién era.
 */
export function SharePanel({
  quote,
  title,
  url,
  matches,
  onKeepMark,
}: {
  quote: string;
  title: string;
  url: string;
  matches: Interested[];
  /** Guarda el fragmento como resaltado con una nota («→ Para Laura»). */
  onKeepMark: (note: string) => Promise<void>;
}) {
  const { workspace, createEntry, notify, peekPerson } = useApp();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'tarea' | 'enviado'>>({});

  const needle = normalizeText(query.trim());
  const found = useMemo(
    () =>
      needle ? workspace.people.filter((p) => searchText(p).includes(needle)).slice(0, 6) : [],
    [needle, workspace.people],
  );
  const rows: { person: Person; reason?: string }[] = needle
    ? found.map((p) => ({ person: p, reason: matches.find((m) => m.person.id === p.id)?.reason }))
    : matches.map((m) => ({ person: m.person, reason: m.reason }));

  const first = (p: Person) => p.name.split(' ')[0];
  const canShare = typeof navigator.share === 'function';
  const message = (p: Person) =>
    shareText(quote, title, url, `${first(p)}, esto me hizo pensar en ti:`);

  const task = async (p: Person, reason?: string) => {
    setBusy(p.id);
    const g = genderOf(p);
    const saved = await createEntry(
      {
        title: `Enviarle a ${first(p)} «${title}»`.slice(0, 180),
        body: [shareText(quote, title, url), reason && `Por qué: ${reason}`]
          .filter(Boolean)
          .join('\n\n'),
        kind: 'Pendiente',
        tags: ['lectura'],
        personIds: [p.id],
        date: todayInputValue(),
        amount: 0,
        direction: 'egreso',
        status: 'pendiente',
        images: [],
        details: { priority: 'media' },
        file: null,
        removeFile: false,
      },
      true,
    );
    if (saved) {
      await onKeepMark(`→ Para ${first(p)}${reason ? `: ${reason}` : ''}`);
      setDone((d) => ({ ...d, [p.id]: 'tarea' }));
      notify(
        `Pendiente creado: enviarle esto a ${g === 'f' ? 'ella' : g === 'm' ? 'él' : first(p)}.`,
      );
    }
    setBusy(null);
  };

  const send = async (p: Person, reason?: string) => {
    const text = message(p);
    const wa = whatsappLink(p.profile.phone, text);
    if (wa) window.open(wa, '_blank', 'noopener');
    else if (canShare) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        return; // cancelado
      }
    } else {
      await navigator.clipboard?.writeText(text);
      notify(`Mensaje copiado: pégaselo a ${first(p)}.`);
    }
    await onKeepMark(`→ Compartido con ${first(p)}${reason ? `: ${reason}` : ''}`);
    setDone((d) => ({ ...d, [p.id]: 'enviado' }));
  };

  return (
    <div className="rd-mt-panel rd-mt-share">
      <div className="rd-mt-share-head">
        <strong>¿A quién le sirve?</strong>
        <small>
          {matches.length
            ? 'Por sus novedades, intereses y lo que sabes de su vida.'
            : 'No encontré a nadie claro. Busca a quién mandárselo.'}
        </small>
      </div>

      <label className="rd-mt-share-search">
        <Search size={13} aria-hidden="true" />
        <input
          value={query}
          placeholder="Buscar a otra persona…"
          aria-label="Buscar persona"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {rows.length > 0 ? (
        <ul className="rd-mt-people">
          {rows.map(({ person: p, reason }) => {
            const state = done[p.id];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="rd-mt-who"
                  title={`Ver la ficha de ${p.name}`}
                  onClick={() => peekPerson(p)}
                >
                  <Avatar person={p} size={28} />
                  <span>
                    <b>{p.name.split(' ').slice(0, 2).join(' ')}</b>
                    {reason && <small>{reason}</small>}
                  </span>
                </button>
                {state ? (
                  <span className="rd-mt-done">
                    <Check size={13} /> {state === 'tarea' ? 'Pendiente creado' : 'Enviado'}
                  </span>
                ) : busy === p.id ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <span className="rd-mt-acts">
                    <button
                      type="button"
                      title={
                        p.profile.phone ? 'Enviar por WhatsApp' : 'Compartir (o copiar el mensaje)'
                      }
                      aria-label={`Compartir con ${p.name}`}
                      onClick={() => void send(p, reason)}
                    >
                      {p.profile.phone ? (
                        <MessageCircle size={14} />
                      ) : canShare ? (
                        <Share2 size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      title="Crear el pendiente «Enviarle esto»"
                      onClick={() => void task(p, reason)}
                    >
                      <ListChecks size={13} /> Enviarle esto
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        needle && <p className="rd-mt-empty">Nadie coincide con «{query}».</p>
      )}
    </div>
  );
}

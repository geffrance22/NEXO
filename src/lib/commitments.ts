import { Hourglass, HandHeart, Target, Users, type LucideIcon } from 'lucide-react';
import type { CommitmentKind, Entry, Person } from '../data';
import { daysBetween } from './people';
import { todayInputValue } from './format';

/** Cuatro tipos de compromiso: no se sigue igual lo que prometiste que lo que esperas. */
export const commitmentKinds: Record<
  CommitmentKind,
  { label: string; short: string; who: string; icon: LucideIcon; color: string; soft: string }
> = {
  quiero: {
    label: 'Quiero hacerlo',
    short: 'Quiero',
    who: 'Con quién o para quién',
    icon: Target,
    color: '#5f8247',
    soft: '#eaf1e0',
  },
  prometi: {
    label: 'Lo prometí',
    short: 'Prometí',
    who: '¿A quién se lo prometiste?',
    icon: HandHeart,
    color: '#c0674a',
    soft: '#f9e9e2',
  },
  espero: {
    label: 'Estoy esperando',
    short: 'Espero',
    who: '¿De quién lo esperas?',
    icon: Hourglass,
    color: '#c48a2a',
    soft: '#fbf1dc',
  },
  depende: {
    label: 'Depende de otra persona',
    short: 'Depende',
    who: '¿De quién depende?',
    icon: Users,
    color: '#4d7b9d',
    soft: '#e3eef6',
  },
};
export const commitmentKindList = Object.keys(commitmentKinds) as CommitmentKind[];

export const commitmentOf = (e: Entry): CommitmentKind => e.details.commitment ?? 'quiero';
export const isOpenTask = (e: Entry) => e.kind === 'Pendiente' && e.status !== 'completado';

/** La persona clave del compromiso: a quién se lo prometiste o de quién depende. */
export function counterpartOf(e: Entry, people: Person[]): Person | null {
  const k = commitmentOf(e);
  const id =
    (k === 'prometi' ? e.details.beneficiary : k === 'quiero' ? undefined : e.details.owner) ??
    e.person_ids[0];
  return (id && people.find((p) => p.id === id)) || null;
}

/** Días desde que se hizo el compromiso (sirve para «llevas 6 días esperando»). */
export function ageInDays(e: Entry, today = todayInputValue()) {
  const from = e.details.waitingSince ?? todayInputValue(new Date(e.created_at));
  return Math.max(0, daysBetween(from, today));
}

/** Solo los dígitos de un teléfono, como los quiere wa.me (sin + ni espacios). */
export const waDigits = (phone?: string) => (phone ?? '').replace(/[^\d]/g, '');
/** Enlace de WhatsApp con un mensaje listo (o null si la persona no tiene teléfono). */
export function whatsappLink(phone: string | undefined, text: string) {
  const digits = waDigits(phone);
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
/** Un mensaje amable para preguntar por algo que esperas. */
export function nudgeText(person: Person, what: string, days: number) {
  const name = person.name.split(' ')[0];
  const ago = days <= 0 ? '' : days === 1 ? ' desde ayer' : ` desde hace ${days} días`;
  return `Hola ${name}, ¿cómo vas con «${what.slice(0, 120)}»? Lo estoy esperando${ago}. ¡Gracias!`;
}

/** Compromisos abiertos de una persona, en los dos sentidos. */
export function commitmentsWith(personId: string, entries: Entry[]) {
  const open = entries.filter(
    (e) =>
      isOpenTask(e) &&
      (e.person_ids.includes(personId) ||
        e.details.owner === personId ||
        e.details.beneficiary === personId),
  );
  return {
    /** Lo que tú le debes (prometiste o quieres hacer con ella). */
    mine: open.filter((e) => ['prometi', 'quiero'].includes(commitmentOf(e))),
    /** Lo que esperas de ella. */
    theirs: open.filter((e) => ['espero', 'depende'].includes(commitmentOf(e))),
  };
}

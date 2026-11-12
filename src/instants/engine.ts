import { captureWithAssistant } from '../assistant';
import { captureContext } from '../capture/context';
import type { MyProfile, Workspace } from '../data';
import {
  planFromAi,
  proposeBatch,
  splitExperiences,
  type CapturePlan,
  type Piece,
} from '../lib/capture';
import { normalizeText } from '../lib/format';
import type { PieceJob } from './analysis';

/** Cuántas experiencias de una misma publicación afina la IA (las demás quedan con lo local). */
const AI_PLANS = 3;
/** Textos muy cortos no valen una consulta a la IA. */
const AI_MIN = 25;

const dated = (p: Piece) =>
  p.kind === 'encuentro' ||
  p.kind === 'movimiento' ||
  p.kind === 'novedad' ||
  p.kind === 'intercambio' ||
  p.kind === 'visita';

const same = (a: string, b: string) =>
  normalizeText(a).replace(/\s+/g, ' ').trim() === normalizeText(b).replace(/\s+/g, ' ').trim();

/**
 * Lo que elegiste al escribir manda sobre lo que Nexo dedujo: el ánimo, el día (si el texto no lo
 * dice), las personas (van en el encuentro) y el episodio. Y la «entrada al diario» que solo
 * repetiría el instante se apaga: el texto ya queda en él.
 */
function adjust(
  plan: CapturePlan,
  item: PieceJob['items'][number],
  job: PieceJob,
  ws: Workspace,
): CapturePlan {
  let next: CapturePlan = { ...plan };
  if (item.mood && !next.mood) next.mood = item.mood;
  if (item.date && !next.dateFrom && item.date !== next.date) {
    const date = item.date;
    next = {
      ...next,
      date,
      pieces: next.pieces.map((x) => (dated(x) ? ({ ...x, date } as Piece) : x)),
    };
  }
  const people = job.people.filter((id) => ws.people.some((p) => p.id === id));
  if (people.length)
    next = {
      ...next,
      pieces: next.pieces.map((x) =>
        x.kind === 'encuentro'
          ? { ...x, personIds: [...new Set([...people, ...x.personIds])] }
          : x,
      ),
    };
  // El lugar que marcaste: si el texto lo nombra, es ese; si el encuentro no dice dónde, fue ahí.
  const tagged = item.places ?? [];
  if (tagged.length)
    next = {
      ...next,
      pieces: next.pieces.map((x) => {
        if ((x.kind !== 'encuentro' && x.kind !== 'visita') || x.placeId) return x;
        const said = x.placeName.trim();
        const named = said ? tagged.find((p) => same(p.name, said)) : undefined;
        if (named) return { ...x, placeId: named.id, placeName: '' };
        if (!said && x.kind === 'encuentro') return { ...x, placeId: tagged[0].id, placeName: '' };
        return x;
      }),
    };
  const episode = job.episodeId ? ws.episodes.find((e) => e.id === job.episodeId) : undefined;
  if (episode)
    next = {
      ...next,
      episodeExisting: episode.id,
      episode: { ...next.episode, on: true, title: episode.title },
    };
  if (!job.keepText)
    next = {
      ...next,
      pieces: next.pieces.map((x) =>
        x.kind === 'nota' && x.on && same(x.text, next.text)
          ? { ...x, on: false, hint: 'Ya queda en tu instante.' }
          : x,
      ),
    };
  return next;
}

/** ¿Hay algo que valga la pena revisar? Una pieza, una persona nueva o un parentesco por guardar. */
const meaningful = (p: CapturePlan) =>
  p.pieces.some((x) => x.on) ||
  p.newPeople.some((n) => n.on) ||
  p.kinLinks.some((k) => k.personId && k.save);

/**
 * Lee lo que publicaste y propone sus piezas: primero con las reglas locales (al instante) y luego,
 * si hay IA, afina las primeras experiencias. Si la IA falla, queda lo local.
 */
export async function analyzeJob(
  job: PieceJob,
  ctx: { workspace: Workspace; me: MyProfile },
): Promise<Pick<PieceJob, 'plans' | 'initial' | 'planInstants'>> {
  const ws = ctx.workspace;
  const parts: { text: string; item: PieceJob['items'][number] }[] = [];
  for (const item of job.items)
    for (const text of splitExperiences(item.text)) parts.push({ text, item });
  if (!parts.length) return { plans: [], initial: [], planInstants: [] };

  const local = proposeBatch(
    parts.map((p) => p.text),
    ws,
  ).map((plan, i) => adjust(plan, parts[i].item, job, ws));

  let aiLeft = AI_PLANS;
  const context = captureContext(ws, ctx.me);
  const plans: CapturePlan[] = [];
  for (let i = 0; i < local.length; i++) {
    let plan = local[i];
    if (aiLeft > 0 && plan.text.trim().length >= AI_MIN) {
      aiLeft--;
      try {
        const raw = await captureWithAssistant(plan.text, context);
        plan = adjust(planFromAi(raw, plan, ws), parts[i].item, job, ws);
      } catch {
        // Sin IA (o con un error): queda lo que propuso Nexo por su cuenta.
      }
    }
    plans.push(plan);
  }

  const keep = plans.map((p, i) => ({ p, i })).filter(({ p }) => meaningful(p));
  return {
    plans: keep.map(({ p }) => p),
    // Lo que propuso Nexo por su cuenta: de ahí aprende cuando corriges (como en la captura).
    initial: keep.map(({ i }) => JSON.parse(JSON.stringify(local[i])) as CapturePlan),
    planInstants: keep.map(({ i }) => parts[i].item.id),
  };
}

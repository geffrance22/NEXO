import { supabase } from '../backend';
import { capture } from './capture';
import { savePictures } from './media';

type Mark = { id: string; start_offset: number; end_offset: number };
type Offsets = Pick<Mark, 'start_offset' | 'end_offset'>;

const minutes = (text: string) => Math.max(1, Math.ceil(text.length / 1200));

/**
 * Dónde queda un resaltado en el texto nuevo: la aparición de su mismo texto más cercana a la
 * posición que tenía (proporcional a la longitud de cada versión). Si no aparece, null.
 */
function relocate(before: string, after: string, m: Mark): Offsets | null {
  const piece = before.slice(m.start_offset, m.end_offset);
  if (!piece.trim()) return null;
  const expected = (m.start_offset / Math.max(1, before.length)) * after.length;
  let best = -1;
  for (let i = after.indexOf(piece); i >= 0; i = after.indexOf(piece, i + 1))
    if (best < 0 || Math.abs(i - expected) < Math.abs(best - expected)) best = i;
  return best < 0 ? null : { start_offset: best, end_offset: best + piece.length };
}

/**
 * Vuelve a descargar un artículo desde su enlace y reemplaza su título, texto e imágenes.
 * Los resaltados se recolocan buscando su texto en la versión nueva. Antes de reemplazar pide
 * permiso (`approve`) si el texto nuevo es mucho más corto o si algún resaltado no aparece.
 *
 * Devuelve la fila actualizada, `'same'` si el texto no cambió o `'cancelled'` si no se aprobó.
 */
export async function refetchReading<Row>(
  id: string,
  url: string,
  approve: (warning: string) => Promise<boolean>,
): Promise<{ row: Row; lost: number } | 'same' | 'cancelled'> {
  // Sin la caché del lector: si la primera vez la página llegó a medias, no se repite.
  const snap = await capture(url, { fresh: true });
  const [old, saved] = await Promise.all([
    supabase.from('readings').select('title,content,resume_at').eq('id', id).single(),
    supabase.from('reading_marks').select('id,start_offset,end_offset').eq('reading_id', id),
  ]);
  if (old.error) throw old.error;
  if (saved.error) throw saved.error;
  const before = String(old.data.content ?? '');
  if (before === snap.content) return 'same';

  const marks = (saved.data ?? []) as Mark[];
  const moves = marks.map((m) => ({ m, to: relocate(before, snap.content, m) }));
  const lost = moves.filter((x) => !x.to).length;
  const warnings: string[] = [];
  if (before.length > 1500 && snap.content.length < before.length * 0.6)
    warnings.push(
      `El texto nuevo es bastante más corto (${minutes(snap.content)} min frente a ${minutes(before)} min): puede que la página no se haya leído bien.`,
    );
  if (lost)
    warnings.push(
      lost === 1
        ? '1 resaltado no aparece en el texto nuevo y quedará descolocado.'
        : `${lost} resaltados no aparecen en el texto nuevo y quedarán descolocados.`,
    );
  if (warnings.length && !(await approve(warnings.join(' ')))) return 'cancelled';

  // Si la página solo devolvió el dominio como título, se conserva el que había.
  const title =
    snap.title === new URL(url).hostname && old.data.title ? String(old.data.title) : snap.title;
  const resume = Number(old.data.resume_at) || 0;
  const { data, error } = await supabase
    .from('readings')
    .update({
      title,
      content: snap.content,
      media: await savePictures(snap.content),
      // La posición de lectura ya no cabe en el texto nuevo: vuelve al principio.
      ...(resume > snap.content.length ? { resume_at: 0 } : {}),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;

  const moved = moves.filter(
    (x): x is { m: Mark; to: Offsets } =>
      x.to !== null &&
      (x.to.start_offset !== x.m.start_offset || x.to.end_offset !== x.m.end_offset),
  );
  const results = await Promise.all(
    moved.map((x) => supabase.from('reading_marks').update(x.to).eq('id', x.m.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return { row: data as Row, lost };
}

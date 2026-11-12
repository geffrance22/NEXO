import { useEffect, useRef } from 'react';
import type { Workspace } from '../data';
import type { Notify } from '../hooks/useToast';
import { peopleIn, placesIn } from './helpers';
import { importFromFediverse, loadFediverse, refreshShares, sharesState } from './share';
import { instantsState, linkInstant, loadInstants } from './store';

/** Al volver a la pestaña, se mira de nuevo si pasaron más de estos minutos desde la última vez. */
const EVERY = 3 * 60_000;

/** Los instantes de Mastodon que este navegador ya vio llegar (para avisar y enlazar una sola vez). */
const seenKey = (uid: string) => `nexo-fediverse-seen:${uid}`;
function readSeen(uid: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(seenKey(uid));
    if (raw === null) return null;
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return null;
  }
}
function saveSeen(uid: string, seen: Set<string>) {
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify([...seen]));
  } catch {
    /* Sin almacenamiento: se avisará de nuevo en la próxima revisión. */
  }
}

/**
 * Trae a Nexo lo que publicas en Mastodon: al abrir la app y cada vez que vuelves a ella (con un
 * mínimo de unos minutos entre una revisión y otra). Además, una vez al día lo hace el servidor
 * (cron), aunque Nexo esté cerrado: lo que llegó así se ve aquí al abrir, con su aviso. Si
 * compartir no está configurado, no hace nada.
 *
 * A cada instante que nace en Mastodon se le suman, una sola vez, las personas y lugares que el
 * texto nombra, como en cualquier instante. La búsqueda de piezas no se lanza sola: la decides tú
 * desde el menú del instante.
 */
export function useFediverseImport({
  uid,
  workspace,
  ready,
  notify,
  openInstants,
}: {
  uid: string;
  workspace: Workspace;
  /** Ya cargaron tus personas y lugares. */
  ready: boolean;
  notify: Notify;
  openInstants: (focus?: string) => void;
}) {
  const live = useRef({ workspace, notify, openInstants });
  live.current = { workspace, notify, openInstants };

  useEffect(() => {
    if (!ready) return;
    let last = 0;

    const check = async () => {
      last = Date.now();
      await loadFediverse();
      if (!sharesState().account || sharesState().missing) return;

      const r = await importFromFediverse();
      if (r.error) console.warn('Mastodon:', r.error);
      await refreshShares();
      // Espera a que estén cargados los instantes de siempre, para saber cuáles son nuevos.
      await loadInstants();
      const before = instantsState().list;
      if (!before) return;

      const born = [...sharesState().shares.values()].filter((s) => s.origin === 'mastodon');
      const have = new Set(before.map((i) => i.id));
      // Llegó algo con la app abierta (esta revisión o el cron del servidor): se recarga la lista.
      if (r.imported.length || r.updated.length || born.some((s) => !have.has(s.instant_id)))
        await loadInstants(true);
      const byId = new Map((instantsState().list ?? []).map((i) => [i.id, i]));
      const here = born.filter((s) => byId.has(s.instant_id));

      // La primera vez en este navegador no se anuncia lo anterior; solo lo que llegó ahora.
      let seen = readSeen(uid);
      if (!seen) {
        const now = new Set(r.imported.map((b) => b.id));
        seen = new Set(here.map((s) => s.instant_id).filter((id) => !now.has(id)));
        saveSeen(uid, seen);
      }
      const fresh = here
        .filter((s) => !seen!.has(s.instant_id))
        .map((s) => byId.get(s.instant_id)!)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      const { workspace: ws, notify: say, openInstants: open } = live.current;
      if (fresh.length) {
        for (const i of fresh) {
          seen.add(i.id);
          const person_ids = peopleIn(i.body, [], ws);
          const place_ids = placesIn(i.body, [], ws);
          if (person_ids.length || place_ids.length) void linkInstant(i.id, { person_ids, place_ids });
        }
        saveSeen(uid, seen);
        const n = fresh.length;
        say(
          n === 1
            ? 'Un post de Mastodon llegó a tus Instantes.'
            : `${n} posts de Mastodon llegaron a tus Instantes.`,
          { label: 'Ver', icon: 'open', run: () => open(fresh[n - 1].id) },
        );
      } else if (r.updated.length) {
        const n = r.updated.length;
        say(
          n === 1
            ? 'Un instante se actualizó con lo que editaste en Mastodon.'
            : `${n} instantes se actualizaron con lo que editaste en Mastodon.`,
        );
      }
    };

    void check();
    const onShow = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > EVERY) void check();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
    // Una sola vez cuando todo está cargado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid]);
}

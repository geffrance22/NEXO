import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Folder, Images, Star } from 'lucide-react';
import { useApp } from '../../AppContext';
import { childrenMap, flatTree, sortShots, subtree, type CapSort, type Shot } from '../../capturas/model';
import { openCapturasFolder, peekShot } from '../../capturas/nav';
import { useCapturas } from '../../capturas/useCapturas';
import { goLibroteca } from '../../library/shelf';
import { Card } from '../Card';
import { Mosaic, rowHeight } from '../Mosaic';
import { bool, num, str, type BlockProps, type Choice } from '../types';

/** Las carpetas de CAPTURAS como opciones del ajuste «Qué carpeta». */
export function useFolderChoices(): Choice[] {
  const { folders } = useCapturas();
  return useMemo(
    () => [
      { value: 'recientes', label: 'Las más recientes (todas)' },
      { value: 'favoritas', label: 'Favoritas' },
      { value: 'raiz', label: 'CAPTURAS (carpeta principal)' },
      ...flatTree(folders ?? []).map(({ folder, depth }) => ({
        value: folder.id,
        label: `${'   '.repeat(depth)}${depth ? '└ ' : ''}${folder.name}`,
      })),
    ],
    [folders],
  );
}

/**
 * Una carpeta de CAPTURAS en Mi espacio: sus imágenes y sus subcarpetas, para mirarlas (y entrar
 * en las subcarpetas) sin ir a Libroteca. Al tocar una imagen se abre encima.
 */
export function CapturasBlock({ opts, zone }: BlockProps) {
  const { go } = useApp();
  const { folders, shots, missing } = useCapturas();
  const base = str(opts, 'folder', 'recientes');
  const [cwd, setCwd] = useState<string | null>(null);
  useEffect(() => setCwd(null), [base]);
  const here = cwd ?? base;
  const isFolder = here !== 'recientes' && here !== 'favoritas';
  const folderId = here === 'raiz' ? null : isFolder ? here : null;
  const kids = useMemo(() => childrenMap(folders ?? []), [folders]);
  const byId = useMemo(() => new Map((folders ?? []).map((f) => [f.id, f])), [folders]);
  const withSub = bool(opts, 'sub', false);

  const list = useMemo(() => {
    const live = (shots ?? []).filter((s) => !s.archived_at);
    let pool: Shot[];
    if (here === 'recientes') pool = live;
    else if (here === 'favoritas') pool = live.filter((s) => s.favorite);
    else if (withSub && folderId) {
      const ids = subtree(folders ?? [], [folderId]);
      pool = live.filter((s) => s.folder_id && ids.has(s.folder_id));
    } else pool = live.filter((s) => s.folder_id === folderId);
    return sortShots(pool, (str(opts, 'sort', 'reciente') as CapSort) || 'reciente');
  }, [shots, folders, here, folderId, withSub, opts.sort]);

  const count = num(opts, 'count', 9);
  const shown = list.slice(0, count);
  const row = rowHeight(opts.size, zone);
  const sub = isFolder && bool(opts, 'folders', true) ? (kids.get(folderId) ?? []) : [];
  const countIn = (id: string) => {
    const ids = subtree(folders ?? [], [id]);
    return (shots ?? []).filter((s) => !s.archived_at && s.folder_id && ids.has(s.folder_id)).length;
  };
  const title =
    here === 'recientes'
      ? 'Capturas'
      : here === 'favoritas'
        ? 'Capturas favoritas'
        : here === 'raiz'
          ? 'CAPTURAS'
          : (byId.get(here)?.name ?? 'Carpeta');
  const parentOf = (id: string) => byId.get(id)?.parent_id ?? null;
  const openAll = () => {
    openCapturasFolder(folderId);
    goLibroteca(go, 'capturas');
  };

  return (
    <Card
      zone={zone}
      opts={opts}
      icon={here === 'favoritas' ? Star : Images}
      tone="#4f6b3d"
      title={
        cwd ? (
          <button
            type="button"
            className="hk-crumb"
            onClick={() => {
              const up = cwd === 'raiz' ? null : parentOf(cwd);
              // Subir hasta la carpeta del bloque; más arriba ya no es «esta» carpeta.
              setCwd(up && up !== base ? up : null);
            }}
            title="Volver"
          >
            <ChevronLeft size={14} /> {title}
          </button>
        ) : (
          title
        )
      }
      count={list.length}
      link="Abrir"
      onLink={openAll}
      empty={missing || (shots !== null && !list.length && !sub.length)}
      emptyText={missing ? 'Prepara CAPTURAS en Libroteca para usar este bloque.' : 'Esta carpeta está vacía.'}
    >
      {shots === null ? (
        <div className="hk-justify">
          {Array.from({ length: Math.min(count, 6) }, (_, i) => (
            <span key={i} className="hk-jt skel" style={{ flexGrow: 1.5, flexBasis: 1.5 * row + 'px', height: row }} />
          ))}
        </div>
      ) : (
        <>
          {sub.length > 0 && (
            <div className="hk-folders">
              {sub.map((f) => (
                <button type="button" key={f.id} onClick={() => setCwd(f.id)} title={`Abrir ${f.name}`}>
                  <Folder size={13} /> <span>{f.name}</span> <i>{countIn(f.id)}</i>
                </button>
              ))}
            </div>
          )}
          {shown.length > 0 && (
            <Mosaic
              row={row}
              items={shown.map((s) => ({
                key: s.id,
                src: s.thumb ?? s.url,
                srcSet: s.thumb ? `${s.thumb} 280w, ${s.url} ${s.width ?? 1600}w` : undefined,
                ratio: s.width && s.height ? s.width / s.height : undefined,
                title: s.name,
                star: s.favorite,
                onOpen: () => peekShot(s.id),
              }))}
            />
          )}
          {list.length > shown.length && (
            <button type="button" className="hc-more" onClick={openAll}>
              Ver las {list.length.toLocaleString('es-CO')} en CAPTURAS
            </button>
          )}
        </>
      )}
    </Card>
  );
}

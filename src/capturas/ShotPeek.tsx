import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../AppContext";
import { CapLightbox } from "./CapLightbox";
import { pathOf, type Shot } from "./model";
import { onPeekShot } from "./nav";
import { removeItems, setFavorite, useCapturasWhen } from "./useCapturas";
import "./capturas.css";

/**
 * Visor de una captura abierto desde cualquier sección (p. ej. el buscador global): se ve encima
 * de donde estás y al cerrarlo sigues ahí, sin pasar por CAPTURAS.
 */
export function ShotPeek() {
  const { confirm, notify } = useApp();
  const [id, setId] = useState<string | null>(null);
  const { shots, folders } = useCapturasWhen(id !== null);

  useEffect(() => onPeekShot(setId), []);

  const shot = useMemo(
    () => (id ? shots?.find((s) => s.id === id) : undefined),
    [id, shots],
  );
  const list = useMemo(() => (shot ? [shot] : []), [shot]);

  const folderName = useCallback(
    (s: Shot) => {
      if (s.archived_at) return "CAPTURAS › Archivadas";
      const path = s.folder_id ? pathOf(folders ?? [], s.folder_id) : [];
      return ["CAPTURAS", ...path.map((f) => f.name)].join(" › ");
    },
    [folders],
  );

  if (!id || !shot) return null;

  const onDelete = async (s: Shot) => {
    const ok = await confirm({
      title: "¿Eliminar esta captura?",
      message: "También se borra de YourImageShare. No se puede deshacer.",
      confirmLabel: "Eliminar",
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    const res = await removeItems({ shots: [s.id] });
    if (typeof res === "string") return notify(res);
    setId(null);
    notify("Captura eliminada.");
  };
  const onFavorite = async (s: Shot) => {
    const res = await setFavorite([s.id], !s.favorite);
    if (typeof res === "string") notify(res);
  };

  return (
    <CapLightbox
      key={shot.id}
      shots={list}
      startId={shot.id}
      onClose={() => setId(null)}
      onDelete={(s) => void onDelete(s)}
      onFavorite={(s) => void onFavorite(s)}
      folderName={folderName}
    />
  );
}

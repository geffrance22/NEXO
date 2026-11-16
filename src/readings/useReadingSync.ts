import { useEffect } from "react";
import { flush, OFFLINE_SYNCED, setOfflineOwner } from "./offline";

type Notify = (message: string) => void;

/**
 * Envía los cambios de Lecturas hechos sin conexión en cuanto vuelve (aunque estés en otra
 * sección) y avisa cuando quedaron guardados.
 */
export function useReadingSync(uid: string, notify: Notify) {
  setOfflineOwner(uid);
  useEffect(() => {
    setOfflineOwner(uid);
    const kick = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    const onSynced = (e: Event) => {
      const { sent = 0, dropped = 0 } = (e as CustomEvent<{ sent: number; dropped: number }>)
        .detail ?? {};
      if (sent)
        notify(
          sent === 1
            ? "Lecturas: se guardó el cambio que hiciste sin conexión."
            : `Lecturas: se guardaron los ${sent} cambios que hiciste sin conexión.`,
        );
      if (dropped)
        notify(
          dropped === 1
            ? "Lecturas: un cambio sin conexión ya no se pudo aplicar (el artículo cambió o se borró)."
            : `Lecturas: ${dropped} cambios sin conexión ya no se pudieron aplicar.`,
        );
    };
    kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(OFFLINE_SYNCED, onSynced);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(OFFLINE_SYNCED, onSynced);
    };
  }, [uid, notify]);
}

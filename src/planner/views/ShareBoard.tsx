import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Eye, Link2, LoaderCircle, Trash2, X } from "lucide-react";
import { supabase } from "../../backend";
import { useApp } from "../../AppContext";
import type { Board } from "../boardStore";
import { isMissingPhase2, missingPhase2Text } from "../boardPhase";

type Share = { token: string; created_at: string };

/** 32 caracteres al azar, aptos para una URL. */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export const shareUrl = (token: string) =>
  `${location.origin}${location.pathname}?ver=${encodeURIComponent(token)}`;

/**
 * Enlace de solo lectura para un cliente: ve las columnas y las tarjetas sin archivar (títulos,
 * descripción, listas, etiquetas y fechas), nunca personas, pendientes ni nada más de tu cuenta.
 * Se puede revocar cuando quieras.
 */
export function ShareBoardDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { notify } = useApp();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void supabase
      .from("board_shares")
      .select("token,created_at")
      .eq("board_id", board.id)
      .is("revoked_at", null)
      .order("created_at")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setError(isMissingPhase2(error) || error.code === "42P01" || error.code === "PGRST205" ? missingPhase2Text : error.message);
          setShares([]);
        } else setShares((data ?? []) as Share[]);
      });
    return () => {
      live = false;
    };
  }, [board.id]);

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      notify("Enlace copiado.");
    } catch {
      notify("No se pudo copiar: selecciona el enlace y cópialo.");
    }
  };
  const create = async () => {
    setBusy(true);
    const token = newToken();
    const { error } = await supabase.from("board_shares").insert({ token, board_id: board.id });
    setBusy(false);
    if (error) {
      setError(isMissingPhase2(error) || error.code === "42P01" || error.code === "PGRST205" ? missingPhase2Text : error.message);
      return;
    }
    setShares((s) => [...(s ?? []), { token, created_at: new Date().toISOString() }]);
    void copy(token);
  };
  const revoke = async (token: string) => {
    const before = shares;
    setShares((s) => (s ?? []).filter((x) => x.token !== token));
    const { error } = await supabase
      .from("board_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", token);
    if (error) {
      setShares(before);
      notify("No se pudo revocar: " + error.message);
    } else notify("Enlace revocado: ya no abre el tablero.");
  };

  return createPortal(
    <div className="bv-modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="bv-modal bv-share"
        role="dialog"
        aria-modal="true"
        aria-label={`Compartir «${board.name}»`}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="bv-modal-head">
          <div>
            <strong>
              <Eye size={15} /> Enlace de solo lectura
            </strong>
            <span>
              Quien tenga el enlace ve las columnas y tarjetas de «{board.name.slice(0, 60)}» sin
              poder cambiar nada. No ve personas, pendientes ni el resto de tu Nexo.
            </span>
          </div>
          <button type="button" className="bv-icon" aria-label="Cerrar" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {error && <p className="bv-share-error">{error}</p>}
        {shares === null ? (
          <p className="bv-share-empty">
            <LoaderCircle className="spin" size={16} />
          </p>
        ) : (
          <ul className="bv-share-list">
            {shares.map((s) => (
              <li key={s.token}>
                <Link2 size={14} />
                <input readOnly value={shareUrl(s.token)} onFocus={(e) => e.target.select()} aria-label="Enlace" />
                <button type="button" className="bv-icon" title="Copiar" aria-label="Copiar el enlace" onClick={() => void copy(s.token)}>
                  <Copy size={14} />
                </button>
                <button type="button" className="bv-icon danger" title="Revocar" aria-label="Revocar el enlace" onClick={() => void revoke(s.token)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {!shares.length && !error && <li className="bv-share-empty">Aún no hay enlaces.</li>}
          </ul>
        )}
        <footer className="bv-modal-foot">
          <button type="button" className="bd-btn primary" disabled={busy || Boolean(error)} onClick={() => void create()}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />} Crear enlace y copiarlo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

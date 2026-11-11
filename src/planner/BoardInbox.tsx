import { useEffect, useRef } from "react";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import { isMissingPhase2 } from "./boardPhase";
import { BOARDS_CHANGED } from "./boardStore";
import { BOARD_GO, BOARD_LAST } from "./boardView";

/**
 * Recordatorios de tarjetas y avisos del servidor. Con la app abierta, avisa ella misma al llegar
 * la hora de una tarjeta; los avisos que dejó el servidor (board-sweep, con pg_cron) mientras no
 * estabas aparecen al volver. Cada aviso sale una sola vez: la tarjeta queda con `reminded_at` y
 * el aviso del servidor, leído.
 */
type InboxRow = {
  id: number;
  board_id: string | null;
  card_id: string | null;
  kind: "reminder" | "rule";
  title: string;
  body: string;
};
type Due = {
  id: string;
  title: string;
  list_id: string;
  board_id: string;
  board_name: string;
  remind_at: string;
};

/** ¿Falta la tabla o la columna (no se ejecutó la migración)? Un corte de red no cuenta. */
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "42703" ||
  e.code === "PGRST204" ||
  e.code === "PGRST205" ||
  isMissingPhase2(e);

const CHECK_EVERY = 20_000;
const INBOX_EVERY = 2 * 60_000;

function systemNotice(title: string, body: string, tag: string, onClick: () => void) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: new URL("./nexo-favicon.svg", location.href).href,
    });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* Algunos navegadores solo permiten notificaciones desde un service worker. */
  }
}

export function BoardInbox() {
  const { go, notify } = useApp();
  const nav = useRef({ go, notify });
  nav.current = { go, notify };
  // Cada consulta se apaga sola solo si falta su tabla; un corte de red no la apaga.
  const missing = useRef({ cards: false, inbox: false });

  const open = (boardId: string | null | undefined, listId?: string | null, cardId?: string | null) => {
    if (boardId) {
      localStorage.setItem(BOARD_LAST, boardId);
      sessionStorage.setItem(
        BOARD_GO,
        JSON.stringify({ list: listId ?? undefined, card: cardId ?? undefined }),
      );
    }
    nav.current.go("Tableros");
  };

  // Recordatorios con la app abierta: las tarjetas con aviso pendiente (pocas) se leen aparte.
  useEffect(() => {
    let list: Due[] = [];
    let live = true;
    const load = async () => {
      if (missing.current.cards) return;
      const { data, error } = await supabase
        .from("planner_board_cards")
        .select("id,title,list_id,board_id,board_name,remind_at")
        .not("remind_at", "is", null)
        .is("reminded_at", null)
        .is("archived_at", null)
        .limit(500);
      if (!live) return;
      if (error) {
        if (isMissing(error)) missing.current.cards = true;
        return;
      }
      list = (data ?? []) as Due[];
      void check();
    };
    const check = async () => {
      const now = Date.now();
      const due = list.filter((c) => new Date(c.remind_at).getTime() <= now);
      if (!due.length) return;
      list = list.filter((c) => !due.includes(c));
      // Se «reclama» cada aviso: si el servidor ya lo dio, no se repite aquí.
      const { data: won, error } = await supabase
        .from("board_cards")
        .update({ reminded_at: new Date().toISOString() })
        .in(
          "id",
          due.map((c) => c.id),
        )
        .is("reminded_at", null)
        .select("id");
      if (error) return;
      window.dispatchEvent(new Event(BOARDS_CHANGED));
      const claimed = new Set(((won ?? []) as { id: string }[]).map((r) => r.id));
      const mine = due.filter((c) => claimed.has(c.id));
      if (!mine.length) return;
      const first = mine[0];
      const text =
        mine.length === 1
          ? `Recordatorio: «${first.title.slice(0, 80)}» (${first.board_name})`
          : `Tienes ${mine.length} recordatorios de tarjetas, empezando por «${first.title.slice(0, 60)}».`;
      const go = () => open(first.board_id, first.list_id, first.id);
      nav.current.notify(text, { label: "Abrir", icon: "open", run: go });
      systemNotice("Nexo · Recordatorio", text.replace(/^Recordatorio: /, ""), "nexo-card-" + first.id, go);
    };
    void load();
    const t = window.setInterval(() => void check(), CHECK_EVERY);
    const slow = window.setInterval(() => void load(), 5 * 60_000);
    let soon = 0;
    const onChange = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void load(), 2000);
    };
    window.addEventListener(BOARDS_CHANGED, onChange);
    return () => {
      live = false;
      window.clearInterval(t);
      window.clearInterval(slow);
      window.clearTimeout(soon);
      window.removeEventListener(BOARDS_CHANGED, onChange);
    };
  }, []);

  // Lo que dejó el servidor.
  useEffect(() => {
    const load = async () => {
      if (missing.current.inbox || document.hidden) return;
      const { data, error } = await supabase
        .from("board_inbox")
        .select("id,board_id,card_id,kind,title,body")
        .is("read_at", null)
        .order("created_at")
        .limit(20);
      if (error) {
        // Sin la migración 202611100009 no hay avisos del servidor.
        if (isMissing(error)) missing.current.inbox = true;
        return;
      }
      const rows = (data ?? []) as InboxRow[];
      if (!rows.length) return;
      void supabase
        .from("board_inbox")
        .update({ read_at: new Date().toISOString() })
        .in(
          "id",
          rows.map((r) => r.id),
        );
      const first = rows[0];
      const text =
        rows.length === 1
          ? first.body
            ? `${first.title}: ${first.body}`
            : first.title
          : `${rows.length} avisos de tus tableros. ${first.title}.`;
      nav.current.notify(text.slice(0, 220), {
        label: "Abrir",
        icon: "open",
        run: () => open(first.board_id, null, first.card_id),
      });
      if (first.kind === "reminder")
        systemNotice("Nexo · Tableros", text.slice(0, 220), "nexo-inbox-" + first.id, () =>
          open(first.board_id, null, first.card_id),
        );
    };
    void load();
    const t = window.setInterval(load, INBOX_EVERY);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}

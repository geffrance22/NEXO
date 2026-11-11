import { useMemo } from "react";
import { useApp } from "../AppContext";
import type { Entry } from "../data";
import { todayInputValue } from "../lib/format";
import { useBoardFeed, type FeedCard } from "./boardFeed";
import { cardPeople } from "./boardPeople";

/**
 * Lo abierto con una persona en los tableros: las tarjetas que la tienen (en su pendiente o como
 * persona antigua), sin completar ni pospuestas, de tableros que siguen activos. Sirve para su
 * ficha y para el resumen de antes de verla.
 */
export function cardsWithPerson(
  cards: FeedCard[],
  entries: Map<string, Entry>,
  personId: string,
  today = todayInputValue(),
): FeedCard[] {
  return cards
    .filter((c) => {
      if (c.archived_at || c.board_archived_at) return false;
      const task = c.entry_id ? entries.get(c.entry_id) : undefined;
      const done = task ? task.status === "completado" : c.done;
      if (done) return false;
      if (c.snoozed_until && c.snoozed_until > today) return false;
      return cardPeople(c, task).includes(personId);
    })
    .sort(
      (a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.title.localeCompare(b.title, "es"),
    );
}

/** Las tarjetas abiertas con esa persona, siempre al día con los tableros. */
export function usePersonCards(personId: string) {
  const { workspace } = useApp();
  const feed = useBoardFeed();
  return useMemo(() => {
    const byId = new Map(workspace.entries.map((e) => [e.id, e]));
    const cards = cardsWithPerson(feed.cards, byId, personId);
    return {
      cards,
      /** Los pendientes que nacieron en esas tarjetas (para no mostrarlos dos veces). */
      entryIds: new Set(cards.flatMap((c) => (c.entry_id ? [c.entry_id] : []))),
    };
  }, [feed.cards, workspace.entries, personId]);
}

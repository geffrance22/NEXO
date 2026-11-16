import { useEffect } from 'react';
import type { Page } from '../data';

const KEY = 'nexo-land';
/** Una petición vieja (la página nunca llegó a abrirse) no debe aplicarse en una visita posterior. */
const TTL = 5000;

type Landing = { page: Page; tab: string; at: number };

/**
 * Pide abrir una sección en una pestaña concreta (p. ej. desde la barra inferior del celular). Va
 * justo antes de `go(page)`: cada navegación vuelve a montar la página, que la lee al arrancar.
 */
export function landOn(page: Page, tab: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ page, tab, at: Date.now() } satisfies Landing));
  } catch {
    /* Sin almacenamiento: la sección abre en su pestaña de siempre. */
  }
}

/** La pestaña pedida para `page`, si hay una reciente. No la borra (ver `useLanded`). */
export function landingTab(page: Page): string | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<Landing> | null;
    if (!r || r.page !== page || typeof r.tab !== 'string') return null;
    if (typeof r.at !== 'number' || Date.now() - r.at > TTL) return null;
    return r.tab;
  } catch {
    return null;
  }
}

/**
 * Borra la petición una vez montada la página. Va en un efecto y no al calcular el estado: en
 * modo estricto React calcula el estado inicial dos veces y la segunda ya no la encontraría.
 */
export function useLanded(page: Page) {
  useEffect(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<Landing> | null;
      if (r?.page === page) sessionStorage.removeItem(KEY);
    } catch {
      /* Nada que borrar. */
    }
  }, [page]);
}

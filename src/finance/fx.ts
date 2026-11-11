import { todayInputValue } from '../lib/format';

/** Monedas que se pueden registrar además del peso. */
export const currencies = ['COP', 'USD', 'EUR'] as const;
export type Currency = (typeof currencies)[number];

const KEY = 'nexo-fx';

type Cache = { day: string; rates: Partial<Record<Currency, number>> };

function readCache(): Cache {
  try {
    const c = JSON.parse(sessionStorage.getItem(KEY) ?? '') as Cache;
    if (c.day === todayInputValue()) return c;
  } catch {
    /* sin caché */
  }
  return { day: todayInputValue(), rates: {} };
}

/**
 * Pesos por unidad de la moneda, con la tasa del día. El dólar usa la TRM oficial de la
 * Superfinanciera (datos.gov.co); el resto, open.er-api.com. Ambos son gratis y sin clave.
 * null si no hay conexión (la tasa se puede escribir a mano).
 */
export async function rateToCop(cur: Currency): Promise<number | null> {
  if (cur === 'COP') return 1;
  const cache = readCache();
  if (cache.rates[cur]) return cache.rates[cur]!;
  let rate: number | null = null;
  if (cur === 'USD') {
    try {
      const r = await fetch(
        'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1',
      );
      const rows = (await r.json()) as { valor?: string }[];
      const v = Number(rows[0]?.valor);
      if (v > 0) rate = v;
    } catch {
      /* se intenta con el otro servicio */
    }
  }
  if (!rate)
    try {
      const r = await fetch(`https://open.er-api.com/v6/latest/${cur}`);
      const j = (await r.json()) as { rates?: Record<string, number> };
      const v = j.rates?.COP;
      if (v && v > 0) rate = v;
    } catch {
      /* sin conexión */
    }
  if (rate) {
    cache.rates[cur] = rate;
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  }
  return rate;
}
